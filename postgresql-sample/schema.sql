-- All-Tickers PostgreSQL Schema
-- Efficient normalized design for financial data with incremental update support

-- Main tickers table (similar to current SQLite structure)
CREATE TABLE tickers (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL,
    exchange VARCHAR(10) NOT NULL,
    active BOOLEAN DEFAULT NULL,
    price DECIMAL(15,4) DEFAULT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, exchange)
);

-- Ticker metadata (version info, data source, etc.)
CREATE TABLE ticker_metadata (
    ticker_id INTEGER REFERENCES tickers(id) ON DELETE CASCADE,
    fetch_date TIMESTAMP WITH TIME ZONE NOT NULL,
    data_source VARCHAR(100) DEFAULT 'Yahoo Finance API',
    version VARCHAR(20) DEFAULT '2.0.0',
    had_validation_warnings BOOLEAN DEFAULT FALSE,
    historical_start_date DATE,
    historical_end_date DATE,
    historical_record_count INTEGER DEFAULT 0,
    summary_modules_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_id, fetch_date)
);

-- Real-time quote data (frequently updated)
CREATE TABLE ticker_quotes (
    ticker_id INTEGER REFERENCES tickers(id) ON DELETE CASCADE,
    quote_time TIMESTAMP WITH TIME ZONE NOT NULL,
    language VARCHAR(10) DEFAULT 'en-US',
    region VARCHAR(10) DEFAULT 'US',
    quote_type VARCHAR(20),
    currency VARCHAR(10) DEFAULT 'USD',
    exchange_name VARCHAR(50),
    market VARCHAR(50),
    
    -- Price data
    regular_market_price DECIMAL(15,4),
    regular_market_time TIMESTAMP WITH TIME ZONE,
    fifty_day_average DECIMAL(15,4),
    fifty_day_average_change DECIMAL(15,4),
    fifty_day_average_change_percent DECIMAL(10,6),
    two_hundred_day_average DECIMAL(15,4),
    two_hundred_day_average_change DECIMAL(15,4),
    two_hundred_day_average_change_percent DECIMAL(10,6),
    
    -- Market data
    market_cap BIGINT,
    shares_outstanding BIGINT,
    book_value DECIMAL(15,4),
    
    -- Dividend & yield data
    trailing_annual_dividend_yield DECIMAL(10,6),
    dividend_yield DECIMAL(10,6),
    
    -- EPS data
    eps_trailing_twelve_months DECIMAL(15,4),
    eps_forward DECIMAL(15,4),
    eps_current_year DECIMAL(15,4),
    price_eps_current_year DECIMAL(15,4),
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_id, quote_time)
);

-- Historical price data (append-only for incremental updates)
CREATE TABLE ticker_historical (
    ticker_id INTEGER REFERENCES tickers(id) ON DELETE CASCADE,
    trade_date DATE NOT NULL,
    open_price DECIMAL(15,4),
    high_price DECIMAL(15,4),
    low_price DECIMAL(15,4),
    close_price DECIMAL(15,4),
    adj_close_price DECIMAL(15,4),
    volume BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_id, trade_date)
);

