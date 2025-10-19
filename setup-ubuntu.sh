#!/bin/bash
# Quick setup script for All-Tickers on Ubuntu Server

set -e

echo "🚀 All-Tickers Ubuntu Setup Script"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    echo "❌ Please do not run as root. Run as your regular user."
    exit 1
fi

# Get current directory
INSTALL_DIR=$(pwd)
echo "📁 Installation directory: $INSTALL_DIR"

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Setup environment
if [ ! -f .env ]; then
    echo ""
    echo "⚙️  Setting up environment configuration..."
    cp .env.example .env
    
    # Prompt for database location
    echo ""
    echo "Where would you like to store the database?"
    echo "1) Current directory (${INSTALL_DIR}/ticker_data.db)"
    echo "2) /var/lib/all-tickers/ticker_data.db"
    echo "3) Custom location"
    read -p "Enter choice (1-3): " DB_CHOICE
    
    case $DB_CHOICE in
        2)
            DB_DIR="/var/lib/all-tickers"
            echo ""
            echo "Creating database directory: $DB_DIR"
            sudo mkdir -p "$DB_DIR"
            sudo chown $USER:$USER "$DB_DIR"
            chmod 755 "$DB_DIR"
            
            # Update .env file
            sed -i "s|#DB_DIR=/var/lib/all-tickers|DB_DIR=$DB_DIR|g" .env
            sed -i "s|SQLITE_DATABASE=/path/to/your/ticker_data.db|#SQLITE_DATABASE=/path/to/your/ticker_data.db|g" .env
            ;;
        3)
            read -p "Enter custom database path (full path including filename): " CUSTOM_DB
            sed -i "s|SQLITE_DATABASE=/path/to/your/ticker_data.db|SQLITE_DATABASE=$CUSTOM_DB|g" .env
            
            # Create directory if it doesn't exist
            DB_DIR=$(dirname "$CUSTOM_DB")
            if [ ! -d "$DB_DIR" ]; then
                echo "Creating directory: $DB_DIR"
                mkdir -p "$DB_DIR"
            fi
            ;;
        *)
            echo "Using current directory for database"
            sed -i "s|SQLITE_DATABASE=/path/to/your/ticker_data.db|#SQLITE_DATABASE=$INSTALL_DIR/ticker_data.db|g" .env
            ;;
    esac
    
    # Set access codes
    echo ""
    read -p "Enter ACCESS_CODE (default: 007): " ACCESS_CODE
    ACCESS_CODE=${ACCESS_CODE:-007}
    sed -i "s|ACCESS_CODE=007|ACCESS_CODE=$ACCESS_CODE|g" .env
    
    read -p "Enter PROCESS_KILL_CODE (default: 007): " KILL_CODE
    KILL_CODE=${KILL_CODE:-007}
    sed -i "s|PROCESS_KILL_CODE=007|PROCESS_KILL_CODE=$KILL_CODE|g" .env
    
    echo "✅ Environment configured"
else
    echo "⚠️  .env file already exists, skipping configuration"
fi

# Test database connection
echo ""
echo "🧪 Testing database connection..."
node -e "
const { createDatabaseManager } = require('./src/db/database-factory');
(async () => {
    try {
        const db = await createDatabaseManager();
        console.log('✅ Database connection successful!');
        await db.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
})();
"

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Database setup failed. Please check permissions and try again."
    exit 1
fi

echo ""
echo "=================================="
echo "✅ Setup Complete!"
echo "=================================="
echo ""
echo "To start the server manually:"
echo "  npm start"
echo ""
echo "To set up as a systemd service:"
echo "  See docs/DEPLOYMENT.md for instructions"
echo ""
echo "To set up with PM2:"
echo "  npm install -g pm2"
echo "  pm2 start server.js --name all-tickers --max-memory-restart 8G"
echo "  pm2 save"
echo "  pm2 startup"
echo ""
echo "Dashboard will be available at: http://localhost:3001"
echo ""
