const yahooFinance = require('yahoo-finance2').default;
const fs = require('fs');
const path = require('path');
const PostgreSQLManager = require('../db/database-manager');
require('dotenv').config();

// Suppress Yahoo Finance validation warnings and errors
yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

// Additional error suppression - redirect console errors during processing
const originalConsoleError = console.error;
let suppressErrors = false;
let capturedValidationWarnings = new Set();

function toggleErrorSuppression(suppress) {
    suppressErrors = suppress;
    if (suppress) {
        console.error = (...args) => {
            // Capture validation warnings for problematic tickers
            const message = args.join(' ');
            if (message.includes('validation') || message.includes('Expected union value') || 
                message.includes('yahoo-finance2') || message.includes('gadicc')) {
                
                // Try to extract ticker symbol from the error context if possible
                // This is a best-effort attempt to identify which ticker caused the warning
                const currentTicker = getCurrentProcessingTicker();
                if (currentTicker) {
                    capturedValidationWarnings.add(currentTicker);
                }
                return; // Suppress these errors
            }
            originalConsoleError.apply(console, args); // Allow other errors through
        };
    } else {
        console.error = originalConsoleError;
    }
}

// Track the currently processing ticker for validation warning capture
let currentProcessingTicker = null;
function setCurrentProcessingTicker(ticker) {
    currentProcessingTicker = ticker;
}
function getCurrentProcessingTicker() {
    return currentProcessingTicker;
}
function hasValidationWarning(ticker) {
    return capturedValidationWarnings.has(ticker);
}

class TickerDataDatabase {
    constructor() {
        this.dbManager = new PostgreSQLManager();
    }

    async initializeDatabase() {
        await this.dbManager.connect();
        console.log('✅ PostgreSQL ticker data system initialized');
    }

    async insertOrUpdateTicker(ticker, jsonData) {
        return await this.dbManager.insertOrUpdateTickerData(ticker, jsonData);
    }

    async getTickerCount() {
        return await this.dbManager.getTickerDataCount();
    }

    async getRecentlyUpdated(limit = 10) {
        return await this.dbManager.getRecentlyUpdatedTickerData(limit);
    }

    async isTickerRecentlyChecked(ticker, hoursAgo = 24) {
        return await this.dbManager.isTickerRecentlyChecked(ticker, hoursAgo);
    }

    async markTickerInactive(ticker, reason = 'Schema validation error') {
        try {
            // Parse ticker to get symbol and exchange
            const [symbol, exchange] = ticker.includes('.') ? 
                ticker.split('.') : [ticker, 'NYSE'];
            
            // Update the ticker as inactive in the main tickers table
            await this.dbManager.updateTicker(symbol, {
                active: false,
                price: -1
            });
            
            console.log(`🔄 Marked ${ticker} as inactive due to: ${reason}`);
            return { ticker, success: true };
        } catch (error) {
            console.log(`⚠️  Could not mark ${ticker} as inactive: ${error.message}`);
            throw error;
        }
    }

    async markTickerActive(ticker, price) {
        try {
            // Parse ticker to get symbol and exchange
            const [symbol, exchange] = ticker.includes('.') ? 
                ticker.split('.') : [ticker, 'NYSE'];
            
            // Update the ticker as active in the main tickers table
            await this.dbManager.updateTicker(symbol, {
                active: true,
                price: price
            });
            
            console.log(`✅ Marked ${ticker} as active with price: $${price}`);
            return { ticker, success: true };
        } catch (error) {
            console.log(`⚠️  Could not mark ${ticker} as active: ${error.message}`);
            throw error;
        }
    }

    async close() {
        if (this.dbManager) {
            await this.dbManager.disconnect();
            console.log('✅ Database connections closed');
        }
    }
}

