// Database configuration for All-Tickers project
// SQLite-only configuration

const path = require('path');

const config = {
    // SQLite configuration
    sqlite: {
        database: process.env.SQLITE_DATABASE || path.join(process.cwd(), 'ticker_data.db'),
        maxRetries: 3,
        retryDelay: 1000
    },
    
    // General settings
    maxRetries: 3,
    retryDelay: 1000
};

module.exports = config;