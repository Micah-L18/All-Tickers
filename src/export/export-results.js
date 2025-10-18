const DatabaseFactory = require('../db/database-factory');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class TickerExporter {
    constructor() {
        this.dbManager = DatabaseFactory.createDatabaseManager();
        this.outputDir = path.join(__dirname, '..', '..', 'output');
        this.resultsPath = path.join(this.outputDir, 'results.json');
        this.activeTickersPath = path.join(this.outputDir, 'active_tickers.json');
        this.delistedTickersPath = path.join(this.outputDir, 'delisted_tickers.json');
        
        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Initialize database connection
    async initialize() {
        await this.dbManager.connect();
    }

    // Get all tickers from SQLite database
    async getAllTickers() {
        const result = await this.dbManager.query(`
            SELECT CONCAT(symbol, '.', exchange) as ticker, active, price, exchange
            FROM tickers
            ORDER BY 
                CASE WHEN active = true THEN 0 ELSE 1 END,
                symbol, exchange
        `);
        
        return result.rows.map(row => ({
            ticker: row.ticker,
            active: row.active,
            price: parseFloat(row.price) || row.price,
            exchange: row.exchange
        }));
    }

    // Stream active tickers in batches to avoid memory issues
    async streamActiveTickers() {
        const result = await this.dbManager.query(`
            SELECT CONCAT(symbol, '.', exchange) as ticker, price, exchange
            FROM tickers
            WHERE active = true
            ORDER BY symbol, exchange
        `);
        
        return result.rows.map(row => ({
            ticker: row.ticker,
            active: true,
            price: parseFloat(row.price) || row.price,
            exchange: row.exchange
        }));
    }

    // Stream delisted tickers in batches to avoid memory issues
    async streamDelistedTickers() {
        const result = await this.dbManager.query(`
            SELECT CONCAT(symbol, '.', exchange) as ticker, price, exchange
            FROM tickers
            WHERE active = false
            ORDER BY symbol, exchange
        `);
        
        return result.rows.map(row => ({
            ticker: row.ticker,
            active: false,
            price: parseFloat(row.price) || row.price,
            exchange: row.exchange
        }));
    }

    // Get database statistics
    async getStats() {
        return await this.dbManager.getStats();
    }

    // Get statistics grouped by exchange
    async getStatsByExchange() {
        const result = await this.dbManager.query(`
            SELECT 
                exchange,
                COUNT(*) as total,
                COUNT(CASE WHEN active = true THEN 1 END) as active_count,
                COUNT(CASE WHEN active = false THEN 1 END) as inactive_count,
                AVG(CASE WHEN active = true AND price > 0 THEN price END) as avg_price
            FROM tickers
            GROUP BY exchange
            ORDER BY total DESC
        `);
        
        return result.rows.map(row => ({
            exchange: row.exchange,
            total: parseInt(row.total),
            active_count: parseInt(row.active_count),
            inactive_count: parseInt(row.inactive_count),
            avg_price: row.avg_price ? parseFloat(row.avg_price).toFixed(2) : null
        }));
    }

    // Export results to JSON file
    async exportResults() {
        console.log('📊 Starting export process...');
        const startTime = Date.now();
        
        try {
            console.log('📈 Getting database statistics...');
            const stats = await this.getStats();
            const exchangeStats = await this.getStatsByExchange();
            
            console.log('📥 Exporting all ticker data...');
            const allTickers = await this.getAllTickers();
            
            const results = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    exportTimestamp: Date.now(),
                    database: 'SQLite',
                    source: 'All-Tickers Project',
                    version: '2.0.0'
                },
                summary: {
                    totalTickers: parseInt(stats.total),
                    activeTickers: parseInt(stats.active_count),
                    inactiveTickers: parseInt(stats.inactive_count),
                    activePercentage: ((parseInt(stats.active_count) / parseInt(stats.total)) * 100).toFixed(2),
                    lastUpdated: stats.last_updated_formatted
                },
                exchangeBreakdown: exchangeStats,
                tickers: allTickers
            };
            
            // Write results file
            const jsonString = JSON.stringify(results, null, 2);
            fs.writeFileSync(this.resultsPath, jsonString);
            
            const fileSize = (jsonString.length / 1024 / 1024).toFixed(2);
            const exportTime = Date.now() - startTime;
            
            console.log(`✅ Results exported successfully!`);
            console.log(`📁 File: ${this.resultsPath}`);
            console.log(`📊 Records: ${allTickers.length} tickers`);
            console.log(`💾 Size: ${fileSize} MB`);
            console.log(`⏱️  Time: ${(exportTime / 1000).toFixed(1)}s`);
            
            return {
                success: true,
                path: this.resultsPath,
                records: allTickers.length,
                size: fileSize,
                time: exportTime
            };
            
        } catch (error) {
            console.error('❌ Export failed:', error.message);
            throw error;
        }
    }

    // Export active tickers only
    async exportActiveTickers() {
        console.log('📊 Exporting active tickers...');
        const startTime = Date.now();
        
        try {
            const activeTickers = await this.streamActiveTickers();
            const stats = await this.getStats();
            
            const activeResults = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    exportTimestamp: Date.now(),
                    database: 'SQLite',
                    type: 'Active Tickers Only',
                    source: 'All-Tickers Project',
                    version: '2.0.0'
                },
                summary: {
                    totalActiveTickers: activeTickers.length,
                    percentageOfTotal: ((activeTickers.length / parseInt(stats.total)) * 100).toFixed(2),
                    averagePrice: activeTickers.length > 0 ? 
                        (activeTickers.filter(t => t.price > 0).reduce((sum, t) => sum + t.price, 0) / 
                         activeTickers.filter(t => t.price > 0).length).toFixed(2) : 0
                },
                tickers: activeTickers
            };
            
            // Write active tickers file
            const jsonString = JSON.stringify(activeResults, null, 2);
            fs.writeFileSync(this.activeTickersPath, jsonString);
            
            const fileSize = (jsonString.length / 1024 / 1024).toFixed(2);
            const exportTime = Date.now() - startTime;
            
            console.log(`✅ Active tickers exported successfully!`);
            console.log(`📁 File: ${this.activeTickersPath}`);
            console.log(`📊 Records: ${activeTickers.length} active tickers`);
            console.log(`💾 Size: ${fileSize} MB`);
            console.log(`⏱️  Time: ${(exportTime / 1000).toFixed(1)}s`);
            
            return {
                success: true,
                path: this.activeTickersPath,
                records: activeTickers.length,
                size: fileSize,
                time: exportTime
            };
            
        } catch (error) {
            console.error('❌ Active tickers export failed:', error.message);
            throw error;
        }
    }

    // Export delisted/inactive tickers only
    async exportDelistedTickers() {
        console.log('📊 Exporting delisted/inactive tickers...');
        const startTime = Date.now();
        
        try {
            const delistedTickers = await this.streamDelistedTickers();
            const stats = await this.getStats();
            
            const delistedResults = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    exportTimestamp: Date.now(),
                    database: 'SQLite',
                    type: 'Delisted/Inactive Tickers Only',
                    source: 'All-Tickers Project',
                    version: '2.0.0'
                },
                summary: {
                    totalDelistedTickers: delistedTickers.length,
                    percentageOfTotal: ((delistedTickers.length / parseInt(stats.total)) * 100).toFixed(2)
                },
                tickers: delistedTickers
            };
            
            // Write delisted tickers file
            const jsonString = JSON.stringify(delistedResults, null, 2);
            fs.writeFileSync(this.delistedTickersPath, jsonString);
            
            const fileSize = (jsonString.length / 1024 / 1024).toFixed(2);
            const exportTime = Date.now() - startTime;
            
            console.log(`✅ Delisted tickers exported successfully!`);
            console.log(`📁 File: ${this.delistedTickersPath}`);
            console.log(`📊 Records: ${delistedTickers.length} delisted tickers`);
            console.log(`💾 Size: ${fileSize} MB`);
            console.log(`⏱️  Time: ${(exportTime / 1000).toFixed(1)}s`);
            
            return {
                success: true,
                path: this.delistedTickersPath,
                records: delistedTickers.length,
                size: fileSize,
                time: exportTime
            };
            
        } catch (error) {
            console.error('❌ Delisted tickers export failed:', error.message);
            throw error;
        }
    }

    // Export all formats (complete export)
    async exportAllFormats() {
        console.log('🚀 Starting complete export process...');
        console.log('=' .repeat(50));
        
        const overallStartTime = Date.now();
        const results = {};
        
        try {
            // Export main results
            console.log('\n1️⃣  Exporting main results file...');
            results.main = await this.exportResults();
            
            // Export active tickers
            console.log('\n2️⃣  Exporting active tickers...');
            results.active = await this.exportActiveTickers();
            
            // Export delisted tickers
            console.log('\n3️⃣  Exporting delisted tickers...');
            results.delisted = await this.exportDelistedTickers();
            
            const totalTime = Date.now() - overallStartTime;
            const totalRecords = results.main.records;
            const totalSize = (
                parseFloat(results.main.size) + 
                parseFloat(results.active.size) + 
                parseFloat(results.delisted.size)
            ).toFixed(2);
            
            console.log('\n🎉 Complete export finished!');
            console.log('=' .repeat(50));
            console.log(`📊 Total records processed: ${totalRecords.toLocaleString()}`);
            console.log(`💾 Total size: ${totalSize} MB`);
            console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
            console.log(`⚡ Rate: ${(totalRecords / (totalTime / 1000)).toFixed(0)} records/second`);
            
            console.log('\n📁 Generated files:');
            console.log(`   • ${results.main.path}`);
            console.log(`   • ${results.active.path}`);
            console.log(`   • ${results.delisted.path}`);
            
            return {
                success: true,
                totalRecords,
                totalSize,
                totalTime,
                files: [results.main.path, results.active.path, results.delisted.path],
                details: results
            };
            
        } catch (error) {
            console.error('❌ Complete export failed:', error.message);
            throw error;
        }
    }

    // Create a status/checkpoint file
    async createCheckpoint() {
        try {
            const stats = await this.getStats();
            const exchangeStats = await this.getStatsByExchange();
            
            const checkpoint = {
                timestamp: new Date().toISOString(),
                database: 'SQLite',
                version: '2.0.0',
                status: 'operational',
                statistics: {
                    total: parseInt(stats.total),
                    active: parseInt(stats.active_count),
                    inactive: parseInt(stats.inactive_count),
                    activePercentage: ((parseInt(stats.active_count) / parseInt(stats.total)) * 100).toFixed(2)
                },
                exchangeBreakdown: exchangeStats,
                lastUpdated: stats.last_updated_formatted
            };
            
            const checkpointPath = path.join(this.outputDir, 'checkpoint.json');
            fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
            
            console.log(`✅ Checkpoint created: ${checkpointPath}`);
            return checkpointPath;
            
        } catch (error) {
            console.error('❌ Checkpoint creation failed:', error.message);
            throw error;
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
        const exporter = new TickerExporter();
        
        try {
            console.log('📤 Ticker Exporter - SQLite Edition');
            console.log('=' .repeat(50));
            
            await exporter.initialize();
            
            // Get command line arguments
            const args = process.argv.slice(2);
            const activeOnly = args.includes('--active');
            const delistedOnly = args.includes('--delisted');
            const checkpointOnly = args.includes('--checkpoint');
            
            if (checkpointOnly) {
                await exporter.createCheckpoint();
            } else if (activeOnly) {
                await exporter.exportActiveTickers();
            } else if (delistedOnly) {
                await exporter.exportDelistedTickers();
            } else {
                // Default: export all formats
                await exporter.exportAllFormats();
                await exporter.createCheckpoint();
            }
            
        } catch (error) {
            console.error('❌ Export error:', error);
            process.exit(1);
        } finally {
            await exporter.close();
        }
    }
}

// Export the class and run main if this is the main module
module.exports = TickerExporter;
main();