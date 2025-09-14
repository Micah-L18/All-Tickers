const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class TickerExporter {
    constructor() {
        // Use mounted volume path for database storage
        this.dbPath = path.join(process.env.DB_PATH || '/app/output', 'tickers.db');
        this.db = new sqlite3.Database(this.dbPath);
        this.outputDir = process.env.OUTPUT_PATH || '/app/output';
        this.resultsPath = path.join(this.outputDir, 'results.json');
        this.activeTickersPath = path.join(this.outputDir, 'active_tickers.json');
        this.delistedTickersPath = path.join(this.outputDir, 'delisted_tickers.json');
        
        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Get all tickers from database
    async getAllTickers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, active, price, exchange
                FROM tickers
                ORDER BY 
                    CASE WHEN active = 1 THEN 0 ELSE 1 END,
                    ticker
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    // Convert SQLite boolean integers to actual booleans
                    const formattedRows = rows.map(row => ({
                        ticker: row.ticker,
                        active: row.active === 1,
                        price: row.price,
                        exchange: row.exchange
                    }));
                    resolve(formattedRows);
                }
            });
        });
    }

    // Stream active tickers in batches to avoid memory issues
    async streamActiveTickers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, price, exchange
                FROM tickers
                WHERE active = 1
                ORDER BY ticker
            `;
            
            this.db.all(query, (err, rows) => {
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

    // Stream delisted tickers in batches to avoid memory issues
    async streamDelistedTickers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, price, exchange
                FROM tickers
                WHERE active = 0
                ORDER BY ticker
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const formattedRows = rows.map(row => ({
                        ticker: row.ticker,
                        active: false,
                        price: row.price,
                        exchange: row.exchange
                    }));
                    resolve(formattedRows);
                }
            });
        });
    }

    // Get only active tickers
    async getActiveTickers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, active, price, exchange
                FROM tickers
                WHERE active = 1
                ORDER BY ticker
            `;
            
            this.db.all(query, (err, rows) => {
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

    // Get only delisted/inactive tickers
    async getDelistedTickers() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT ticker, active, price, exchange
                FROM tickers
                WHERE active = 0
                ORDER BY ticker
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const formattedRows = rows.map(row => ({
                        ticker: row.ticker,
                        active: false,
                        price: row.price,
                        exchange: row.exchange
                    }));
                    resolve(formattedRows);
                }
            });
        });
    }

    // Get database statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
                    SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive_count,
                    COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as validated_count,
                    AVG(CASE WHEN active = 1 AND price IS NOT NULL THEN price END) as avg_price,
                    MIN(CASE WHEN active = 1 AND price IS NOT NULL THEN price END) as min_price,
                    MAX(CASE WHEN active = 1 AND price IS NOT NULL THEN price END) as max_price
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

        // Get exchange breakdown
    async getExchangeBreakdown() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    exchange,
                    COUNT(*) as count,
                    AVG(price) as avg_price
                FROM tickers 
                WHERE active = 1 AND exchange IS NOT NULL
                GROUP BY exchange
                ORDER BY count DESC
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

    // Export data to JSON files using streaming to handle large datasets
    async exportToJson(exportType = 'all') {
        try {
            console.log('📊 Gathering database statistics...');
            const stats = await this.getStats();
            
            console.log('📈 Getting exchange breakdown...');
            const exchangeBreakdown = await this.getExchangeBreakdown();
            
            // Create metadata object
            const metadata = {
                exportDate: new Date().toISOString(),
                exportType: exportType,
                version: '2.0.0',
                description: 'All-Tickers bulk validation results'
            };

            const statistics = {
                total: stats.total,
                active: stats.active_count,
                inactive: stats.inactive_count,
                validated: stats.validated_count,
                validationRate: Math.round((stats.validated_count / stats.total) * 100) + '%',
                activeRate: stats.active_count > 0 ? Math.round((stats.active_count / stats.validated_count) * 100) + '%' : '0%',
                priceStats: {
                    average: stats.avg_price ? Math.round(stats.avg_price * 100) / 100 : null,
                    minimum: stats.min_price,
                    maximum: stats.max_price
                }
            };

            const exchanges = exchangeBreakdown.map(ex => ({
                name: ex.exchange,
                tickerCount: ex.count,
                averagePrice: ex.avg_price ? Math.round(ex.avg_price * 100) / 100 : null
            }));

            const results = {
                created: 0,
                totalSize: 0,
                files: []
            };

            // Stream export active tickers (most useful for legacy format)
            console.log('� Streaming active tickers export...');
            const activeTickers = await this.streamActiveTickers();
            
            const activeData = {
                metadata: { ...metadata, exportType: 'active' },
                statistics: { ...statistics, description: 'Active tickers only' },
                exchanges,
                tickers: activeTickers
            };
            
            console.log(`💾 Writing active tickers (${activeTickers.length} tickers) to ${this.activeTickersPath}...`);
            fs.writeFileSync(this.activeTickersPath, JSON.stringify(activeData, null, 2));
            
            let fileSize = fs.statSync(this.activeTickersPath).size;
            results.files.push({
                name: 'active_tickers.json',
                path: this.activeTickersPath,
                type: 'active',
                tickerCount: activeTickers.length,
                size: fileSize
            });
            results.created++;
            results.totalSize += fileSize;
            
            // Only export delisted tickers if requested
            if (exportType === 'all' || exportType === 'delisted') {
                // Stream export delisted tickers 
                console.log('🔍 Streaming delisted tickers export...');
                const delistedTickers = await this.streamDelistedTickers();
                
                const delistedData = {
                    metadata: { ...metadata, exportType: 'delisted' },
                    statistics: { 
                        ...statistics, 
                        description: 'Delisted/inactive tickers only',
                        active: 0,
                        inactive: delistedTickers.length
                    },
                    exchanges: [], // No exchanges for inactive tickers
                    tickers: delistedTickers
                };
                
                console.log(`💾 Writing delisted tickers (${delistedTickers.length} tickers) to ${this.delistedTickersPath}...`);
                fs.writeFileSync(this.delistedTickersPath, JSON.stringify(delistedData, null, 2));
                
                fileSize = fs.statSync(this.delistedTickersPath).size;
                results.files.push({
                    name: 'delisted_tickers.json',
                    path: this.delistedTickersPath,
                    type: 'delisted',
                    tickerCount: delistedTickers.length,
                    size: fileSize
                });
                results.created++;
                results.totalSize += fileSize;
            }
            
            return {
                outputDir: this.outputDir,
                filesCreated: results.created,
                totalSize: results.totalSize,
                files: results.files,
                stats: statistics
            };
            
        } catch (error) {
            console.error('❌ Error during export:', error);
            throw error;
        }
    }

    // Close database connection
    close() {
        if (!this.db) return; // Already closed
        
        try {
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err);
                } else {
                    console.log('✅ Database connection closed');
                }
            });
            this.db = null; // Mark as closed
        } catch (error) {
            // Database already closed or connection lost
            this.db = null;
        }
    }
}