-- Financial data (summary detail)
CREATE TABLE ticker_financials (
    ticker_id INTEGER REFERENCES tickers(id) ON DELETE CASCADE,
    data_date TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Valuation metrics
    market_cap BIGINT,
    enterprise_value BIGINT,
    trailing_pe DECIMAL(10,4),
    forward_pe DECIMAL(10,4),
    peg_ratio DECIMAL(10,4),
    price_to_sales_trailing DECIMAL(10,4),
    price_to_book DECIMAL(10,4),
    enterprise_to_revenue DECIMAL(10,4),
    enterprise_to_ebitda DECIMAL(10,4),
    
    -- Profitability
    profit_margins DECIMAL(10,6),
    operating_margins DECIMAL(10,6),
    return_on_assets DECIMAL(10,6),
    return_on_equity DECIMAL(10,6),
    
    -- Financial health
    total_cash BIGINT,
    total_cash_per_share DECIMAL(15,4),
    total_debt BIGINT,
    debt_to_equity DECIMAL(10,4),
    current_ratio DECIMAL(10,4),
    quick_ratio DECIMAL(10,4),
    
    -- Revenue & earnings
    total_revenue BIGINT,
    revenue_per_share DECIMAL(15,4),
    revenue_growth DECIMAL(10,6),
    earnings_growth DECIMAL(10,6),
    gross_profits BIGINT,
    ebitda BIGINT,
    operating_cashflow BIGINT,
    free_cashflow BIGINT,
    
    -- Analyst data
    target_high_price DECIMAL(15,4),
    target_low_price DECIMAL(15,4),
    target_mean_price DECIMAL(15,4),
    target_median_price DECIMAL(15,4),
    recommendation_mean DECIMAL(4,2),
    recommendation_key VARCHAR(20),
    number_of_analyst_opinions INTEGER,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_id, data_date)
);

-- Historical statistics (calculated fields)
CREATE TABLE ticker_statistics (
    ticker_id INTEGER REFERENCES tickers(id) ON DELETE CASCADE,
    calculation_date TIMESTAMP WITH TIME ZONE NOT NULL,
    total_days INTEGER,
    average_close DECIMAL(15,4),
    highest_close DECIMAL(15,4),
    lowest_close DECIMAL(15,4),
    average_volume BIGINT,
    price_change_percent DECIMAL(10,6),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker_id, calculation_date)
);

-- Indexes for performance
CREATE INDEX idx_tickers_symbol ON tickers(symbol);
CREATE INDEX idx_tickers_active ON tickers(active);
CREATE INDEX idx_tickers_last_updated ON tickers(last_updated);

CREATE INDEX idx_ticker_quotes_time ON ticker_quotes(quote_time);
CREATE INDEX idx_ticker_quotes_ticker_time ON ticker_quotes(ticker_id, quote_time DESC);

CREATE INDEX idx_ticker_historical_date ON ticker_historical(trade_date);
CREATE INDEX idx_ticker_historical_ticker_date ON ticker_historical(ticker_id, trade_date DESC);

CREATE INDEX idx_ticker_financials_date ON ticker_financials(data_date);
CREATE INDEX idx_ticker_metadata_fetch_date ON ticker_metadata(fetch_date);

-- Partitioning for historical data (monthly partitions)
-- This will help with performance as historical data grows
CREATE TABLE ticker_historical_template (LIKE ticker_historical INCLUDING ALL);

-- Function to create monthly partitions automatically
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    end_date date;
BEGIN
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + interval '1 month';
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I 
                    FOR VALUES FROM (%L) TO (%L)',
                   partition_name, table_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;

-- Create partitions for historical data (last 5 years + current year)
DO $$
DECLARE
    start_date date := '2020-01-01';
    current_date date := CURRENT_DATE;
BEGIN
    WHILE start_date <= current_date + interval '1 month' LOOP
        PERFORM create_monthly_partition('ticker_historical', start_date);
        start_date := start_date + interval '1 month';
    END LOOP;
END $$;

-- Convert historical table to partitioned
ALTER TABLE ticker_historical RENAME TO ticker_historical_old;
CREATE TABLE ticker_historical (
    LIKE ticker_historical_old INCLUDING ALL
) PARTITION BY RANGE (trade_date);

-- Create the partitions we defined above
DO $$
DECLARE
    start_date date := '2020-01-01';
    current_date date := CURRENT_DATE;
BEGIN
    WHILE start_date <= current_date + interval '1 month' LOOP
        PERFORM create_monthly_partition('ticker_historical', start_date);
        start_date := start_date + interval '1 month';
    END LOOP;
END $$;

