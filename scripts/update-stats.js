#!/usr/bin/env node

/**
 * Background Stats Updater
 * 
 * This script refreshes the statistics cache in the background.
 * Can be run as a scheduled task (cron job) or standalone script.
 */

const StatsCache = require('../src/db/stats-cache');

class BackgroundStatsUpdater {
    constructor() {
        this.statsCache = null;
    }

    async initialize() {
        this.statsCache = new StatsCache();
        await this.statsCache.initialize();
    }

    /**
     * Refresh statistics cache
     */
    async refreshStats() {
        console.log('🔄 Background Stats Updater - Starting refresh...');
        const startTime = Date.now();

        try {
            await this.statsCache.refreshAllStats();
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ Background stats refresh completed in ${duration}s`);
            
            // Log current cached stats
            const stats = await this.statsCache.getCachedStats();
            console.log(`📊 Updated stats: Active: ${stats.active_count}, Inactive: ${stats.inactive_count}, Total: ${stats.total}`);
            
        } catch (error) {
            console.error('❌ Background stats refresh failed:', error);
            throw error;
        }
    }

    /**
     * Check cache status and age
     */
    async checkCacheStatus() {
        try {
            const stats = await this.statsCache.getCachedStats();
            const needsRefresh = await this.statsCache.needsRefresh(60);
            
            console.log(`📊 Cache Status:`);
            console.log(`   Age: ${stats.cache_age_minutes || 0} minutes`);
            console.log(`   Needs refresh: ${needsRefresh ? 'Yes' : 'No'}`);
            console.log(`   Last refresh: ${stats.last_refresh || 'Never'}`);
            
            if (Object.keys(stats).length > 0) {
                console.log(`   Active tickers: ${stats.active_count || 'N/A'}`);
                console.log(`   Total tickers: ${stats.total || 'N/A'}`);
                console.log(`   Database size: ${stats.database_size || 'N/A'}`);
            }
            
        } catch (error) {
            console.error('❌ Error checking cache status:', error);
        }
    }

    /**
     * Run continuous background updater (updates every 5 seconds)
     */
    async runContinuous() {
        console.log('🚀 Starting continuous background stats updater...');
        console.log('   Updates every 5 seconds');
        console.log('   Press Ctrl+C to stop\n');

        // Initial refresh
        await this.refreshStats();

        // Schedule updates every 5 seconds
        const updateInterval = setInterval(async () => {
            try {
                await this.refreshStats();
            } catch (error) {
                console.error('❌ Scheduled refresh failed:', error);
            }
        }, 5 * 1000); // 5 seconds

        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            clearInterval(updateInterval);
            await this.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            clearInterval(updateInterval);
            await this.close();
            process.exit(0);
        });
    }

    async close() {
        if (this.statsCache) {
            await this.statsCache.close();
        }
    }
}

// Command line interface
async function main() {
    const updater = new BackgroundStatsUpdater();
    
    try {
        await updater.initialize();
        
        const args = process.argv.slice(2);
        
        if (args.includes('--help') || args.includes('-h')) {
            console.log('📊 Background Stats Updater');
            console.log('=' .repeat(50));
            console.log('Refreshes the statistics cache in the background for faster page loads');
            console.log('');
            console.log('Usage: node update-stats.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --status, -s    Check current cache status');
            console.log('  --refresh, -r   Refresh stats cache once and exit');
            console.log('  --continuous, -c Run continuous updater (every 60 minutes)');
            console.log('  --help, -h      Show this help message');
            console.log('');
            console.log('Examples:');
            console.log('  node update-stats.js --refresh     # Refresh once');
            console.log('  node update-stats.js --continuous  # Run continuously');
            console.log('  node update-stats.js --status      # Check cache status');
            return;
        }
        
        if (args.includes('--status') || args.includes('-s')) {
            console.log('📊 Background Stats Updater - Status Check');
            console.log('=' .repeat(50));
            await updater.checkCacheStatus();
        } else if (args.includes('--continuous') || args.includes('-c')) {
            await updater.runContinuous();
        } else {
            // Default: single refresh
            console.log('📊 Background Stats Updater - Single Refresh');
            console.log('=' .repeat(50));
            await updater.refreshStats();
        }
        
    } catch (error) {
        console.error('❌ Background stats updater error:', error);
        process.exit(1);
    } finally {
        await updater.close();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = BackgroundStatsUpdater;