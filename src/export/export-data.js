const Database = require('sqlite3').Database;
const fs = require('fs');
const path = require('path');

class DataExporter {
    constructor() {
        this.dbPath = path.join(process.env.DB_PATH || '/app/output', 'ticker_data.db');
        this.db = new Database(this.dbPath);
        this.outputDir = process.env.OUTPUT_PATH || '/app/output';
    }

    async getAllTickerData() {
        return new Promise((resolve, reject) => {
            // First check how many records we have
            this.db.get('SELECT COUNT(*) as count FROM ticker_data', (err, countRow) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                const totalCount = countRow.count;
                console.log(`📊 Found ${totalCount} records in database`);
                
                // If too many records, reject to force streaming approach
                if (totalCount > 1000) {
                    console.log('⚠️  Too many records for memory loading - will use streaming...');
                    resolve({ useStreaming: true, totalCount });
                    return;
                }
                
                // Safe to load into memory
                const sql = 'SELECT * FROM ticker_data ORDER BY ticker ASC';
                this.db.all(sql, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            });
        });
    }

    async exportToJSON() {
        console.log('📊 Exporting data to DATA.json...');
        
        try {
            const rawData = await this.getAllTickerData();
            
            // Check if we should use streaming (either too many records or special flag)
            if (rawData.useStreaming || (Array.isArray(rawData) && rawData.length > 1000)) {
                console.log('⚠️  Using streaming export for large dataset...');
                return await this.exportToJSONStreamingFromDB();
            }
            
            console.log(`📊 Processing ${rawData.length} records for JSON export...`);
            
            // Parse JSON data and create structured export
            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    totalRecords: rawData.length,
                    dataSource: 'All-Tickers Comprehensive Data Collection',
                    version: '2.0.0',
                    description: 'Complete financial data for active tickers including quotes, historical data, and company summaries'
                },
                tickers: rawData.map((row, index) => {
                    if (index % 1000 === 0) {
                        console.log(`📈 Processing record ${index + 1}/${rawData.length}...`);
                    }
                    return {
                        ticker: row.ticker,
                        lastUpdated: row.last_updated,
                        createdAt: row.created_at,
                        data: JSON.parse(row.json_data)
                    };
                })
            };
            
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            const jsonPath = path.join(this.outputDir, 'DATA.json');
            console.log('💾 Writing JSON file...');
            fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
            
            console.log(`✅ DATA.json exported successfully: ${jsonPath}`);
            console.log(`📊 Records exported: ${rawData.length}`);
            
