const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

/**
 * PostgreSQL Database Manager for All-Tickers
 * Handles efficient data operations with incremental updates
 */
class PostgreSQLManager {
    constructor(config = {}) {
        // Default configuration
        this.config = {
            user: config.user || process.env.DB_USER || 'all_tickers_user',
            host: config.host || process.env.DB_HOST || 'localhost',
            database: config.database || process.env.DB_NAME || 'all_tickers',
            password: config.password || process.env.DB_PASSWORD,
            port: config.port || process.env.DB_PORT || 5432,
            // Connection pool settings - extremely conservative to prevent memory exhaustion
            max: config.max || 2, // Only 2 connections max
            min: config.min || 1, // Minimum connections to maintain
            idleTimeoutMillis: config.idleTimeoutMillis || 60000, // 1 minute idle timeout
            connectionTimeoutMillis: config.connectionTimeoutMillis || 10000, // 10 second connection timeout
            acquireTimeoutMillis: config.acquireTimeoutMillis || 15000, // 15 seconds to acquire connection
            // Query settings - increased timeout for large export operations
            query_timeout: config.query_timeout || 300000, // 5 minute query timeout for exports
            statement_timeout: config.statement_timeout || 300000, // 5 minute statement timeout
            // Application settings
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 2000 // Longer delay between retries
        };

        this.pool = null;
        this.isConnected = false;
    }

    /**
     * Initialize connection pool
     */
    async connect() {
        try {
            this.pool = new Pool(this.config);
            
            // Test connection
            const client = await this.pool.connect();
            await client.query('SELECT 1');
            client.release();
            
            this.isConnected = true;
            console.log('✅ PostgreSQL connection established');
            
            // Set up error handling
            this.pool.on('error', (err, client) => {
                console.error('❌ Unexpected error on idle client', err);
                // Don't exit process, just log the error
                console.error('❌ Database pool error - attempting to recover');
            });
            
            return this.pool;
        } catch (error) {
            console.error('❌ Failed to connect to PostgreSQL:', error.message);
            throw error;
        }
    }

    /**
     * Close all connections
     */
    async disconnect() {
        if (this.pool && this.isConnected) {
            try {
                await this.pool.end();
                this.isConnected = false;
                this.pool = null;
                console.log('✅ PostgreSQL connections closed');
            } catch (error) {
                console.error('❌ Error closing PostgreSQL connections:', error.message);
                this.isConnected = false;
                this.pool = null;
            }
        }
    }