async function getTickerData(symbol) {
    try {
        // Set current ticker for validation warning tracking
        setCurrentProcessingTicker(symbol);
        
        // Get comprehensive ticker data with error suppression
        const quote = await yahooFinance.quote(symbol, {}, { validateResult: false });
        const historicalData = await yahooFinance.historical(symbol, {
            period1: '1900-01-01',
            period2: new Date().toISOString().split('T')[0],
            interval: '1d'
        }, { validateResult: false });
        const summary = await yahooFinance.quoteSummary(symbol, {
            modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile']
        }, { validateResult: false });

        // Check if this ticker had validation warnings
        const hadValidationWarnings = hasValidationWarning(symbol);
        
        // Clear current ticker
        setCurrentProcessingTicker(null);

        // Create structured data with metadata
        const tickerDataWithMetadata = {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                dataSource: 'Yahoo Finance API (yahoo-finance2)',
                version: '2.0.0',
                hadValidationWarnings: hadValidationWarnings,
                historicalPeriod: {
                    start: '1900-01-01',
                    end: new Date().toISOString().split('T')[0]
                },
                recordCount: {
                    historical: historicalData ? historicalData.length : 0,
                    summaryModules: summary ? Object.keys(summary).length : 0
                }
            },
            quote: quote,
            historical: historicalData,
            summary: summary,
            statistics: {
                // Calculate basic statistics from historical data
                historicalStats: historicalData && historicalData.length > 0 ? {
                    totalDays: historicalData.length,
                    averageClose: (historicalData.reduce((sum, day) => sum + (day.close || 0), 0) / historicalData.length).toFixed(2),
                    highestClose: Math.max(...historicalData.map(day => day.close || 0)).toFixed(2),
                    lowestClose: Math.min(...historicalData.map(day => day.close || 0)).toFixed(2),
                    priceRange: (Math.max(...historicalData.map(day => day.close || 0)) - Math.min(...historicalData.map(day => day.close || 0))).toFixed(2)
                } : null,
                // Basic quote statistics
                quoteStats: quote ? {
                    currentPrice: quote.regularMarketPrice || quote.price || 'N/A',
                    marketCap: quote.marketCap || 'N/A',
                    volume: quote.regularMarketVolume || quote.volume || 'N/A',
                    peRatio: quote.trailingPE || 'N/A'
                } : null
            }
        };

        return tickerDataWithMetadata;
    } catch (error) {
        console.error(`❌ Error fetching data for ${symbol}:`, error.message);
        
        // Return error structure
        return {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                dataSource: 'Yahoo Finance API (yahoo-finance2)',
                version: '2.0.0',
                error: true,
                errorMessage: error.message,
                hadValidationWarnings: hasValidationWarning(symbol)
            },
            quote: null,
            historical: null,
            summary: null,
            error: error.message
        };
    }
}

// Ticker data processing functions
class TickerDataProcessor {
    constructor() {
        this.database = new TickerDataDatabase();
        this.concurrency = 3;
        this.retryDelay = 2000; // 2 seconds
        this.maxRetries = 3;
        this.processingStats = {
            total: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            inactiveMarked: 0
        };
    }

    async initialize() {
        await this.database.initializeDatabase();
    }

    async getActiveTickers() {
        const result = await this.database.dbManager.query(`
            SELECT CONCAT(symbol, '.', exchange) as ticker, symbol, exchange
            FROM tickers 
            WHERE active = true
            ORDER BY last_updated ASC NULLS FIRST
        `);
        
        return result.rows;
    }

    async getUnvalidatedTickers() {
        const result = await this.database.dbManager.query(`
            SELECT symbol, exchanges
            FROM tickers 
            WHERE active IS NULL
            ORDER BY symbol
            LIMIT 1000
        `);
        
        // Convert to the expected format that includes individual exchange combinations
        const tickers = [];
        for (const row of result.rows) {
            for (const exchange of row.exchanges) {
                tickers.push({
                    ticker: `${row.symbol}.${exchange}`,
                    symbol: row.symbol,
                    exchange: exchange
                });
            }
        }
        
        return tickers;
    }

    async getTickersNeedingUpdate(hoursThreshold = 24) {
        const result = await this.database.dbManager.query(`
            SELECT t.symbol, t.exchanges
            FROM tickers t
            WHERE (t.active = true OR t.active IS NULL)
                AND (t.last_updated IS NULL OR t.last_updated < NOW() - INTERVAL '${hoursThreshold} hours')
            ORDER BY t.last_updated ASC NULLS FIRST
            LIMIT 1000
        `);
        
        // Convert to the expected format that includes individual exchange combinations
        const tickers = [];
        for (const row of result.rows) {
            for (const exchange of row.exchanges) {
                tickers.push({
                    ticker: `${row.symbol}.${exchange}`,
                    symbol: row.symbol,
                    exchange: exchange
                });
            }
        }
        
        return tickers;
    }

