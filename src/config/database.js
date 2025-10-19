// Database configuration for All-Tickers project
// SQLite-only configuration

const path = require('path');

// Determine the base directory for the database
// Priority: SQLITE_DATABASE (full path) > DB_DIR (directory) > current working directory
let databasePath;
if (process.env.SQLITE_DATABASE) {
    // Use the full path if provided
    databasePath = process.env.SQLITE_DATABASE;
} else if (process.env.DB_DIR) {
    // Use specified directory
    databasePath = path.join(process.env.DB_DIR, 'ticker_data.db');
} else {
    // Default to current working directory
    databasePath = path.join(process.cwd(), 'ticker_data.db');
}

const config = {
    // SQLite configuration
    sqlite: {
        database: databasePath,
        maxRetries: 3,
        retryDelay: 1000
    },
    
    // General settings
    maxRetries: 3,
    retryDelay: 1000
};

module.exports = config;