    /**
     * Execute query with enhanced retry logic for memory errors
     */
    async query(text, params = []) {
        if (!this.isConnected) {
            await this.connect();
        }

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                const result = await this.pool.query(text, params);
                return result;
            } catch (error) {
                const errorMessage = error.message.toLowerCase();
                const isMemoryError = errorMessage.includes('out of shared memory') || 
                                    errorMessage.includes('memory') ||
                                    errorMessage.includes('out of memory');
                
                console.error(`Query attempt ${attempt} failed: ${error.message}`);
                
                if (attempt === this.config.retryAttempts) {
                    throw error;
                }
                
                // For memory errors, wait longer and trigger garbage collection
                if (isMemoryError) {
                    if (global.gc) {
                        global.gc();
                    }
                    // Exponential backoff with longer delays for memory errors
                    const delay = this.config.retryDelay * attempt * (isMemoryError ? 3 : 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Standard retry delay for other errors
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
                }
            }
        }
    }

    /**
     * Get or create ticker ID with exchanges array support
     */
    async getOrCreateTickerId(symbol, exchanges = ['NYSE']) {
        // Ensure exchanges is an array
        if (!Array.isArray(exchanges)) {
            exchanges = [exchanges];
        }
        
        const result = await this.query(
            'SELECT get_or_create_ticker_id_array($1, $2) as ticker_id',
            [symbol, exchanges]
        );
        
        return result.rows[0].ticker_id;
    }

    /**
     * Update ticker basic info (validation data)
     */
    async updateTicker(symbol, { active, price, exchanges, updateValidated = false } = {}) {
        const updateFields = [];
        const values = [];
        let paramIndex = 2;

        if (active !== undefined) {
            updateFields.push(`active = $${paramIndex++}`);
            values.push(active);
        }

        if (price !== undefined) {
            updateFields.push(`price = $${paramIndex++}`);
            values.push(price);
        }

        if (exchanges !== undefined) {
            updateFields.push(`exchanges = $${paramIndex++}`);
            values.push(Array.isArray(exchanges) ? exchanges : [exchanges]);
        }

        // Always update last_updated when data changes
        updateFields.push(`last_updated = CURRENT_TIMESTAMP`);
        
        // Only update last_validated when explicitly requested (during validation operations)
        if (updateValidated) {
            updateFields.push(`last_validated = CURRENT_TIMESTAMP`);
        }

        const query = `
            UPDATE tickers 
            SET ${updateFields.join(', ')}
            WHERE symbol = $1
        `;

        return await this.query(query, [symbol, ...values]);
    }

    /**
     * Trigger background stats cache refresh (throttled to avoid excessive updates)
     */
    triggerStatsRefreshIfNeeded() {
        // Only refresh if enough time has passed since last trigger
        const now = Date.now();
        if (!this.lastStatsRefreshTrigger || (now - this.lastStatsRefreshTrigger) > 300000) { // 5 minutes
            this.lastStatsRefreshTrigger = now;
            
            // Trigger in background, don't wait
            setImmediate(async () => {
                try {
                    const StatsCache = require('./stats-cache');
                    const statsCache = new StatsCache();
                    await statsCache.initialize();
                    await statsCache.refreshAllStats();
                    await statsCache.close();
                    console.log('🔄 Stats cache refreshed after ticker updates');
                } catch (error) {
                    console.error('❌ Background stats refresh failed:', error);
                }
            });
        }
    }

    /**
     * Add exchange to ticker's exchanges array
     */
    async addExchangeToTicker(symbol, exchange) {
        const query = `
            UPDATE tickers 
            SET exchanges = array_append(exchanges, $2)
            WHERE symbol = $1 AND NOT ($2 = ANY(exchanges))
        `;
        
        return await this.query(query, [symbol, exchange]);
    }

    /**
     * Insert/update historical data with incremental logic
     */
    async upsertHistoricalData(symbol, historicalData) {
        if (!Array.isArray(historicalData) || historicalData.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        let inserted = 0;
        let updated = 0;

        // Get latest historical date by symbol (not exchange-specific anymore)
        const latestDateResult = await this.query(
            'SELECT get_latest_historical_date_by_symbol($1) as latest_date',
            [symbol]
        );
        
        const latestDate = latestDateResult.rows[0].latest_date;
        
        // Filter to only new data if we have existing historical data
        let dataToProcess = historicalData;
        if (latestDate) {
            dataToProcess = historicalData.filter(record => {
                const recordDate = new Date(record.date);
                return recordDate > new Date(latestDate);
            });
        }

        console.log(`Processing ${dataToProcess.length} historical records for ${symbol}`);

        // Batch insert/update historical data using efficient SQL batch queries
        const batchSize = 50; // Process in smaller batches to avoid memory issues
        
        for (let i = 0; i < dataToProcess.length; i += batchSize) {
            const batch = dataToProcess.slice(i, i + batchSize);
            
            try {
                // Use individual queries but in a transaction for efficiency
                for (const record of batch) {
                    try {
                        const recordDate = new Date(record.date).toISOString().split('T')[0];
                        
                        await this.query(`
                            SELECT upsert_historical_data_by_symbol($1, $2, $3, $4, $5, $6, $7, $8)
                        `, [
                            symbol, recordDate, record.open, record.high,
                            record.low, record.close, record.adjClose, record.volume
                        ]);
                        
                        inserted++;
                    } catch (recordError) {
                        console.error(`Failed to process historical record for ${symbol}:`, recordError.message);
                    }
                }
                
                // Small delay between batches to reduce memory pressure
                if (i + batchSize < dataToProcess.length) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                
            } catch (error) {
                console.error(`Failed to process batch for ${symbol}:`, error.message);
                // Continue with next batch
            }
        }

        return { inserted, updated, skipped: historicalData.length - dataToProcess.length };
    }

    /**
     * Insert/update quote data
     */
    async upsertQuoteData(symbol, exchanges, quoteData) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchanges);
        
        const query = `
            INSERT INTO ticker_quotes (
                ticker_id, quote_time, language, region, quote_type, currency,
                exchange_name, market, regular_market_price, regular_market_time,
                fifty_day_average, fifty_day_average_change, fifty_day_average_change_percent,
                two_hundred_day_average, two_hundred_day_average_change, two_hundred_day_average_change_percent,
                market_cap, shares_outstanding, book_value, trailing_annual_dividend_yield,
                dividend_yield, eps_trailing_twelve_months, eps_forward, eps_current_year,
                price_eps_current_year
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22, $23, $24, $25
            ) ON CONFLICT (ticker_id, quote_time) 
            DO UPDATE SET
                regular_market_price = EXCLUDED.regular_market_price,
                market_cap = EXCLUDED.market_cap,
                fifty_day_average = EXCLUDED.fifty_day_average,
                two_hundred_day_average = EXCLUDED.two_hundred_day_average,
                eps_trailing_twelve_months = EXCLUDED.eps_trailing_twelve_months,
                updated_at = CURRENT_TIMESTAMP
        `;

        const values = [
            tickerId,
            quoteData.regularMarketTime || new Date(),
            quoteData.language || 'en-US',
            quoteData.region || 'US',
            quoteData.quoteType || 'EQUITY',
            quoteData.currency || 'USD',
            quoteData.exchange,
            quoteData.market,
            quoteData.regularMarketPrice,
            quoteData.regularMarketTime,
            quoteData.fiftyDayAverage,
            quoteData.fiftyDayAverageChange,
            quoteData.fiftyDayAverageChangePercent,
            quoteData.twoHundredDayAverage,
            quoteData.twoHundredDayAverageChange,
            quoteData.twoHundredDayAverageChangePercent,
            quoteData.marketCap,
            quoteData.sharesOutstanding,
            quoteData.bookValue,
            quoteData.trailingAnnualDividendYield,
            quoteData.dividendYield,
            quoteData.epsTrailingTwelveMonths,
            quoteData.epsForward,
            quoteData.epsCurrentYear,
            quoteData.priceEpsCurrentYear
        ];

        return await this.query(query, values);
    }

    /**
     * Insert/update financial data
     */
    async upsertFinancialData(symbol, exchanges, financialData) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchanges);
        
        const query = `
            INSERT INTO ticker_financials (
                ticker_id, data_date, market_cap, enterprise_value, trailing_pe, forward_pe,
                peg_ratio, price_to_sales_trailing, price_to_book, enterprise_to_revenue,
                enterprise_to_ebitda, profit_margins, operating_margins, return_on_assets,
                return_on_equity, total_cash, total_cash_per_share, total_debt, debt_to_equity,
                current_ratio, quick_ratio, total_revenue, revenue_per_share, revenue_growth,
                earnings_growth, gross_profits, ebitda, operating_cashflow, free_cashflow,
                target_high_price, target_low_price, target_mean_price, target_median_price,
                recommendation_mean, recommendation_key, number_of_analyst_opinions
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36
            ) ON CONFLICT (ticker_id, data_date)
            DO UPDATE SET
                market_cap = EXCLUDED.market_cap,
                trailing_pe = EXCLUDED.trailing_pe,
                return_on_equity = EXCLUDED.return_on_equity,
                total_revenue = EXCLUDED.total_revenue,
                target_mean_price = EXCLUDED.target_mean_price,
                recommendation_key = EXCLUDED.recommendation_key,
                updated_at = CURRENT_TIMESTAMP
        `;

        const values = [
            tickerId,
            new Date(),
            financialData.marketCap,
            financialData.enterpriseValue,
            financialData.trailingPE,
            financialData.forwardPE,
            financialData.pegRatio,
            financialData.priceToSalesTrailing12Months,
            financialData.priceToBook,
            financialData.enterpriseToRevenue,
            financialData.enterpriseToEbitda,
            financialData.profitMargins,
            financialData.operatingMargins,
            financialData.returnOnAssets,
            financialData.returnOnEquity,
            financialData.totalCash,
            financialData.totalCashPerShare,
            financialData.totalDebt,
            financialData.debtToEquity,
            financialData.currentRatio,
            financialData.quickRatio,
            financialData.totalRevenue,
            financialData.revenuePerShare,
            financialData.revenueGrowth,
            financialData.earningsGrowth,
            financialData.grossProfits,
            financialData.ebitda,
            financialData.operatingCashflow,
            financialData.freeCashflow,
            financialData.targetHighPrice,
            financialData.targetLowPrice,
            financialData.targetMeanPrice,
            financialData.targetMedianPrice,
            financialData.recommendationMean,
            financialData.recommendationKey,
            financialData.numberOfAnalystOpinions
        ];

        return await this.query(query, values);
    }

    /**
     * Insert metadata
     */
    async insertMetadata(symbol, exchanges, metadata) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchanges);
        
        const query = `
            INSERT INTO ticker_metadata (
                ticker_id, fetch_date, data_source, version, had_validation_warnings,
                historical_start_date, historical_end_date, historical_record_count,
                summary_modules_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (ticker_id, fetch_date) DO NOTHING
        `;

        const values = [
            tickerId,
            metadata.fetchDate || new Date(),
            metadata.dataSource || 'Yahoo Finance API',
            metadata.version || '2.0.0',
            metadata.hadValidationWarnings || false,
            metadata.historicalPeriod?.start,
            metadata.historicalPeriod?.end,
            metadata.recordCount?.historical || 0,
            metadata.recordCount?.summaryModules || 0
        ];

        return await this.query(query, values);
    }

    /**
     * Process complete ticker data (Yahoo Finance API response)
     */
    async processTickerData(tickerData) {
        const { ticker, data } = tickerData;
        // Parse symbol and exchange(s) - support both single ticker and ticker.exchange format
        let symbol, exchanges;
        if (ticker.includes('.')) {
            const parts = ticker.split('.');
            symbol = parts[0];
            exchanges = [parts[1]]; // Single exchange from ticker format
        } else {
            symbol = ticker;
            exchanges = data.exchanges || ['NYSE']; // Default or from data
        }

        const results = {
            symbol,
            exchanges,
            metadata: null,
            quote: null,
            historical: null,
            financials: null,
            errors: []
        };

        try {
            // Process metadata
            if (data.metadata) {
                results.metadata = await this.insertMetadata(symbol, exchanges, data.metadata);
            }

            // Process quote data
            if (data.quote) {
                results.quote = await this.upsertQuoteData(symbol, exchanges, data.quote);
            }

            // Process historical data (incremental)
            if (data.historical && Array.isArray(data.historical)) {
                results.historical = await this.upsertHistoricalData(symbol, data.historical);
            }

            // Process financial data
            if (data.modules?.financialData) {
                results.financials = await this.upsertFinancialData(symbol, exchanges, data.modules.financialData);
            }

            // Update ticker basic info
            await this.updateTicker(symbol, {
                active: true,
                price: data.quote?.regularMarketPrice,
                exchanges: exchanges
            });

        } catch (error) {
            results.errors.push(error.message);
            console.error(`Error processing ticker ${ticker}:`, error.message);
        }

        return results;
    }

    /**
     * Get ticker data for API response (replaces SQLite JSON queries)
     */
    async getTickerData(symbol) {
        // Get basic ticker info
        const tickerQuery = `
            SELECT t.*, 
                   tq.regular_market_price as current_price,
                   tq.market_cap,
                   tq.quote_time as last_quote_time
            FROM tickers t
            LEFT JOIN LATERAL (
                SELECT * FROM ticker_quotes 
                WHERE ticker_id = t.id 
                ORDER BY quote_time DESC 
                LIMIT 1
            ) tq ON true
            WHERE t.symbol = $1
        `;

        const tickerResult = await this.query(tickerQuery, [symbol]);
        
        if (tickerResult.rows.length === 0) {
            return null;
        }

        const ticker = tickerResult.rows[0];

        // Get historical data (last 100 records for API response)
        const historicalQuery = `
            SELECT trade_date, open_price, high_price, low_price, close_price, adj_close_price, volume
            FROM ticker_historical 
            WHERE ticker_id = $1 
            ORDER BY trade_date DESC 
            LIMIT 100
        `;

        const historicalResult = await this.query(historicalQuery, [ticker.id]);

        // Get latest financial data
        const financialQuery = `
            SELECT * FROM ticker_financials 
            WHERE ticker_id = $1 
            ORDER BY data_date DESC 
            LIMIT 1
        `;

        const financialResult = await this.query(financialQuery, [ticker.id]);

        // Construct response similar to current format
        return {
            ticker: `${symbol}.${exchange}`,
            lastUpdated: ticker.last_updated,
            createdAt: ticker.created_at,
            data: {
                quote: {
                    symbol: ticker.symbol,
                    regularMarketPrice: ticker.current_price,
                    marketCap: ticker.market_cap,
                    // ... other quote fields
                },
                historical: historicalResult.rows.map(row => ({
                    date: row.trade_date,
                    open: row.open_price,
                    high: row.high_price,
                    low: row.low_price,
                    close: row.close_price,
                    adjClose: row.adj_close_price,
                    volume: row.volume
                })),
                financials: financialResult.rows[0] || null
            }
        };
    }

    /**
     * Get total ticker count
     */
    async getTickerDataCount() {
        const query = `SELECT COUNT(*) as count FROM tickers`;
        const result = await this.query(query);
        return parseInt(result.rows[0].count);
    }

    /**
     * Insert or update ticker data
     */
    async insertOrUpdateTickerData(symbol, data) {
        // This method should handle inserting/updating ticker price data
        return await this.updateTicker(symbol, data);
    }

    /**
     * Get recently updated ticker data
     */
    async getRecentlyUpdatedTickerData(limit = 10) {
        const query = `
            SELECT symbol, exchanges, price, last_updated, active
            FROM tickers
            WHERE last_updated IS NOT NULL
            ORDER BY last_updated DESC
            LIMIT $1
        `;
        const result = await this.query(query, [limit]);
        return result.rows;
    }

    /**
     * Check if ticker was recently checked
     */
    async isTickerRecentlyChecked(symbol, hoursAgo = 24) {
        const query = `
            SELECT last_updated
            FROM tickers
            WHERE symbol = $1
            AND last_updated > NOW() - INTERVAL '${hoursAgo} hours'
        `;
        const result = await this.query(query, [symbol]);
        return result.rows.length > 0;
    }

    /**
     * Get database statistics (cached version for fast retrieval)
     */
    async getStats() {
        const StatsCache = require('./stats-cache');
        const statsCache = new StatsCache(this); // Pass this database manager instance
        
        try {
            await statsCache.initialize();
            
            // Check if cache needs refresh (uses 5-second logic from stats-cache.js)
            const needsRefresh = await statsCache.needsRefresh();
            
            if (needsRefresh) {
                console.log('📊 Stats cache is stale, refreshing synchronously...');
                // Refresh synchronously to avoid connection cascade
                await statsCache.refreshAllStats();
                const newStats = await statsCache.getCachedStats();
                return this.formatStatsResponse(newStats);
            } else {
                // Cache is fresh, use it
                const cachedStats = await statsCache.getCachedStats();
                return this.formatStatsResponse(cachedStats);
            }
        } catch (error) {
            console.error('❌ Error with stats cache, falling back to real-time calculation:', error);
            return this.getStatsRealtime(); // Fallback to original method
        }
    }

    /**
     * Handle background stats refresh without connection conflicts
     * DISABLED to prevent connection cascade issues
     */
    async backgroundRefreshStats() {
        // Disabled to prevent multiple database connections
        console.log('📊 Background refresh disabled to prevent connection issues');
        return;
        
        /*
        const StatsCache = require('./stats-cache');
        const backgroundStatsCache = new StatsCache(); // Create a separate instance for background work
        
        try {
            await backgroundStatsCache.initialize();
            await backgroundStatsCache.refreshAllStats();
        } catch (error) {
            console.error('❌ Background stats refresh failed:', error);
        } finally {
            try {
                await backgroundStatsCache.close();
            } catch (closeError) {
                // Ignore close errors for background tasks
            }
        }
        */
    }

    /**
     * Format cached stats into expected response format
     */
    formatStatsResponse(cachedStats) {
        return {
            total: parseInt(cachedStats.total) || 0,
            active_count: parseInt(cachedStats.active_count) || 0,
            inactive_count: parseInt(cachedStats.inactive_count) || 0,
            unvalidated_count: parseInt(cachedStats.unvalidated_count) || 0,
            validated_count: parseInt(cachedStats.validated_count) || 0,
            historical_count: parseInt(cachedStats.historical_count) || 0,
            total_historical_records: parseInt(cachedStats.total_historical_records) || 0,
            total_exchanges: parseInt(cachedStats.total_exchanges) || 0,
            database_size: cachedStats.database_size || 'Unknown',
            cache_age_minutes: cachedStats.cache_age_minutes || 0,
            last_cache_refresh: cachedStats.last_refresh || null
        };
    }

    /**
     * Get database statistics (original real-time calculation - now used as fallback)
     */
    async getStatsRealtime() {
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN active = true THEN 1 END) as active_count,
                COUNT(CASE WHEN active = false THEN 1 END) as inactive_count,
                COUNT(CASE WHEN active IS NULL THEN 1 END) as unvalidated_count,
                COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as validated_count,
                (SELECT COUNT(DISTINCT ticker_id) FROM ticker_historical) as historical_count,
                (SELECT COUNT(*) FROM ticker_historical) as total_historical_records,
                (SELECT COUNT(DISTINCT exchange) FROM (SELECT unnest(exchanges) as exchange FROM tickers) t) as total_exchanges
            FROM tickers
        `;

        const result = await this.query(query);
        const stats = result.rows[0];

        // Get database size
        try {
            const sizeQuery = `SELECT pg_database_size(current_database()) as size_bytes`;
            const sizeResult = await this.query(sizeQuery);
            const sizeBytes = parseInt(sizeResult.rows[0].size_bytes);
            stats.database_size = this.formatDatabaseSize(sizeBytes);
        } catch (error) {
            console.log('Could not get database size:', error.message);
            stats.database_size = 'Unknown';
        }

        return stats;
    }

    /**
     * Format database size with decimal scaling (1000-based)
     */
    formatDatabaseSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const base = 1000; // Decimal scaling as requested
        
        const i = Math.floor(Math.log(bytes) / Math.log(base));
        const size = bytes / Math.pow(base, i);
        
        // Format with appropriate decimal places
        let formattedSize;
        if (size >= 100) {
            formattedSize = size.toFixed(0);
        } else if (size >= 10) {
            formattedSize = size.toFixed(1);
        } else {
            formattedSize = size.toFixed(2);
        }
        
        return `${formattedSize} ${units[i]}`;
    }

    /**
     * Search tickers (for dashboard)
     */
    async searchTickers(searchTerm, limit = 50, offset = 0) {
        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM tickers t
            WHERE t.symbol ILIKE $1
        `;
        const countResult = await this.query(countQuery, [`%${searchTerm}%`]);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated results
        const dataQuery = `
            SELECT t.symbol, t.exchanges, t.active, t.price, t.last_updated,
                   tq.regular_market_price, tq.market_cap, tq.quote_time
            FROM tickers t
            LEFT JOIN LATERAL (
                SELECT * FROM ticker_quotes 
                WHERE ticker_id = t.id 
                ORDER BY quote_time DESC 
                LIMIT 1
            ) tq ON true
            WHERE t.symbol ILIKE $1
            ORDER BY t.symbol
            LIMIT $2 OFFSET $3
        `;

        const dataResult = await this.query(dataQuery, [`%${searchTerm}%`, limit, offset]);
        
        return {
            data: dataResult.rows,
            total: total
        };
    }

    /**
     * Export database data to SQLite format
     */
    async exportToSQLite(exportPath, options = {}, progressCallback = null) {
        const sqlite3 = require('sqlite3').verbose();
        const fs = require('fs');
        const path = require('path');

        const progress = progressCallback || ((msg) => console.log(msg));
        let db = null; // Initialize db variable for proper cleanup

        try {
            progress('🔄 Starting SQLite export...');
            
            // Ensure output directory exists
            const outputDir = path.dirname(exportPath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
                progress(`📁 Created output directory: ${outputDir}`);
            }

            // Delete existing file if it exists
            if (fs.existsSync(exportPath)) {
                fs.unlinkSync(exportPath);
                progress('🗑️ Removed existing SQLite file');
            }

            // Create SQLite database
            progress('📊 Creating SQLite database...');
            db = new sqlite3.Database(exportPath);
            
            // Create tables
            progress('🔧 Creating SQLite tables...');
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    // Create tickers table
                    db.run(`CREATE TABLE IF NOT EXISTS tickers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        symbol TEXT UNIQUE NOT NULL,
                        active BOOLEAN DEFAULT true,
                        exchanges TEXT,
                        current_price REAL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )`);

                    // Create ticker_quotes table
                    db.run(`CREATE TABLE IF NOT EXISTS ticker_quotes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker_id INTEGER,
                        quote_time TIMESTAMP,
                        regular_market_price REAL,
                        regular_market_change REAL,
                        regular_market_change_percent REAL,
                        regular_market_previous_close REAL,
                        regular_market_open REAL,
                        regular_market_day_low REAL,
                        regular_market_day_high REAL,
                        regular_market_volume INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(ticker_id) REFERENCES tickers(id)
                    )`);

                    // Create ticker_metadata table
                    db.run(`CREATE TABLE IF NOT EXISTS ticker_metadata (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker_id INTEGER,
                        fetch_date TIMESTAMP,
                        data_source TEXT,
                        version TEXT,
                        had_validation_warnings BOOLEAN,
                        historical_start_date TIMESTAMP,
                        historical_end_date TIMESTAMP,
                        historical_record_count INTEGER,
                        summary_modules_count INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(ticker_id) REFERENCES tickers(id)
                    )`);

                    // Create ticker_historical table
                    db.run(`CREATE TABLE IF NOT EXISTS ticker_historical (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        ticker_id INTEGER,
                        trade_date DATE,
                        open_price REAL,
                        high_price REAL,
                        low_price REAL,
                        close_price REAL,
                        adj_close_price REAL,
                        volume INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(ticker_id) REFERENCES tickers(id)
                    )`, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            });

            const exportedCounts = {
                tickers: 0,
                ticker_quotes: 0,
                ticker_metadata: 0,
                ticker_historical: 0
            };

            // Export tickers in chunks to avoid query timeouts
            progress('📈 Exporting tickers...');
            const chunkSize = 1000; // Process 1000 tickers at a time
            let offset = 0;
            let totalExported = 0;
            let rowId = 1;
            
            // Build WHERE clause based on activeOnly setting
            const { activeOnly = true } = options;
            const whereClause = activeOnly ? 'WHERE active = true' : '';
            const activeText = activeOnly ? 'active ' : '';
            
            // Get total count first
            const countResult = await this.query(`SELECT COUNT(*) as count FROM tickers ${whereClause}`);
            const totalTickers = parseInt(countResult.rows[0].count);
            
            progress(`📊 Will export ${totalTickers} ${activeText}tickers...`);
            
            while (offset < totalTickers) {
                progress(`📈 Export Progress: ${totalExported}/${totalTickers} (${Math.round(totalExported/totalTickers*100)}%)`);
                
                const tickersResult = await this.query(
                    `SELECT * FROM tickers ${whereClause} ORDER BY id LIMIT $1 OFFSET $2`,
                    [chunkSize, offset]
                );
                
                if (tickersResult.rows.length > 0) {
                    await new Promise((resolve, reject) => {
                        db.serialize(() => {
                            const stmt = db.prepare(`INSERT INTO tickers 
                                (id, symbol, active, exchanges, current_price, created_at, updated_at) 
                                VALUES (?, ?, ?, ?, ?, ?, ?)`);
                            
                            for (const row of tickersResult.rows) {
                                stmt.run(
                                    rowId++, row.symbol, row.active, 
                                    Array.isArray(row.exchanges) ? JSON.stringify(row.exchanges) : row.exchanges,
                                    row.current_price, row.created_at, row.updated_at
                                );
                            }
                            
                            stmt.finalize((err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    });
                    
                    totalExported += tickersResult.rows.length;
                }
                
                offset += chunkSize;
            }
            
            exportedCounts.tickers = totalExported;
            progress(`✅ Exported ${exportedCounts.tickers} tickers`);

            // Export ticker_quotes
            if (options.includeTickerData !== false) {
                progress('💰 Exporting ticker quotes...');
                
                // Use chunked processing to avoid memory issues
                let offset = 0;
                const chunkSize = 10000;
                let totalQuotes = 0;
                let rowId = 1;

                // Build JOIN clause for active filter if needed
                const joinClause = activeOnly ? 
                    `FROM ticker_quotes tq 
                     INNER JOIN tickers t ON tq.ticker_id = t.id AND t.active = true` : 
                    `FROM ticker_quotes tq`;

                while (true) {
                    const quotesResult = await this.query(
                        `SELECT tq.* ${joinClause}
                         ORDER BY tq.ticker_id, tq.quote_time 
                         LIMIT $1 OFFSET $2`, 
                        [chunkSize, offset]
                    );

                    if (quotesResult.rows.length === 0) break;

                    progress(`💰 Processing ticker quotes chunk ${Math.floor(offset/chunkSize) + 1}... (${totalQuotes} records so far)`);

                    await new Promise((resolve, reject) => {
                        db.serialize(() => {
                            const stmt = db.prepare(`INSERT INTO ticker_quotes 
                                (id, ticker_id, quote_time, regular_market_price, regular_market_change, 
                                regular_market_change_percent, regular_market_previous_close, 
                                regular_market_open, regular_market_day_low, regular_market_day_high, 
                                regular_market_volume, created_at) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                            
                            for (const row of quotesResult.rows) {
                                stmt.run(
                                    rowId++, row.ticker_id, row.quote_time, row.regular_market_price,
                                    row.regular_market_change, row.regular_market_change_percent,
                                    row.regular_market_previous_close, row.regular_market_open,
                                    row.regular_market_day_low, row.regular_market_day_high,
                                    row.regular_market_volume, row.created_at
                                );
                                totalQuotes++;
                            }
                            
                            stmt.finalize((err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    });

                    offset += chunkSize;
                    
                    // Progress update every few chunks
                    if (offset % (chunkSize * 5) === 0) {
                        progress(`💰 Ticker quotes progress: ${totalQuotes} records exported so far...`);
                    }
                }
                
                exportedCounts.ticker_quotes = totalQuotes;
                progress(`✅ Exported ${exportedCounts.ticker_quotes} ticker quotes`);

                // Export ticker_metadata with chunking
                progress('📋 Exporting ticker metadata...');
                offset = 0;
                let totalMetadata = 0;
                rowId = 1;

                while (true) {
                    const metadataResult = await this.query(
                        `SELECT * FROM ticker_metadata 
                         ORDER BY ticker_id, fetch_date 
                         LIMIT $1 OFFSET $2`, 
                        [chunkSize, offset]
                    );

                    if (metadataResult.rows.length === 0) break;

                    progress(`📋 Processing ticker metadata chunk ${Math.floor(offset/chunkSize) + 1}... (${totalMetadata} records so far)`);

                    await new Promise((resolve, reject) => {
                        db.serialize(() => {
                            const stmt = db.prepare(`INSERT INTO ticker_metadata 
                                (id, ticker_id, fetch_date, data_source, version, had_validation_warnings,
                                historical_start_date, historical_end_date, historical_record_count,
                                summary_modules_count, created_at) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                            
                            for (const row of metadataResult.rows) {
                                stmt.run(
                                    rowId++, row.ticker_id, row.fetch_date, row.data_source, 
                                    row.version, row.had_validation_warnings, row.historical_start_date,
                                    row.historical_end_date, row.historical_record_count, 
                                    row.summary_modules_count, row.created_at
                                );
                                totalMetadata++;
                            }
                            
                            stmt.finalize((err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    });

                    offset += chunkSize;
                    
                    // Progress update every few chunks
                    if (offset % (chunkSize * 5) === 0) {
                        progress(`📋 Ticker metadata progress: ${totalMetadata} records exported so far...`);
                    }
                }
                
                exportedCounts.ticker_metadata = totalMetadata;
                progress(`✅ Exported ${exportedCounts.ticker_metadata} ticker metadata records`);
            }

            // Export ticker_historical (if requested)
            if (options.includeHistorical) {
                progress('📊 Starting historical data export...');
                
                // Build date constraint based on historicalDays
                let dateConstraint = '';
                let dateParams = [];
                if (options.historicalDays && options.historicalDays > 0) {
                    dateConstraint = `WHERE trade_date >= CURRENT_DATE - INTERVAL '${options.historicalDays} days'`;
                    progress(`📅 Filtering historical data to last ${options.historicalDays} days`);
                } else {
                    progress('📅 Exporting all historical data');
                }
                
                // Get historical data in chunks to avoid memory issues
                let offset = 0;
                const chunkSize = 10000;
                let totalHistorical = 0;

                while (true) {
                    const historicalResult = await this.query(
                        `SELECT * FROM ticker_historical 
                         ${dateConstraint}
                         ORDER BY ticker_id, trade_date 
                         LIMIT $1 OFFSET $2`, 
                        [chunkSize, offset]
                    );

                    if (historicalResult.rows.length === 0) break;

                    progress(`📈 Processing historical data chunk ${Math.floor(offset/chunkSize) + 1}... (${totalHistorical} records so far)`);

                    await new Promise((resolve, reject) => {
                        db.serialize(() => {
                            const stmt = db.prepare(`INSERT INTO ticker_historical 
                                (ticker_id, trade_date, open_price, high_price, low_price, 
                                close_price, adj_close_price, volume, created_at) 
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                            
                            for (const row of historicalResult.rows) {
                                stmt.run(
                                    row.ticker_id, row.trade_date, row.open_price, 
                                    row.high_price, row.low_price, row.close_price, 
                                    row.adj_close_price, row.volume, row.created_at
                                );
                                totalHistorical++;
                            }
                            
                            stmt.finalize((err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    });

                    offset += chunkSize;
                    
                    // Progress update every few chunks
                    if (offset % (chunkSize * 5) === 0) {
                        progress(`📈 Historical data progress: ${totalHistorical} records exported so far...`);
                    }
                }
                
                exportedCounts.ticker_historical = totalHistorical;
                progress(`✅ Exported ${exportedCounts.ticker_historical} historical records`);
            }

            // Close SQLite database
            progress('💾 Finalizing SQLite database...');
            await new Promise((resolve, reject) => {
                db.close((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Get file size
            const stats = fs.statSync(exportPath);
            const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

            const result = {
                success: true,
                exportPath,
                fileSizeMB: `${fileSizeMB} MB`,
                exportedCounts,
                options
            };

            progress('✅ SQLite export completed successfully!');
            progress(`📊 Export Summary:`);
            progress(`   File: ${exportPath}`);
            progress(`   Size: ${fileSizeMB} MB`);
            progress(`   Tickers: ${exportedCounts.tickers}`);
            progress(`   Quotes: ${exportedCounts.ticker_quotes}`);
            progress(`   Metadata: ${exportedCounts.ticker_metadata}`);
            progress(`   Historical: ${exportedCounts.ticker_historical}`);

            return result;

        } catch (error) {
            const errorMsg = `❌ SQLite export failed: ${error.message}`;
            if (progressCallback) {
                progressCallback(errorMsg);
            }
            console.error('SQLite export error:', error);
            
            // Ensure database connection is closed before cleanup
            if (db) {
                try {
                    await new Promise((resolve) => {
                        db.close((err) => {
                            if (err) {
                                console.error('Error closing SQLite database:', err);
                            }
                            resolve(); // Always resolve to continue cleanup
                        });
                    });
                    console.log('🔒 SQLite database connection closed');
                } catch (closeError) {
                    console.error('Error during database close:', closeError);
                }
            }
            
            // Now safe to delete the partial file
            if (fs.existsSync(exportPath)) {
                try {
                    fs.unlinkSync(exportPath);
                    console.log(`🗑️ Cleaned up partial SQLite file: ${exportPath}`);
                } catch (deleteError) {
                    console.error('Error deleting partial SQLite file:', deleteError);
                }
            }
            
            throw error;
        }
    }
}

module.exports = PostgreSQLManager;
