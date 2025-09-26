const PostgreSQLManager = require('../db/database-manager');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class DataExporter {
    constructor(existingDbManager = null) {
        this.dbManager = existingDbManager || new PostgreSQLManager();
        this.ownsDbManager = !existingDbManager; // Only manage connection if we created it
        this.outputDir = path.join(__dirname, '..', '..', 'output');
        this.processingDir = path.join(__dirname, '..', '..', 'processing');
        this.exportProgress = new Map(); // Track progress for active exports
        this.cancelledExports = new Set(); // Track cancelled exports
    }

    async initialize() {
        if (!this.dbManager.isConnected) {
            await this.dbManager.connect();
            console.log('✅ PostgreSQL connection established');
        }
        
        // Ensure processing directory exists
        if (!fs.existsSync(this.processingDir)) {
            fs.mkdirSync(this.processingDir, { recursive: true });
            console.log('📁 Created processing directory');
        }
    }

    // Helper method to move file from processing to output
    moveFileFromProcessingToOutput(filename) {
        const processingPath = path.join(this.processingDir, filename);
        const outputPath = path.join(this.outputDir, filename);
        
        if (fs.existsSync(processingPath)) {
            // Ensure output directory exists
            if (!fs.existsSync(this.outputDir)) {
                fs.mkdirSync(this.outputDir, { recursive: true });
            }
            
            fs.renameSync(processingPath, outputPath);
            console.log(`✅ Moved ${filename} from processing to output folder`);
            return outputPath;
        }
        
        return processingPath; // Return original if move failed
    }

    // Enhanced progress update that checks for cancellation
    updateExportProgress(filename, current, total, status = 'processing') {
        // Don't update progress for cancelled exports
        if (this.cancelledExports.has(filename) && status !== 'cancelled') {
            return false;
        }
        
        this.exportProgress.set(filename, {
            current,
            total,
            percentage: total > 0 ? Math.round((current / total) * 100) : 0,
            status,
            lastUpdated: new Date().toISOString()
        });
        
        // Log progress every 25 records or significant milestones
        if (status !== 'cancelled' && (current % 25 === 0 || current === total || current === 1)) {
            console.log(`📈 ${status === 'processing' ? 'Export' : 'Export'} Progress: ${current}/${total} (${total > 0 ? Math.round((current / total) * 100) : 0}%)`);
        }
        
        return true;
    }

    // Get progress for a specific export
    getExportProgress(filename) {
        return this.exportProgress.get(filename) || null;
    }

    // Clear progress tracking for completed export
    clearExportProgress(filename) {
        this.exportProgress.delete(filename);
    }

    // Cancel export methods
    cancelExport(filename) {
        console.log(`🚫 Cancelling export: ${filename}`);
        this.cancelledExports.add(filename);
        this.updateExportProgress(filename, 0, 0, 'cancelled');
        
        // Remove partial file from processing
        const processingPath = path.join(this.processingDir, filename);
        if (fs.existsSync(processingPath)) {
            try {
                fs.unlinkSync(processingPath);
                console.log(`🗑️  Removed partial file: ${processingPath}`);
            } catch (error) {
                console.error(`❌ Failed to remove partial file: ${error.message}`);
            }
        }
        
        // Clear tracking
        this.clearExportProgress(filename);
        this.cancelledExports.delete(filename);
        
        return true;
    }

    isExportCancelled(filename) {
        return this.cancelledExports.has(filename);
    }

    async getAllTickerData(activeOnly = true) {
        try {
            // Build the WHERE clause based on activeOnly setting
            const whereClause = activeOnly ? 'WHERE active = true' : '';
            const activeText = activeOnly ? 'active ' : '';
            
            // Check how many records we have in the main tickers table
            const countResult = await this.dbManager.query(`SELECT COUNT(*) as count FROM tickers ${whereClause}`);
            const totalCount = parseInt(countResult.rows[0].count);
            
            console.log(`📊 Found ${totalCount} ${activeText}ticker records in PostgreSQL database`);
            
            if (totalCount === 0) {
                if (activeOnly) {
                    console.log('⚠️  No active tickers found. Export will contain basic ticker list only.');
                    // Get all tickers even if not active for basic export
                    const basicResult = await this.dbManager.query('SELECT COUNT(*) as count FROM tickers');
                    const basicCount = parseInt(basicResult.rows[0].count);
                    console.log(`📊 Found ${basicCount} total ticker records (including inactive)`);
                    
                    if (basicCount === 0) {
                        throw new Error('❌ No tickers found in database. Please run generate command first.');
                    }
                    return { useBasicExport: true, totalCount: basicCount };
                } else {
                    throw new Error('❌ No tickers found in database. Please run generate command first.');
                }
            }
            
            // If too many records, use streaming approach
            if (totalCount > 1000) {
                console.log('⚠️  Too many records for memory loading - will use streaming...');
                return { useStreaming: true, totalCount };
            }
            
            // Get comprehensive data from all available tables
            const result = await this.dbManager.query(`
                SELECT 
                    t.id,
                    t.symbol,
                    t.exchanges,
                    t.active,
                    t.price,
                    t.last_updated,
                    t.created_at,
                    -- Quote data (latest)
                    tq.regular_market_price,
                    tq.market_cap,
                    tq.quote_time,
                    tq.currency,
                    tq.exchange_name,
                    tq.market,
                    tq.language,
                    tq.region,
                    tq.quote_type,
                    tq.regular_market_time,
                    tq.fifty_day_average,
                    tq.fifty_day_average_change,
                    tq.fifty_day_average_change_percent,
                    tq.two_hundred_day_average,
                    tq.two_hundred_day_average_change,
                    tq.two_hundred_day_average_change_percent,
                    tq.shares_outstanding,
                    tq.book_value,
                    tq.trailing_annual_dividend_yield,
                    tq.dividend_yield,
                    tq.eps_trailing_twelve_months,
                    tq.eps_forward,
                    tq.eps_current_year,
                    tq.price_eps_current_year,
                    -- Metadata
                    tm.fetch_date,
                    tm.data_source,
                    tm.version,
                    tm.had_validation_warnings,
                    tm.historical_start_date,
                    tm.historical_end_date,
                    tm.historical_record_count,
                    tm.summary_modules_count,
                    -- Historical data count for this ticker
                    (SELECT COUNT(*) FROM ticker_historical WHERE ticker_id = t.id) as total_historical_records
                FROM tickers t
                LEFT JOIN LATERAL (
                    SELECT * FROM ticker_quotes 
                    WHERE ticker_id = t.id 
                    ORDER BY quote_time DESC 
                    LIMIT 1
                ) tq ON true
                LEFT JOIN LATERAL (
                    SELECT * FROM ticker_metadata 
                    WHERE ticker_id = t.id 
                    ORDER BY fetch_date DESC 
                    LIMIT 1
                ) tm ON true
                ${whereClause}
                ORDER BY t.symbol ASC
            `);
            
            return result.rows;
        } catch (error) {
            console.error('❌ Error in getAllTickerData:', error.message);
            if (error.message.includes('does not exist') || error.message.includes('relation')) {
                throw new Error('❌ Database tables not found. Please run generate command first.');
            }
            throw error;
        }
    }

    async exportToJSON(filename = null, options = {}) {
        // Ensure proper .json extension
        let actualFilename = filename || 'DATA.json';
        if (actualFilename && !actualFilename.endsWith('.json')) {
            actualFilename += '.json';
        }
        console.log(`📊 Exporting data to ${actualFilename}...`);
        
        const { historicalDays, activeOnly = true } = options;
        
        try {
            const rawData = await this.getAllTickerData(activeOnly);
            
            // Check if we should use streaming (either too many records or special flag)
            if (rawData.useStreaming) {
                console.log('⚠️  Using streaming export for large dataset...');
                return await this.exportToJSONStreamingFromDB(filename, options);
            }

            // Check if we should use basic export (no active tickers)
            if (rawData.useBasicExport) {
                console.log('⚠️  Using basic export - no active tickers found...');
                return await this.exportBasicTickerList(filename);
            }
            
            const tickerTypeText = activeOnly ? 'active ticker' : 'ticker';
            console.log(`📊 Processing ${rawData.length} ${tickerTypeText} records for JSON export...`);
            
            // Fetch all historical data in bulk to avoid memory issues
            console.log('📈 Fetching historical data for all tickers...');
            const historicalDataMap = new Map();
            try {
                // Build date constraint based on historicalDays
                let dateConstraint = '';
                if (historicalDays && historicalDays > 0) {
                    dateConstraint = `AND trade_date >= CURRENT_DATE - INTERVAL '${historicalDays} days'`;
                }
                
                const historicalResult = await this.dbManager.query(`
                    SELECT 
                        th.ticker_id,
                        th.trade_date,
                        th.open_price,
                        th.high_price,
                        th.low_price,
                        th.close_price,
                        th.volume
                    FROM (
                        SELECT 
                            ticker_id,
                            trade_date,
                            open_price,
                            high_price,
                            low_price,
                            close_price,
                            volume,
                            ROW_NUMBER() OVER (PARTITION BY ticker_id ORDER BY trade_date DESC) as rn
                        FROM ticker_historical 
                        WHERE ticker_id IN (${rawData.map(r => r.id).join(',')})
                        ${dateConstraint}
                    ) th
                    ${historicalDays && historicalDays <= 30 ? 'WHERE th.rn <= 30' : ''}
                    ORDER BY th.ticker_id, th.trade_date DESC
                `);
                
                // Group historical data by ticker_id
                historicalResult.rows.forEach(row => {
                    if (!historicalDataMap.has(row.ticker_id)) {
                        historicalDataMap.set(row.ticker_id, []);
                    }
                    historicalDataMap.get(row.ticker_id).push({
                        date: row.trade_date,
                        open: parseFloat(row.open_price) || null,
                        high: parseFloat(row.high_price) || null,
                        low: parseFloat(row.low_price) || null,
                        close: parseFloat(row.close_price) || null,
                        volume: parseInt(row.volume) || null
                    });
                });
                
                console.log(`📈 Successfully fetched historical data for ${historicalDataMap.size} tickers`);
            } catch (historicalError) {
                console.log(`⚠️  Could not fetch bulk historical data: ${historicalError.message}`);
            }
            
            // Process data from the new schema structure with all available data
            const processedTickers = rawData.map((row, index) => {
                if (index % 100 === 0) {
                    console.log(`📈 Processing record ${index + 1}/${rawData.length}...`);
                }
                
                // Create comprehensive ticker data object
                const tickerData = {
                    symbol: row.symbol,
                    exchanges: row.exchanges,
                    active: row.active,
                    price: parseFloat(row.price) || null,
                    lastUpdated: row.last_updated,
                    createdAt: row.created_at
                };

                // Add comprehensive quote data if available
                if (row.regular_market_price) {
                    tickerData.quote = {
                        regularMarketPrice: parseFloat(row.regular_market_price),
                        regularMarketTime: row.regular_market_time,
                        marketCap: row.market_cap ? parseInt(row.market_cap) : null,
                        sharesOutstanding: row.shares_outstanding ? parseInt(row.shares_outstanding) : null,
                        quoteTime: row.quote_time,
                        currency: row.currency,
                        exchangeName: row.exchange_name,
                        market: row.market,
                        language: row.language,
                        region: row.region,
                        quoteType: row.quote_type,
                        // Moving averages
                        fiftyDayAverage: parseFloat(row.fifty_day_average) || null,
                        fiftyDayAverageChange: parseFloat(row.fifty_day_average_change) || null,
                        fiftyDayAverageChangePercent: parseFloat(row.fifty_day_average_change_percent) || null,
                        twoHundredDayAverage: parseFloat(row.two_hundred_day_average) || null,
                        twoHundredDayAverageChange: parseFloat(row.two_hundred_day_average_change) || null,
                        twoHundredDayAverageChangePercent: parseFloat(row.two_hundred_day_average_change_percent) || null,
                        // Financial metrics
                        bookValue: parseFloat(row.book_value) || null,
                        trailingAnnualDividendYield: parseFloat(row.trailing_annual_dividend_yield) || null,
                        dividendYield: parseFloat(row.dividend_yield) || null,
                        epsTrailingTwelveMonths: parseFloat(row.eps_trailing_twelve_months) || null,
                        epsForward: parseFloat(row.eps_forward) || null,
                        epsCurrentYear: parseFloat(row.eps_current_year) || null,
                        priceEpsCurrentYear: parseFloat(row.price_eps_current_year) || null
                    };
                }

                // Add metadata if available
                if (row.fetch_date) {
                    tickerData.metadata = {
                        fetchDate: row.fetch_date,
                        dataSource: row.data_source,
                        version: row.version,
                        hadValidationWarnings: row.had_validation_warnings,
                        historicalStartDate: row.historical_start_date,
                        historicalEndDate: row.historical_end_date,
                        historicalRecordCount: parseInt(row.historical_record_count) || 0,
                        summaryModulesCount: parseInt(row.summary_modules_count) || 0,
                        totalHistoricalRecords: parseInt(row.total_historical_records) || 0
                    };
                }

                // Add recent historical data from bulk fetch if available
                const historicalData = historicalDataMap.get(row.id);
                if (historicalData && historicalData.length > 0) {
                    tickerData.recentHistorical = historicalData;
                }

                return {
                    ticker: row.symbol,
                    lastUpdated: row.last_updated,
                    createdAt: row.created_at,
                    data: tickerData
                };
            });

            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    totalRecords: rawData.length,
                    dataSource: 'All-Tickers Comprehensive Data Collection (PostgreSQL)',
                    version: '2.0.0',
                    description: 'Complete financial data for active tickers including quotes, historical data, and company summaries'
                },
                tickers: processedTickers
            };
            
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }
            
            const jsonPath = path.join(this.processingDir, actualFilename);
            console.log('💾 Writing JSON file to processing folder...');
            fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
            
            console.log(`✅ ${actualFilename} exported successfully: ${jsonPath}`);
            console.log(`📊 Records exported: ${rawData.length}`);
            
            // Move file from processing to output
            const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
            
            return finalPath;
            
        } catch (error) {
            console.error('❌ Error exporting to JSON:', error.message);
            throw error;
        }
    }

    async exportBasicTickerList(filename = null) {
        // Ensure proper .json extension  
        let actualFilename = filename || 'DATA.json';
        if (actualFilename && !actualFilename.endsWith('.json')) {
            actualFilename += '.json';
        }
        console.log(`📊 Exporting basic ticker list to ${actualFilename}...`);
        
        try {
            // Get all tickers (including inactive) for basic export
            const result = await this.dbManager.query(`
                SELECT symbol, exchanges, active, price, last_updated, created_at
                FROM tickers
                ORDER BY symbol ASC
            `);
            
            const tickerData = result.rows;
            console.log(`📊 Found ${tickerData.length} total tickers for basic export...`);
            
            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    totalRecords: tickerData.length,
                    dataSource: 'All-Tickers Basic Ticker List (PostgreSQL)',
                    version: '2.0.0',
                    description: 'Basic ticker list with status information (no comprehensive financial data available)'
                },
                tickers: tickerData.map(row => ({
                    ticker: row.symbol,
                    lastUpdated: row.last_updated,
                    createdAt: row.created_at,
                    data: {
                        symbol: row.symbol,
                        exchanges: row.exchanges,
                        active: row.active,
                        price: parseFloat(row.price) || null
                    }
                }))
            };
            
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }
            
            const jsonPath = path.join(this.processingDir, actualFilename);
            fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
            
            console.log(`✅ Basic ticker list exported: ${jsonPath}`);
            console.log(`📊 Records exported: ${tickerData.length}`);
            
            // Move file from processing to output
            const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
            
            return finalPath;
            
        } catch (error) {
            console.error('❌ Error exporting basic ticker list:', error.message);
            throw error;
        }
    }

    async exportToJSONStreamingFromDB(filename = null, options = {}) {
        // Ensure proper .json extension
        let actualFilename = filename || 'DATA.json';
        if (actualFilename && !actualFilename.endsWith('.json')) {
            actualFilename += '.json';
        }
        const jsonPath = path.join(this.processingDir, actualFilename);
        
        try {
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }
            
            const { activeOnly = true } = options;
            
            console.log('🚀 Starting streaming JSON export directly from PostgreSQL database...');
            
            // Build WHERE clause based on activeOnly setting
            const whereClause = activeOnly ? 'WHERE t.active = true' : '';
            const activeText = activeOnly ? 'active ' : '';
            
            // Get total count for progress tracking
            const countResult = await this.dbManager.query(`SELECT COUNT(*) as count FROM tickers t ${whereClause}`);
            const totalCount = parseInt(countResult.rows[0].count);
            
            console.log(`📊 Will export ${totalCount} ${activeText}records using database streaming...`);
            
            // Initialize progress tracking
            this.updateExportProgress(actualFilename, 0, totalCount, 'processing');
            
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
                dataSource: 'All-Tickers Comprehensive Data Collection (PostgreSQL)',
                version: '2.0.0',
                description: 'Complete financial data for active tickers including quotes, historical data, and company summaries'
            };
            
            await writeToStream('{\n');
            await writeToStream(`  "metadata": ${JSON.stringify(metadata, null, 2).split('\n').join('\n  ')},\n`);
            await writeToStream('  "tickers": [\n');
            
            // Process records in small chunks directly from database
            const chunkSize = 25; // Reduced chunk size to prevent memory issues
            let processedCount = 0;
            let exportedCount = 0;
            
            for (let offset = 0; offset < totalCount; offset += chunkSize) {
                const result = await this.dbManager.query(`
                    SELECT 
                        t.id,
                        t.symbol as ticker,
                        t.exchanges,
                        t.active,
                        t.price,
                        t.last_updated,
                        t.created_at,
                        -- Quote data (latest)
                        tq.regular_market_price,
                        tq.market_cap,
                        tq.quote_time,
                        tq.currency,
                        tq.exchange_name,
                        tq.market,
                        tq.language,
                        tq.region,
                        tq.quote_type,
                        tq.regular_market_time,
                        tq.fifty_day_average,
                        tq.fifty_day_average_change,
                        tq.fifty_day_average_change_percent,
                        tq.two_hundred_day_average,
                        tq.two_hundred_day_average_change,
                        tq.two_hundred_day_average_change_percent,
                        tq.shares_outstanding,
                        tq.book_value,
                        tq.trailing_annual_dividend_yield,
                        tq.dividend_yield,
                        tq.eps_trailing_twelve_months,
                        tq.eps_forward,
                        tq.eps_current_year,
                        tq.price_eps_current_year,
                        -- Metadata
                        tm.fetch_date,
                        tm.data_source,
                        tm.version,
                        tm.had_validation_warnings,
                        tm.historical_start_date,
                        tm.historical_end_date,
                        tm.historical_record_count,
                        tm.summary_modules_count,
                        -- Historical data count
                        (SELECT COUNT(*) FROM ticker_historical WHERE ticker_id = t.id) as total_historical_records
                    FROM tickers t
                    LEFT JOIN LATERAL (
                        SELECT * FROM ticker_quotes 
                        WHERE ticker_id = t.id 
                        ORDER BY quote_time DESC 
                        LIMIT 1
                    ) tq ON true
                    LEFT JOIN LATERAL (
                        SELECT * FROM ticker_metadata 
                        WHERE ticker_id = t.id 
                        ORDER BY fetch_date DESC 
                        LIMIT 1
                    ) tm ON true
                    ${whereClause}
                    ORDER BY t.symbol ASC 
                    LIMIT $1 OFFSET $2
                `, [chunkSize, offset]);
                
                const chunk = result.rows;
                
                for (let i = 0; i < chunk.length; i++) {
                    const row = chunk[i];
                    const isLast = processedCount === totalCount - 1;
                    
                    try {
                        // Create comprehensive ticker data with normalized columns
                        const tickerData = {
                            symbol: row.ticker,
                            exchanges: row.exchanges,
                            active: row.active,
                            price: parseFloat(row.price) || null,
                            lastUpdated: row.last_updated,
                            createdAt: row.created_at
                        };

                        // Add comprehensive quote data if available
                        if (row.regular_market_price) {
                            tickerData.quote = {
                                regularMarketPrice: parseFloat(row.regular_market_price),
                                regularMarketTime: row.regular_market_time,
                                marketCap: row.market_cap ? parseInt(row.market_cap) : null,
                                sharesOutstanding: row.shares_outstanding ? parseInt(row.shares_outstanding) : null,
                                quoteTime: row.quote_time,
                                currency: row.currency,
                                exchangeName: row.exchange_name,
                                market: row.market,
                                language: row.language,
                                region: row.region,
                                quoteType: row.quote_type,
                                // Moving averages
                                fiftyDayAverage: parseFloat(row.fifty_day_average) || null,
                                fiftyDayAverageChange: parseFloat(row.fifty_day_average_change) || null,
                                fiftyDayAverageChangePercent: parseFloat(row.fifty_day_average_change_percent) || null,
                                twoHundredDayAverage: parseFloat(row.two_hundred_day_average) || null,
                                twoHundredDayAverageChange: parseFloat(row.two_hundred_day_average_change) || null,
                                twoHundredDayAverageChangePercent: parseFloat(row.two_hundred_day_average_change_percent) || null,
                                // Financial metrics
                                bookValue: parseFloat(row.book_value) || null,
                                trailingAnnualDividendYield: parseFloat(row.trailing_annual_dividend_yield) || null,
                                dividendYield: parseFloat(row.dividend_yield) || null,
                                epsTrailingTwelveMonths: parseFloat(row.eps_trailing_twelve_months) || null,
                                epsForward: parseFloat(row.eps_forward) || null,
                                epsCurrentYear: parseFloat(row.eps_current_year) || null,
                                priceEpsCurrentYear: parseFloat(row.price_eps_current_year) || null
                            };
                        }

                        // Add metadata if available
                        if (row.fetch_date) {
                            tickerData.metadata = {
                                fetchDate: row.fetch_date,
                                dataSource: row.data_source,
                                version: row.version,
                                hadValidationWarnings: row.had_validation_warnings,
                                historicalStartDate: row.historical_start_date,
                                historicalEndDate: row.historical_end_date,
                                historicalRecordCount: parseInt(row.historical_record_count) || 0,
                                summaryModulesCount: parseInt(row.summary_modules_count) || 0,
                                totalHistoricalRecords: parseInt(row.total_historical_records) || 0
                            };
                        }

                        // Add historical data based on specified date range
                        if (parseInt(row.total_historical_records) > 0) {
                            try {
                                // Build date constraint based on historicalDays option
                                let dateConstraint = '';
                                let queryParams = [row.id];
                                
                                if (options.historicalDays && options.historicalDays > 0) {
                                    dateConstraint = `AND trade_date >= CURRENT_DATE - INTERVAL '${options.historicalDays} days'`;
                                }
                                
                                const historicalResult = await this.dbManager.query(`
                                    SELECT trade_date, open_price, high_price, low_price, close_price, volume
                                    FROM ticker_historical 
                                    WHERE ticker_id = $1 ${dateConstraint}
                                    ORDER BY trade_date DESC
                                `, queryParams);
                                
                                if (historicalResult.rows.length > 0) {
                                    tickerData.recentHistorical = historicalResult.rows.map(h => ({
                                        date: h.trade_date,
                                        open: parseFloat(h.open_price) || null,
                                        high: parseFloat(h.high_price) || null,
                                        low: parseFloat(h.low_price) || null,
                                        close: parseFloat(h.close_price) || null,
                                        volume: parseInt(h.volume) || null
                                    }));
                                }
                            } catch (historicalError) {
                                console.log(`⚠️  Could not fetch historical data for ${row.ticker}: ${historicalError.message}`);
                            }
                            
                            // Small delay to prevent database overload
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }

                        const exportEntry = {
                            ticker: row.ticker,
                            lastUpdated: row.last_updated,
                            createdAt: row.created_at,
                            data: tickerData
                        };
                        
                        const jsonString = JSON.stringify(exportEntry, null, 4).split('\n').join('\n    ');
                        await writeToStream(`    ${jsonString}${isLast ? '' : ','}\n`);
                        exportedCount++;
                        
                    } catch (parseError) {
                        console.log(`⚠️  Skipping ${row?.ticker || 'unknown'} due to processing error: ${parseError.message}`);
                    }
                    
                    processedCount++;
                }
                
                // Progress update using our progress tracking system
                const continueExport = this.updateExportProgress(actualFilename, processedCount, totalCount, 'processing');
                
                // Check if export was cancelled
                if (!continueExport || this.isExportCancelled(actualFilename)) {
                    console.log(`🚫 Export cancelled for ${actualFilename}`);
                    writeStream.destroy();
                    throw new Error('Export cancelled by user');
                }
                
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
                        
                        // Move file from processing to output
                        const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
                        
                        // Clear progress tracking
                        this.clearExportProgress(actualFilename);
                        
                        resolve(finalPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in database streaming JSON export:', error.message);
            throw error;
        }
    }

    async exportToJSONStreaming(rawData, filename = null) {
        // Ensure proper .json extension
        let actualFilename = filename || 'DATA.json';
        if (actualFilename && !actualFilename.endsWith('.json')) {
            actualFilename += '.json';
        }
        const jsonPath = path.join(this.processingDir, actualFilename);
        
        try {
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
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
                        
                        // Move file from processing to output
                        const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
                        resolve(finalPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in streaming JSON export:', error.message);
            console.error('Error details:', error);
            throw error;
        }
    }

    async exportToCSV(filename = null, options = {}) {
        // Ensure proper .csv extension
        let actualFilename = filename || 'DATA.csv';
        if (actualFilename && !actualFilename.endsWith('.csv')) {
            actualFilename += '.csv';
        }
        console.log(`📊 Exporting data to CSV: ${actualFilename}...`);
        
        const { historicalDays } = options;
        
        try {
            const rawData = await this.getAllTickerData();
            
            // Check if we should use streaming (either too many records or special flag)
            if (rawData.useStreaming || (Array.isArray(rawData) && rawData.length > 1000)) {
                console.log('⚠️  Using streaming CSV export for large dataset...');
                return await this.exportToCSVStreamingFromDB(actualFilename, options);
            }
            
            console.log(`📊 Processing ${rawData.length} records for CSV export...`);
            
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }
            
            // Export to processing folder first
            const csvPath = path.join(this.processingDir, actualFilename);
            
            // Initialize progress tracking
            this.updateExportProgress(actualFilename, 0, rawData.length, 'processing');
            
            // Use streaming for large datasets
            if (rawData.length > 5000) {
                console.log('⚠️  Large dataset detected - using streaming CSV export...');
                return await this.exportToCSVStreaming(rawData, csvPath, options);
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
                    // Work directly with normalized database columns instead of JSON parsing
                    // Extract key financial metrics from the normalized schema
                    return [
                        `"${row.symbol}"`,
                        `"${row.last_updated || ''}"`,
                        `"${row.created_at || ''}"`,
                        row.regular_market_price || 'N/A',
                        row.market_cap || 'N/A',
                        row.eps_trailing_twelve_months || 'N/A', // Using as proxy for P/E
                        row.dividend_yield || 'N/A',
                        'N/A', // fifty_two_week_high not available in current schema
                        'N/A', // fifty_two_week_low not available in current schema
                        'N/A', // averageDailyVolume not available in current schema
                        `"${row.exchange_name || 'N/A'}"`,
                        'N/A', // sector not available in current schema
                        'N/A', // industry not available in current schema
                        `"${row.symbol}"`, // using ticker symbol as name
                        'N/A', // marketState not available in current schema
                        `"${row.currency || 'N/A'}"`,
                        row.total_historical_records || 0,
                        'N/A', // priceChange not available
                        row.fifty_day_average || 'N/A', // using fifty day average
                        row.active ? 'true' : 'false'
                    ].join(',');
                } catch (parseError) {
                    // Handle corrupted data
                    console.log(`⚠️  Error processing ${row.symbol} for CSV: ${parseError.message}`);
                    return [
                        `"${row.symbol}"`,
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
            
            console.log(`✅ ${actualFilename} exported successfully: ${csvPath}`);
            console.log(`📊 Records exported: ${rawData.length}`);
            console.log(`📋 CSV Columns: ${csvHeaders.split(',').length}`);
            
            // Move file from processing to output
            const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
            
            // Clear progress tracking
            this.clearExportProgress(actualFilename);
            
            return finalPath;
            
        } catch (error) {
            console.error('❌ Error exporting to CSV:', error.message);
            throw error;
        }
    }

    async exportToCSVStreaming(rawData, csvPath, options = {}) {
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

    async exportToCSVStreamingFromDB(filename = null, options = {}) {
        // Ensure proper .csv extension
        let actualFilename = filename || 'DATA.csv';
        if (actualFilename && !actualFilename.endsWith('.csv')) {
            actualFilename += '.csv';
        }
        const csvPath = path.join(this.processingDir, actualFilename);
        
        try {
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }
            
            console.log('🚀 Starting streaming CSV export directly from database...');
            
            // Get total count for progress tracking
            const countResult = await this.dbManager.query('SELECT COUNT(*) as count FROM tickers WHERE active = true');
            const totalCount = countResult.rows[0].count;
            
            console.log(`📊 Will export ${totalCount} records using database streaming...`);
            
            // Initialize progress tracking
            this.updateExportProgress(actualFilename, 0, totalCount, 'processing');
            
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
                const sql = `
                    SELECT 
                        t.symbol as ticker,
                        t.exchanges,
                        t.active,
                        t.price,
                        t.last_updated,
                        t.created_at,
                        tq.regular_market_price,
                        tq.market_cap,
                        tq.currency,
                        tq.exchange_name,
                        tq.fifty_day_average,
                        tq.two_hundred_day_average,
                        tq.eps_trailing_twelve_months,
                        tq.dividend_yield
                    FROM tickers t
                    LEFT JOIN LATERAL (
                        SELECT * FROM ticker_quotes 
                        WHERE ticker_id = t.id 
                        ORDER BY quote_time DESC 
                        LIMIT 1
                    ) tq ON true
                    WHERE t.active = true
                    ORDER BY t.symbol ASC 
                    LIMIT $1 OFFSET $2
                `;
                const result = await this.dbManager.query(sql, [chunkSize, offset]);
                const chunk = result.rows;
                
                for (let i = 0; i < chunk.length; i++) {
                    const row = chunk[i];
                    
                    try {
                        // Work with normalized columns instead of json_data
                        const quote = {
                            regularMarketPrice: row.regular_market_price,
                            marketCap: row.market_cap,
                            currency: row.currency,
                            fiftyDayAverage: row.fifty_day_average,
                            twoHundredDayAverage: row.two_hundred_day_average,
                            epsTrailingTwelveMonths: row.eps_trailing_twelve_months,
                            dividendYield: row.dividend_yield
                        };
                        
                        // Extract key financial metrics
                        const csvRow = [
                            `"${row.ticker}"`,
                            `"${row.last_updated || ''}"`,
                            `"${row.created_at || ''}"`,
                            quote.regularMarketPrice || '',
                            quote.marketCap || '',
                            '', // trailingPE not available
                            quote.dividendYield || '',
                            '', // fiftyTwoWeekHigh not available
                            '', // fiftyTwoWeekLow not available
                            '', // averageVolume not available
                            `"${row.exchange_name || ''}"`,
                            '', // sector not available in current schema
                            '', // industry not available in current schema
                            `"${row.ticker}"`, // using ticker as name
                            '', // marketState not available
                            `"${quote.currency || ''}"`,
                            '', // totalDays not available
                            '', // priceChange not available
                            quote.fiftyDayAverage || '',
                            row.active ? 'true' : 'false'
                        ].join(',');
                        
                        await writeToStream(csvRow + '\n');
                        exportedCount++;
                        
                    } catch (parseError) {
                        console.log(`⚠️  Skipping ${row?.ticker || 'unknown'} due to JSON parse error: ${parseError.message}`);
                    }
                    
                    processedCount++;
                }
                
                // Progress update using our progress tracking system
                const continueExport = this.updateExportProgress(actualFilename, processedCount, totalCount, 'processing');
                
                // Check if export was cancelled
                if (!continueExport || this.isExportCancelled(actualFilename)) {
                    console.log(`🚫 CSV Export cancelled for ${actualFilename}`);
                    writeStream.destroy();
                    throw new Error('CSV Export cancelled by user');
                }
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
                        
                        // Move file from processing to output
                        const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
                        
                        // Clear progress tracking
                        this.clearExportProgress(actualFilename);
                        
                        resolve(finalPath);
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in database streaming CSV export:', error.message);
            throw error;
        }
    }

    async getExportStats() {
        const sql = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(CASE WHEN t.active = false THEN 1 END) as inactive_records,
                COUNT(CASE WHEN t.active = true THEN 1 END) as active_records,
                MIN(t.created_at) as earliest_record,
                MAX(t.last_updated) as latest_update
            FROM tickers t
        `;
        
        try {
            const result = await this.dbManager.query(sql);
            return result.rows[0];
        } catch (error) {
            throw error;
        }
    }

    async close() {
        if (this.ownsDbManager && this.dbManager && this.dbManager.isConnected) {
            await this.dbManager.disconnect();
            console.log('✅ Database connection closed');
        }
    }

    /**
     * Export data to SQLite format with progress tracking and cancellation support
     */
    async exportToSQLite(filename = null, options = {}) {
        // Ensure proper .db extension
        let actualFilename = filename || 'DATA.db';
        if (actualFilename && !actualFilename.endsWith('.db')) {
            actualFilename += '.db';
        }
        console.log(`🗄️ Exporting data to SQLite: ${actualFilename}...`);

        try {
            // Ensure processing directory exists
            if (!fs.existsSync(this.processingDir)) {
                fs.mkdirSync(this.processingDir, { recursive: true });
            }

            // Export to processing folder first
            const processingPath = path.join(this.processingDir, actualFilename);
            
            // Initialize progress tracking with estimated phases
            // Rough estimate: Tickers(5%), Quotes(40%), Metadata(10%), Historical(45%)
            const totalPhases = 4;
            let currentPhase = 0;
            this.updateExportProgress(actualFilename, 0, 100, 'processing');

            // Create progress callback that includes cancellation check and progress updates
            const progressCallback = (message) => {
                console.log(message);
                
                // Check for cancellation
                if (this.isExportCancelled(actualFilename)) {
                    throw new Error('Export cancelled by user');
                }

                // Update progress based on the message content
                let progressPercent = Math.floor((currentPhase / totalPhases) * 100);
                
                if (message.includes('Exporting tickers')) {
                    currentPhase = 1;
                    progressPercent = 5;
                } else if (message.includes('Exporting ticker quotes') || message.includes('ticker quotes')) {
                    currentPhase = 2;
                    progressPercent = 15;
                } else if (message.includes('Exporting ticker metadata') || message.includes('ticker metadata')) {
                    currentPhase = 3;
                    progressPercent = 55;
                } else if (message.includes('Starting historical data export') || message.includes('historical data')) {
                    currentPhase = 4;
                    progressPercent = 65;
                } else if (message.includes('Finalizing SQLite database')) {
                    progressPercent = 95;
                }

                this.updateExportProgress(actualFilename, progressPercent, 100, 'processing');
            };

            // Use the database manager's exportToSQLite method
            const result = await this.dbManager.exportToSQLite(processingPath, options, progressCallback);

            // Check for cancellation one more time before moving file
            if (this.isExportCancelled(actualFilename)) {
                // For SQLite, the database manager handles cleanup
                // No need to delete the file here as it's done in the catch block
                console.log(`🗑️ SQLite export was cancelled: ${actualFilename}`);
                this.exportProgress.delete(actualFilename);
                return null;
            }

            // Update progress to completed
            this.updateExportProgress(actualFilename, 100, 100, 'completed');

            // Move file from processing to output folder
            const finalPath = this.moveFileFromProcessingToOutput(actualFilename);
            
            // Clean up progress tracking
            this.exportProgress.delete(actualFilename);

            console.log(`✅ SQLite export completed: ${finalPath}`);
            
            return {
                ...result,
                exportPath: finalPath
            };

        } catch (error) {
            console.error('❌ SQLite export error:', error);
            
            // For SQLite exports, the database manager handles cleanup
            // including proper database connection closing and file deletion
            console.log(`🗑️ SQLite export cleanup handled by database manager`);
            
            // Update progress to error state
            this.updateExportProgress(actualFilename, 0, 100, 'error');
            
            // Clean up progress tracking after a delay
            setTimeout(() => {
                this.exportProgress.delete(actualFilename);
            }, 5000);
            
            throw error;
        }
    }
}

// Main export function
async function exportAllData() {
    console.log('📈 All-Tickers Data Exporter');
    console.log('============================');
    
    const exporter = new DataExporter();
    
    try {
        // Initialize database connection
        await exporter.initialize();
        
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
        
        // Export to both formats using proper threshold logic
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

module.exports = { DataExporter };
