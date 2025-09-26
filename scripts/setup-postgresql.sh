#!/bin/bash

# PostgreSQL Setup Script for All-Tickers Project
# Creates database, user, schema, and stored procedures
# Compatible with macOS and Linux

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="all_tickers"
DB_USER="all_tickers_user"
DB_PASSWORD="A5LDIF/1mZjzAK+K4StR4HBpdQ36+zGZmqkvWj9RNHQ="
DB_HOST="localhost"
DB_PORT="5432"

echo -e "${BLUE}🐘 All-Tickers PostgreSQL Setup${NC}"
echo "=================================="

# Function to check if PostgreSQL is installed
check_postgresql() {
    if command -v psql > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL client found${NC}"
    else
        echo -e "${RED}❌ PostgreSQL client not found. Please install PostgreSQL first.${NC}"
        echo ""
        echo "On macOS with Homebrew:"
        echo "  brew install postgresql"
        echo ""
        echo "On Ubuntu/Debian:"
        echo "  sudo apt-get install postgresql postgresql-contrib"
        echo ""
        exit 1
    fi
}

# Function to check if PostgreSQL server is running
check_postgresql_server() {
    if pg_isready -h $DB_HOST -p $DB_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PostgreSQL server is running${NC}"
    else
        echo -e "${YELLOW}⚠️  PostgreSQL server is not running${NC}"
        echo ""
        echo "Start PostgreSQL server:"
        echo "On macOS with Homebrew:"
        echo "  brew services start postgresql"
        echo ""
        echo "On Ubuntu/Debian:"
        echo "  sudo systemctl start postgresql"
        echo ""
        read -p "Press Enter after starting PostgreSQL server..."
        
        # Check again
        if ! pg_isready -h $DB_HOST -p $DB_PORT > /dev/null 2>&1; then
            echo -e "${RED}❌ PostgreSQL server still not accessible${NC}"
            exit 1
        fi
    fi
}

# Function to create database and user
create_database_and_user() {
    echo -e "${BLUE}📊 Creating database and user...${NC}"
    
    # Create user and database using superuser access
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || {
        # Try alternative method for macOS
        psql postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || {
            echo -e "${YELLOW}⚠️  User may already exist, continuing...${NC}"
        }
    }
    
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || {
        # Try alternative method for macOS
        psql postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || {
            echo -e "${YELLOW}⚠️  Database may already exist, continuing...${NC}"
        }
    }
    
    # Grant necessary privileges
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || {
        psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || {
            echo -e "${YELLOW}⚠️  Privileges may already be granted, continuing...${NC}"
        }
    }
    
    echo -e "${GREEN}✅ Database and user created/verified${NC}"
}

# Function to create tables
create_tables() {
    echo -e "${BLUE}🏗️  Creating database schema...${NC}"
    
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
-- Create tickers table
CREATE TABLE IF NOT EXISTS tickers (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) NOT NULL UNIQUE,
    exchanges TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN DEFAULT false,
    price DECIMAL(10,4),
    last_updated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create ticker_quotes table
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

-- Create ticker_metadata table
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

-- Create ticker_historical table
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

-- Create ticker_financials table (optional for financial data)
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

EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Database schema created successfully${NC}"
    else
        echo -e "${RED}❌ Failed to create database schema${NC}"
        exit 1
    fi
}

