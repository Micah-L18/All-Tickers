-- PostgreSQL Stored Procedures for Exchanges Array Schema
-- Run this after the database migration to create required functions

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

-- Function to get latest historical date by symbol (not exchange-specific)
CREATE OR REPLACE FUNCTION get_latest_historical_date_by_symbol(
    p_symbol TEXT
) RETURNS DATE AS $$
DECLARE
    v_latest_date DATE;
    v_ticker_id INTEGER;
BEGIN
    -- Get ticker ID
    SELECT id INTO v_ticker_id
    FROM tickers 
    WHERE symbol = p_symbol;
    
    IF v_ticker_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Get latest historical date
    SELECT MAX(trade_date) INTO v_latest_date
    FROM ticker_historical
    WHERE ticker_id = v_ticker_id;
    
    RETURN v_latest_date;
END;
$$ LANGUAGE plpgsql;

-- Function to upsert historical data by symbol (simplified)
CREATE OR REPLACE FUNCTION upsert_historical_data_by_symbol(
    p_symbol TEXT,
    p_trade_date DATE,
    p_open DECIMAL(10,4),
    p_high DECIMAL(10,4),
    p_low DECIMAL(10,4),
    p_close DECIMAL(10,4),
    p_adj_close DECIMAL(10,4),
    p_volume BIGINT
) RETURNS VOID AS $$
DECLARE
    v_ticker_id INTEGER;
BEGIN
    -- Get ticker ID
    SELECT id INTO v_ticker_id
    FROM tickers 
    WHERE symbol = p_symbol;
    
    IF v_ticker_id IS NULL THEN
        RAISE EXCEPTION 'Ticker % not found', p_symbol;
    END IF;
    
    -- Insert or update historical data
    INSERT INTO ticker_historical (ticker_id, trade_date, open_price, high_price, low_price, close_price, adj_close_price, volume)
    VALUES (v_ticker_id, p_trade_date, p_open, p_high, p_low, p_close, p_adj_close, p_volume)
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

-- Update the ticker generation function to work with exchanges array
CREATE OR REPLACE FUNCTION bulk_insert_tickers_array(
    p_tickers JSONB
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
    v_ticker JSONB;
    v_symbol TEXT;
    v_exchanges TEXT[];
BEGIN
    FOR v_ticker IN SELECT jsonb_array_elements(p_tickers)
    LOOP
        v_symbol := v_ticker->>'symbol';
        v_exchanges := ARRAY(SELECT jsonb_array_elements_text(v_ticker->'exchanges'));
        
        INSERT INTO tickers (symbol, exchanges, created_at)
        VALUES (v_symbol, v_exchanges, NOW())
        ON CONFLICT (symbol) DO UPDATE SET
            exchanges = (
                SELECT array_agg(DISTINCT unnest ORDER BY unnest)
                FROM (
                    SELECT unnest(tickers.exchanges) 
                    UNION 
                    SELECT unnest(EXCLUDED.exchanges)
                ) combined
            );
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to migrate existing ticker data to exchanges array format
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