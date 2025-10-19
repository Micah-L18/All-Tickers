-- All-Tickers SQLite Database Schema
-- Converted from PostgreSQL to SQLite
-- Maintains full compatibility with existing functionality

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Main tickers table with JSON-based exchanges support
CREATE TABLE IF NOT EXISTS tickers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    exchanges TEXT NOT NULL DEFAULT '[]', -- JSON array of exchanges
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Real-time ticker quotes with comprehensive financial data
CREATE TABLE IF NOT EXISTS ticker_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    current_price REAL,
    previous_close REAL,
    open_price REAL,
    bid REAL,
    ask REAL,
    days_range TEXT,
    weeks_52_range TEXT,
    volume INTEGER,
    avg_volume INTEGER,
    market_cap REAL,
    beta REAL,
    pe_ratio REAL,
    eps REAL,
    earnings_date TEXT,
    dividend_yield REAL,
    ex_dividend_date TEXT,
    year_target_est REAL,
    quote_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticker_id) REFERENCES tickers(id) ON DELETE CASCADE
);

-- Data fetch tracking and validation metadata
CREATE TABLE IF NOT EXISTS ticker_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    last_fetch_attempt DATETIME,
    last_successful_fetch DATETIME,
    fetch_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    data_quality_score REAL DEFAULT 0.0,
    validation_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticker_id) REFERENCES tickers(id) ON DELETE CASCADE
);

-- Historical OHLCV price data
CREATE TABLE IF NOT EXISTS ticker_historical (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    trade_date DATE NOT NULL,
    open_price REAL,
    high_price REAL,
    low_price REAL,
    close_price REAL,
    volume INTEGER,
    adjusted_close REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticker_id) REFERENCES tickers(id) ON DELETE CASCADE
);

-- Financial statements and ratios
CREATE TABLE IF NOT EXISTS ticker_financials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    report_date DATE,
    revenue REAL,
    net_income REAL,
    total_assets REAL,
    total_debt REAL,
    shareholders_equity REAL,
    operating_cash_flow REAL,
    free_cash_flow REAL,
    return_on_equity REAL,
    return_on_assets REAL,
    debt_to_equity REAL,
    current_ratio REAL,
    quick_ratio REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticker_id) REFERENCES tickers(id) ON DELETE CASCADE
);

-- Performance optimization cache for dashboard statistics
CREATE TABLE IF NOT EXISTS stats_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_name TEXT UNIQUE NOT NULL,
    stat_value TEXT NOT NULL, -- JSON value for complex data
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT (datetime(CURRENT_TIMESTAMP, '+30 minutes'))
);

-- Performance indexes for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickers_symbol ON tickers(symbol);
CREATE INDEX IF NOT EXISTS idx_tickers_active ON tickers(active);
CREATE INDEX IF NOT EXISTS idx_tickers_created_at ON tickers(created_at);

CREATE INDEX IF NOT EXISTS idx_ticker_quotes_ticker_id ON ticker_quotes(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_symbol ON ticker_quotes(symbol);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_quote_time ON ticker_quotes(quote_time);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_volume ON ticker_quotes(volume);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_market_cap ON ticker_quotes(market_cap);

CREATE INDEX IF NOT EXISTS idx_ticker_metadata_ticker_id ON ticker_metadata(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_symbol ON ticker_metadata(symbol);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_last_fetch ON ticker_metadata(last_successful_fetch);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_validation ON ticker_metadata(validation_status);

CREATE INDEX IF NOT EXISTS idx_ticker_historical_ticker_id ON ticker_historical(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_symbol ON ticker_historical(symbol);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_date ON ticker_historical(trade_date);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_volume ON ticker_historical(volume);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ticker_historical_unique ON ticker_historical(ticker_id, trade_date);

CREATE INDEX IF NOT EXISTS idx_ticker_financials_ticker_id ON ticker_financials(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_financials_symbol ON ticker_financials(symbol);
CREATE INDEX IF NOT EXISTS idx_ticker_financials_date ON ticker_financials(report_date);

CREATE INDEX IF NOT EXISTS idx_stats_cache_name ON stats_cache(stat_name);
CREATE INDEX IF NOT EXISTS idx_stats_cache_expires ON stats_cache(expires_at);

-- Performance index for stats queries
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_validation ON ticker_metadata(validation_status);
CREATE INDEX IF NOT EXISTS idx_tickers_active ON tickers(active);

-- Views for common queries
CREATE VIEW IF NOT EXISTS v_active_tickers_with_quotes AS
SELECT 
    t.id,
    t.symbol,
    t.exchanges,
    t.active,
    q.current_price,
    q.volume,
    q.market_cap,
    q.quote_time
FROM tickers t
LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
WHERE t.active = 1;

CREATE VIEW IF NOT EXISTS v_ticker_stats AS
SELECT 
    COUNT(*) as total_tickers,
    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_tickers,
    SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive_tickers
FROM tickers;

-- Triggers for automatic timestamp updates
CREATE TRIGGER IF NOT EXISTS update_tickers_timestamp 
    AFTER UPDATE ON tickers
BEGIN
    UPDATE tickers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_ticker_quotes_timestamp 
    AFTER UPDATE ON ticker_quotes
BEGIN
    UPDATE ticker_quotes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_ticker_metadata_timestamp 
    AFTER UPDATE ON ticker_metadata
BEGIN
    UPDATE ticker_metadata SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- SQLite-specific optimizations
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = 10000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456; -- 256MB