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
    
    # Check if schema.sql exists
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    SCHEMA_FILE="$SCRIPT_DIR/../schema.sql"
    
    if [ -f "$SCHEMA_FILE" ]; then
        echo -e "${GREEN}📄 Using comprehensive schema file: schema.sql${NC}"
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$SCHEMA_FILE"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Database schema created successfully from schema.sql${NC}"
        else
            echo -e "${RED}❌ Failed to create database schema from schema.sql${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Schema file not found: $SCHEMA_FILE${NC}"
        echo -e "${YELLOW}Expected to find schema.sql in project root${NC}"
        exit 1
    fi
}

# Function to install stored procedures
install_stored_procedures() {
    echo -e "${BLUE}⚙️  Installing additional stored procedures...${NC}"
    
    # Check if the additional stored procedures file exists
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    FUNCTIONS_FILE="$SCRIPT_DIR/create-array-functions.sql"
    
    if [ -f "$FUNCTIONS_FILE" ]; then
        echo -e "${GREEN}📄 Found additional stored procedures file: $FUNCTIONS_FILE${NC}"
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$FUNCTIONS_FILE"
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Additional stored procedures installed successfully${NC}"
        else
            echo -e "${YELLOW}⚠️  Some additional stored procedures may have failed to install${NC}"
        fi
    else
        echo -e "${BLUE}ℹ️  Additional stored procedures file not found (schema.sql includes core functions)${NC}"
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
    install_stored_procedures
    create_env_template
    verify_installation
    show_connection_info
    
    echo -e "${GREEN}✅ Setup completed successfully!${NC}"
}

# Run main function
main