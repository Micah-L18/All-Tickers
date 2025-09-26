const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

class FastTickerValidator {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'db', 'tickers.db');
        this.db = null; // Initialize as null, create connection when needed
        this.batchSize = 500; // Increased batch size
        this.delayMs = 200; // Reduced delay
        this.concurrentRequests = 25; // Allow multiple concurrent requests
        this.timeoutMs = 3000; // Faster timeout
        this.maxRetries = 3; // Maximum database retry attempts
        this.busyTimeout = 30000; // 30 second busy timeout
    }

    // Create database connection with proper settings
    createConnection() {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                } else {
                    // Configure database for better concurrency
                    db.configure('busyTimeout', this.busyTimeout);
                    db.run('PRAGMA journal_mode = WAL;'); // Write-Ahead Logging for better concurrency
                    db.run('PRAGMA synchronous = NORMAL;'); // Balance between safety and performance
                    db.run('PRAGMA temp_store = MEMORY;'); // Use memory for temporary storage
                    db.run('PRAGMA mmap_size = 268435456;'); // 256MB memory mapping
                    resolve(db);
                }
            });
        });
    }

    // Ensure database connection exists
    async ensureConnection() {
        if (!this.db) {
            this.db = await this.createConnection();
        }
    }

    // Get tickers that haven't been validated yet (active = false and no price set)
    async getUnvalidatedTickers(limit = null) {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            let query = 'SELECT ticker FROM tickers WHERE active = 0 AND price IS NULL';
            if (limit) {
                query += ` LIMIT ${limit}`;
            }
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows.map(row => row.ticker));
                }
            });
        });
    }

    // Validate multiple tickers concurrently
    async validateTickersConcurrent(tickers) {
        const promises = tickers.map(ticker => this.validateTickerFast(ticker));
        const results = await Promise.allSettled(promises);
        
        return results.map((result, index) => ({
            ticker: tickers[index],
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : { active: false, price: null, exchange: null }
        }));
    }

    // Fast ticker validation with deep validation to catch problematic tickers
    async validateTickerFast(ticker) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
            const response = await axios.get(url, {
                timeout: this.timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result.length > 0) {
                const result = response.data.chart.result[0];
                const meta = result.meta;
                
                if (meta && meta.regularMarketPrice) {
                    // Ticker appears active, but let's do deeper validation to catch problematic tickers
                    const deepValidationResult = await this.performDeepValidation(ticker);
                    
                    if (deepValidationResult.shouldMarkInactive) {
                        console.log(`🗑️  ${ticker}: Deep validation failed - ${deepValidationResult.reason}`);
                        return { 
                            active: false, 
                            price: -1, 
                            exchange: 'DELISTED'
                        };
                    }
                    
                    return {
                        active: true,
                        price: meta.regularMarketPrice,
                        exchange: meta.exchangeName || 'Unknown'
                    };
                }
            }
            
            return { active: false, price: -1, exchange: 'INACTIVE' }; // Mark as checked but inactive
            
        } catch (error) {
            // Check for specific delisting errors
            const errorMessage = error.message || '';
            if (this.isDelistingError(errorMessage)) {
                return { 
                    active: false, 
                    price: -1, 
                    exchange: 'DELISTED'
                };
            }
            
            // Network errors or 404s might indicate delisted tickers
            if (error.response && error.response.status === 404) {
                return { active: false, price: -1, exchange: 'NOT_FOUND' };
            }
            return { active: false, price: -1, exchange: 'INACTIVE' }; // Mark as checked but inactive
        }
    }

    // Bulk update tickers in database using retry logic
    async bulkUpdateTickers(tickerResults) {
        await this.ensureConnection();
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.bulkUpdateTickersAttempt(tickerResults);
            } catch (error) {
                console.error(`❌ Database update attempt ${attempt} failed:`, error.message);
                
                if (attempt === this.maxRetries) {
                    throw error;
                }
                
                // Wait before retrying, with exponential backoff
                const waitTime = 1000 * attempt;
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Recreate connection on retry
                if (this.db) {
                    this.db.close();
                    this.db = null;
                }
                await this.ensureConnection();
            }
        }
    }

    // Single attempt at bulk database update
    async bulkUpdateTickersAttempt(tickerResults) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE tickers 
                SET active = ?, price = ?, exchange = ?, last_checked = CURRENT_TIMESTAMP
                WHERE ticker = ?
            `;
            
            let completed = 0;
            let errors = 0;
            
            // Process updates individually instead of using transactions
            // This reduces the chance of locks and makes the process more resilient
            const processUpdate = (index) => {
                if (index >= tickerResults.length) {
                    resolve({ completed, errors });
                    return;
                }
                
                const { ticker, data } = tickerResults[index];
                
                this.db.run(query, [
                    data.active ? 1 : 0,
                    data.price,
                    data.exchange,
                    ticker
                ], (err) => {
                    if (err) {
                        errors++;
                        console.error(`❌ Error updating ${ticker}:`, err.message);
                    }
                    
                    completed++;
                    
                    // Process next update after a small delay
                    setTimeout(() => processUpdate(index + 1), 10);
                });
            };
            
            // Start processing
            processUpdate(0);
        });
    }

    // Validate and update a single ticker
    async validateSingleTicker(ticker) {
        try {
            console.log(`🔍 Validating single ticker: ${ticker}`);
            
            // Validate the ticker
            const validationResult = await this.validateTickerFast(ticker);
            
            // Update database
            const updateResult = await this.bulkUpdateTickers([{
                ticker: ticker,
                data: validationResult
            }]);
            
            const result = {
                ticker: ticker,
                success: updateResult.errors === 0,
                validation: validationResult,
                status: validationResult.active ? 'active' : 'inactive',
                message: validationResult.active 
                    ? `Active: $${validationResult.price} on ${validationResult.exchange}`
                    : `Inactive: ${validationResult.exchange}`
            };
            
            console.log(`${validationResult.active ? '✅' : '❌'} ${ticker}: ${result.message}`);
            return result;
            
        } catch (error) {
            console.error(`❌ Error validating ${ticker}:`, error.message);
            return {
                ticker: ticker,
                success: false,
                validation: { active: false, price: null, exchange: 'ERROR' },
                status: 'error',
                message: `Error: ${error.message}`
            };
        }
    }

    // Process a batch with concurrent validation
    async processBatchFast(tickers) {
        const results = {
            validated: 0,
            active: 0,
            inactive: 0,
            errors: 0
        };

        console.log(`🚀 Fast validating batch of ${tickers.length} tickers with ${this.concurrentRequests} concurrent requests...`);
        
        // Process in smaller concurrent groups
        const chunkSize = this.concurrentRequests;
        const chunks = [];
        for (let i = 0; i < tickers.length; i += chunkSize) {
            chunks.push(tickers.slice(i, i + chunkSize));
        }
        
        const allResults = [];
        
        for (const chunk of chunks) {
            const chunkResults = await this.validateTickersConcurrent(chunk);
            allResults.push(...chunkResults);
            
            // Count results
            chunkResults.forEach(({ success, data, ticker }) => {
                results.validated++;
                if (success && data.active) {
                    results.active++;
                    console.log(`✅ Found active  ${ticker} - ${data.exchange} - $${data.price}`);
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
                ticker: r.ticker, 
                data: r.data 
            })));
            console.log(`💾 Database updated: ${updateResults.completed} tickers, ${updateResults.errors} errors`);
        } catch (error) {
            console.error('❌ Bulk update failed after all retries:', error);
            console.error('❌ Error details:', error.message);
            console.log('⚠️  Continuing with process...');
            results.errors += allResults.length;
        }
        
        return results;
    }

    // Get current database statistics
    async getStats() {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
                    SUM(CASE WHEN active = 0 AND price = -1 THEN 1 ELSE 0 END) as inactive_count,
                    SUM(CASE WHEN price IS NULL THEN 1 ELSE 0 END) as unvalidated_count,
                    COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as validated_count
                FROM tickers
            `;
            
            this.db.get(query, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Estimate completion time
    calculateETA(remainingTickers, tickersPerSecond) {
        const remainingSeconds = Math.ceil(remainingTickers / tickersPerSecond);
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;
        
        return `${hours}h ${minutes}m ${seconds}s`;
    }

    // Check if an error message indicates a delisted/problematic ticker
    isDelistingError(errorMessage) {
        return errorMessage.includes('No fundamentals data found for symbol') ||
               errorMessage.includes('1d data not available for startTime') ||
               errorMessage.includes('Only 100 years worth of day granularity data are allowed') ||
               errorMessage.includes('Ticker not found') ||
               errorMessage.includes('Invalid ticker') ||
               errorMessage.includes('Symbol not found') ||
               errorMessage.includes('No data found for this date range');
    }

    // Perform deeper validation to catch problematic tickers
    async performDeepValidation(ticker) {
        try {
            // Test if we can get historical data (this is where many problematic tickers fail)
            const historicalUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1mo&interval=1d`;
            const historicalResponse = await axios.get(historicalUrl, {
                timeout: 3000, // Shorter timeout for fast validation
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            // Test if we can get quote data
            const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
            const quoteResponse = await axios.get(quoteUrl, {
                timeout: 3000, // Shorter timeout for fast validation
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            // Check if the responses contain the problematic error patterns
            const responses = [historicalResponse, quoteResponse];
            for (const resp of responses) {
                const responseText = JSON.stringify(resp.data);
                if (responseText.includes('No fundamentals data found for symbol') ||
                    responseText.includes('1d data not available for startTime')) {
                    return {
                        shouldMarkInactive: true,
                        reason: 'Deep validation failed - problematic ticker detected'
                    };
                }
            }

            return { shouldMarkInactive: false };
            
        } catch (error) {
            const errorMessage = error.message || '';
            
            // If we get specific delisting errors during deep validation, mark as inactive
            if (this.isDelistingError(errorMessage)) {
                return {
                    shouldMarkInactive: true,
                    reason: `Deep validation error: ${errorMessage}`
                };
            }
            
            // For other errors during deep validation, assume ticker is still active
            // (we don't want to mark tickers inactive due to temporary network issues)
            return { shouldMarkInactive: false };
        }
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err);
                } else {
                    console.log('✅ Database connection closed');
                }
            });
        }
    }
}

// Main execution
async function main() {
    console.log('⚡ All-Tickers Fast Validator v2.1');
    console.log('==================================');
    
    const validator = new FastTickerValidator();
    
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const limitIndex = args.indexOf('--limit');
        const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : null;
        const dryRun = args.includes('--dry-run');
        const fastMode = args.includes('--fast') || true; // Always use fast mode
        
        // Get initial stats
        const initialStats = await validator.getStats();
        console.log(`📊 Database Status:`);
        console.log(`   Total: ${initialStats.total}`);
        console.log(`   ✅ Active: ${initialStats.active_count}`);
        console.log(`   ❌ Inactive: ${initialStats.inactive_count}`);
        console.log(`   🔍 Validated: ${initialStats.validated_count}`);
        console.log(`   ⏳ Unvalidated: ${initialStats.unvalidated_count}`);
        
        if (dryRun) {
            console.log('🧪 DRY RUN MODE - No database updates will be made');
        }
        
        // Get tickers to validate
        const tickersToValidate = await validator.getUnvalidatedTickers(limit);
        
        if (tickersToValidate.length === 0) {
            console.log('🎉 All tickers have been validated!');
            validator.close();
            return;
        }
        
        console.log(`🎯 Found ${tickersToValidate.length} tickers to validate`);
        console.log(`⚡ Fast mode: ${validator.batchSize} per batch, ${validator.concurrentRequests} concurrent, ${validator.delayMs}ms delay`);
        
        // Calculate estimated time
        const tickersPerSecond = validator.concurrentRequests / (validator.delayMs / 1000 + 0.5); // Rough estimate
        const eta = validator.calculateETA(tickersToValidate.length, tickersPerSecond);
        console.log(`⏱️  Estimated completion time: ${eta}`);
        
        if (limit) {
            console.log(`📊 Limited to ${limit} tickers`);
        }
        
        if (dryRun) {
            console.log(`🧪 Would validate: ${tickersToValidate.slice(0, 10).join(', ')}${tickersToValidate.length > 10 ? '...' : ''}`);
            validator.close();
            return;
        }
        
        // Process tickers in batches
        const totalResults = {
            validated: 0,
            active: 0,
            inactive: 0,
            errors: 0
        };
        
        const startTime = Date.now();
        let lastProgressTime = startTime;
        let requestCount = 0; // Track total requests for refresh timing
        
        // Force refresh cookies/crumbs every 10,000 requests
        const refreshInterval = 10000;
        
        // Function to force refresh cookies/crumbs (similar to return-data script)
        async function refreshSession() {
            try {
                console.log('🔄 Refreshing cookies and crumbs for rate limit prevention...');
                // Force a simple request to refresh session
                const refreshUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL';
                await axios.get(refreshUrl, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                console.log('✅ Session refreshed successfully');
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second pause after refresh
            } catch (error) {
                console.log('⚠️  Session refresh warning (continuing anyway):', error.message);
            }
        }
        
        for (let i = 0; i < tickersToValidate.length; i += validator.batchSize) {
            const batch = tickersToValidate.slice(i, i + validator.batchSize);
            const batchStartTime = Date.now();
            
            // Check if we need to refresh session before this batch
            if (requestCount > 0 && requestCount % refreshInterval === 0) {
                await refreshSession();
            }
            
            const batchResults = await validator.processBatchFast(batch);
            
            // Update request count (approximate based on batch size and concurrent requests)
            requestCount += batch.length;
            
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
        console.log(`🌐 Total API requests: ${requestCount}`);
        
        // Show refresh statistics
        const refreshCount = Math.floor(requestCount / refreshInterval);
        if (refreshCount > 0) {
            console.log(`🔄 Session refreshes performed: ${refreshCount} (every ${refreshInterval.toLocaleString()} requests)`);
        }
        
        console.log(`\n📈 Final Database Stats:`);
        console.log(`   Total: ${finalStats.total}`);
        console.log(`   Active: ${finalStats.active_count}`);
        console.log(`   Inactive: ${finalStats.inactive_count}`);
        console.log(`   Validated: ${finalStats.validated_count}`);
        console.log(`   Remaining: ${finalStats.unvalidated_count}`);
        
    } catch (error) {
        console.error('❌ Error during validation:', error);
        process.exit(1);
    } finally {
        validator.close();
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = FastTickerValidator;