// Main execution
async function main() {
    console.log('📤 All-Tickers Results Exporter v2.0');
    console.log('=====================================');
    
    const exporter = new TickerExporter();
    
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        let exportType = 'all'; // Default to exporting all files
        
        if (args.includes('--active-only')) {
            exportType = 'active';
        } else if (args.includes('--delisted-only')) {
            exportType = 'delisted';
        } else if (args.includes('--complete-only')) {
            exportType = 'complete';
        }
        
        const showPreview = args.includes('--preview');
        
        if (showPreview) {
            console.log('👀 Preview mode - showing sample data only');
            
            // Show database stats
            const stats = await exporter.getStats();
            console.log('\n📊 Database Statistics:');
            console.log(`   Total tickers: ${stats.total}`);
            console.log(`   Active: ${stats.active_count}`);
            console.log(`   Inactive: ${stats.inactive_count}`);
            console.log(`   Validated: ${stats.validated_count}`);
            
            if (stats.active_count > 0) {
                console.log('\n💰 Price Statistics:');
                console.log(`   Average: $${stats.avg_price ? Math.round(stats.avg_price * 100) / 100 : 'N/A'}`);
                console.log(`   Range: $${stats.min_price || 'N/A'} - $${stats.max_price || 'N/A'}`);
                
                // Show exchange breakdown
                const exchanges = await exporter.getExchangeBreakdown();
                if (exchanges.length > 0) {
                    console.log('\n🏢 Exchange Breakdown:');
                    exchanges.slice(0, 5).forEach(ex => {
                        console.log(`   ${ex.exchange}: ${ex.count} tickers (avg: $${Math.round(ex.avg_price * 100) / 100})`);
                    });
                }
                
                // Show sample active tickers
                const activeSample = await exporter.getActiveTickers();
                if (activeSample.length > 0) {
                    console.log('\n📈 Sample Active Tickers:');
                    activeSample.slice(0, 10).forEach(ticker => {
                        console.log(`   ${ticker.ticker} - ${ticker.exchange} - $${ticker.price}`);
                    });
                    if (activeSample.length > 10) {
                        console.log(`   ... and ${activeSample.length - 10} more`);
                    }
                }
            }
            
            exporter.close();
            return;
        }
        
        console.log(`🎯 Export type: ${exportType === 'active' ? 'Active tickers only' : exportType === 'delisted' ? 'Delisted tickers only' : 'All files (complete, active, and delisted)'}`);
        
        // Perform export
        const startTime = Date.now();
        const result = await exporter.exportToJson(exportType);
        const exportTime = Date.now() - startTime;
        
        // Show results
        console.log('\n🎉 Export completed successfully!');
        console.log(`📁 Output directory: ${result.outputDir}`);
        console.log(`📊 Files created: ${result.filesCreated}`);
        console.log(`💾 Total size: ${Math.round(result.totalSize / 1024)} KB`);
        console.log(`⏱️  Export time: ${exportTime}ms`);
        
        console.log('\n📁 Files created:');
        result.files.forEach(file => {
            const sizeKB = Math.round(file.size / 1024);
            const typeEmoji = file.type === 'active' ? '✅' : file.type === 'delisted' ? '❌' : '📊';
            console.log(`   ${typeEmoji} ${file.name} - ${file.tickerCount} tickers (${sizeKB} KB)`);
        });
        
        console.log('\n📈 Summary Statistics:');
        console.log(`   Active tickers: ${result.stats.active}`);
        console.log(`   Inactive/delisted: ${result.stats.inactive}`);
        console.log(`   Validation rate: ${result.stats.validationRate}`);
        console.log(`   Active rate: ${result.stats.activeRate}`);
        
        if (result.stats.priceStats.average) {
            console.log(`   Average price: $${result.stats.priceStats.average}`);
        }
        
        console.log('\n💡 Output files:');
        console.log('   • active_tickers.json - All validated active tickers');
        console.log('   • delisted_tickers.json - All inactive/delisted tickers');
        if (exportType === 'all' || exportType === 'complete') {
            console.log('   • results.json - Complete dataset with all tickers');
        }
        
    } catch (error) {
        console.error('❌ Error during export:', error);
        process.exit(1);
    } finally {
        exporter.close();
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TickerExporter;