-- Migrate data (uncomment when ready to migrate)
-- INSERT INTO ticker_historical SELECT * FROM ticker_historical_old;
-- DROP TABLE ticker_historical_old;

-- Views for common queries
CREATE VIEW v_latest_quotes AS
SELECT DISTINCT ON (t.symbol, t.exchange)
    t.symbol,
    t.exchange,
    t.active,
    tq.regular_market_price as current_price,
    tq.regular_market_time,
    tq.market_cap,
    tq.fifty_day_average,
    tq.two_hundred_day_average,
    tq.eps_trailing_twelve_months,
    tq.dividend_yield
FROM tickers t
LEFT JOIN ticker_quotes tq ON t.id = tq.ticker_id
ORDER BY t.symbol, t.exchange, tq.quote_time DESC;

CREATE VIEW v_latest_financials AS
SELECT DISTINCT ON (t.symbol, t.exchange)
    t.symbol,
    t.exchange,
    tf.market_cap,
    tf.trailing_pe,
    tf.price_to_book,
    tf.profit_margins,
    tf.return_on_equity,
    tf.total_revenue,
    tf.revenue_growth,
    tf.target_mean_price,
    tf.recommendation_key
FROM tickers t
LEFT JOIN ticker_financials tf ON t.id = tf.ticker_id
ORDER BY t.symbol, t.exchange, tf.data_date DESC;

-- Function to get ticker ID or create if not exists
CREATE OR REPLACE FUNCTION get_or_create_ticker_id(p_symbol VARCHAR, p_exchange VARCHAR)
RETURNS INTEGER AS $$
DECLARE
    ticker_id INTEGER;
BEGIN
    SELECT id INTO ticker_id FROM tickers WHERE symbol = p_symbol AND exchange = p_exchange;
    
    IF ticker_id IS NULL THEN
        INSERT INTO tickers (symbol, exchange) VALUES (p_symbol, p_exchange) RETURNING id INTO ticker_id;
    END IF;
    
    RETURN ticker_id;
END;
$$ LANGUAGE plpgsql;

-- Function to upsert historical data (incremental updates)
CREATE OR REPLACE FUNCTION upsert_historical_data(
    p_symbol VARCHAR,
    p_exchange VARCHAR,
    p_trade_date DATE,
    p_open DECIMAL,
    p_high DECIMAL,
    p_low DECIMAL,
    p_close DECIMAL,
    p_adj_close DECIMAL,
    p_volume BIGINT
)
RETURNS void AS $$
DECLARE
    ticker_id INTEGER;
BEGIN
    ticker_id := get_or_create_ticker_id(p_symbol, p_exchange);
    
    INSERT INTO ticker_historical (ticker_id, trade_date, open_price, high_price, low_price, close_price, adj_close_price, volume)
    VALUES (ticker_id, p_trade_date, p_open, p_high, p_low, p_close, p_adj_close, p_volume)
    ON CONFLICT (ticker_id, trade_date) 
    DO UPDATE SET
        open_price = EXCLUDED.open_price,
        high_price = EXCLUDED.high_price,
        low_price = EXCLUDED.low_price,
        close_price = EXCLUDED.close_price,
        adj_close_price = EXCLUDED.adj_close_price,
        volume = EXCLUDED.volume;
END;
$$ LANGUAGE plpgsql;

-- Function to get latest historical date for a ticker (for incremental updates)
CREATE OR REPLACE FUNCTION get_latest_historical_date(p_symbol VARCHAR, p_exchange VARCHAR)
RETURNS DATE AS $$
DECLARE
    latest_date DATE;
    ticker_id INTEGER;
BEGIN
    SELECT id INTO ticker_id FROM tickers WHERE symbol = p_symbol AND exchange = p_exchange;
    
    IF ticker_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    SELECT MAX(trade_date) INTO latest_date FROM ticker_historical WHERE ticker_id = ticker_id;
    
    RETURN latest_date;
END;
$$ LANGUAGE plpgsql;