            return jsonPath;
            
        } catch (error) {
            console.error('❌ Error exporting to JSON:', error.message);
            throw error;
        }
    }

    async exportToJSONStreamingFromDB() {
        const jsonPath = path.join(this.outputDir, 'DATA.json');
        
        try {
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            console.log('🚀 Starting streaming JSON export directly from database...');
            
            // Get total count for progress tracking
            const totalCount = await new Promise((resolve, reject) => {
                this.db.get('SELECT COUNT(*) as count FROM ticker_data', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
            
            console.log(`📊 Will export ${totalCount} records using database streaming...`);
            
            // Create write stream
            const writeStream = fs.createWriteStream(jsonPath, {
                encoding: 'utf8',
                highWaterMark: 16 * 1024 // 16KB buffer
            });
            
            // Increase max listeners to prevent warning
            writeStream.setMaxListeners(50);
            
            // Handle stream errors
            writeStream.on('error', (error) => {
                console.error('❌ Write stream error:', error);
                throw error;
            });
            
            // Helper function to write with backpressure handling
            const writeToStream = async (data) => {
                return new Promise((resolve, reject) => {
                    const canContinue = writeStream.write(data);
                    if (canContinue) {
                        resolve();
                    } else {
                        writeStream.once('drain', resolve);
                        writeStream.once('error', reject);
                    }
                });
            };
            
            // Write metadata and opening
            const metadata = {
                exportDate: new Date().toISOString(),
                totalRecords: totalCount,
                dataSource: 'All-Tickers Comprehensive Data Collection',
                version: '2.0.0',
                description: 'Complete financial data for active tickers including quotes, historical data, and company summaries'
            };
            
            await writeToStream('{\n');
            await writeToStream(`  "metadata": ${JSON.stringify(metadata, null, 2).split('\n').join('\n  ')},\n`);
            await writeToStream('  "tickers": [\n');
            
            // Process records in small chunks directly from database
            const chunkSize = 50;
            let processedCount = 0;
            let exportedCount = 0;
            
            for (let offset = 0; offset < totalCount; offset += chunkSize) {
                const chunk = await new Promise((resolve, reject) => {
                    const sql = 'SELECT * FROM ticker_data ORDER BY ticker ASC LIMIT ? OFFSET ?';
                    this.db.all(sql, [chunkSize, offset], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
                
                for (let i = 0; i < chunk.length; i++) {
                    const row = chunk[i];
                    const isLast = processedCount === totalCount - 1;
                    
                    try {
                        const tickerData = {
                            ticker: row.ticker,
                            lastUpdated: row.last_updated,
                            createdAt: row.created_at,
                            data: JSON.parse(row.json_data)
                        };
                        
                        const jsonString = JSON.stringify(tickerData, null, 4).split('\n').join('\n    ');
                        await writeToStream(`    ${jsonString}${isLast ? '' : ','}\n`);
                        exportedCount++;
                        
                    } catch (parseError) {
                        console.log(`⚠️  Skipping ${row?.ticker || 'unknown'} due to JSON parse error: ${parseError.message}`);
                    }
                    
                    processedCount++;
                }
                
                // Progress update
                const percentage = ((processedCount / totalCount) * 100).toFixed(1);
                console.log(`📈 JSON Export Progress: ${processedCount}/${totalCount} (${percentage}%)`);
                
                // Small delay to prevent overwhelming
                if (offset + chunkSize < totalCount) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            await writeToStream('  ]\n');
            await writeToStream('}\n');
            
            // Properly close the stream
            return new Promise((resolve, reject) => {
                writeStream.end((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        console.log(`✅ Database streaming JSON export completed: ${jsonPath}`);
                        console.log(`📊 Records exported: ${exportedCount}/${totalCount} (${totalCount - exportedCount} skipped due to errors)`);
                        resolve(jsonPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in database streaming JSON export:', error.message);
            throw error;
        }
    }

    async exportToJSONStreaming(rawData) {
        const jsonPath = path.join(this.outputDir, 'DATA.json');
        
        try {
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            console.log('🚀 Starting streaming JSON export...');
            
            // Create write stream with proper options
            const writeStream = fs.createWriteStream(jsonPath, {
                encoding: 'utf8',
                highWaterMark: 64 * 1024 // 64KB buffer
            });
            
            // Handle stream errors
            writeStream.on('error', (error) => {
                console.error('❌ Write stream error:', error);
                throw error;
            });
            
            // Write metadata and opening
            const metadata = {
                exportDate: new Date().toISOString(),
                totalRecords: rawData.length,
                dataSource: 'All-Tickers Comprehensive Data Collection',
                version: '2.0.0',
                description: 'Complete financial data for active tickers including quotes, historical data, and company summaries'
            };
            
            // Helper function to write with backpressure handling
            const writeToStream = async (data) => {
                return new Promise((resolve, reject) => {
                    const canContinue = writeStream.write(data);
                    if (canContinue) {
                        resolve();
                    } else {
                        writeStream.once('drain', resolve);
                        writeStream.once('error', reject);
                    }
                });
            };
            
            await writeToStream('{\n');
            await writeToStream(`  "metadata": ${JSON.stringify(metadata, null, 2).split('\n').join('\n  ')},\n`);
            await writeToStream('  "tickers": [\n');
            
            // Process records in smaller chunks to reduce memory pressure
            const chunkSize = 10; // Much smaller chunk size for memory efficiency
            let processedCount = 0;
            
            for (let i = 0; i < rawData.length; i += chunkSize) {
                const chunk = rawData.slice(i, i + chunkSize);
                
                for (let j = 0; j < chunk.length; j++) {
                    const row = chunk[j];
                    const globalIndex = i + j;
                    const isLast = globalIndex === rawData.length - 1;
                    
                    try {
                        const tickerData = {
                            ticker: row.ticker,
                            lastUpdated: row.last_updated,
                            createdAt: row.created_at,
                            data: JSON.parse(row.json_data)
                        };
                        
                        const jsonString = JSON.stringify(tickerData, null, 4).split('\n').join('\n    ');
                        await writeToStream(`    ${jsonString}${isLast ? '' : ','}\n`);
                        processedCount++;
                        
                    } catch (parseError) {
                        console.log(`⚠️  Skipping ${row?.ticker || 'unknown'} due to JSON parse error: ${parseError.message}`);
                        // Don't write anything for corrupted records, but still count them
                    }
                }
                
                // Progress update
                const progress = Math.min(i + chunk.length, rawData.length);
                const percentage = ((progress / rawData.length) * 100).toFixed(1);
                console.log(`📈 JSON Export Progress: ${progress}/${rawData.length} (${percentage}%)`);
                
                // Small delay between chunks to prevent overwhelming the system
                if (i + chunkSize < rawData.length) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            await writeToStream('  ]\n');
            await writeToStream('}\n');
            
            // Properly close the stream and wait for it to finish
            return new Promise((resolve, reject) => {
                writeStream.end((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        console.log(`✅ Streaming JSON export completed: ${jsonPath}`);
                        console.log(`📊 Records exported: ${processedCount}/${rawData.length} (${rawData.length - processedCount} skipped due to errors)`);
                        resolve(jsonPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in streaming JSON export:', error.message);
            console.error('Error details:', error);
            throw error;
        }
    }

    async exportToCSV() {
        console.log('📊 Exporting data to DATA.csv...');
        
        try {
            const rawData = await this.getAllTickerData();
            
            // Check if we should use streaming (either too many records or special flag)
            if (rawData.useStreaming || (Array.isArray(rawData) && rawData.length > 1000)) {
                console.log('⚠️  Using streaming CSV export for large dataset...');
                return await this.exportToCSVStreamingFromDB();
            }
            
            console.log(`📊 Processing ${rawData.length} records for CSV export...`);
            
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            const csvPath = path.join(this.outputDir, 'DATA.csv');
            
            // Use streaming for large datasets
            if (rawData.length > 5000) {
                console.log('⚠️  Large dataset detected - using streaming CSV export...');
                return await this.exportToCSVStreaming(rawData, csvPath);
            }
            
            // CSV headers
            const csvHeaders = [
                'ticker',
                'last_updated',
                'created_at',
                'current_price',
                'market_cap',
                'pe_ratio',
                'dividend_yield',
                'fifty_two_week_high',
                'fifty_two_week_low',
                'avg_volume',
                'exchange',
                'sector',
                'industry',
                'company_name',
                'market_state',
                'currency',
                'historical_data_points',
                'price_change_percent',
                'average_close_historical',
                'data_fetch_success'
            ].join(',');
            
            // Process each ticker's data for CSV
            const csvRows = rawData.map((row, index) => {
                if (index % 1000 === 0) {
                    console.log(`📈 Processing CSV record ${index + 1}/${rawData.length}...`);
                }
                
                try {
                    const data = JSON.parse(row.json_data);
                    const quote = data.quote || {};
                    const summary = data.summary || {};
                    const stats = data.statistics?.historicalStats || {};
                    
                    // Extract key financial metrics
                    return [
                        `"${row.ticker}"`,
                        `"${row.last_updated}"`,
                        `"${row.created_at}"`,
                        quote.regularMarketPrice || 'N/A',
                        quote.marketCap || 'N/A',
                        (summary.defaultKeyStatistics?.trailingPE?.raw || summary.defaultKeyStatistics?.trailingPE || 'N/A'),
                        (summary.summaryDetail?.dividendYield?.raw || summary.summaryDetail?.dividendYield || 'N/A'),
                        quote.fiftyTwoWeekHigh || 'N/A',
                        quote.fiftyTwoWeekLow || 'N/A',
                        quote.averageDailyVolume3Month || 'N/A',
                        `"${quote.exchange || 'N/A'}"`,
                        `"${summary.assetProfile?.sector || 'N/A'}"`,
                        `"${summary.assetProfile?.industry || 'N/A'}"`,
                        `"${(quote.longName || quote.shortName || 'N/A').replace(/"/g, "'")}"`,
                        `"${quote.marketState || 'N/A'}"`,
                        `"${quote.currency || 'N/A'}"`,
                        stats.totalDays || 0,
                        `"${stats.priceChange || 'N/A'}"`,
                        stats.averageClose || 'N/A',
                        data.metadata.error ? 'false' : 'true'
                    ].join(',');
                } catch (parseError) {
                    // Handle corrupted data
                    console.log(`⚠️  Error processing ${row.ticker} for CSV: ${parseError.message}`);
                    return [
                        `"${row.ticker}"`,
                        `"${row.last_updated}"`,
                        `"${row.created_at}"`,
                        ...Array(17).fill('ERROR')
                    ].join(',');
                }
            });
            
            // Combine headers and data
            const csvContent = [csvHeaders, ...csvRows].join('\n');
            
            console.log('💾 Writing CSV file...');
            fs.writeFileSync(csvPath, csvContent);
            
            console.log(`✅ DATA.csv exported successfully: ${csvPath}`);
            console.log(`📊 Records exported: ${rawData.length}`);
            console.log(`📋 CSV Columns: ${csvHeaders.split(',').length}`);
            
            return csvPath;
            
        } catch (error) {
            console.error('❌ Error exporting to CSV:', error.message);
            throw error;
        }
    }

    async exportToCSVStreaming(rawData, csvPath) {
        console.log('🚀 Starting streaming CSV export...');
        
        // Create write stream
        const writeStream = fs.createWriteStream(csvPath);
        
        // CSV headers
        const csvHeaders = [
            'ticker',
            'last_updated',
            'created_at',
            'current_price',
            'market_cap',
            'pe_ratio',
            'dividend_yield',
            'fifty_two_week_high',
            'fifty_two_week_low',
            'avg_volume',
            'exchange',
            'sector',
            'industry',
            'company_name',
            'market_state',
            'currency',
            'historical_data_points',
            'price_change_percent',
            'average_close_historical',
            'data_fetch_success'
        ].join(',');
        
        writeStream.write(csvHeaders + '\n');
        
        // Process records in chunks
        const chunkSize = 100;
        for (let i = 0; i < rawData.length; i += chunkSize) {
            const chunk = rawData.slice(i, i + chunkSize);
            
            for (const row of chunk) {
                try {
                    const data = JSON.parse(row.json_data);
                    const quote = data.quote || {};
                    const summary = data.summary || {};
                    const stats = data.statistics?.historicalStats || {};
                    
                    const csvRow = [
                        `"${row.ticker}"`,
                        `"${row.last_updated}"`,
                        `"${row.created_at}"`,
                        quote.regularMarketPrice || 'N/A',
                        quote.marketCap || 'N/A',
                        (summary.defaultKeyStatistics?.trailingPE?.raw || summary.defaultKeyStatistics?.trailingPE || 'N/A'),
                        (summary.summaryDetail?.dividendYield?.raw || summary.summaryDetail?.dividendYield || 'N/A'),
                        quote.fiftyTwoWeekHigh || 'N/A',
                        quote.fiftyTwoWeekLow || 'N/A',
                        quote.averageDailyVolume3Month || 'N/A',
                        `"${quote.exchange || 'N/A'}"`,
                        `"${summary.assetProfile?.sector || 'N/A'}"`,
                        `"${summary.assetProfile?.industry || 'N/A'}"`,
                        `"${(quote.longName || quote.shortName || 'N/A').replace(/"/g, "'")}"`,
                        `"${quote.marketState || 'N/A'}"`,
                        `"${quote.currency || 'N/A'}"`,
                        stats.totalDays || 0,
                        `"${stats.priceChange || 'N/A'}"`,
                        stats.averageClose || 'N/A',
                        data.metadata.error ? 'false' : 'true'
                    ].join(',');
                    
                    writeStream.write(csvRow + '\n');
                    
                } catch (parseError) {
                    console.log(`⚠️  Skipping ${row.ticker} due to parse error`);
                    const errorRow = [
                        `"${row.ticker}"`,
                        `"${row.last_updated}"`,
                        `"${row.created_at}"`,
                        ...Array(17).fill('ERROR')
                    ].join(',');
                    writeStream.write(errorRow + '\n');
                }
            }
            
            // Progress update
            const progress = Math.min(i + chunkSize, rawData.length);
            const percentage = ((progress / rawData.length) * 100).toFixed(1);
            console.log(`� CSV Export Progress: ${progress}/${rawData.length} (${percentage}%)`);
        }
        
        writeStream.end();
        
        // Wait for stream to finish
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        
        console.log(`✅ Streaming CSV export completed: ${csvPath}`);
        console.log(`📊 Records exported: ${rawData.length}`);
        console.log(`📋 CSV Columns: ${csvHeaders.split(',').length}`);
        
        return csvPath;
    }

    async exportToCSVStreamingFromDB() {
        const csvPath = path.join(this.outputDir, 'DATA.csv');
        
        try {
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            console.log('🚀 Starting streaming CSV export directly from database...');
            
            // Get total count for progress tracking
            const totalCount = await new Promise((resolve, reject) => {
                this.db.get('SELECT COUNT(*) as count FROM ticker_data', (err, row) => {
                    if (err) reject(err);
                    else resolve(row.count);
                });
            });
            
            console.log(`📊 Will export ${totalCount} records using database streaming...`);
            
            // Create write stream
            const writeStream = fs.createWriteStream(csvPath, {
                encoding: 'utf8',
                highWaterMark: 16 * 1024 // 16KB buffer
            });
            
            // Increase max listeners to prevent warning
            writeStream.setMaxListeners(20);
            
            // Handle stream errors
            writeStream.on('error', (error) => {
                console.error('❌ Write stream error:', error);
                throw error;
            });
            
            // Helper function to write with backpressure handling
            const writeToStream = async (data) => {
                return new Promise((resolve, reject) => {
                    const canContinue = writeStream.write(data);
                    if (canContinue) {
                        resolve();
                    } else {
                        writeStream.once('drain', resolve);
                        writeStream.once('error', reject);
                    }
                });
            };
            
            // CSV headers
            const csvHeaders = [
                'ticker',
                'last_updated',
                'created_at',
                'current_price',
                'market_cap',
                'pe_ratio',
                'dividend_yield',
                'fifty_two_week_high',
                'fifty_two_week_low',
                'avg_volume',
                'exchange',
                'sector',
                'industry',
                'company_name',
                'market_state',
                'currency',
                'historical_data_points',
                'price_change_percent',
                'average_close_historical',
                'data_fetch_success'
            ].join(',');
            
            await writeToStream(csvHeaders + '\n');
            
            // Process records in small chunks directly from database
            const chunkSize = 50;
            let processedCount = 0;
            let exportedCount = 0;
            
            for (let offset = 0; offset < totalCount; offset += chunkSize) {
                const chunk = await new Promise((resolve, reject) => {
                    const sql = 'SELECT * FROM ticker_data ORDER BY ticker ASC LIMIT ? OFFSET ?';
                    this.db.all(sql, [chunkSize, offset], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
                
                for (let i = 0; i < chunk.length; i++) {
                    const row = chunk[i];
                    
                    try {
                        const data = JSON.parse(row.json_data);
                        const quote = data.quote || {};
                        const summary = data.summary || {};
                        const stats = data.statistics?.historicalStats || {};
                        
                        // Extract key financial metrics
                        const csvRow = [
                            `"${row.ticker}"`,
                            `"${row.last_updated}"`,
                            `"${row.created_at}"`,
                            quote.regularMarketPrice || '',
                            quote.marketCap || '',
                            quote.trailingPE || '',
                            quote.dividendYield || '',
                            quote.fiftyTwoWeekHigh || '',
                            quote.fiftyTwoWeekLow || '',
                            quote.averageVolume || '',
                            `"${quote.fullExchangeName || ''}"`,
                            `"${summary.assetProfile?.sector || ''}"`,
                            `"${summary.assetProfile?.industry || ''}"`,
                            `"${quote.longName || quote.shortName || ''}"`,
                            `"${quote.marketState || ''}"`,
                            `"${quote.currency || ''}"`,
                            stats.totalDays || '',
                            stats.priceChange || '',
                            stats.averageClose || '',
                            data.metadata?.error ? 'false' : 'true'
                        ].join(',');
                        
                        await writeToStream(csvRow + '\n');
                        exportedCount++;
                        
                    } catch (parseError) {
                        console.log(`⚠️  Skipping ${row?.ticker || 'unknown'} due to JSON parse error: ${parseError.message}`);
                    }
                    
                    processedCount++;
                }
                
                // Progress update
                const percentage = ((processedCount / totalCount) * 100).toFixed(1);
                console.log(`📈 CSV Export Progress: ${processedCount}/${totalCount} (${percentage}%)`);
                
                // Small delay to prevent overwhelming
                if (offset + chunkSize < totalCount) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
            // Properly close the stream
            return new Promise((resolve, reject) => {
                writeStream.end((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        console.log(`✅ Database streaming CSV export completed: ${csvPath}`);
                        console.log(`📊 Records exported: ${exportedCount}/${totalCount} (${totalCount - exportedCount} skipped due to errors)`);
                        resolve(csvPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in database streaming CSV export:', error.message);
            throw error;
        }
    }

    async getExportStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(CASE WHEN json_data LIKE '%"error"%' THEN 1 END) as error_records,
                    COUNT(CASE WHEN json_data NOT LIKE '%"error"%' THEN 1 END) as success_records,
                    MIN(created_at) as earliest_record,
                    MAX(last_updated) as latest_update
                FROM ticker_data
            `;
            
            this.db.get(sql, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            if (!this.db) {
                resolve(); // Already closed
                return;
            }
            
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err);
                } else {
                    console.log('✅ Database connection closed');
                }
                this.db = null; // Mark as closed
                resolve();
            });
        });
    }
}

// Main export function
async function exportAllData() {
    console.log('📈 All-Tickers Data Exporter');
    console.log('============================');
    
    const exporter = new DataExporter();
    
    try {
        // Check if database exists
        if (!fs.existsSync(exporter.dbPath)) {
            console.error('❌ Database not found. Please run return-data.js first to collect data.');
            return;
        }
        
        // Get export statistics
        const stats = await exporter.getExportStats();
        console.log('\n📊 Database Statistics:');
        console.log(`   Total Records: ${stats.total_records}`);
        console.log(`   Successful: ${stats.success_records}`);
        console.log(`   Errors: ${stats.error_records}`);
        console.log(`   Date Range: ${stats.earliest_record} to ${stats.latest_update}`);
        
        if (stats.total_records === 0) {
            console.log('❌ No data found in database. Please run return-data.js first.');
            await exporter.close();
            return;
        }
        
        console.log('\n🚀 Starting data export...');
        
        // Export to both formats
        const jsonPath = await exporter.exportToJSON();
        const csvPath = await exporter.exportToCSV();
        
        // File size information
        const jsonStats = fs.statSync(jsonPath);
        const csvStats = fs.statSync(csvPath);
        
        console.log('\n🎉 Export completed successfully!');
        console.log('📁 Output Files:');
        console.log(`   📊 DATA.json: ${(jsonStats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   📋 DATA.csv: ${(csvStats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`📍 Location: ${exporter.outputDir}`);
        
        // Success summary
        const successRate = ((stats.success_records / stats.total_records) * 100).toFixed(1);
        console.log(`\n✅ Export Summary:`);
        console.log(`   Records: ${stats.total_records}`);
        console.log(`   Success Rate: ${successRate}%`);
        console.log(`   JSON Size: ${(jsonStats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   CSV Size: ${(csvStats.size / 1024 / 1024).toFixed(2)} MB`);
        
    } catch (error) {
        console.error('❌ Export failed:', error.message);
        process.exit(1);
    } finally {
        await exporter.close();
    }
}

// Handle command line execution
if (require.main === module) {
    exportAllData().catch(console.error);
}

module.exports = DataExporter;