# Function to create indexes for performance
create_indexes() {
    echo -e "${BLUE}📊 Creating performance indexes...${NC}"
    
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
-- Indexes for tickers table
CREATE INDEX IF NOT EXISTS idx_tickers_symbol ON tickers(symbol);
CREATE INDEX IF NOT EXISTS idx_tickers_exchanges ON tickers USING GIN(exchanges);
CREATE INDEX IF NOT EXISTS idx_tickers_active ON tickers(active);
CREATE INDEX IF NOT EXISTS idx_tickers_last_updated ON tickers(last_updated);

-- Indexes for ticker_quotes table
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_ticker_id ON ticker_quotes(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_quote_time ON ticker_quotes(quote_time);
CREATE INDEX IF NOT EXISTS idx_ticker_quotes_ticker_time ON ticker_quotes(ticker_id, quote_time);

-- Indexes for ticker_metadata table
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_ticker_id ON ticker_metadata(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_metadata_fetch_date ON ticker_metadata(fetch_date);

-- Indexes for ticker_historical table
CREATE INDEX IF NOT EXISTS idx_ticker_historical_ticker_id ON ticker_historical(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_trade_date ON ticker_historical(trade_date);
CREATE INDEX IF NOT EXISTS idx_ticker_historical_ticker_date ON ticker_historical(ticker_id, trade_date);

-- Indexes for ticker_financials table
CREATE INDEX IF NOT EXISTS idx_ticker_financials_ticker_id ON ticker_financials(ticker_id);
CREATE INDEX IF NOT EXISTS idx_ticker_financials_data_date ON ticker_financials(data_date);

EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Performance indexes created successfully${NC}"
    else
        echo -e "${RED}❌ Failed to create performance indexes${NC}"
        exit 1
    fi
}

# Function to install stored procedures
install_stored_procedures() {
    echo -e "${BLUE}⚙️  Installing stored procedures...${NC}"
    
    # Check if the stored procedures file exists
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    FUNCTIONS_FILE="$SCRIPT_DIR/create-array-functions.sql"
    
    if [ -f "$FUNCTIONS_FILE" ]; then
        echo -e "${GREEN}📄 Found stored procedures file: $FUNCTIONS_FILE${NC}"
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$FUNCTIONS_FILE"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Stored procedures installed successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  Some stored procedures may have failed to install${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Stored procedures file not found: $FUNCTIONS_FILE${NC}"
        echo -e "${YELLOW}   Stored procedures can be installed later using:${NC}"
        echo -e "${YELLOW}   PGPASSWORD=\$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f create-array-functions.sql${NC}"
    fi
}

# Function to create environment file template
create_env_template() {
    echo -e "${BLUE}📝 Creating environment configuration...${NC}"
    
    ENV_FILE="../.env"
    
    if [ -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}⚠️  .env file already exists, skipping creation${NC}"
        echo -e "${BLUE}   Current PostgreSQL configuration:${NC}"
        grep -E "^DB_" "$ENV_FILE" || echo -e "${YELLOW}   No DB_ variables found in existing .env${NC}"
    else
        cat > "$ENV_FILE" << EOF
# PostgreSQL Configuration
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Application Configuration
NODE_ENV=development
PORT=3000

# Optional: Memory settings for Node.js large datasets
NODE_OPTIONS=--max-old-space-size=8192
EOF
        
        echo -e "${GREEN}✅ Environment file created: $ENV_FILE${NC}"
        echo -e "${YELLOW}⚠️  IMPORTANT: Review and update the DB_PASSWORD in .env if needed${NC}"
    fi
}

# Function to verify installation
verify_installation() {
    echo -e "${BLUE}🔍 Verifying installation...${NC}"
    
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOF'
-- Check tables
SELECT 
    schemaname,
    tablename,
    hasindexes,
    hasrules,
    hastriggers
FROM pg_tables 
WHERE schemaname = 'public' 
    AND tablename IN ('tickers', 'ticker_quotes', 'ticker_metadata', 'ticker_historical', 'ticker_financials')
ORDER BY tablename;

-- Check indexes
SELECT 
    indexname,
    tablename,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
    AND tablename LIKE 'ticker%'
ORDER BY tablename, indexname;

-- Check functions
SELECT 
    proname as function_name,
    pronargs as num_args,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    AND proname LIKE '%ticker%'
ORDER BY proname;

EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Installation verification completed${NC}"
    else
        echo -e "${RED}❌ Verification failed${NC}"
        exit 1
    fi
}

# Function to display connection information
show_connection_info() {
    echo ""
    echo -e "${GREEN}🎉 PostgreSQL Setup Complete!${NC}"
    echo "=================================="
    echo ""
    echo -e "${BLUE}Database Connection Details:${NC}"
    echo "  Host: $DB_HOST"
    echo "  Port: $DB_PORT"
    echo "  Database: $DB_NAME"
    echo "  User: $DB_USER"
    echo ""
    echo -e "${BLUE}Connect manually using:${NC}"
    echo "  PGPASSWORD='$DB_PASSWORD' psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "1. Review the generated .env file and update settings as needed"
    echo "2. Start your Node.js application: npm start"
    echo "3. Generate ticker combinations: node src/db/generate-tickers.js"
    echo "4. Begin ticker data collection and validation"
    echo ""
    echo -e "${YELLOW}⚠️  Remember to backup your database regularly!${NC}"
}

# Main execution
main() {
    echo -e "${BLUE}Starting PostgreSQL setup process...${NC}"
    
    check_postgresql
    check_postgresql_server
    create_database_and_user
    create_tables
    create_indexes
    install_stored_procedures
    create_env_template
    verify_installation
    show_connection_info
    
    echo -e "${GREEN}✅ Setup completed successfully!${NC}"
}

# Run main function
main