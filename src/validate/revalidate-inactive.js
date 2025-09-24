#!/usr/bin/env node
// Re-validate inactive tickers to find any that have become active again

const PostgreSQLManager = require('../db/database-manager');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

class InactiveTickerRevalidator {
    constructor() {
        this.dbManager = new PostgreSQLManager();
        this.concurrentRequests = 6; // Conservative concurrency for inactive ticker validation
        this.batchSize = 400;
        this.retryDelay = 1000; // 1 second between batches
        this.maxRetries = 3; // Maximum database retry attempts
    }

    // Initialize database connection
    async ensureConnection() {
        if (!this.dbManager.isConnected) {
            await this.dbManager.connect();
        }
    }

    // Get all inactive tickers from database
    async getInactiveTickers() {
        await this.ensureConnection();
        
        const result = await this.dbManager.query(`
            SELECT symbol, exchange, price, last_updated as last_checked
            FROM tickers 
            WHERE active = false
            ORDER BY last_updated ASC NULLS FIRST
        `);
        
        return result.rows.map(row => ({
            ticker: `${row.symbol}.${row.exchange}`,
            price: row.price,
            exchange: row.exchange,
            last_checked: row.last_checked
        }));
    }

    // Get inactive tickers that need revalidation (older than specified days)
    async getInactiveTickersNeedingRevalidation(daysSinceLastCheck = 30) {
        await this.ensureConnection();
        
        const result = await this.dbManager.query(`
            SELECT symbol, exchange, price, last_updated as last_checked
            FROM tickers 
            WHERE active = false 
                AND (last_updated IS NULL OR last_updated < NOW() - INTERVAL '${daysSinceLastCheck} days')
            ORDER BY last_updated ASC NULLS FIRST
        `);
        
        return result.rows.map(row => ({
            ticker: `${row.symbol}.${row.exchange}`,
            price: row.price,
            exchange: row.exchange,
            last_checked: row.last_checked
        }));
    }

