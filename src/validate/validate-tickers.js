const PostgreSQLManager = require('../db/database-manager');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

class FastTickerValidator {
    constructor() {
        this.dbManager = new PostgreSQLManager();
        this.batchSize = 500; // Increased batch size
        this.delayMs = 200; // Reduced delay
        this.concurrentRequests = 25; // Allow multiple concurrent requests
        this.timeoutMs = 3000; // Faster timeout
        this.maxRetries = 3; // Maximum database retry attempts
    }

    // Initialize database connection
    async ensureConnection() {
        if (!this.dbManager.isConnected) {
            await this.dbManager.connect();
        }
    }

    // Get tickers that haven't been validated yet (active = null and no price set)
    async getUnvalidatedTickers(limit = null) {
        await this.ensureConnection();
        
        let query = 'SELECT symbol, exchange FROM tickers WHERE active IS NULL AND price IS NULL';
        const params = [];
        
        if (limit) {
            query += ' LIMIT $1';
            params.push(limit);
        }
        
        const result = await this.dbManager.query(query, params);
        return result.rows.map(row => `${row.symbol}.${row.exchange}`);
    }

    // Validate multiple tickers concurrently
    async validateTickersConcurrent(tickers) {
        const results = [];
        const batches = [];
        
        // Split tickers into batches for concurrent processing
        for (let i = 0; i < tickers.length; i += this.concurrentRequests) {
            batches.push(tickers.slice(i, i + this.concurrentRequests));
        }

        for (const batch of batches) {
            const batchPromises = batch.map(ticker => this.validateTickerFast(ticker));
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.error(`❌ Failed to validate ${batch[index]}:`, result.reason);
                    results.push({
                        ticker: batch[index],
                        active: false,
                        price: -1,
                        exchange: 'ERROR'
                    });
                }
            });

            // Add delay between batches to respect rate limits
            if (batches.indexOf(batch) < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, this.delayMs));
            }
        }

        return results;
    }

    // Fast validation using Yahoo Finance API
    async validateTickerFast(ticker) {
        try {
            const symbol = ticker.split('.')[0];
            
            // Use Yahoo Finance query API for fast validation
            const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&lang=en-US&region=US&quotesCount=6&newsCount=4&listsCount=2&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query&multiQuoteQueryId=multi_quote_single_token_query&newsQueryId=news_cie_vespa&enableCb=true&enableNavLinks=true&enableEnhancedTrivialQuery=true`;
            
            const response = await axios.get(url, {
                timeout: this.timeoutMs,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.data && response.data.quotes && response.data.quotes.length > 0) {
                const quote = response.data.quotes[0];
                
                // Check if the ticker actually matches what we're looking for
                if (quote.symbol.toUpperCase() === symbol.toUpperCase()) {
                    return {
                        ticker: ticker,
                        active: true,
                        price: quote.regularMarketPrice || quote.ask || quote.bid || 0,
                        exchange: quote.exchDisp || quote.exchange || 'UNKNOWN'
                    };
                }
            }

            // If not found or no exact match, mark as inactive
            return {
                ticker: ticker,
                active: false,
                price: -1,
                exchange: 'NOT_FOUND'
            };

        } catch (error) {
            console.log(`⚠️  API error for ${ticker}: ${error.message}`);
            
            // Check if this is a delisting error
            if (this.isDelistingError(error.message)) {
                return {
                    ticker: ticker,
                    active: false,
                    price: -1,
                    exchange: 'DELISTED'
                };
            }

            return {
                ticker: ticker,
                active: false,
                price: -1,
                exchange: 'ERROR'
            };
        }
    }

    // Update ticker data in PostgreSQL
    async bulkUpdateTickers(tickerResults) {
        await this.ensureConnection();
        
        let successCount = 0;
        let errorCount = 0;

        for (const result of tickerResults) {
            try {
                const [symbol, exchange] = result.ticker.includes('.') ? 
                    result.ticker.split('.') : [result.ticker, 'NYSE'];
                
                await this.dbManager.updateTicker(symbol, {
                    active: result.active,
                    price: result.price
                });
                
                successCount++;
            } catch (error) {
                console.error(`❌ Failed to update ${result.ticker}:`, error.message);
                errorCount++;
            }
        }

        return { successCount, errorCount };
    }

    // Validate a single ticker for testing
    async validateSingleTicker(ticker) {
        console.log(`🔍 Validating single ticker: ${ticker}`);
        
        const result = await this.validateTickerFast(ticker);
        console.log(`📊 Result:`, result);
        
        const updateResult = await this.bulkUpdateTickers([result]);
        console.log(`✅ Update result:`, updateResult);
        
        return result;
    }

    // Process tickers in batches
    async processBatchFast(tickers) {
        console.log(`🚀 Processing ${tickers.length} tickers...`);
        
        const startTime = Date.now();
        let processedCount = 0;
        const totalTickers = tickers.length;

        // Process in batches
        for (let i = 0; i < tickers.length; i += this.batchSize) {
            const batch = tickers.slice(i, i + this.batchSize);
            const batchStartTime = Date.now();
            
            console.log(`\n📦 Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(tickers.length / this.batchSize)} (${batch.length} tickers)`);
            
            // Validate batch
            const results = await this.validateTickersConcurrent(batch);
            
            // Update database
            const updateResult = await this.bulkUpdateTickers(results);
            
            processedCount += batch.length;
            const batchTime = Date.now() - batchStartTime;
            const tickersPerSecond = (batch.length / batchTime * 1000).toFixed(2);
            
            // Calculate statistics
            const activeCount = results.filter(r => r.active).length;
            const inactiveCount = results.filter(r => !r.active).length;
            
            console.log(`✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s (${tickersPerSecond} tickers/sec)`);
            console.log(`📊 Active: ${activeCount}, Inactive: ${inactiveCount}`);
            console.log(`💾 Database updates: ${updateResult.successCount} success, ${updateResult.errorCount} errors`);
            
            // Calculate and display ETA
            const elapsedTime = Date.now() - startTime;
            const remainingTickers = totalTickers - processedCount;
            const overallTickersPerSecond = processedCount / (elapsedTime / 1000);
            
            if (remainingTickers > 0) {
                const eta = this.calculateETA(remainingTickers, overallTickersPerSecond);
                console.log(`⏱️  Progress: ${processedCount}/${totalTickers} (${(processedCount/totalTickers*100).toFixed(1)}%) - ETA: ${eta}`);
            }
        }

        const totalTime = Date.now() - startTime;
        const overallRate = (processedCount / (totalTime / 1000)).toFixed(2);
        
        console.log(`\n🎉 Batch processing completed!`);
        console.log(`📊 Total processed: ${processedCount} tickers in ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
        console.log(`⚡ Overall rate: ${overallRate} tickers/second`);
        
        return processedCount;
    }

    // Get current database statistics
    async getStats() {
        await this.ensureConnection();
        return await this.dbManager.getStats();
    }

    // Calculate ETA based on current progress
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

    // Check if error indicates a delisted ticker
    isDelistingError(errorMessage) {
        const delistingKeywords = ['delisted', 'suspended', 'halt', 'not found', '404'];
        return delistingKeywords.some(keyword => 
            errorMessage.toLowerCase().includes(keyword)
        );
    }

    // Close database connection
    async close() {
        if (this.dbManager) {
            await this.dbManager.disconnect();
        }
    }
}

