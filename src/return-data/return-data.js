const yahooFinance = require('yahoo-finance2').default;
const fs = require('fs');
const path = require('path');
const Database = require('sqlite3').Database;

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
        const dbPath = path.join(process.env.DB_PATH || '/app/output', 'ticker_data.db');
        this.db = new Database(dbPath);
        
        // Also connect to the validation database to mark inactive tickers
        const validationDbPath = path.join(process.env.DB_PATH || '/app/output', 'tickers.db');
        this.validationDb = new Database(validationDbPath);
        
        this.initializeDatabase();
    }

    initializeDatabase() {
        const createTableSQL = `
            CREATE TABLE IF NOT EXISTS ticker_data (
                ticker TEXT PRIMARY KEY,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                json_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        
        this.db.run(createTableSQL, (err) => {
            if (err) {
                console.error('Error creating table:', err);
            } else {
                console.log('✅ Database initialized successfully');
            }
        });
    }

    async insertOrUpdateTicker(ticker, jsonData) {
        return new Promise((resolve, reject) => {
           const sql = `
                INSERT OR REPLACE INTO ticker_data (ticker, last_updated, json_data)
                VALUES (?, CURRENT_TIMESTAMP, ?)
            `;
            
            this.db.run(sql, [ticker, JSON.stringify(jsonData)], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ ticker, rowId: this.lastID, changes: this.changes });
                }
            });
        });
    }

    async getTickerCount() {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT COUNT(*) as count FROM ticker_data', (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
    }

    async getRecentlyUpdated(limit = 10) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT ticker, last_updated 
                FROM ticker_data 
                ORDER BY last_updated DESC 
                LIMIT ?
            `;
            
            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async isTickerRecentlyChecked(ticker, hoursAgo = 24) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT ticker, last_updated,
                       (julianday('now') - julianday(last_updated)) * 24 as hours_diff
                FROM ticker_data 
                WHERE ticker = ? 
                AND (julianday('now') - julianday(last_updated)) * 24 < ?
            `;
            
            this.db.get(sql, [ticker, hoursAgo], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        isRecent: !!row,
                        lastUpdated: row ? row.last_updated : null,
                        hoursSince: row ? Math.round(row.hours_diff * 100) / 100 : null
                    });
                }
            });
        });
    }

    async markTickerInactive(ticker, reason = 'Schema validation error') {
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE tickers 
                SET active = 0, price = -1, exchange = ? 
                WHERE ticker = ?
            `;
            
            this.validationDb.run(sql, [`INACTIVE_${reason}`, ticker], function(err) {
                if (err) {
                    console.log(`⚠️  Could not mark ${ticker} as inactive in validation DB: ${err.message}`);
                    reject(err);
                } else {
                    console.log(`🔄 Marked ${ticker} as inactive due to: ${reason}`);
                    resolve({ ticker, changes: this.changes });
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            // Close main database
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing main database:', err);
                }
                
                // Close validation database
                this.validationDb.close((err2) => {
                    if (err2) {
                        console.error('Error closing validation database:', err2);
                    } else {
                        console.log('✅ Database connections closed');
                    }
                    resolve();
                });
            });
        });
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
                    averageVolume: Math.round(historicalData.reduce((sum, day) => sum + (day.volume || 0), 0) / historicalData.length),
                    priceChange: historicalData.length > 1 ? 
                        ((historicalData[historicalData.length - 1].close - historicalData[0].close) / historicalData[0].close * 100).toFixed(2) + '%' 
                        : 'N/A'
                } : null
            }
        };

        return tickerDataWithMetadata;
        
    } catch (error) {
        // Clear current ticker
        setCurrentProcessingTicker(null);
        
        // Detect schema/validation errors
        const isSchemaError = error.message && (
            error.message.includes('Expected union value') ||
            error.message.includes('validation') ||
            error.message.includes('schema') ||
            error.message.includes('Invalid response') ||
            error.message.toLowerCase().includes('yahoo-finance2')
        );
        
        return {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                dataSource: 'Yahoo Finance API (yahoo-finance2)',
                version: '2.0.0',
                error: error.message,
                errorType: isSchemaError ? 'SCHEMA_VALIDATION' : 'API_ERROR',
                hadValidationWarnings: hasValidationWarning(symbol)
            },
            quote: null,
            historical: null,
            summary: null,
            statistics: null
        };
    }
}

