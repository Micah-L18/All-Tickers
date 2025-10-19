const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class SQLiteManager {
    constructor(config = {}) {
        this.dbPath = config.database || path.join(process.cwd(), 'ticker_data.db');
        this.db = null;
        this.isConnected = false;
        
        // Retry configuration
        this.maxRetries = config.maxRetries || 3;
        this.retryDelay = config.retryDelay || 1000;
        
        console.log(`📁 SQLite database path: ${this.dbPath}`);
        console.log(`📂 Current working directory: ${process.cwd()}`);
        console.log(`📂 Script directory: ${__dirname}`);
        
        // Ensure the directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            console.log(`📁 Creating database directory: ${dbDir}`);
            fs.mkdirSync(dbDir, { recursive: true });
        }
    }

    async connect() {
        if (this.isConnected && this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ SQLite connection error:', err.message);
                    reject(err);
                    return;
                }
                
                console.log('✅ SQLite database connected successfully');
                this.isConnected = true;
                
                // Enable foreign keys and set optimizations
                this.db.serialize(() => {
                    this.db.run("PRAGMA foreign_keys = ON");
                    this.db.run("PRAGMA journal_mode = WAL");
                    this.db.run("PRAGMA synchronous = NORMAL");
                    this.db.run("PRAGMA cache_size = 10000");
                    this.db.run("PRAGMA temp_store = MEMORY");
                });
                
                resolve(this.db);
            });
        });
    }

    async query(sql, params = []) {
        if (!this.isConnected || !this.db) {
            await this.connect();
        }

        return new Promise((resolve, reject) => {
            const isSelect = sql.trim().toLowerCase().startsWith('select');
            
            if (isSelect) {
                this.db.all(sql, params, (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve({ rows, rowCount: rows.length });
                });
            } else {
                this.db.run(sql, params, function(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve({ 
                        rows: [], 
                        rowCount: this.changes,
                        insertId: this.lastID 
                    });
                });
            }
        });
    }

    async queryWithRetry(sql, params = []) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this.query(sql, params);
                return result;
            } catch (error) {
                lastError = error;
                console.log(`Query attempt ${attempt} failed: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
        
        throw lastError;
    }

    async initializeSchema() {
        console.log('🏗️  Checking SQLite database schema...');
        
        // Check if tables already exist
        const result = await this.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tickers'");
        
        if (result.rows.length > 0) {
            console.log('✅ SQLite schema already initialized');
            return;
        }
        
        console.log('📋 Initializing new SQLite database schema...');
        
        const schemaPath = path.join(process.cwd(), 'sqlite-schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found: ${schemaPath}`);
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Execute the entire schema as one transaction
        return new Promise((resolve, reject) => {
            this.db.exec(schema, (err) => {
                if (err) {
                    console.error('Schema initialization error:', err.message);
                    reject(err);
                } else {
                    console.log('✅ SQLite schema initialized successfully');
                    resolve();
                }
            });
        });
    }

    // Ticker management methods
    async getOrCreateTickerId(symbol, exchanges = []) {
        try {
            // First try to get existing ticker
            const existingResult = await this.query(
                'SELECT id FROM tickers WHERE symbol = ?',
                [symbol]
            );
            
            if (existingResult.rows.length > 0) {
                return existingResult.rows[0].id;
            }
            
            // Create new ticker
            const insertResult = await this.query(
                'INSERT INTO tickers (symbol, exchanges, active) VALUES (?, ?, ?)',
                [symbol, JSON.stringify(exchanges), true]
            );
            
            return insertResult.insertId;
        } catch (error) {
            console.error(`Error creating ticker ${symbol}:`, error);
            throw error;
        }
    }

    async upsertQuote(tickerData) {
        const tickerId = await this.getOrCreateTickerId(tickerData.symbol, tickerData.exchanges);
        
        // Check if quote exists
        const existingQuote = await this.query(
            'SELECT id FROM ticker_quotes WHERE ticker_id = ?',
            [tickerId]
        );
        
        const quoteData = [
            tickerId,
            tickerData.symbol,
            tickerData.regularMarketPrice,
            tickerData.previousClose,
            tickerData.open,
            tickerData.bid,
            tickerData.ask,
            tickerData.regularMarketDayRange,
            tickerData.fiftyTwoWeekRange,
            tickerData.volume,
            tickerData.averageVolume,
            tickerData.marketCap,
            tickerData.beta,
            tickerData.trailingPE,
            tickerData.eps,
            tickerData.earningsDate,
            tickerData.dividendYield,
            tickerData.exDividendDate,
            tickerData.targetMeanPrice
        ];
        
        if (existingQuote.rows.length > 0) {
            // Update existing quote
            await this.query(`
                UPDATE ticker_quotes SET
                    current_price = ?, previous_close = ?, open_price = ?, bid = ?, ask = ?,
                    days_range = ?, weeks_52_range = ?, volume = ?, avg_volume = ?,
                    market_cap = ?, beta = ?, pe_ratio = ?, eps = ?, earnings_date = ?,
                    dividend_yield = ?, ex_dividend_date = ?, year_target_est = ?,
                    quote_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE ticker_id = ?
            `, [...quoteData.slice(2), tickerId]);
        } else {
            // Insert new quote
            await this.query(`
                INSERT INTO ticker_quotes (
                    ticker_id, symbol, current_price, previous_close, open_price, bid, ask,
                    days_range, weeks_52_range, volume, avg_volume, market_cap, beta,
                    pe_ratio, eps, earnings_date, dividend_yield, ex_dividend_date,
                    year_target_est, quote_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, quoteData);
        }
        
        return tickerId;
    }

    async upsertHistoricalData(symbol, historicalData) {
        const tickerId = await this.getOrCreateTickerId(symbol);
        
        for (const record of historicalData) {
            // Check if record exists
            const existing = await this.query(
                'SELECT id FROM ticker_historical WHERE ticker_id = ? AND trade_date = ?',
                [tickerId, record.date]
            );
            
            const data = [
                tickerId,
                symbol,
                record.date,
                record.open,
                record.high,
                record.low,
                record.close,
                record.volume,
                record.adjClose
            ];
            
            if (existing.rows.length > 0) {
                await this.query(`
                    UPDATE ticker_historical SET
                        open_price = ?, high_price = ?, low_price = ?, close_price = ?,
                        volume = ?, adjusted_close = ?
                    WHERE ticker_id = ? AND trade_date = ?
                `, [record.open, record.high, record.low, record.close, record.volume, record.adjClose, tickerId, record.date]);
            } else {
                await this.query(`
                    INSERT INTO ticker_historical (
                        ticker_id, symbol, trade_date, open_price, high_price,
                        low_price, close_price, volume, adjusted_close
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, data);
            }
        }
    }

    async markTickerActive(symbol) {
        await this.query(
            'UPDATE tickers SET active = ? WHERE symbol = ?',
            [1, symbol]
        );
        await this.invalidateStatsCache();
    }

    async markTickerInactive(symbol) {
        await this.query(
            'UPDATE tickers SET active = ? WHERE symbol = ?',
            [0, symbol]
        );
        await this.invalidateStatsCache();
    }

    async getAllTickers(activeOnly = false) {
        const whereClause = activeOnly ? 'WHERE active = 1' : '';
        const result = await this.query(`
            SELECT id, symbol, exchanges, active, created_at, updated_at
            FROM tickers ${whereClause}
            ORDER BY symbol
        `);
        
        // Parse JSON exchanges for each ticker
        return result.rows.map(row => ({
            ...row,
            exchanges: JSON.parse(row.exchanges || '[]')
        }));
    }

    async getStats(useCache = true) {
        const stats = {};
        
        try {
            // Check cache first (only if requested)
            if (useCache) {
                const cacheResult = await this.query(
                    "SELECT stat_value FROM stats_cache WHERE stat_name = 'dashboard_stats' AND expires_at > datetime('now')"
                );
                
                if (cacheResult.rows.length > 0) {
                    console.log('📊 Using cached stats');
                    return JSON.parse(cacheResult.rows[0].stat_value);
                }
            }
            
            console.log('📊 Calculating fresh stats...');
            
            // Optimized: Use a single query with aggregations instead of multiple COUNT queries
            // This is much faster on large tables
            const statsQuery = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
                    SUM(CASE WHEN active IS NULL THEN 1 ELSE 0 END) as need_validation
                FROM tickers
            `;
            
            const mainStats = await this.query(statsQuery);
            stats.total = mainStats.rows[0].total;
            stats.totalTickers = stats.total;
            stats.active_count = mainStats.rows[0].active_count;
            stats.activeTickers = stats.active_count;
            stats.need_validation = mainStats.rows[0].need_validation;
            stats.unvalidated_count = mainStats.rows[0].need_validation; // For backwards compatibility
            
            // Get quotes and historical counts (run in parallel)
            const [quotesResult, historicalResult] = await Promise.all([
                this.query('SELECT COUNT(*) as count FROM ticker_quotes'),
                this.query('SELECT COUNT(*) as count FROM ticker_historical')
            ]);
            
            stats.totalQuotes = quotesResult.rows[0].count;
            stats.totalHistoricalRecords = historicalResult.rows[0].count;
            stats.historical_count = quotesResult.rows[0].count; // Tickers with quotes
            stats.total_historical_records = historicalResult.rows[0].count;
            
            // Database size
            const dbStats = fs.statSync(this.dbPath);
            const sizeMB = dbStats.size / (1024 * 1024);
            
            // Show GB if size is above 1000MB
            if (sizeMB >= 1000) {
                const sizeGB = (sizeMB / 1024).toFixed(2);
                stats.databaseSizeMB = sizeMB.toFixed(2);
                stats.database_size = `${sizeGB} GB`;
            } else {
                stats.databaseSizeMB = sizeMB.toFixed(2);
                stats.database_size = `${sizeMB.toFixed(2)} MB`;
            }
            
            console.log('📊 Stats calculated:', {
                total: stats.total,
                active: stats.active_count,
                need_validation: stats.need_validation,
                quotes: stats.totalQuotes
            });
            
            // Cache the results for 5 minutes
            await this.query(
                `INSERT OR REPLACE INTO stats_cache (stat_name, stat_value, expires_at) 
                 VALUES ('dashboard_stats', ?, datetime('now', '+5 minutes'))`,
                [JSON.stringify(stats)]
            );
            
            console.log('✅ Stats calculated and cached');
            
            return stats;
        } catch (error) {
            console.error('Error getting stats:', error);
            console.error('Stack trace:', error.stack);
            return { 
                error: error.message,
                total: 0,
                active_count: 0,
                need_validation: 0,
                validated_count: 0,
                unvalidated_count: 0,
                totalTickers: 0,
                activeTickers: 0,
                totalQuotes: 0,
                totalHistoricalRecords: 0,
                historical_count: 0,
                total_historical_records: 0,
                databaseSizeMB: '0.00',
                database_size: '0.00 MB'
            };
        }
    }

    async invalidateStatsCache() {
        try {
            await this.query("DELETE FROM stats_cache WHERE stat_name = 'dashboard_stats'");
            console.log('🗑️  Stats cache invalidated');
        } catch (error) {
            console.error('Error invalidating stats cache:', error);
        }
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err.message);
                    } else {
                        console.log('✅ SQLite database connection closed');
                    }
                    this.isConnected = false;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    // Export functionality (existing methods adapted for SQLite)
    async exportToSQLite(exportPath, options = {}) {
        const { activeOnly = false, historicalDays = null } = options;
        
        console.log(`📤 Exporting SQLite database to: ${exportPath}`);
        console.log(`📤 Options: activeOnly=${activeOnly}, historicalDays=${historicalDays}`);
        
        // Copy current database to export location
        return new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(this.dbPath);
            const writeStream = fs.createWriteStream(exportPath);
            
            readStream.on('error', reject);
            writeStream.on('error', reject);
            writeStream.on('finish', () => {
                console.log('✅ SQLite export completed successfully');
                resolve();
            });
            
            readStream.pipe(writeStream);
        });
    }

    // Methods to maintain compatibility with existing export system
    async exportToJSON(exportPath, options = {}) {
        const { activeOnly = false, historicalDays = null } = options;
        
        console.log(`📤 Exporting to JSON: ${exportPath}`);
        
        // Get tickers data
        const tickers = await this.getAllTickers(activeOnly);
        
        // Get quotes data
        const quotesQuery = activeOnly 
            ? 'SELECT * FROM ticker_quotes WHERE ticker_id IN (SELECT id FROM tickers WHERE active = 1)'
            : 'SELECT * FROM ticker_quotes';
        const quotes = await this.query(quotesQuery);
        
        // Get historical data with date filtering
        let historicalQuery = 'SELECT * FROM ticker_historical';
        const params = [];
        
        if (activeOnly) {
            historicalQuery += ' WHERE ticker_id IN (SELECT id FROM tickers WHERE active = 1)';
        }
        
        if (historicalDays) {
            const dateClause = activeOnly ? ' AND' : ' WHERE';
            historicalQuery += `${dateClause} trade_date >= date('now', '-${historicalDays} days')`;
        }
        
        const historical = await this.query(historicalQuery, params);
        
        const exportData = {
            metadata: {
                exportedAt: new Date().toISOString(),
                totalTickers: tickers.length,
                totalQuotes: quotes.rows.length,
                totalHistoricalRecords: historical.rows.length,
                activeOnly,
                historicalDays
            },
            tickers,
            quotes: quotes.rows,
            historical: historical.rows
        };
        
        fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
        console.log('✅ JSON export completed successfully');
    }

    async exportToCSV(exportPath, options = {}) {
        const { activeOnly = false, historicalDays = null } = options;
        
        console.log(`📤 Exporting to CSV: ${exportPath}`);
        
        // Create a simple CSV export of tickers with quotes
        const query = `
            SELECT 
                t.symbol,
                t.active,
                q.current_price,
                q.volume,
                q.market_cap,
                q.quote_time
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            ${activeOnly ? 'WHERE t.active = 1' : ''}
            ORDER BY t.symbol
        `;
        
        const result = await this.query(query);
        
        // Create CSV content
        const headers = ['Symbol', 'Active', 'Current Price', 'Volume', 'Market Cap', 'Quote Time'];
        const csvContent = [
            headers.join(','),
            ...result.rows.map(row => [
                row.symbol,
                row.active ? 'Yes' : 'No',
                row.current_price || '',
                row.volume || '',
                row.market_cap || '',
                row.quote_time || ''
            ].join(','))
        ].join('\n');
        
        fs.writeFileSync(exportPath, csvContent);
        console.log('✅ CSV export completed successfully');
    }

    // Additional methods needed for server.js compatibility
    async searchTickers(searchTerm, limit = 50, offset = 0) {
        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM tickers t
            WHERE t.symbol LIKE ?
        `;
        const countResult = await this.query(countQuery, [`%${searchTerm}%`]);
        const total = countResult.rows[0].total;

        // Get paginated results with quotes
        const dataQuery = `
            SELECT t.symbol, t.exchanges, t.active, t.created_at as last_updated,
                   q.current_price as regular_market_price, q.market_cap, q.quote_time
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            WHERE t.symbol LIKE ?
            ORDER BY t.symbol
            LIMIT ? OFFSET ?
        `;

        const dataResult = await this.query(dataQuery, [`%${searchTerm}%`, limit, offset]);
        
        // Parse exchanges JSON for each result
        const data = dataResult.rows.map(row => ({
            ...row,
            exchanges: JSON.parse(row.exchanges || '[]')
        }));
        
        return {
            data,
            total
        };
    }

    async getTickerData(symbol, exchange = null) {
        // Get basic ticker info with latest quote
        const tickerQuery = `
            SELECT t.*, 
                   q.current_price,
                   q.market_cap,
                   q.quote_time as last_quote_time
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            WHERE t.symbol = ?
        `;

        const tickerResult = await this.query(tickerQuery, [symbol]);
        
        if (tickerResult.rows.length === 0) {
            return null;
        }

        const ticker = tickerResult.rows[0];

        // Get historical data (last 100 records for API response)
        const historicalQuery = `
            SELECT trade_date, open_price, high_price, low_price, close_price, adjusted_close, volume
            FROM ticker_historical 
            WHERE ticker_id = ? 
            ORDER BY trade_date DESC 
            LIMIT 100
        `;

        const historicalResult = await this.query(historicalQuery, [ticker.id]);

        // Get latest financial data
        const financialQuery = `
            SELECT * FROM ticker_financials 
            WHERE ticker_id = ? 
            ORDER BY report_date DESC 
            LIMIT 1
        `;

        const financialResult = await this.query(financialQuery, [ticker.id]);

        // Construct response
        return {
            ticker: `${symbol}${exchange ? `.${exchange}` : ''}`,
            lastUpdated: ticker.updated_at,
            createdAt: ticker.created_at,
            data: {
                quote: {
                    symbol: ticker.symbol,
                    regularMarketPrice: ticker.current_price,
                    marketCap: ticker.market_cap,
                    quoteTime: ticker.last_quote_time
                },
                historical: historicalResult.rows,
                financials: financialResult.rows[0] || null
            }
        };
    }

    async getTickerDataPaginated(page = 1, limit = 50, tickerFilter = null) {
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        let params = [];
        
        if (tickerFilter) {
            whereClause = 'WHERE t.symbol LIKE ?';
            params.push(`%${tickerFilter}%`);
        }
        
        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total
            FROM tickers t
            ${whereClause}
        `;
        const countResult = await this.query(countQuery, params);
        const total = countResult.rows[0].total;

        // Get paginated data
        const dataQuery = `
            SELECT t.symbol, t.exchanges, t.active, t.created_at, t.updated_at,
                   q.current_price, q.market_cap, q.volume, q.quote_time
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            ${whereClause}
            ORDER BY t.symbol
            LIMIT ? OFFSET ?
        `;
        
        const queryParams = [...params, limit, offset];
        const result = await this.query(dataQuery, queryParams);
        
        // Parse exchanges JSON for each result
        const data = result.rows.map(row => ({
            ...row,
            exchanges: JSON.parse(row.exchanges || '[]')
        }));
        
        return {
            data,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        };
    }

    // Get exchange statistics - SQLite specific implementation
    async getExchangeStats() {
        // Get all tickers with their exchanges
        const result = await this.query(`
            SELECT exchanges, active 
            FROM tickers
        `);

        // Process the results to extract individual exchanges
        const exchangeStats = {};
        
        for (const row of result.rows) {
            const exchanges = JSON.parse(row.exchanges || '[]');
            const active = row.active;
            
            for (const exchange of exchanges) {
                if (!exchangeStats[exchange]) {
                    exchangeStats[exchange] = {
                        exchange_name: exchange,
                        total: 0,
                        active_count: 0,
                        inactive_count: 0,
                        unvalidated_count: 0
                    };
                }
                
                exchangeStats[exchange].total++;
                
                if (active === 1) {
                    exchangeStats[exchange].active_count++;
                } else if (active === 0) {
                    exchangeStats[exchange].inactive_count++;
                } else {
                    exchangeStats[exchange].unvalidated_count++;
                }
            }
        }
        
        // Convert to array and sort by total
        return Object.values(exchangeStats).sort((a, b) => b.total - a.total);
    }

    // Close database connection
    async disconnect() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = SQLiteManager;