// Main execution function
async function main() {
    if (require.main === module) {
        const validator = new FastTickerValidator();
        
        try {
            console.log('🎯 Fast Ticker Validator - PostgreSQL Edition');
            console.log('=' .repeat(50));
            
            // Get command line arguments
            const args = process.argv.slice(2);
            const testMode = args.includes('--test');
            const limitArg = args.find(arg => arg.startsWith('--limit='));
            const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
            
            if (testMode) {
                console.log('🧪 Running in test mode with single ticker...');
                // Test with a known ticker
                await validator.validateSingleTicker('AAPL.NASDAQ');
            } else {
                // Get initial statistics
                console.log('📊 Getting current database statistics...');
                const initialStats = await validator.getStats();
                console.log(`📈 Total: ${initialStats.total}, Active: ${initialStats.active_count}, Inactive: ${initialStats.inactive_count}, Unvalidated: ${initialStats.unvalidated_count}`);
                
                // Get unvalidated tickers
                console.log(`🔍 Finding unvalidated tickers${limit ? ` (limit: ${limit})` : ''}...`);
                const unvalidatedTickers = await validator.getUnvalidatedTickers(limit);
                
                if (unvalidatedTickers.length === 0) {
                    console.log('✅ No unvalidated tickers found. All tickers have been processed!');
                } else {
                    console.log(`📋 Found ${unvalidatedTickers.length} unvalidated tickers`);
                    
                    // Process the batch
                    await validator.processBatchFast(unvalidatedTickers);
                    
                    // Get final statistics
                    console.log('\n📊 Final database statistics...');
                    const finalStats = await validator.getStats();
                    console.log(`📈 Total: ${finalStats.total}, Active: ${finalStats.active_count}, Inactive: ${finalStats.inactive_count}, Unvalidated: ${finalStats.unvalidated_count}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Application error:', error);
        } finally {
            await validator.close();
        }
    }
}

// Export the class and run main if this is the main module
module.exports = FastTickerValidator;
main();