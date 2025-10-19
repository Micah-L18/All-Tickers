const { createDatabaseManager } = require('../db/database-factory');
const axios = require('axios');
const { RateLimitError, isRateLimitError, handleRateLimitError } = require('../return-data/return-data');
const yahooFinance = require('yahoo-finance2').default;

class FastTickerValidator {
    constructor() {
        this.dbManager = null; // Will be initialized in initDatabase
        // Using the same high-performance settings from the old validator
        this.batchSize = 500; // Increased batch size
        this.delayMs = 200; // Reduced delay
        this.concurrentRequests = 25; // Allow multiple concurrent requests
        this.timeoutMs = 3000; // Faster timeout
        this.maxRetries = 3; // Maximum database retry attempts
        this.busyTimeout = 30000; // 30 second busy timeout
        
        // Session refresh system to prevent rate limiting
        this.requestCount = 0;
        this.refreshInterval = 10000; // Refresh every 10,000 requests
        
        // User agent rotation like old validator
        this.userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101'
        ];
    }

    async initialize() {
        this.dbManager = await createDatabaseManager();
        console.log('✅ SQLite connection established');
    }

    // Get random user agent for each request
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    // Get a random active ticker for session refresh to avoid rate limiting on AAPL
    async getRandomActiveTicker() {
        try {
            // Get a few random active tickers from database
            const query = `
                SELECT symbol 
                FROM tickers 
                WHERE active = 1 
                    AND updated_at > datetime('now', '-7 days')
                ORDER BY RANDOM() 
                LIMIT 5
            `;
            
            const result = await this.dbManager.query(query);
            
            if (result.rows.length > 0) {
                // Return a random ticker from the results
                const randomTicker = result.rows[Math.floor(Math.random() * result.rows.length)];
                return randomTicker.symbol;
            }
        } catch (error) {
            console.log('⚠️  Could not get random active ticker:', error.message);
        }
        
        // Fallback to a list of reliable tickers if database query fails
        const fallbackTickers = ['MSFT', 'GOOGL', 'TSLA', 'AMZN', 'META', 'NVDA', 'JPM', 'JNJ'];
        return fallbackTickers[Math.floor(Math.random() * fallbackTickers.length)];
    }

    // Session refresh system from old validator
    async refreshSession() {
        try {
            console.log('🔄 Refreshing session to prevent rate limiting...');
            
            // Use random active ticker instead of always AAPL
            const refreshSymbol = await this.getRandomActiveTicker();
            console.log(`📊 Using ${refreshSymbol} for session refresh`);
            
            const refreshUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${refreshSymbol}`;
            await axios.get(refreshUrl, {
                timeout: this.timeoutMs * 2, // Longer timeout for refresh
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            });
            console.log('✅ Session refreshed successfully');
            await new Promise(resolve => setTimeout(resolve, 3000)); // Longer pause after refresh
        } catch (error) {
            console.log('⚠️  Session refresh warning (continuing anyway):', error.message);
            // Wait longer if refresh failed
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    // Get unvalidated tickers (symbols without active status set)
    async getUnvalidatedTickers(limit = null) {
        let query = 'SELECT symbol FROM tickers WHERE active IS NULL';
        if (limit) {
            query += ` LIMIT ${limit}`;
        }
        const result = await this.dbManager.query(query);
        return result.rows.map(row => row.symbol);
    }

    // Fast ticker validation - just check if price exists
    async validateTickerFast(symbol) {
        try {
            this.requestCount++;
            
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
            const response = await axios.get(url, {
                timeout: this.timeoutMs,
                headers: {
                    'User-Agent': this.getRandomUserAgent()
                }
            });

            // Check for rate limiting in response
            if (isRateLimitError(response)) {
                throw new RateLimitError(`Rate limit detected for ${symbol}`);
            }

            if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result.length > 0) {
                const result = response.data.chart.result[0];
                const meta = result.meta;
                
                if (meta && meta.regularMarketPrice && meta.regularMarketPrice > 0) {
                    return {
                        symbol,
                        active: true,
                        price: meta.regularMarketPrice,
                        exchange: meta.exchangeName || 'Unknown'
                    };
                }
            }
            
            return { symbol, active: false, price: -1, exchange: null }; // -1 indicates validated but inactive
            
        } catch (error) {
            if (error instanceof RateLimitError || isRateLimitError(error)) {
                throw error; // Let rate limiting bubble up
            }
            
            return { symbol, active: false, price: -1, exchange: null }; // -1 indicates validated but inactive
        }
    }

    // Validate multiple tickers concurrently like old validator
    async validateTickersConcurrent(symbols) {
        const promises = symbols.map(symbol => this.validateTickerFast(symbol));
        const results = await Promise.allSettled(promises);
        
        return results.map((result, index) => ({
            symbol: symbols[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : { symbol: symbols[index], active: false, price: null, exchange: null }
        }));
    }

    // Update ticker status in database
    async updateTickerStatus(symbol, active, price = null) {
        if (active) {
            // When marking ticker as active, set updated_at to old date so it appears in "needs data update"
            // This ensures newly validated active tickers will be picked up by the gather data process
            const query = `UPDATE tickers 
                          SET active = ?, 
                              updated_at = datetime('2000-01-01') 
                          WHERE symbol = ?`;
            await this.dbManager.query(query, [1, symbol]);
        } else {
            // When marking ticker as inactive, just update the active status
            const query = 'UPDATE tickers SET active = ? WHERE symbol = ?';
            await this.dbManager.query(query, [0, symbol]);
        }
    }

    // Validate a single ticker (for API endpoint)
    async validateSingleTicker(symbol) {
        try {
            // Ensure database connection
            if (!this.dbManager) {
                await this.initialize();
            }

            // Validate the ticker
            const validationResult = await this.validateTickerFast(symbol);
            
            // Update the database
            await this.updateTickerStatus(symbol, validationResult.active, validationResult.price);

            return {
                symbol: validationResult.symbol,
                active: validationResult.active,
                price: validationResult.price,
                exchange: validationResult.exchange,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error validating single ticker ${symbol}:`, error);
            throw error;
        }
    }

    // Bulk update tickers with retry logic like old validator
    async bulkUpdateTickers(tickerResults) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.bulkUpdateTickersAttempt(tickerResults);
            } catch (error) {
                console.error(`❌ Database update attempt ${attempt} failed:`, error.message);
                
                if (attempt === this.maxRetries) {
                    throw error;
                }
                
                // Wait before retrying with exponential backoff
                const waitTime = 1000 * attempt;
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    // Single attempt at bulk database update
    async bulkUpdateTickersAttempt(tickerResults) {
        let completed = 0;
        let errors = 0;

        for (const { symbol, data } of tickerResults) {
            try {
                // Update ticker status only (no historical data fetching)
                await this.updateTickerStatus(symbol, data.active, data.price);
                completed++;
            } catch (error) {
                errors++;
                console.error(`❌ Error updating ${symbol}:`, error.message);
            }
        }

        return { completed, errors };
    }

    // Process batch with concurrent validation like old validator
    async processBatchFast(symbols) {
        const results = {
            validated: 0,
            active: 0,
            inactive: 0,
            errors: 0
        };

        console.log(`🚀 Fast validating batch of ${symbols.length} symbols with ${this.concurrentRequests} concurrent requests...`);
        
        // Process in concurrent chunks
        const chunks = [];
        for (let i = 0; i < symbols.length; i += this.concurrentRequests) {
            chunks.push(symbols.slice(i, i + this.concurrentRequests));
        }
        
        const allResults = [];
        
        for (const chunk of chunks) {
            const chunkResults = await this.validateTickersConcurrent(chunk);
            allResults.push(...chunkResults);
            
            // Count results
            chunkResults.forEach(({ success, data, symbol }) => {
                results.validated++;
                if (success && data.active) {
                    results.active++;
                    console.log(`✅ Found active: ${symbol} - ${data.exchange} - $${data.price}`);
                } else {
                    results.inactive++;
                }
            });
            
            // Small delay between chunks
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Bulk update database
        try {
            const updateResults = await this.bulkUpdateTickers(allResults.map(r => ({ 
                symbol: r.symbol, 
                data: r.data 
            })));
            console.log(`💾 Database updated: ${updateResults.completed} symbols, ${updateResults.errors} errors`);
        } catch (error) {
            console.error('❌ Bulk update failed after all retries:', error);
            results.errors += allResults.length;
        }
        
        return results;
    }

    // Get current database statistics
    async getStats() {
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN active = true THEN 1 END) as active_count,
                COUNT(CASE WHEN active = false THEN 1 END) as inactive_count,
                COUNT(CASE WHEN active IS NULL THEN 1 END) as unvalidated_count
            FROM tickers
        `;
        
        const result = await this.dbManager.query(query);
        return result.rows[0];
    }

    // Calculate ETA like old validator
    calculateETA(remainingTickers, tickersPerSecond) {
        const remainingSeconds = Math.ceil(remainingTickers / tickersPerSecond);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    async close() {
        await this.dbManager.disconnect();
        console.log('✅ Database connections closed');
    }
}

// Main execution function
async function main() {
    console.log('⚡ Fast Ticker Validator - SQLite Edition');
    console.log('============================================');
    
    const validator = new FastTickerValidator();
    let shouldRestart = false;
    
    do {
        try {
            shouldRestart = false;
            await validator.initialize();
            
            // Get initial stats
            const initialStats = await validator.getStats();
            console.log(`📊 Database Status:`);
            console.log(`   Total: ${initialStats.total}`);
            console.log(`   ✅ Active: ${initialStats.active_count}`);
            console.log(`   ❌ Inactive: ${initialStats.inactive_count}`);
            console.log(`   ⏳ Unvalidated: ${initialStats.unvalidated_count}`);
            
            // Get tickers to validate
            const tickersToValidate = await validator.getUnvalidatedTickers();
            
            if (tickersToValidate.length === 0) {
                console.log('🎉 All tickers have been validated!');
                break;
            }
            
            console.log(`🎯 Found ${tickersToValidate.length} symbols to validate`);
            console.log(`⚡ Configuration: ${validator.batchSize} per batch, ${validator.concurrentRequests} concurrent, ${validator.delayMs}ms delay`);
            
            // Calculate estimated time
            const tickersPerSecond = validator.concurrentRequests / (validator.delayMs / 1000 + 0.5);
            const eta = validator.calculateETA(tickersToValidate.length, tickersPerSecond);
            console.log(`⏱️  Estimated completion time: ${eta}`);
            
            // Process tickers in batches
            const totalResults = {
                validated: 0,
                active: 0,
                inactive: 0,
                errors: 0
            };
            
            const startTime = Date.now();
            
            for (let i = 0; i < tickersToValidate.length; i += validator.batchSize) {
                const batch = tickersToValidate.slice(i, i + validator.batchSize);
                const batchStartTime = Date.now();
                
                // Check if we need to refresh session
                if (validator.requestCount > 0 && validator.requestCount % validator.refreshInterval === 0) {
                    await validator.refreshSession();
                }
                
                const batchResults = await validator.processBatchFast(batch);
                
                // Accumulate results
                totalResults.validated += batchResults.validated;
                totalResults.active += batchResults.active;
                totalResults.inactive += batchResults.inactive;
                totalResults.errors += batchResults.errors;
                
                const batchTime = Date.now() - batchStartTime;
                const totalTime = Date.now() - startTime;
                const progress = Math.round(((i + batch.length) / tickersToValidate.length) * 100);
                
                // Calculate current speed
                const tickersPerSecond = totalResults.validated / (totalTime / 1000);
                const remainingTickers = tickersToValidate.length - (i + batch.length);
                const newETA = validator.calculateETA(remainingTickers, tickersPerSecond);
                
                console.log(`📊 Progress: ${progress}% (${i + batch.length}/${tickersToValidate.length}) - ${Math.round(tickersPerSecond)} tickers/sec`);
                console.log(`📈 Batch: ${batchResults.active} active, ${batchResults.inactive} inactive (${batchTime}ms)`);
                console.log(`⏱️  ETA: ${newETA}`);
                console.log('---');
                
                // Delay between batches
                if (i + validator.batchSize < tickersToValidate.length) {
                    await new Promise(resolve => setTimeout(resolve, validator.delayMs));
                }
            }
            
            // Final statistics
            const endTime = Date.now();
            const finalStats = await validator.getStats();
            
            console.log('\n🎉 Fast Validation Complete!');
            console.log(`⏱️  Total time: ${Math.round((endTime - startTime) / 1000)}s`);
            console.log(`📊 Processed: ${totalResults.validated} tickers`);
            console.log(`⚡ Average speed: ${Math.round(totalResults.validated / ((endTime - startTime) / 1000))} tickers/sec`);
            console.log(`✅ Found active: ${totalResults.active}`);
            console.log(`❌ Inactive: ${totalResults.inactive}`);
            console.log(`⚠️  Errors: ${totalResults.errors}`);
            
        } catch (error) {
            if (error instanceof RateLimitError || isRateLimitError(error)) {
                console.log('🚨 Rate limiting detected, handling...');
                shouldRestart = await handleRateLimitError(error);
            } else {
                console.error('❌ Error during validation:', error);
                break;
            }
        }
    } while (shouldRestart);
    
    await validator.close();
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = FastTickerValidator;