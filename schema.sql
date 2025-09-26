-- PostgreSQL Schema for All-Tickers Project
-- Complete database structure as of September 2025
-- 
-- This schema includes all tables, indexes, constraints, and stored procedures
-- used by the All-Tickers ticker generation and validation system.

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Main tickers table with exchanges array support
CREATE TABLE IF NOT EXISTS tickers (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL UNIQUE,
    exchanges TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN DEFAULT false,
    price DECIMAL(10,4),
    last_updated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Real-time quote data with comprehensive financial metrics
CREATE TABLE IF NOT EXISTS ticker_quotes (
    id SERIAL PRIMARY KEY,
    ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    quote_time TIMESTAMP WITH TIME ZONE NOT NULL,
    regular_market_price DECIMAL(12,4),
    regular_market_change DECIMAL(12,4),
    regular_market_change_percent DECIMAL(8,4),
    regular_market_previous_close DECIMAL(12,4),
    regular_market_open DECIMAL(12,4),
    regular_market_day_low DECIMAL(12,4),
    regular_market_day_high DECIMAL(12,4),
    regular_market_volume BIGINT,
    market_cap BIGINT,
    shares_outstanding BIGINT,
    float_shares BIGINT,
    avg_daily_volume_3month BIGINT,
    avg_daily_volume_10day BIGINT,
    fifty_two_week_low DECIMAL(12,4),
    fifty_two_week_high DECIMAL(12,4),
    fifty_two_week_change DECIMAL(8,4),
    beta DECIMAL(8,4),
    forward_pe DECIMAL(8,4),
    trailing_pe DECIMAL(8,4),
    price_to_book DECIMAL(8,4),
    price_to_sales_ttm DECIMAL(8,4),
    enterprise_value BIGINT,
    profit_margins DECIMAL(8,4),
    enterprise_to_revenue DECIMAL(8,4),
    enterprise_to_ebitda DECIMAL(8,4),
    revenue_per_share DECIMAL(8,4),
    debt_to_equity DECIMAL(8,4),
    return_on_assets DECIMAL(8,4),
    return_on_equity DECIMAL(8,4),
    gross_profits BIGINT,
    free_cashflow BIGINT,
    operating_cashflow BIGINT,
    earnings_growth DECIMAL(8,4),
    revenue_growth DECIMAL(8,4),
    gross_margins DECIMAL(8,4),
    ebitda_margins DECIMAL(8,4),
    operating_margins DECIMAL(8,4),
    financial_currency VARCHAR(10),
    trailing_annual_dividend_rate DECIMAL(8,4),
    trailing_annual_dividend_yield DECIMAL(8,4),
    dividend_rate DECIMAL(8,4),
    dividend_yield DECIMAL(8,4),
    payout_ratio DECIMAL(8,4),
    book_value DECIMAL(8,4),
    trailing_annual_dividend_yield DECIMAL(8,4),
    eps_trailing_twelve_months DECIMAL(8,4),
    eps_forward DECIMAL(8,4),
    eps_current_year DECIMAL(8,4),
    price_eps_current_year DECIMAL(8,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_ticker_quote_time UNIQUE(ticker_id, quote_time)
);

-- Data fetch tracking and validation metadata
CREATE TABLE IF NOT EXISTS ticker_metadata (
    id SERIAL PRIMARY KEY,
    ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    fetch_date TIMESTAMP WITH TIME ZONE NOT NULL,
    data_source VARCHAR(100) DEFAULT 'Yahoo Finance API',
    version VARCHAR(20) DEFAULT '2.0.0',
    had_validation_warnings BOOLEAN DEFAULT false,
    historical_start_date DATE,
    historical_end_date DATE,
    historical_record_count INTEGER DEFAULT 0,
    summary_modules_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_ticker_fetch_date UNIQUE(ticker_id, fetch_date)
);

-- Historical OHLCV price data
CREATE TABLE IF NOT EXISTS ticker_historical (
    id SERIAL PRIMARY KEY,
    ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    trade_date DATE NOT NULL,
    open_price DECIMAL(12,4),
    high_price DECIMAL(12,4),
    low_price DECIMAL(12,4),
    close_price DECIMAL(12,4),
    adj_close_price DECIMAL(12,4),
    volume BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_ticker_trade_date UNIQUE(ticker_id, trade_date)
);

-- Financial statements and ratios
CREATE TABLE IF NOT EXISTS ticker_financials (
    id SERIAL PRIMARY KEY,
    ticker_id INTEGER NOT NULL REFERENCES tickers(id) ON DELETE CASCADE,
    data_date DATE NOT NULL,
    total_cash BIGINT,
    total_debt BIGINT,
    total_revenue BIGINT,
    debt_to_equity DECIMAL(8,4),
    return_on_equity DECIMAL(8,4),
    return_on_assets DECIMAL(8,4),
    free_cashflow BIGINT,
    operating_cashflow BIGINT,
    earnings_growth DECIMAL(8,4),
    revenue_growth DECIMAL(8,4),
    gross_margins DECIMAL(8,4),
    operating_margins DECIMAL(8,4),
    profit_margins DECIMAL(8,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_ticker_financial_date UNIQUE(ticker_id, data_date)
);

-- Statistics cache table for performance optimization
CREATE TABLE IF NOT EXISTS stats_cache (
    id SERIAL PRIMARY KEY,
    stat_key VARCHAR(100) UNIQUE NOT NULL,
    stat_value BIGINT NOT NULL,
    stat_text VARCHAR(255),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- PERFORMANCE INDEXES
-- =============================================================================

-- Indexes for tickers table
CREATE INDEX IF NOT EXISTS idx_tickers_symbol ON tickers(symbol);
CREATE INDEX IF NOT EXISTS idx_tickers_exchanges ON tickers USING GIN(exchanges);
CREATE INDEX IF NOT EXISTS idx_tickers_active ON tickers(active);
CREATE INDEX IF NOT EXISTS idx_tickers_last_updated ON tickers(last_updated);
CREATE INDEX IF NOT EXISTS idx_tickers_created_at ON tickers(created_at);

-- Indexes for ticker_quotes table
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_ticker_id ON ticker_quotes(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_quote_time ON ticker_quotes(quote_time);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_ticker_time ON ticker_quotes(ticker_id, quote_time);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_market_cap ON ticker_quotes(market_cap);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_volume ON ticker_quotes(regular_market_volume);

-- Indexes for ticker_metadata table
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_ticker_id ON ticker_metadata(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_fetch_date ON ticker_metadata(fetch_date);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_data_source ON ticker_metadata(data_source);

-- Indexes for ticker_historical table
CREATE INDEX IF NOT EXISTS idx_ticker_historical_ticker_id ON ticker_historical(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_trade_date ON ticker_historical(trade_date);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_ticker_date ON ticker_historical(ticker_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_volume ON ticker_historical(volume);

-- Indexes for ticker_financials table
CREATE INDEX IF NOT EXISTS idx_ticker_financials_ticker_id ON ticker_financials(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_financials_data_date ON ticker_financials(data_date);

-- Indexes for stats_cache table
CREATE INDEX IF NOT EXISTS idx_stats_cache_key ON stats_cache(stat_key);
CREATE INDEX IF NOT EXISTS idx_stats_cache_updated ON stats_cache(last_updated);

-- =============================================================================
-- STORED PROCEDURES AND FUNCTIONS
-- =============================================================================

-- Function to get or create ticker ID with exchanges array support
CREATE OR REPLACE FUNCTION get_or_create_ticker_id_array(
    p_symbol TEXT,
    p_exchanges TEXT[]
) RETURNS INTEGER AS $$
DECLARE
    v_ticker_id INTEGER;
BEGIN
    -- Try to find existing ticker
    SELECT id INTO v_ticker_id
    FROM tickers 
    WHERE symbol = p_symbol;
    
    IF v_ticker_id IS NULL THEN
        -- Create new ticker
        INSERT INTO tickers (symbol, exchanges, created_at)
        VALUES (p_symbol, p_exchanges, NOW())
        RETURNING id INTO v_ticker_id;
    ELSE
        -- Update exchanges array to include any new exchanges
        UPDATE tickers 
        SET exchanges = (
            SELECT array_agg(DISTINCT unnest ORDER BY unnest)
            FROM (
                SELECT unnest(exchanges) 
                UNION 
                SELECT unnest(p_exchanges)
            ) combined
        )
        WHERE id = v_ticker_id;
    END IF;
    
    RETURN v_ticker_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get ticker data for historical analysis
CREATE OR REPLACE FUNCTION get_ticker_historical_data(
    p_symbol TEXT,
    p_days INTEGER DEFAULT 30
) RETURNS TABLE (
    trade_date DATE,
    open_price DECIMAL(12,4),
    high_price DECIMAL(12,4),
    low_price DECIMAL(12,4),
    close_price DECIMAL(12,4),
    adj_close_price DECIMAL(12,4),
    volume BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        th.trade_date,
        th.open_price,
        th.high_price,
        th.low_price,
        th.close_price,
        th.adj_close_price,
        th.volume
    FROM ticker_historical th
    INNER JOIN tickers t ON th.ticker_id = t.id
    WHERE t.symbol = p_symbol
        AND th.trade_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
    ORDER BY th.trade_date DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to bulk update ticker status
CREATE OR REPLACE FUNCTION bulk_update_ticker_status(
    p_symbols TEXT[],
    p_active BOOLEAN,
    p_price DECIMAL(10,4) DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_updated_count INTEGER := 0;
    v_symbol TEXT;
BEGIN
    FOREACH v_symbol IN ARRAY p_symbols
    LOOP
        UPDATE tickers 
        SET 
            active = p_active,
            price = COALESCE(p_price, price),
            last_updated = NOW()
        WHERE symbol = v_symbol;
        
        IF FOUND THEN
            v_updated_count := v_updated_count + 1;
        END IF;
    END LOOP;
    
    RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function to migrate existing ticker data to exchanges array format
-- (Used during database migrations)
CREATE OR REPLACE FUNCTION migrate_to_exchanges_array() RETURNS TEXT AS $$
DECLARE
    v_result TEXT;
    v_old_count INTEGER;
    v_new_count INTEGER;
BEGIN
    -- Get count before migration
    SELECT COUNT(*) INTO v_old_count FROM tickers;
    
    -- Create backup
    CREATE TABLE IF NOT EXISTS tickers_backup_auto AS 
    SELECT * FROM tickers WHERE FALSE; -- Create structure only
    
    INSERT INTO tickers_backup_auto SELECT * FROM tickers;
    
    -- Drop and recreate tickers table with new schema
    DROP TABLE IF EXISTS tickers CASCADE;
    
    CREATE TABLE tickers (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(10) NOT NULL UNIQUE,
        exchanges TEXT[] NOT NULL DEFAULT '{}',
        active BOOLEAN,
        price DECIMAL(10,4),
        last_updated TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Migrate data
    INSERT INTO tickers (symbol, exchanges, active, price, last_updated, created_at)
    SELECT 
        symbol,
        array_agg(DISTINCT exchange ORDER BY exchange) as exchanges,
        BOOL_OR(COALESCE(active, false)) as active,
        MAX(price) as price,
        MAX(last_updated) as last_updated,
        MIN(created_at) as created_at
    FROM tickers_backup_auto
    GROUP BY symbol
    ORDER BY symbol;
    
    -- Get count after migration
    SELECT COUNT(*) INTO v_new_count FROM tickers;
    
    -- Create indexes
    CREATE INDEX idx_tickers_symbol ON tickers(symbol);
    CREATE INDEX idx_tickers_exchanges ON tickers USING GIN(exchanges);
    CREATE INDEX idx_tickers_active ON tickers(active);
    CREATE INDEX idx_tickers_last_updated ON tickers(last_updated);
    
    v_result := format('Migration completed: %s rows -> %s unique symbols', v_old_count, v_new_count);
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS (Optional - for common queries)
-- =============================================================================

-- Active tickers with latest quote data
CREATE OR REPLACE VIEW v_active_tickers_with_quotes AS
SELECT 
    t.id,
    t.symbol,
    t.exchanges,
    t.active,
    t.price,
    t.last_updated,
    tq.regular_market_price,
    tq.market_cap,
    tq.regular_market_volume,
    tq.quote_time
FROM tickers t
LEFT JOIN LATERAL (
    SELECT * FROM ticker_quotes 
    WHERE ticker_id = t.id 
    ORDER BY quote_time DESC 
    LIMIT 1
) tq ON true
WHERE t.active = true;

-- Ticker statistics summary
CREATE OR REPLACE VIEW v_ticker_stats AS
SELECT 
    COUNT(*) as total_tickers,
    COUNT(CASE WHEN active = true THEN 1 END) as active_tickers,
    COUNT(CASE WHEN active = false THEN 1 END) as inactive_tickers,
    COUNT(CASE WHEN active IS NULL THEN 1 END) as unvalidated_tickers,
    COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as tickers_with_price,
    COUNT(DISTINCT unnest(exchanges)) as total_exchanges
FROM tickers;

-- =============================================================================
-- DATABASE CONFIGURATION AND OPTIMIZATION
-- =============================================================================

-- Set recommended PostgreSQL configuration for All-Tickers workload
-- These settings can be applied via ALTER SYSTEM or postgresql.conf

-- Memory settings for large datasets
-- shared_buffers = '1GB'
-- work_mem = '256MB'
-- maintenance_work_mem = '512MB'

-- Checkpoint settings for write-heavy workloads
-- checkpoint_completion_target = 0.7
-- wal_buffers = '64MB'

-- Connection settings
-- max_connections = 100

-- Query optimization
-- random_page_cost = 1.1
-- effective_cache_size = '4GB'

-- =============================================================================
-- COMMENTS AND DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE tickers IS 'Core ticker symbols with exchange array support';
COMMENT ON TABLE ticker_quotes IS 'Real-time quote data with comprehensive financial metrics';
COMMENT ON TABLE ticker_metadata IS 'Data fetch tracking and validation metadata';
COMMENT ON TABLE ticker_historical IS 'Historical OHLCV price data for backtesting and analysis';
COMMENT ON TABLE ticker_financials IS 'Financial statements and key ratios';
COMMENT ON TABLE stats_cache IS 'Performance optimization cache for dashboard statistics';

COMMENT ON COLUMN tickers.exchanges IS 'Array of exchanges where ticker is traded (NYSE, NASDAQ, AMEX)';
COMMENT ON COLUMN tickers.active IS 'TRUE=valid ticker, FALSE=invalid/delisted, NULL=unvalidated';
COMMENT ON COLUMN ticker_quotes.quote_time IS 'Timestamp when quote data was fetched';
COMMENT ON COLUMN ticker_historical.adj_close_price IS 'Adjusted close price accounting for splits/dividends';
COMMENT ON COLUMN stats_cache.stat_key IS 'Unique identifier for cached statistic';
COMMENT ON COLUMN stats_cache.stat_value IS 'Numeric value of the cached statistic';
COMMENT ON COLUMN stats_cache.stat_text IS 'Text representation of the statistic (for formatted values)';

-- =============================================================================
-- MAINTENANCE PROCEDURES
-- =============================================================================

-- Function to vacuum and analyze all tables (run periodically)
CREATE OR REPLACE FUNCTION maintenance_vacuum_analyze() RETURNS TEXT AS $$
DECLARE
    v_result TEXT := '';
    v_table RECORD;
BEGIN
    FOR v_table IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename LIKE 'ticker%'
        OR tablename = 'stats_cache'
    LOOP
        EXECUTE format('VACUUM ANALYZE %I.%I', v_table.schemaname, v_table.tablename);
        v_result := v_result || format('Vacuumed %s.%s; ', v_table.schemaname, v_table.tablename);
    END LOOP;
    
    RETURN 'Maintenance completed: ' || v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to get database size information
CREATE OR REPLACE FUNCTION get_database_size_info() RETURNS TABLE (
    database_name TEXT,
    size_bytes BIGINT,
    size_pretty TEXT,
    table_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        current_database()::TEXT,
        pg_database_size(current_database()),
        pg_size_pretty(pg_database_size(current_database())),
        (SELECT COUNT(*)::INTEGER FROM pg_tables WHERE schemaname = 'public');
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SCHEMA VERSION AND METADATA
-- =============================================================================

-- Store schema version information
INSERT INTO stats_cache (stat_key, stat_value, stat_text) 
VALUES ('schema_version', 1, '2025.09.26') 
ON CONFLICT (stat_key) DO UPDATE SET 
    stat_value = EXCLUDED.stat_value,
    stat_text = EXCLUDED.stat_text,
    last_updated = CURRENT_TIMESTAMP;

INSERT INTO stats_cache (stat_key, stat_value, stat_text) 
VALUES ('schema_created', 1, NOW()::TEXT) 
ON CONFLICT (stat_key) DO NOTHING;

-- =============================================================================
-- FINAL NOTES
-- =============================================================================

-- This schema supports:
-- - Millions of ticker combinations (A-ZZZZZ across multiple exchanges)
-- - High-performance queries with proper indexing
-- - Real-time quote data with 40+ financial metrics
-- - Historical data analysis and backtesting
-- - Comprehensive metadata tracking
-- - Statistics caching for fast dashboard performance
-- - Easy maintenance and monitoring

-- Recommended workflow after applying this schema:
-- 1. Generate ticker combinations: npm run generate
-- 2. Validate tickers: npm run validate  
-- 3. Gather market data: npm run gather
-- 4. Export data: Use web interface or npm run export

-- For production deployments:
-- - Regularly run maintenance_vacuum_analyze()
-- - Monitor database size with get_database_size_info()
-- - Set up automated backups
-- - Consider read replicas for analytics workloads