    async processTickersConcurrent(tickers, skipRecent = true, hoursThreshold = 24) {
        console.log(`🚀 Starting concurrent ticker processing...`);
        console.log(`📊 Total tickers to process: ${tickers.length}`);
        console.log(`⚙️  Concurrency: ${this.concurrency}`);
        console.log(`⏱️  Skip recent (${hoursThreshold}h): ${skipRecent ? 'Yes' : 'No'}`);
        console.log('=' .repeat(50));

        const startTime = Date.now();
        this.processingStats = { total: tickers.length, successful: 0, failed: 0, skipped: 0, inactiveMarked: 0 };

        // Enable error suppression during processing
        toggleErrorSuppression(true);

        // Process in batches with concurrency control
        const batches = [];
        for (let i = 0; i < tickers.length; i += this.concurrency) {
            batches.push(tickers.slice(i, i + this.concurrency));
        }

        let processedCount = 0;
        for (const [batchIndex, batch] of batches.entries()) {
            const batchStartTime = Date.now();
            
            console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} tickers)`);
            
            // Process batch concurrently
            const batchPromises = batch.map(tickerInfo => this.processTickerWithRetry(tickerInfo, skipRecent, hoursThreshold));
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Process results
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    const { status } = result.value;
                    this.processingStats[status]++;
                } else {
                    console.error(`❌ Batch error for ${batch[index].ticker}:`, result.reason);
                    this.processingStats.failed++;
                }
            });

            processedCount += batch.length;
            const batchTime = Date.now() - batchStartTime;
            const tickersPerSecond = (batch.length / batchTime * 1000).toFixed(2);
            
            console.log(`✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s (${tickersPerSecond} tickers/sec)`);
            this.logProgress(processedCount, startTime);
            
            // Brief pause between batches to be respectful to the API
            if (batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Disable error suppression
        toggleErrorSuppression(false);

        const totalTime = Date.now() - startTime;
        const overallRate = (processedCount / (totalTime / 1000)).toFixed(2);
        
        console.log(`\n🎉 Processing completed!`);
        console.log(`📊 Total: ${this.processingStats.total}, Successful: ${this.processingStats.successful}, Failed: ${this.processingStats.failed}, Skipped: ${this.processingStats.skipped}`);
        console.log(`🔄 Marked inactive: ${this.processingStats.inactiveMarked}`);
        console.log(`⚡ Overall rate: ${overallRate} tickers/second`);
        console.log(`⏱️  Total time: ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
        
