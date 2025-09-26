const PostgreSQLManager = require('./database-manager');

class StatsCache {
    constructor(existingDbManager = null) {
        this.dbManager = existingDbManager;
        this.ownsDatabaseManager = !existingDbManager; // Only close if we created it
    }

    async initialize() {
        if (!this.dbManager) {
            this.dbManager = new PostgreSQLManager();
            await this.dbManager.connect();
        } else if (!this.dbManager.isConnected) {
            await this.dbManager.connect();
        }
        await this.createStatsCacheTable();
    }

    /**
     * Create the stats cache table if it doesn't exist
     */
    async createStatsCacheTable() {
        const createQuery = `
            CREATE TABLE IF NOT EXISTS stats_cache (
                id SERIAL PRIMARY KEY,
                stat_key VARCHAR(100) UNIQUE NOT NULL,
                stat_value BIGINT NOT NULL,
                stat_text VARCHAR(255),
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Create index for faster lookups
            CREATE INDEX IF NOT EXISTS idx_stats_cache_key ON stats_cache(stat_key);
            CREATE INDEX IF NOT EXISTS idx_stats_cache_updated ON stats_cache(last_updated);
        `;

        try {
            await this.dbManager.query(createQuery);
            console.log('✅ Stats cache table created/verified');
        } catch (error) {
            console.error('❌ Error creating stats cache table:', error);
            throw error;
        }
    }

    /**
     * Get cached statistics (fast lookup from cache table)
     */
    async getCachedStats() {
        const query = `SELECT stat_key, stat_value, stat_text, last_updated FROM stats_cache`;
        const result = await this.dbManager.query(query);
        
        // Transform into expected format
        const stats = {};
        result.rows.forEach(row => {
            const value = row.stat_text || row.stat_value.toString();
            stats[row.stat_key] = value;
            stats[row.stat_key + '_updated'] = row.last_updated;
        });

        // Add cache age for monitoring
        if (result.rows.length > 0) {
            const oldestUpdate = result.rows.reduce((oldest, row) => 
                !oldest || row.last_updated < oldest ? row.last_updated : oldest, null);
            stats.cache_age_minutes = oldestUpdate ? 
                Math.round((new Date() - new Date(oldestUpdate)) / (1000 * 60)) : 0;
        }

        return stats;
    }

    /**
     * Update or insert a stat in the cache
     */
    async updateStat(key, value, textValue = null) {
        const query = `
            INSERT INTO stats_cache (stat_key, stat_value, stat_text, last_updated)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (stat_key) 
            DO UPDATE SET 
                stat_value = EXCLUDED.stat_value,
                stat_text = EXCLUDED.stat_text,
                last_updated = EXCLUDED.last_updated
        `;

        const numericValue = typeof value === 'number' ? value : parseInt(value) || 0;
        await this.dbManager.query(query, [key, numericValue, textValue]);
    }

    /**
     * Recalculate and update all statistics in cache (expensive operation)
     */
    async refreshAllStats() {
        console.log('🔄 Refreshing statistics cache...');
        const startTime = Date.now();

        try {
            // Calculate all statistics using the original complex queries
            const [
                mainStats,
                historicalStats,
                exchangeCount,
                databaseSize
            ] = await Promise.all([
                this.calculateMainStats(),
                this.calculateHistoricalStats(), 
                this.calculateExchangeCount(),
                this.calculateDatabaseSize()
            ]);

            // Update all stats in cache
            await this.updateStat('total', mainStats.total);
            await this.updateStat('active_count', mainStats.active_count);
            await this.updateStat('inactive_count', mainStats.inactive_count);
            await this.updateStat('unvalidated_count', mainStats.unvalidated_count);
            await this.updateStat('validated_count', mainStats.validated_count);
            await this.updateStat('historical_count', historicalStats.historical_count);
            await this.updateStat('total_historical_records', historicalStats.total_historical_records);
            await this.updateStat('total_exchanges', exchangeCount);
            await this.updateStat('database_size', 0, databaseSize);

            // Update refresh timestamp
            await this.updateStat('last_refresh', Date.now(), new Date().toISOString());

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ Stats cache refreshed in ${duration}s`);

        } catch (error) {
            console.error('❌ Error refreshing stats cache:', error);
            throw error;
        }
    }

    /**
     * Calculate main ticker statistics
     */
    async calculateMainStats() {
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN active = true THEN 1 END) as active_count,
                COUNT(CASE WHEN active = false THEN 1 END) as inactive_count,
                COUNT(CASE WHEN active IS NULL THEN 1 END) as unvalidated_count,
                COUNT(CASE WHEN price IS NOT NULL THEN 1 END) as validated_count
            FROM tickers
        `;
        
        const result = await this.dbManager.query(query);
        return result.rows[0];
    }

    /**
     * Calculate historical data statistics
     */
    async calculateHistoricalStats() {
        const query = `
            SELECT 
                COUNT(DISTINCT ticker_id) as historical_count,
                COUNT(*) as total_historical_records
            FROM ticker_historical
        `;
        
        const result = await this.dbManager.query(query);
        return result.rows[0];
    }

    /**
     * Calculate total unique exchanges
     */
    async calculateExchangeCount() {
        const query = `
            SELECT COUNT(DISTINCT exchange) as count 
            FROM (SELECT unnest(exchanges) as exchange FROM tickers) t
        `;
        
        const result = await this.dbManager.query(query);
        return parseInt(result.rows[0].count);
    }

    /**
     * Calculate database size
     */
    async calculateDatabaseSize() {
        try {
            const query = `SELECT pg_database_size(current_database()) as size_bytes`;
            const result = await this.dbManager.query(query);
            const sizeBytes = parseInt(result.rows[0].size_bytes);
            return this.formatDatabaseSize(sizeBytes);
        } catch (error) {
            console.log('Could not get database size:', error.message);
            return 'Unknown';
        }
    }

    /**
     * Format database size for display
     */
    formatDatabaseSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const formatted = parseFloat((bytes / Math.pow(1024, i)).toFixed(2));
        return formatted + ' ' + sizes[i];
    }

    /**
     * Check if cached stats need refreshing
     * @returns {boolean} True if refresh needed
     */
    async needsRefresh() {
        try {
            const query = 'SELECT last_updated FROM stats_cache LIMIT 1';
            const result = await this.dbManager.query(query);
            
            if (result.rows.length === 0) {
                return true; // No cached data, need refresh
            }
            
            const lastUpdated = new Date(result.rows[0].last_updated);
            const now = new Date();
            const ageInSeconds = (now - lastUpdated) / 1000;
            
            // Refresh if older than 30 minutes (1800 seconds) to prevent conflicts during long exports
            return ageInSeconds > 1800;
        } catch (error) {
            console.error('❌ Error checking cache freshness:', error);
            return true; // Assume refresh needed on error
        }
    }

    /**
     * Close database connection
     */
    async close() {
        if (this.dbManager && this.ownsDatabaseManager) {
            await this.dbManager.disconnect();
        }
    }
}

module.exports = StatsCache;