    // Validate multiple tickers concurrently using Yahoo Finance API
    async validateTickersConcurrent(tickers) {
        const results = [];
        const batches = [];
        
        // Split tickers into batches for concurrent processing
        for (let i = 0; i < tickers.length; i += this.concurrentRequests) {
            batches.push(tickers.slice(i, i + this.concurrentRequests));
        }

        for (const batch of batches) {
            const batchPromises = batch.map(ticker => this.validateInactiveTicker(ticker));
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    console.error(`❌ Failed to validate ${batch[index].ticker}:`, result.reason);
                    results.push({
                        ticker: batch[index].ticker,
                        active: false,
                        price: -1,
                        exchange: 'ERROR',
                        status_changed: false
                    });
                }
            });

            // Add delay between batches to respect rate limits
            if (batches.indexOf(batch) < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }

        return results;
    }

    // Validate an inactive ticker to see if it has become active again
    async validateInactiveTicker(tickerData) {
        try {
            const symbol = tickerData.ticker.split('.')[0];
            
            // Use Yahoo Finance API to check if ticker is now active
            const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&lang=en-US&region=US&quotesCount=6&newsCount=4&listsCount=2&enableFuzzyQuery=false`;
            
            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.data && response.data.quotes && response.data.quotes.length > 0) {
                const quote = response.data.quotes[0];
                
                // Check if the ticker now matches and is tradeable
                if (quote.symbol.toUpperCase() === symbol.toUpperCase() && 
                    (quote.regularMarketPrice || quote.ask || quote.bid)) {
                    
                    const currentPrice = quote.regularMarketPrice || quote.ask || quote.bid || 0;
                    
                    console.log(`🎉 Ticker ${tickerData.ticker} is now ACTIVE! Price: $${currentPrice}`);
                    return {
                        ticker: tickerData.ticker,
                        active: true,
                        price: currentPrice,
                        exchange: quote.exchDisp || quote.exchange || tickerData.exchange,
                        status_changed: true
                    };
                }
            }

            // Still inactive - update last checked time
            return {
                ticker: tickerData.ticker,
                active: false,
                price: tickerData.price,
                exchange: tickerData.exchange,
                status_changed: false
            };

        } catch (error) {
            console.log(`⚠️  API error for ${tickerData.ticker}: ${error.message}`);
            
            // On error, keep it inactive
            return {
                ticker: tickerData.ticker,
                active: false,
                price: tickerData.price,
                exchange: tickerData.exchange,
                status_changed: false,
                error: error.message
            };
        }
    }

    // Update ticker validation results in PostgreSQL
    async updateTickerResults(results) {
        await this.ensureConnection();
        
        let successCount = 0;
        let errorCount = 0;
        let statusChangedCount = 0;

        for (const result of results) {
            try {
                const [symbol, exchange] = result.ticker.includes('.') ? 
                    result.ticker.split('.') : [result.ticker, 'NYSE'];
                
                await this.dbManager.updateTicker(symbol, {
                    active: result.active,
                    price: result.price
                });
                
                successCount++;
                if (result.status_changed) {
                    statusChangedCount++;
                }
            } catch (error) {
                console.error(`❌ Failed to update ${result.ticker}:`, error.message);
                errorCount++;
            }
        }

        return { successCount, errorCount, statusChangedCount };
    }

    // Process revalidation in batches
    async processRevalidation(tickers) {
        console.log(`🔄 Starting revalidation of ${tickers.length} inactive tickers...`);
        
        const startTime = Date.now();
        let processedCount = 0;
        let statusChangedTotal = 0;
        const totalTickers = tickers.length;

        // Process in batches
        for (let i = 0; i < tickers.length; i += this.batchSize) {
            const batch = tickers.slice(i, i + this.batchSize);
            const batchStartTime = Date.now();
            
            console.log(`\n📦 Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(tickers.length / this.batchSize)} (${batch.length} tickers)`);
            
            // Validate batch
            const results = await this.validateTickersConcurrent(batch);
            
            // Update database
            const updateResult = await this.updateTickerResults(results);
            
            processedCount += batch.length;
            statusChangedTotal += updateResult.statusChangedCount;
            const batchTime = Date.now() - batchStartTime;
            const tickersPerSecond = (batch.length / batchTime * 1000).toFixed(2);
            
            // Calculate statistics
            const nowActiveCount = results.filter(r => r.active).length;
            const stillInactiveCount = results.filter(r => !r.active).length;
            
            console.log(`✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s (${tickersPerSecond} tickers/sec)`);
            console.log(`📊 Now Active: ${nowActiveCount}, Still Inactive: ${stillInactiveCount}`);
            console.log(`💾 Database updates: ${updateResult.successCount} success, ${updateResult.errorCount} errors`);
            
            if (updateResult.statusChangedCount > 0) {
                console.log(`🎉 Found ${updateResult.statusChangedCount} tickers that became active!`);
            }
            
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
        
        console.log(`\n🎉 Revalidation completed!`);
        console.log(`📊 Total processed: ${processedCount} tickers in ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
        console.log(`⚡ Overall rate: ${overallRate} tickers/second`);
        console.log(`🎉 Reactivated tickers: ${statusChangedTotal}`);
        
        return { processedCount, statusChangedTotal };
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
        const revalidator = new InactiveTickerRevalidator();
        
        try {
            console.log('🔄 Inactive Ticker Revalidator - PostgreSQL Edition');
            console.log('=' .repeat(50));
            
            // Get command line arguments
            const args = process.argv.slice(2);
            const daysArg = args.find(arg => arg.startsWith('--days='));
            const days = daysArg ? parseInt(daysArg.split('=')[1]) : 30;
            const allFlag = args.includes('--all');
            
            // Get initial statistics
            console.log('📊 Getting current database statistics...');
            const initialStats = await revalidator.getStats();
            console.log(`📈 Total: ${initialStats.total}, Active: ${initialStats.active_count}, Inactive: ${initialStats.inactive_count}`);
            
            // Get tickers that need revalidation
            let tickersToValidate;
            if (allFlag) {
                console.log('🔍 Getting ALL inactive tickers for revalidation...');
                tickersToValidate = await revalidator.getInactiveTickers();
            } else {
                console.log(`🔍 Getting inactive tickers that haven't been checked in ${days} days...`);
                tickersToValidate = await revalidator.getInactiveTickersNeedingRevalidation(days);
            }
            
            if (tickersToValidate.length === 0) {
                console.log('✅ No inactive tickers need revalidation at this time!');
            } else {
                console.log(`📋 Found ${tickersToValidate.length} inactive tickers needing revalidation`);
                
                // Process the revalidation
                await revalidator.processRevalidation(tickersToValidate);
                
                // Get final statistics
                console.log('\n📊 Final database statistics...');
                const finalStats = await revalidator.getStats();
                console.log(`📈 Total: ${finalStats.total}, Active: ${finalStats.active_count}, Inactive: ${finalStats.inactive_count}`);
                
                const activeChange = parseInt(finalStats.active_count) - parseInt(initialStats.active_count);
                const inactiveChange = parseInt(finalStats.inactive_count) - parseInt(initialStats.inactive_count);
                
                if (activeChange !== 0 || inactiveChange !== 0) {
                    console.log(`📈 Changes: Active ${activeChange > 0 ? '+' : ''}${activeChange}, Inactive ${inactiveChange > 0 ? '+' : ''}${inactiveChange}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Application error:', error);
        } finally {
            await revalidator.close();
        }
    }
}

// Export the class and run main if this is the main module
module.exports = InactiveTickerRevalidator;
main();