async function saveTickerDataToDB(symbol, database) {
    try {
        const data = await getTickerData(symbol);
        
        // Check if this is a schema validation error OR had validation warnings
        const hasSchemaIssues = (data.metadata.error && data.metadata.errorType === 'SCHEMA_VALIDATION') || 
                               data.metadata.hadValidationWarnings;
        
        // Check for specific errors that should mark ticker as delisted/inactive
        const shouldMarkDelisted = data.metadata.error && (
            data.metadata.error.includes('No fundamentals data found for symbol') ||
            data.metadata.error.includes('1d data not available for startTime') ||
            data.metadata.error.includes('Only 100 years worth of day granularity data are allowed') ||
            data.metadata.error.includes('Ticker not found') ||
            data.metadata.error.includes('Invalid ticker') ||
            data.metadata.error.includes('Symbol not found') ||
            data.metadata.error.includes('No data found for this date range')
        );
        
        if (hasSchemaIssues) {
            // Mark as inactive in validation database
            try {
                const reason = data.metadata.error ? 'Schema validation error' : 'Validation warnings';
                await database.markTickerInactive(symbol, reason);
            } catch (markError) {
                // Continue even if marking inactive fails
                console.log(`⚠️  Warning: Could not mark ${symbol} as inactive: ${markError.message}`);
            }
            
            // Don't save problematic data to the main database
            return { 
                symbol, 
                success: false, 
                error: data.metadata.error || 'Validation warnings detected - marked as inactive',
                errorType: 'SCHEMA_VALIDATION'
            };
        }
        
        if (shouldMarkDelisted) {
            // Mark as delisted/inactive in validation database
            try {
                await database.markTickerInactive(symbol, 'DELISTED');
                console.log(`🗑️  Marked ${symbol} as delisted due to: ${data.metadata.error}`);
            } catch (markError) {
                console.log(`⚠️  Warning: Could not mark ${symbol} as delisted: ${markError.message}`);
            }
            
            // Don't save delisted ticker data to the main database
            return { 
                symbol, 
                success: false, 
                error: data.metadata.error,
                errorType: 'DELISTED',
                markedAsDelisted: true
            };
        }
        
        // Check if we got valid data (quote, historical, or summary should contain actual data)
        const hasValidData = data.quote || (data.historical && data.historical.length > 0) || data.summary;
        
        if (!hasValidData && data.metadata.error) {
            // Data fetch failed - don't update timestamp, just return error
            return { symbol, success: false, error: data.metadata.error };
        }
        
        // Only save to database and update timestamp if we have valid data
        if (hasValidData) {
            await database.insertOrUpdateTicker(symbol, data);
            return { symbol, success: true, data };
        } else {
            // No valid data but no explicit error - treat as temporary failure
            return { symbol, success: false, error: 'No valid data returned - undefined response' };
        }
        
    } catch (error) {
        return { symbol, success: false, error: error.message };
    }
}

async function loadActiveTickers() {
    try {
        // Load active tickers directly from the database
        const validationDbPath = path.join(__dirname, '..', 'db', 'tickers.db');
        const db = new Database(validationDbPath);
        
        return new Promise((resolve, reject) => {
            const query = 'SELECT ticker FROM tickers WHERE active = 1 ORDER BY ticker';
            
            db.all(query, (err, rows) => {
                db.close();
                
                if (err) {
                    reject(new Error(`Failed to load active tickers from database: ${err.message}`));
                } else {
                    const tickers = rows.map(row => row.ticker);
                    resolve(tickers);
                }
            });
        });
        
    } catch (error) {
        throw new Error(`Failed to load active tickers: ${error.message}`);
    }
}

