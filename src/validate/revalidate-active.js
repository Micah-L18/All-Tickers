#!/usr/bin/env node
// Re-validate active tickers to check if any have become inactive

const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

class ActiveTickerRevalidator {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'db', 'tickers.db');
        this.db = null; // Initialize as null, create connection when needed
        this.concurrentRequests = 8; // Conservative concurrency for active ticker validation
        this.batchSize = 500;
        this.retryDelay = 750; // 750ms between batches
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

    // Get all active tickers from database
    async getActiveTickers() {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, price, exchange, last_checked
                FROM tickers 
                WHERE active = 1
                ORDER BY ticker
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Check if a ticker was recently checked (within 24 hours)
    async isTickerRecentlyChecked(ticker, hoursAgo = 24) {
        await this.ensureConnection();
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT ticker, last_checked,
                       (julianday('now') - julianday(last_checked)) * 24 as hours_diff
                FROM tickers 
                WHERE ticker = ? 
                AND last_checked IS NOT NULL
                AND (julianday('now') - julianday(last_checked)) * 24 < ?
            `;
            
            this.db.get(sql, [ticker, hoursAgo], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        isRecent: !!row,
                        lastChecked: row ? row.last_checked : null,
                        hoursSince: row ? Math.round(row.hours_diff * 100) / 100 : null
                    });
                }
            });
        });
    }

    // Validate a single ticker using Yahoo Finance with deep validation
    async validateTicker(ticker) {
        try {
            // First, do the basic chart validation
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
            const response = await axios.get(url, {
                timeout: 7000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.data && response.data.chart && response.data.chart.result && response.data.chart.result.length > 0) {
                const result = response.data.chart.result[0];
                const meta = result.meta;
                
                if (meta && meta.regularMarketPrice && meta.exchangeName) {
                    // Ticker appears active, but let's do deeper validation to catch problematic tickers
                    const deepValidationResult = await this.performDeepValidation(ticker);
                    
                    if (deepValidationResult.shouldMarkInactive) {
                        console.log(`🗑️  ${ticker}: Deep validation failed - ${deepValidationResult.reason}`);
                        return { 
                            active: false, 
                            price: -1, 
                            exchange: 'DELISTED',
                            reason: deepValidationResult.reason
                        };
                    }
                    
                    return {
                        active: true,
                        price: meta.regularMarketPrice,
                        exchange: meta.exchangeName,
                        symbol: meta.symbol || ticker
                    };
                }
            }
            
            return { active: false, price: -1, exchange: 'DELISTED' };
            
        } catch (error) {
            // Check for specific delisting errors
            const errorMessage = error.message || '';
            if (this.isDelistingError(errorMessage)) {
                return { 
                    active: false, 
                    price: -1, 
                    exchange: 'DELISTED',
                    reason: errorMessage
                };
            }
            
            // Network errors or 404s might indicate delisted tickers
            if (error.response && error.response.status === 404) {
                return { active: false, price: -1, exchange: 'NOT_FOUND' };
            }
            return { active: false, price: -1, exchange: 'ERROR' };
        }
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
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Test if we can get quote data
            const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}`;
            const quoteResponse = await axios.get(quoteUrl, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

    // Validate multiple tickers concurrently
    async validateTickersConcurrent(tickers) {
        const promises = tickers.map(tickerInfo => 
            this.validateTicker(tickerInfo.ticker).then(result => ({ 
                ticker: tickerInfo.ticker,
                oldPrice: tickerInfo.price,
                oldExchange: tickerInfo.exchange,
                ...result 
            }))
        );
        
        const results = await Promise.allSettled(promises);
        
        return results.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    ticker: 'UNKNOWN',
                    active: false,
                    price: -1,
                    exchange: 'ERROR',
                    oldPrice: -1,
                    oldExchange: 'UNKNOWN'
                };
            }
        });
    }

    // Update database with revalidation results
    // Update database with revalidation results using retry logic
    async updateDatabase(tickerResults) {
        await this.ensureConnection();
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.updateDatabaseAttempt(tickerResults);
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

    // Single attempt at database update
    async updateDatabaseAttempt(tickerResults) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE tickers 
                SET active = ?, price = ?, exchange = ?, last_checked = CURRENT_TIMESTAMP
                WHERE ticker = ?
            `;
            
            let completed = 0;
            let errors = 0;
            let nowInactive = 0;
            let priceUpdates = 0;
            
            // Process updates individually instead of using transactions
            // This reduces the chance of locks and makes the process more resilient
            const processUpdate = (index) => {
                if (index >= tickerResults.length) {
                    resolve({ completed, errors, nowInactive, priceUpdates });
                    return;
                }
                
                const { ticker, active, price, exchange, oldPrice } = tickerResults[index];
                
                this.db.run(query, [
                    active ? 1 : 0,
                    price,
                    exchange,
                    ticker
                ], (err) => {
                    if (err) {
                        errors++;
                        console.error(`❌ Error updating ${ticker}:`, err.message);
                    } else {
                        if (!active) {
                            nowInactive++;
                        } else if (oldPrice !== price) {
                            priceUpdates++;
                        }
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

    // Main revalidation process
    async revalidateActiveTickers() {
        console.log('🔍 Starting revalidation of active tickers...\n');
        
        // Get all active tickers
        const allActiveTickers = await this.getActiveTickers();
        console.log(`📊 Found ${allActiveTickers.length.toLocaleString()} active tickers in database`);
        
        if (allActiveTickers.length === 0) {
            console.log('✅ No active tickers found to revalidate!');
            return;
        }
        
        // Filter out recently checked tickers (within 24 hours)
        console.log('🕐 Filtering out recently checked tickers (within 24 hours)...');
        const tickersToCheck = [];
        let skipped = 0;
        
        for (const tickerInfo of allActiveTickers) {
            const recentCheck = await this.isTickerRecentlyChecked(tickerInfo.ticker, 24);
            
            if (recentCheck.isRecent) {
                skipped++;
                
                // Show skip message occasionally for transparency
                if (skipped % 50 === 1 || skipped <= 10) {
                    console.log(`⏭️  Skipping ${tickerInfo.ticker} (checked ${recentCheck.hoursSince}h ago)`);
                }
            } else {
                tickersToCheck.push(tickerInfo);
            }
        }
        
        console.log(`📋 Tickers to revalidate: ${tickersToCheck.length.toLocaleString()}`);
        console.log(`⏭️  Skipped (recent): ${skipped.toLocaleString()}\n`);
        
        if (tickersToCheck.length === 0) {
            console.log('✅ All active tickers were recently validated! No revalidation needed.');
            return;
        }
        
        let totalProcessed = 0;
        let totalNowInactive = 0;
        let totalPriceUpdates = 0;
        let totalErrors = 0;
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
        
        // Process in batches
        for (let i = 0; i < tickersToCheck.length; i += this.batchSize) {
            const batch = tickersToCheck.slice(i, i + this.batchSize);
            const batchNum = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(tickersToCheck.length / this.batchSize);
            
            console.log(`🚀 Processing batch ${batchNum}/${totalBatches} (${batch.length} tickers)...`);
            
            // Check if we need to refresh session before this batch
            if (requestCount > 0 && requestCount % refreshInterval === 0) {
                await refreshSession();
            }
            
            // Process batch in smaller concurrent chunks
            const chunkSize = this.concurrentRequests;
            const chunks = [];
            for (let j = 0; j < batch.length; j += chunkSize) {
                chunks.push(batch.slice(j, j + chunkSize));
            }
            
            const batchResults = [];
            
            for (const chunk of chunks) {
                const chunkResults = await this.validateTickersConcurrent(chunk);
                batchResults.push(...chunkResults);
                
                // Update request count
                requestCount += chunk.length;
                
                // Show any tickers that became inactive or had significant price changes
                chunkResults.forEach(({ ticker, active, price, exchange, oldPrice, oldExchange }) => {
                    if (!active) {
                        console.log(`⚠️  ${ticker} is now inactive: ${oldExchange} → ${exchange}`);
                    } else if (Math.abs(price - oldPrice) / oldPrice > 0.1) {
                        // Show significant price changes (>10%)
                        const change = ((price - oldPrice) / oldPrice * 100).toFixed(1);
                        console.log(`📈 ${ticker}: $${oldPrice.toFixed(2)} → $${price.toFixed(2)} (${change > 0 ? '+' : ''}${change}%)`);
                    }
                });
                
                // Small delay between chunks
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
            
            // Update database with batch results
            try {
                const updateResults = await this.updateDatabase(batchResults);
                totalProcessed += updateResults.completed;
                totalNowInactive += updateResults.nowInactive;
                totalPriceUpdates += updateResults.priceUpdates;
                totalErrors += updateResults.errors;
                
                console.log(`💾 Batch ${batchNum} completed: ${updateResults.nowInactive} became inactive, ${updateResults.priceUpdates} price updates`);
                
                // Progress update
                const progress = ((i + batch.length) / tickersToCheck.length * 100).toFixed(1);
                console.log(`📈 Progress: ${progress}% (${totalNowInactive} now inactive, ${totalPriceUpdates} price updates so far)\n`);
                
            } catch (error) {
                console.error('❌ Batch update failed after all retries:', error);
                console.error('❌ Error details:', error.message);
                console.log('⚠️  Continuing with next batch...');
                totalErrors += batch.length;
                
                // Add extra delay after failed batch
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // Longer delay between batches to be respectful to the API
            if (i + this.batchSize < tickersToCheck.length) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        
        // Final summary
        console.log('🎉 Active ticker revalidation completed!');
        console.log('==========================================');
        console.log(`📊 Total tickers processed: ${totalProcessed.toLocaleString()}`);
        console.log(`⚠️  Tickers now inactive: ${totalNowInactive.toLocaleString()}`);
        console.log(`📈 Price updates: ${totalPriceUpdates.toLocaleString()}`);
        console.log(`❌ Errors: ${totalErrors.toLocaleString()}`);
        console.log(`🌐 Total API requests: ${requestCount.toLocaleString()}`);
        
        // Show refresh statistics
        const refreshCount = Math.floor(requestCount / refreshInterval);
        if (refreshCount > 0) {
            console.log(`🔄 Session refreshes performed: ${refreshCount} (every ${refreshInterval.toLocaleString()} requests)`);
        }
        if (totalNowInactive > 0) {
            console.log(`\n🔍 Found ${totalNowInactive} tickers that are no longer active`);
            console.log('💡 Consider running export scripts to update your output files');
        }
        
        if (totalPriceUpdates > 0) {
            console.log(`\n📊 Updated prices for ${totalPriceUpdates} tickers`);
        }
        
        if (totalNowInactive === 0 && totalPriceUpdates === 0) {
            console.log('\n✅ All active tickers are still active with current prices!');
        }
        
        // Calculate data freshness metrics
        const inactiveRate = (totalNowInactive / totalProcessed * 100).toFixed(2);
        const updateRate = (totalPriceUpdates / totalProcessed * 100).toFixed(2);
        console.log(`\n📊 Data Quality Metrics:`);
        console.log(`   Inactive rate: ${inactiveRate}%`);
        console.log(`   Price update rate: ${updateRate}%`);
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
    const revalidator = new ActiveTickerRevalidator();
    
    // Graceful shutdown handler
    const shutdown = (signal) => {
        console.log(`\n� Received ${signal}. Gracefully shutting down...`);
        console.log('💾 Progress has been saved to database');
        revalidator.close();
        process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    try {
        await revalidator.revalidateActiveTickers();
    } catch (error) {
        console.error('� Active ticker revalidation failed:', error);
        process.exit(1);
    } finally {
        revalidator.close();
    }
}

// Run if this file is executed directly
if (require.main === module) {
    main();
}

module.exports = { ActiveTickerRevalidator };