        return this.processingStats;
    }

    async processTickerWithRetry(tickerInfo, skipRecent, hoursThreshold) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.processTicker(tickerInfo, skipRecent, hoursThreshold);
            } catch (error) {
                if (attempt === this.maxRetries) {
                    console.error(`❌ Final attempt failed for ${tickerInfo.ticker}: ${error.message}`);
                    return { status: 'failed', ticker: tickerInfo.ticker, error: error.message };
                }
                
                console.log(`⚠️  Attempt ${attempt}/${this.maxRetries} failed for ${tickerInfo.ticker}, retrying...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
        }
    }

    async processTicker(tickerInfo, skipRecent = true, hoursThreshold = 24) {
        try {
            const ticker = tickerInfo.ticker;
            
            // Check if ticker was recently processed
            if (skipRecent) {
                const recentCheck = await this.database.isTickerRecentlyChecked(ticker, hoursThreshold);
                if (recentCheck.isRecent) {
                    return { status: 'skipped', ticker, reason: `Updated ${recentCheck.hoursSince}h ago` };
                }
            }

            // Get ticker data from Yahoo Finance (use just the symbol part)
            const symbolOnly = ticker.includes('.') ? ticker.split('.')[0] : ticker;
            const tickerData = await getTickerData(symbolOnly);
            
            // Check if data retrieval was successful
            if (tickerData.metadata.error) {
                // Mark ticker as inactive if there was an error
                await this.database.markTickerInactive(ticker, tickerData.metadata.errorMessage);
                return { status: 'inactiveMarked', ticker, reason: tickerData.metadata.errorMessage };
            }
            
            // Store raw JSON in database
            await this.database.insertOrUpdateTicker(ticker, tickerData);
            
            // Store structured data in normalized tables
            console.log(`📊 Processing structured data for ${ticker}...`);
            await this.database.dbManager.processTickerData({
                ticker: ticker,
                data: tickerData
            });
            
            // Mark ticker as active with current price
            const currentPrice = tickerData.quote?.regularMarketPrice || 
                                tickerData.quote?.ask || 
                                tickerData.quote?.bid || 
                                tickerData.quote?.price || 0;
            await this.database.markTickerActive(ticker, currentPrice);
            
            return { status: 'successful', ticker };
            
        } catch (error) {
            console.error(`❌ Error processing ${tickerInfo.ticker}: ${error.message}`);
            throw error;
        }
    }

    logProgress(processedCount, startTime) {
        const elapsedTime = Date.now() - startTime;
        const remainingTickers = this.processingStats.total - processedCount;
        const overallRate = processedCount / (elapsedTime / 1000);
        
        if (remainingTickers > 0 && overallRate > 0) {
            const eta = this.calculateETA(remainingTickers, overallRate);
            console.log(`⏱️  Progress: ${processedCount}/${this.processingStats.total} (${(processedCount/this.processingStats.total*100).toFixed(1)}%) - ETA: ${eta}`);
        }
        
        console.log(`📈 Success: ${this.processingStats.successful}, Failed: ${this.processingStats.failed}, Skipped: ${this.processingStats.skipped}, Inactive: ${this.processingStats.inactiveMarked}`);
    }

    calculateETA(remainingTickers, tickersPerSecond) {
        if (tickersPerSecond === 0) return 'Unknown';
        
        const remainingSeconds = remainingTickers / tickersPerSecond;
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    async close() {
        await this.database.close();
    }
}

// Main execution function
async function main() {
    if (require.main === module) {
        const processor = new TickerDataProcessor();
        
        // Check for help flag
        const args = process.argv.slice(2);
        if (args.includes('--help') || args.includes('-h')) {
            console.log('📊 Ticker Data Processor - PostgreSQL Edition');
            console.log('=' .repeat(50));
            console.log('Fetches and stores comprehensive ticker data from Yahoo Finance');
            console.log('');
            console.log('Usage: node return-data.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --all           Process all active tickers (ignores time limits)');
            console.log('  --fresh         Force fresh data fetch (ignore recent data)');
            console.log('  --validate      Process unvalidated tickers to determine if they are active');
            console.log('  --unvalidated   Same as --validate');
            console.log('  --hours=N       Only process tickers older than N hours (default: 24)');
            console.log('  --help, -h      Show this help message');
            console.log('');
            console.log('Examples:');
            console.log('  node return-data.js                    # Update tickers older than 24 hours');
            console.log('  node return-data.js --validate         # Validate unvalidated tickers');
            console.log('  node return-data.js --all --fresh      # Force update all active tickers');
            console.log('  node return-data.js --hours=6          # Update tickers older than 6 hours');
            console.log('');
            console.log('Note: Use --validate to process generated ticker combinations and');
            console.log('      determine which ones represent real, active stocks.');
            return;
        }
        
        try {
            console.log('📊 Ticker Data Processor - PostgreSQL Edition');
            console.log('=' .repeat(50));
            
            await processor.initialize();
            
            // Get command line arguments
            const args = process.argv.slice(2);
            const allFlag = args.includes('--all');
            const freshFlag = args.includes('--fresh');
            const validateFlag = args.includes('--validate');
            const unvalidatedFlag = args.includes('--unvalidated');
            const hoursArg = args.find(arg => arg.startsWith('--hours='));
            const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 24;
            
            console.log('📊 Getting database statistics...');
            const stats = await processor.database.dbManager.getStats();
            const tickerDataCount = await processor.database.getTickerCount();
            const unvalidatedCount = await processor.getUnvalidatedTickers();
            
            console.log(`📈 Tickers: ${stats.total} (Active: ${stats.active_count}, Inactive: ${stats.inactive_count}, Unvalidated: ${unvalidatedCount.length})`);
            console.log(`💾 Stored ticker data: ${tickerDataCount} records`);
            
            // Get tickers to process based on flags
            let tickersToProcess;
            if (validateFlag || unvalidatedFlag) {
                console.log('🔍 Getting unvalidated tickers for validation...');
                tickersToProcess = await processor.getUnvalidatedTickers();
            } else if (allFlag) {
                console.log('🔍 Getting ALL active tickers...');
                tickersToProcess = await processor.getActiveTickers();
            } else {
                console.log(`🔍 Getting tickers needing update (older than ${hours} hours)...`);
                tickersToProcess = await processor.getTickersNeedingUpdate(hours);
            }
            
            if (tickersToProcess.length === 0) {
                console.log('✅ No tickers need data processing at this time!');
                
                // If no active tickers found, suggest validating unvalidated ones
                if (!validateFlag && !unvalidatedFlag) {
                    const unvalidatedTickers = await processor.getUnvalidatedTickers();
                    if (unvalidatedTickers.length > 0) {
                        console.log(`💡 Tip: Found ${unvalidatedTickers.length} unvalidated tickers. Run with --validate to process them.`);
                    }
                }
            } else {
                console.log(`📋 Found ${tickersToProcess.length} tickers needing data processing`);
                
                // Process the tickers
                const skipRecent = !freshFlag;
                await processor.processTickersConcurrent(tickersToProcess, skipRecent, hours);
                
                // Final statistics
                console.log('\n📊 Final statistics...');
                const finalTickerDataCount = await processor.database.getTickerCount();
                console.log(`💾 Final ticker data count: ${finalTickerDataCount} records (+${finalTickerDataCount - tickerDataCount})`);
            }
            
        } catch (error) {
            console.error('❌ Application error:', error);
        } finally {
            await processor.close();
        }
    }
}

// Export the classes and functions
module.exports = {
    TickerDataDatabase,
    TickerDataProcessor,
    getTickerData,
    setCurrentProcessingTicker,
    getCurrentProcessingTicker,
    hasValidationWarning,
    toggleErrorSuppression
};

// Run main if this is the main module
main();