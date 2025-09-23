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
            // Connection pool settings
            max: config.max || 20,
            idleTimeoutMillis: config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
            // Application settings
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 1000
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
                process.exit(-1);
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
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
            console.log('✅ PostgreSQL connections closed');
        }
    }

    /**
     * Execute query with retry logic
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
                console.error(`Query attempt ${attempt} failed:`, error.message);
                
                if (attempt === this.config.retryAttempts) {
                    throw error;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
            }
        }
    }

    /**
     * Get or create ticker ID
     */
    async getOrCreateTickerId(symbol, exchange = 'NYSE') {
        const result = await this.query(
            'SELECT get_or_create_ticker_id($1, $2) as ticker_id',
            [symbol, exchange]
        );
        return result.rows[0].ticker_id;
    }

    /**
     * Update ticker basic info (validation data)
     */
    async updateTicker(symbol, exchange, { active, price } = {}) {
        const updateFields = [];
        const values = [];
        let paramIndex = 3;

        if (active !== undefined) {
            updateFields.push(`active = $${paramIndex++}`);
            values.push(active);
        }

        if (price !== undefined) {
            updateFields.push(`price = $${paramIndex++}`);
            values.push(price);
        }

        updateFields.push(`last_updated = CURRENT_TIMESTAMP`);

        const query = `
            UPDATE tickers 
            SET ${updateFields.join(', ')}
            WHERE symbol = $1 AND exchange = $2
        `;

        return await this.query(query, [symbol, exchange, ...values]);
    }

    /**
     * Insert/update historical data with incremental logic
     */
    async upsertHistoricalData(symbol, exchange, historicalData) {
        if (!Array.isArray(historicalData) || historicalData.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        let inserted = 0;
        let updated = 0;

        // Get latest historical date to determine what's new
        const latestDateResult = await this.query(
            'SELECT get_latest_historical_date($1, $2) as latest_date',
            [symbol, exchange]
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

        console.log(`Processing ${dataToProcess.length} historical records for ${symbol}.${exchange}`);

        // Batch insert/update historical data
        for (const record of dataToProcess) {
            try {
                const recordDate = new Date(record.date).toISOString().split('T')[0];
                
                const result = await this.query(`
                    SELECT upsert_historical_data($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    symbol,
                    exchange,
                    recordDate,
                    record.open,
                    record.high,
                    record.low,
                    record.close,
                    record.adjClose,
                    record.volume
                ]);

                inserted++; // The function handles insert/update internally
            } catch (error) {
                console.error(`Failed to process historical record for ${symbol}:`, error.message);
            }
        }

        return { inserted, updated, skipped: historicalData.length - dataToProcess.length };
    }

    /**
     * Insert/update quote data
     */
    async upsertQuoteData(symbol, exchange, quoteData) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchange);
        
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
    async upsertFinancialData(symbol, exchange, financialData) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchange);
        
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
    async insertMetadata(symbol, exchange, metadata) {
        const tickerId = await this.getOrCreateTickerId(symbol, exchange);
        
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
        const [symbol, exchange] = ticker.includes('.') ? ticker.split('.') : [ticker, 'NYSE'];

        const results = {
            symbol,
            exchange,
            metadata: null,
            quote: null,
            historical: null,
            financials: null,
            errors: []
        };

        try {
            // Process metadata
            if (data.metadata) {
                results.metadata = await this.insertMetadata(symbol, exchange, data.metadata);
            }

            // Process quote data
            if (data.quote) {
                results.quote = await this.upsertQuoteData(symbol, exchange, data.quote);
            }

            // Process historical data (incremental)
            if (data.historical && Array.isArray(data.historical)) {
                results.historical = await this.upsertHistoricalData(symbol, exchange, data.historical);
            }

            // Process financial data
            if (data.modules?.financialData) {
                results.financials = await this.upsertFinancialData(symbol, exchange, data.modules.financialData);
            }

            // Update ticker basic info
            await this.updateTicker(symbol, exchange, {
                active: true,
                price: data.quote?.regularMarketPrice
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
    async getTickerData(symbol, exchange = 'NYSE') {
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
            WHERE t.symbol = $1 AND t.exchange = $2
        `;

        const tickerResult = await this.query(tickerQuery, [symbol, exchange]);
        
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
     * Get database statistics
     */
    async getStats() {
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN active = true THEN 1 END) as active_count,
                COUNT(CASE WHEN active = false THEN 1 END) as inactive_count,
                COUNT(CASE WHEN active IS NULL THEN 1 END) as unvalidated_count,
                COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as validated_count,
                (SELECT COUNT(DISTINCT ticker_id) FROM ticker_historical) as historical_count,
                (SELECT COUNT(*) FROM ticker_historical) as total_historical_records
            FROM tickers
        `;

        const result = await this.query(query);
        return result.rows[0];
    }

    /**
     * Search tickers (for dashboard)
     */
    async searchTickers(searchTerm, limit = 50, offset = 0) {
        const query = `
            SELECT t.symbol, t.exchange, t.active, t.price, t.last_updated,
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

        const result = await this.query(query, [`%${searchTerm}%`, limit, offset]);
        return result.rows;
    }
}

module.exports = PostgreSQLManager;
