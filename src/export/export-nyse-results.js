const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class NYSEResultsExporter {
    constructor() {
        // NYSE exchanges we want to include
        this.nyseExchanges = ['NYQ', 'NMS', 'NYSE Arca', 'BATS'];
        this.dbPath = path.join(__dirname, '..', 'db', 'tickers.db');
        this.db = new sqlite3.Database(this.dbPath);

        // Output paths
        this.outputDir = path.join(__dirname, '..', '..', 'output');
        this.nyseTickersPath = path.join(this.outputDir, 'nyse_tickers.json');
        this.nyseTickersCSVPath = path.join(this.outputDir, 'nyse_tickers.csv');
        
        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Get only NYSE tickers
    async getNYSETickers() {
        return new Promise((resolve, reject) => {
            const exchangeList = this.nyseExchanges.map(() => '?').join(',');
            const query = `
                SELECT ticker, active, price, exchange
                FROM tickers
                WHERE active = 1 AND exchange IN (${exchangeList})
                ORDER BY ticker
            `;
            
            this.db.all(query, this.nyseExchanges, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const formattedRows = rows.map(row => ({
                        ticker: row.ticker,
                        active: true,
                        price: row.price,
                        exchange: row.exchange
                    }));
                    resolve(formattedRows);
                }
            });
        });
    }

    // Get NYSE statistics
    async getNYSEStats() {
        return new Promise((resolve, reject) => {
            const exchangeList = this.nyseExchanges.map(() => '?').join(',');
            const query = `
                SELECT 
                    COUNT(*) as total,
                    AVG(price) as avg_price,
                    MIN(price) as min_price,
                    MAX(price) as max_price,
                    exchange
                FROM tickers
                WHERE active = 1 AND exchange IN (${exchangeList})
                GROUP BY exchange
                ORDER BY COUNT(*) DESC
            `;
            
            this.db.all(query, this.nyseExchanges, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Get overall NYSE summary
    async getNYSESummary() {
        return new Promise((resolve, reject) => {
            const exchangeList = this.nyseExchanges.map(() => '?').join(',');
            const query = `
                SELECT 
                    COUNT(*) as total_nyse,
                    AVG(price) as avg_price,
                    MIN(price) as min_price,
                    MAX(price) as max_price,
                    (SELECT COUNT(*) FROM tickers WHERE active = 1) as total_active_all_exchanges
                FROM tickers
                WHERE active = 1 AND exchange IN (${exchangeList})
            `;
            
            this.db.get(query, this.nyseExchanges, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Export NYSE data to JSON
    async exportNYSEToJson() {
        try {
            console.log('📊 Gathering NYSE ticker data...');
            const nyseTickers = await this.getNYSETickers();
            
            console.log('📈 Getting NYSE statistics...');
            const nyseStats = await this.getNYSEStats();
            const nyseSummary = await this.getNYSESummary();
            
            // Create metadata
            const metadata = {
                exportDate: new Date().toISOString(),
                exportType: 'NYSE_only',
                version: '2.0.0',
                description: 'Active tickers from New York Stock Exchange only',
                exchanges: this.nyseExchanges,
                exchangeNote: 'Includes NYSE, NYSE Arca, NASDAQ NMS, and other major US exchanges'
            };

            const statistics = {
                totalNYSETickers: nyseSummary.total_nyse,
                totalActiveAllExchanges: nyseSummary.total_active_all_exchanges,
                nysePercentage: Math.round((nyseSummary.total_nyse / nyseSummary.total_active_all_exchanges) * 100) + '%',
                priceStats: {
                    average: nyseSummary.avg_price ? Math.round(nyseSummary.avg_price * 100) / 100 : null,
                    minimum: nyseSummary.min_price,
                    maximum: nyseSummary.max_price
                },
                exchangeBreakdown: nyseStats.map(stat => ({
                    exchange: stat.exchange,
                    tickerCount: stat.total,
                    averagePrice: stat.avg_price ? Math.round(stat.avg_price * 100) / 100 : null,
                    priceRange: {
                        min: stat.min_price,
                        max: stat.max_price
                    }
                }))
            };

            const nyseData = {
                metadata,
                statistics,
                tickers: nyseTickers
            };
            
            console.log(`💾 Writing NYSE tickers (${nyseTickers.length} tickers) to ${this.nyseTickersPath}...`);
            fs.writeFileSync(this.nyseTickersPath, JSON.stringify(nyseData, null, 2));
            
            const fileSize = fs.statSync(this.nyseTickersPath).size;
            
            return {
                filePath: this.nyseTickersPath,
                tickerCount: nyseTickers.length,
                fileSize: fileSize,
                statistics: statistics
            };
            
        } catch (error) {
            console.error('❌ Error during NYSE export:', error);
            throw error;
        }
    }

    // Export NYSE data to CSV
    async exportNYSEToCSV() {
        try {
            console.log('📊 Preparing NYSE data for CSV export...');
            const nyseTickers = await this.getNYSETickers();
            
            // CSV headers
            const csvHeaders = [
                'ticker',
                'exchange',
                'price',
                'active'
            ].join(',');
            
            // Convert tickers to CSV rows
            const csvRows = nyseTickers.map(ticker => {
                return [
                    `"${ticker.ticker}"`,
                    `"${ticker.exchange}"`,
                    ticker.price || 'N/A',
                    ticker.active
                ].join(',');
            });
            
            // Combine headers and data
            const csvContent = [csvHeaders, ...csvRows].join('\n');
            
            console.log(`💾 Writing NYSE CSV (${nyseTickers.length} tickers) to ${this.nyseTickersCSVPath}...`);
            fs.writeFileSync(this.nyseTickersCSVPath, csvContent);
            
            const fileSize = fs.statSync(this.nyseTickersCSVPath).size;
            
            return {
                filePath: this.nyseTickersCSVPath,
                tickerCount: nyseTickers.length,
                fileSize: fileSize
            };
            
        } catch (error) {
            console.error('❌ Error during NYSE CSV export:', error);
            throw error;
        }
    }

    // Close database connection
    close() {
        if (!this.db) return;
        
        try {
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err);
                } else {
                    console.log('✅ Database connection closed');
                }
            });
            this.db = null;
        } catch (error) {
            this.db = null;
        }
    }
}

// Main execution
async function main() {
    console.log('🏛️  NYSE Tickers Exporter v1.0');
    console.log('==============================');
    
    const exporter = new NYSEResultsExporter();
    
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const csvOnly = args.includes('--csv-only');
        const jsonOnly = args.includes('--json-only');
        const showPreview = args.includes('--preview');
        
        if (showPreview) {
            console.log('👀 Preview mode - showing NYSE sample data');
            
            const nyseTickers = await exporter.getNYSETickers();
            const nyseSummary = await exporter.getNYSESummary();
            const nyseStats = await exporter.getNYSEStats();
            
            console.log('\n📊 NYSE Statistics:');
            console.log(`   NYSE tickers: ${nyseSummary.total_nyse}`);
            console.log(`   Total active (all exchanges): ${nyseSummary.total_active_all_exchanges}`);
            console.log(`   NYSE percentage: ${Math.round((nyseSummary.total_nyse / nyseSummary.total_active_all_exchanges) * 100)}%`);
            
            if (nyseSummary.avg_price) {
                console.log('\n💰 NYSE Price Statistics:');
                console.log(`   Average: $${Math.round(nyseSummary.avg_price * 100) / 100}`);
                console.log(`   Range: $${nyseSummary.min_price} - $${nyseSummary.max_price}`);
            }
            
            if (nyseStats.length > 0) {
                console.log('\n🏢 NYSE Exchange Breakdown:');
                nyseStats.forEach(stat => {
                    console.log(`   ${stat.exchange}: ${stat.total} tickers (avg: $${Math.round(stat.avg_price * 100) / 100})`);
                });
            }
            
            if (nyseTickers.length > 0) {
                console.log('\n📈 Sample NYSE Tickers:');
                nyseTickers.slice(0, 15).forEach(ticker => {
                    console.log(`   ${ticker.ticker} - ${ticker.exchange} - $${ticker.price}`);
                });
                if (nyseTickers.length > 15) {
                    console.log(`   ... and ${nyseTickers.length - 15} more`);
                }
            }
            
            exporter.close();
            return;
        }
        
        console.log('🎯 Exporting NYSE tickers only...');
        console.log('🏛️  Target exchanges: NYQ, NYSE, NMS, NYSE Arca, BATS');
        
        const startTime = Date.now();
        let results = [];
        
        // Export JSON (default)
        if (!csvOnly) {
            const jsonResult = await exporter.exportNYSEToJson();
            results.push({
                type: 'JSON',
                ...jsonResult
            });
        }
        
        // Export CSV
        if (!jsonOnly) {
            const csvResult = await exporter.exportNYSEToCSV();
            results.push({
                type: 'CSV',
                ...csvResult
            });
        }
        
        const exportTime = Date.now() - startTime;
        
        // Show results
        console.log('\n🎉 NYSE export completed successfully!');
        console.log(`📁 Output directory: ${exporter.outputDir}`);
        console.log(`⏱️  Export time: ${exportTime}ms`);
        
        console.log('\n📁 Files created:');
        results.forEach(result => {
            const sizeKB = Math.round(result.fileSize / 1024);
            const typeEmoji = result.type === 'JSON' ? '📊' : '📋';
            console.log(`   ${typeEmoji} ${path.basename(result.filePath)} - ${result.tickerCount} NYSE tickers (${sizeKB} KB)`);
        });
        
        // Show statistics from JSON export if available
        const jsonResult = results.find(r => r.type === 'JSON');
        if (jsonResult) {
            console.log('\n📈 NYSE Summary:');
            console.log(`   NYSE tickers: ${jsonResult.statistics.totalNYSETickers}`);
            console.log(`   Percentage of all active: ${jsonResult.statistics.nysePercentage}`);
            if (jsonResult.statistics.priceStats.average) {
                console.log(`   Average price: $${jsonResult.statistics.priceStats.average}`);
            }
            
            console.log('\n🏢 Exchange breakdown:');
            jsonResult.statistics.exchangeBreakdown.forEach(ex => {
                console.log(`   ${ex.exchange}: ${ex.tickerCount} tickers`);
            });
        }
        
        console.log('\n💡 Output files:');
        if (!csvOnly) console.log('   • nyse_tickers.json - Complete NYSE ticker data with metadata');
        if (!jsonOnly) console.log('   • nyse_tickers.csv - NYSE tickers in spreadsheet format');
        
    } catch (error) {
        console.error('❌ Error during NYSE export:', error);
        process.exit(1);
    } finally {
        exporter.close();
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = NYSEResultsExporter;
