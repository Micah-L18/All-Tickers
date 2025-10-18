// Database factory to create SQLite database manager
const config = require('../config/database');

async function createDatabaseManager() {
    console.log('🗄️  Initializing SQLite database manager...');
    
    const SQLiteManager = require('./sqlite-manager');
    const manager = new SQLiteManager(config.sqlite);
    await manager.connect();
    await manager.initializeSchema();
    return manager;
}

module.exports = { createDatabaseManager };