// Process all active tickers with batch processing and session management
async function processAllActiveTickers() {
    console.log('🚀 Processing all active tickers with comprehensive data...');
    
    const database = new TickerDataDatabase();
    
    try {
        // Enable error suppression for cleaner output
        toggleErrorSuppression(true);
        
        // Load active tickers from the database
        const activeTickers = await loadActiveTickers();
        console.log(`📊 Found ${activeTickers.length} active tickers to process`);
        
        if (activeTickers.length === 0) {
            console.log('❌ No active tickers found to process');
            await database.close();
            return [];
        }
        
        const results = [];
        const errors = [];
        const schemaErrors = [];
        const delistedTickers = [];
        let processed = 0;
        let requestCount = 0;
        let skipped = 0;
        
        console.log('⚡ Starting batch processing...\n');
        
        const startTime = Date.now();
        
        // Process tickers in batches of 500
        const batchSize = 100;
        
        // Force refresh cookies/crumbs every 10,000 requests
        const refreshInterval = 10000;
        
        // Enable concurrent processing (similar to validate script)
        const concurrentRequests = 1; // Conservative for comprehensive data
        
        // Function to force refresh cookies/crumbs
        async function refreshSession() {
            try {
                console.log('🔄 Refreshing cookies and crumbs for rate limit prevention...');
                // Force a simple quote to refresh session
                await yahooFinance.quote('AAPL', {}, { validateResult: false });
                console.log('✅ Session refreshed successfully');
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second pause after refresh
            } catch (error) {
                console.log('⚠️  Session refresh warning (continuing anyway):', error.message);
            }
        }
        
        for (let i = 0; i < activeTickers.length; i += batchSize) {
            const batch = activeTickers.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(activeTickers.length / batchSize);
            
            console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches}: ${batch.length} tickers (${i + 1}-${Math.min(i + batchSize, activeTickers.length)})`);
            
            // Check if we need to refresh session before this batch
            if (requestCount > 0 && requestCount % refreshInterval === 0) {
                await refreshSession();
            }
            
            // Track tickers that need updates vs those that are recent
            let batchNeedsUpdate = [];
            let batchRecentlyUpdated = [];
            
            // First pass: Check which tickers need updates (batch operation for efficiency)
            for (const symbol of batch) {
                const recentCheck = await database.isTickerRecentlyChecked(symbol, 24);
                if (recentCheck.isRecent) {
                    batchRecentlyUpdated.push({ symbol, hoursSince: recentCheck.hoursSince });
                } else {
                    batchNeedsUpdate.push(symbol);
                }
            }
            
            skipped += batchRecentlyUpdated.length;
            
            console.log(`   📊 Batch ${batchNumber}: ${batchNeedsUpdate.length} need updates, ${batchRecentlyUpdated.length} recently updated (skipping)`);
            
            if (batchRecentlyUpdated.length > 0) {
                // Show some examples of skipped tickers
                const examples = batchRecentlyUpdated.slice(0, 3).map(t => `${t.symbol}(${t.hoursSince}h)`).join(', ');
                console.log(`   ⏭️  Skipped examples: ${examples}${batchRecentlyUpdated.length > 3 ? ` +${batchRecentlyUpdated.length - 3} more` : ''}`);
            }
            
            // Process only tickers that need updates with concurrent processing
            const processTickersConcurrent = async (tickersToProcess) => {
                const chunkSize = concurrentRequests;
                const chunks = [];
                for (let j = 0; j < tickersToProcess.length; j += chunkSize) {
                    chunks.push(tickersToProcess.slice(j, j + chunkSize));
                }
                
                for (const chunk of chunks) {
                    // Process chunk concurrently
                    const promises = chunk.map(async (symbol) => {
                        try {
                            const result = await saveTickerDataToDB(symbol, database);
                            requestCount++;
                            
                            if (result.success) {
                                results.push(result);
                                console.log(`   ✅ ${symbol}: Updated successfully`);
                                return { symbol, success: true };
                            } else {
                                if (result.errorType === 'SCHEMA_VALIDATION') {
                                    schemaErrors.push({ symbol, error: result.error || 'Schema validation error' });
                                    console.log(`   🔄 ${symbol}: Marked inactive (schema error)`);
                                } else if (result.errorType === 'DELISTED') {
                                    delistedTickers.push({ symbol, error: result.error || 'Delisted ticker' });
                                    console.log(`   🗑️  ${symbol}: Marked as delisted`);
                                } else {
                                    errors.push({ symbol, error: result.error || 'Unknown error' });
                                    // Different message for undefined vs other errors
                                    if (result.error && result.error.includes('undefined response')) {
                                        console.log(`   ⏸️  ${symbol}: No data returned (timestamp not updated)`);
                                    } else {
                                        console.log(`   ❌ ${symbol}: ${result.error}`);
                                    }
                                }
                                return { symbol, success: false };
                            }
                        } catch (error) {
                            errors.push({ symbol, error: error.message });
                            console.log(`   ❌ ${symbol}: ${error.message}`);
                            requestCount++;
                            return { symbol, success: false };
                        }
                    });
                    
                    // Wait for chunk to complete
                    await Promise.allSettled(promises);
                    
                    // Shorter delay between chunks (instead of 2 seconds per ticker)
                    if (chunks.indexOf(chunk) < chunks.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between chunks
                    }
                }
            };
            
            if (batchNeedsUpdate.length > 0) {
                await processTickersConcurrent(batchNeedsUpdate);
            }
            
            processed += batchNeedsUpdate.length;
            
            // Update processed count to include skipped items for accurate progress tracking
            processed += batchRecentlyUpdated.length;
            
            // Show batch completion and overall progress with speed metrics
            const currentTime = Date.now();
            const elapsedTime = currentTime - startTime;
            const percentage = ((processed / activeTickers.length) * 100).toFixed(1);
            const dbCount = await database.getTickerCount();
            const tickersPerSecond = requestCount > 0 ? Math.round((requestCount / (elapsedTime / 1000)) * 10) / 10 : 0;
            
            console.log(`   ✅ Batch ${batchNumber} complete! Overall: ${processed}/${activeTickers.length} (${percentage}%) - DB: ${dbCount} records - Requests: ${requestCount} - Speed: ${tickersPerSecond}/sec`);
            
            // Shorter delay between batches (2 seconds instead of 10)
            if (i + batchSize < activeTickers.length) {
                console.log(`   ⏸️  Pausing 2s before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Get final database statistics
        const finalDbCount = await database.getTickerCount();
        const recentUpdates = await database.getRecentlyUpdated(5);
        
        // Summary
        console.log('\n🎉 Processing completed!');
        console.log(`📊 Total tickers processed: ${processed}/${activeTickers.length}`);
        console.log(`✅ Successfully processed: ${results.length} tickers`);
        console.log(`⏭️  Skipped (recently updated): ${skipped} tickers`);
        console.log(`❌ Failed to process: ${errors.length} tickers`);
        console.log(`🔄 Schema errors (marked inactive): ${schemaErrors.length} tickers`);
        console.log(`🗑️  Delisted tickers (marked inactive): ${delistedTickers.length} tickers`);
        console.log(`🌐 Total API requests made: ${requestCount}`);
        console.log(`💾 Total records in database: ${finalDbCount}`);
        
        const totalProcessed = results.length + errors.length + schemaErrors.length + delistedTickers.length;
        const successRate = totalProcessed > 0 ? ((results.length / totalProcessed) * 100).toFixed(1) : '0.0';
        const efficiencyRate = ((totalProcessed / activeTickers.length) * 100).toFixed(1);
        console.log(`� Success rate: ${successRate}% (of actually processed)`);
        console.log(`⚡ Efficiency rate: ${efficiencyRate}% (avoided ${skipped} unnecessary requests)`);
        
        // Show refresh statistics
        const refreshCount = Math.floor(requestCount / refreshInterval);
        if (refreshCount > 0) {
            console.log(`🔄 Session refreshes performed: ${refreshCount} (every ${refreshInterval.toLocaleString()} requests)`);
        }
        
        console.log('\n📝 Recently updated tickers:');
        recentUpdates.forEach(ticker => {
            console.log(`   ${ticker.ticker} - ${ticker.last_updated}`);
        });
        
        if (errors.length > 0) {
            console.log('\n📋 Failed tickers (first 20):');
            errors.slice(0, 20).forEach(error => {
                console.log(`   ${error.symbol}: ${error.error}`);
            });
            if (errors.length > 20) {
                console.log(`   ... and ${errors.length - 20} more`);
            }
        }
        
        if (schemaErrors.length > 0) {
            console.log('\n🔄 Schema errors - marked as inactive (first 10):');
            schemaErrors.slice(0, 10).forEach(error => {
                console.log(`   ${error.symbol}: ${error.error}`);
            });
            if (schemaErrors.length > 10) {
                console.log(`   ... and ${schemaErrors.length - 10} more`);
            }
        }
        
        if (delistedTickers.length > 0) {
            console.log('\n🗑️  Delisted tickers - marked as inactive (first 10):');
            delistedTickers.slice(0, 10).forEach(error => {
                console.log(`   ${error.symbol}: ${error.error}`);
            });
            if (delistedTickers.length > 10) {
                console.log(`   ... and ${delistedTickers.length - 10} more`);
            }
        }
        
        // Create a summary file
        const summaryData = {
            processedDate: new Date().toISOString(),
            totalTickers: activeTickers.length,
            successfullyProcessed: results.length,
            skipped: skipped,
            failed: errors.length,
            schemaErrors: schemaErrors.length,
            delistedTickers: delistedTickers.length,
            totalApiRequests: requestCount,
            sessionRefreshes: refreshCount,
            successRate: `${successRate}%`,
            efficiencyRate: `${efficiencyRate}%`,
            databaseRecords: finalDbCount,
            databasePath: path.join(__dirname, '..', 'db', 'ticker_data.db'),
            recentUpdates: recentUpdates,
            errors: errors.slice(0, 100), // Limit errors in summary to first 100
            schemaErrorTickers: schemaErrors.slice(0, 50), // Limit schema errors to first 50
            delistedTickersList: delistedTickers.slice(0, 50) // Limit delisted tickers to first 50
        };
        
        const outputDir = path.join(__dirname, '..', '..', 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const summaryPath = path.join(outputDir, 'Return-Data-Summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
        
        console.log(`\n📄 Processing summary saved to: ${summaryPath}`);
        console.log(`💾 Database location: ${path.join(__dirname, '..', 'db', 'ticker_data.db')}`);
        
        // Restore error logging
        toggleErrorSuppression(false);
        
        await database.close();
        return results;
        
    } catch (error) {
        console.error('❌ Error processing active tickers:', error.message);
        toggleErrorSuppression(false);
        await database.close();
        return [];
    }
}

// Run the processing
if (require.main === module) {
    processAllActiveTickers();
}