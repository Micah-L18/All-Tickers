#!/bin/bash

# All-Tickers PostgreSQL Setup Script
# This script sets up PostgreSQL for the All-Tickers application

set -e  # Exit on any error

# Configuration
DB_NAME="all_tickers"
DB_USER="all_tickers_user"
DB_HOST="localhost"
DB_PORT="5432"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if PostgreSQL is installed
check_postgresql() {
    log "Checking PostgreSQL installation..."
    
    if ! command -v psql &> /dev/null; then
        error "PostgreSQL is not installed. Please install PostgreSQL first."
    fi
    
    if ! command -v createdb &> /dev/null; then
        error "PostgreSQL client tools are not installed."
    fi
    
    success "PostgreSQL is installed and available"
}

# Check if PostgreSQL service is running
check_postgresql_service() {
    log "Checking PostgreSQL service status..."
    
    # Try to connect to PostgreSQL
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" &> /dev/null; then
        error "PostgreSQL service is not running. Please start PostgreSQL first."
    fi
    
    success "PostgreSQL service is running"
}

# Create database user
create_user() {
    log "Creating database user: $DB_USER"
    
    # Check if user already exists
    if psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
        warning "User $DB_USER already exists, skipping creation"
    else
        # Generate a random password
        DB_PASSWORD=$(openssl rand -base64 32)
        
        # Create the user
        psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
        
        # Grant necessary privileges
        psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "ALTER USER $DB_USER CREATEDB;"
        
        success "User $DB_USER created successfully"
        
        # Save credentials to .env file
        echo "# PostgreSQL Configuration" > "$SCRIPT_DIR/.env"
        echo "DB_HOST=$DB_HOST" >> "$SCRIPT_DIR/.env"
        echo "DB_PORT=$DB_PORT" >> "$SCRIPT_DIR/.env"
        echo "DB_NAME=$DB_NAME" >> "$SCRIPT_DIR/.env"
        echo "DB_USER=$DB_USER" >> "$SCRIPT_DIR/.env"
        echo "DB_PASSWORD=$DB_PASSWORD" >> "$SCRIPT_DIR/.env"
        
        success "Database credentials saved to .env file"
    fi
}

# Create database
create_database() {
    log "Creating database: $DB_NAME"
    
    # Check if database already exists
    if psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
        warning "Database $DB_NAME already exists"
        read -p "Do you want to recreate it? This will delete all existing data! (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log "Dropping existing database..."
            psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "DROP DATABASE $DB_NAME;"
        else
            log "Keeping existing database"
            return 0
        fi
    fi
    
    # Create the database
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
    
    # Grant all privileges to the user
    psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
    
    success "Database $DB_NAME created successfully"
}

# Run schema creation
create_schema() {
    log "Creating database schema..."
    
    if [ ! -f "$SCRIPT_DIR/schema.sql" ]; then
        error "Schema file not found: $SCRIPT_DIR/schema.sql"
    fi
    
    # Run the schema file
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SCRIPT_DIR/schema.sql"
    
    success "Database schema created successfully"
}

# Test database connection
test_connection() {
    log "Testing database connection..."
    
    # Source the .env file if it exists
    if [ -f "$SCRIPT_DIR/.env" ]; then
        source "$SCRIPT_DIR/.env"
    fi
    
    # Test connection
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" > /dev/null
    
    success "Database connection test successful"
}

# Create sample configuration files
create_config_files() {
    log "Creating configuration files..."
    
    # Create a connection test script
    cat > "$SCRIPT_DIR/test-connection.js" << 'EOF'
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('✅ Connection successful!');
        console.log('Current time:', result.rows[0].now);
        
        // Test a simple query
        const tickerCount = await client.query('SELECT COUNT(*) FROM tickers');
        console.log('Tickers table exists with', tickerCount.rows[0].count, 'records');
        
        client.release();
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
    } finally {
        pool.end();
    }
}

testConnection();
EOF
    
    # Create a package.json for dependencies
    cat > "$SCRIPT_DIR/package.json" << EOF
{
  "name": "all-tickers-postgresql",
  "version": "1.0.0",
  "description": "PostgreSQL setup for All-Tickers application",
  "main": "database-manager.js",
  "scripts": {
    "test": "node test-connection.js",
    "setup": "./setup-postgresql.sh"
  },
  "dependencies": {
    "pg": "^8.11.0",
    "dotenv": "^16.0.0"
  },
  "keywords": ["postgresql", "finance", "tickers"],
  "author": "All-Tickers",
  "license": "MIT"
}
EOF
    
    success "Configuration files created"
}

# Install Node.js dependencies
install_dependencies() {
    log "Installing Node.js dependencies..."
    
    cd "$SCRIPT_DIR"
    
    if command -v npm &> /dev/null; then
        npm install
        success "Dependencies installed successfully"
    else
        warning "npm not found. Please install Node.js dependencies manually: npm install"
    fi
}

# Display completion message
show_completion_message() {
    echo
    echo "🎉 PostgreSQL setup completed successfully!"
    echo
    echo "Database Information:"
    echo "  Host: $DB_HOST"
    echo "  Port: $DB_PORT"
    echo "  Database: $DB_NAME"
    echo "  User: $DB_USER"
    echo "  Password: (saved in .env file)"
    echo
    echo "Next Steps:"
    echo "1. Test the connection: npm test"
    echo "2. Review the database schema in schema.sql"
    echo "3. Update your application to use the new database"
    echo "4. Run data migration from SQLite"
    echo
    echo "Files created:"
    echo "  📄 .env - Database configuration"
    echo "  📄 package.json - Node.js dependencies"
    echo "  📄 test-connection.js - Connection test script"
    echo "  📄 schema.sql - Database schema"
    echo "  📄 database-manager.js - Database operations (if exists)"
    echo
    echo "⚠️  Remember to:"
    echo "   - Keep the .env file secure (add to .gitignore)"
    echo "   - Backup your database regularly"
    echo "   - Monitor performance after migration"
}

# Main execution
main() {
    log "Starting All-Tickers PostgreSQL setup..."
    
    check_postgresql
    check_postgresql_service
    
    # Get database password if user exists
    if psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
        if [ -f "$SCRIPT_DIR/.env" ]; then
            source "$SCRIPT_DIR/.env"
            log "Using existing credentials from .env file"
        else
            read -s -p "Enter password for existing user $DB_USER: " DB_PASSWORD
            echo
        fi
    else
        create_user
        source "$SCRIPT_DIR/.env"  # Load the newly created credentials
    fi
    
    create_database
    create_schema
    test_connection
    create_config_files
    install_dependencies
    show_completion_message
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "All-Tickers PostgreSQL Setup Script"
        echo
        echo "Usage: $0 [options]"
        echo
        echo "Options:"
        echo "  --help, -h     Show this help message"
        echo "  --test         Test database connection only"
        echo "  --schema-only  Create schema only (assumes DB exists)"
        echo
        echo "Environment Variables:"
        echo "  DB_NAME        Database name (default: all_tickers)"
        echo "  DB_USER        Database user (default: all_tickers_user)"
        echo "  DB_HOST        Database host (default: localhost)"
        echo "  DB_PORT        Database port (default: 5432)"
        ;;
    --test)
        test_connection
        ;;
    --schema-only)
        if [ -f "$SCRIPT_DIR/.env" ]; then
            source "$SCRIPT_DIR/.env"
        fi
        create_schema
        ;;
    *)
        main
        ;;
esac
