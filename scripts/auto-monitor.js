#!/usr/bin/env node
/**
 * Automatic Monitoring Script
 * Checks every minute for tickers that need validation or data updates
 * Automatically runs the appropriate scripts when needed
 */

const { createDatabaseManager } = require('../src/db/database-factory');
const { spawn } = require('child_process');
const path = require('path');

class AutoMonitor {
    constructor() {
        this.dbManager = null;
        this.checkInterval = 60000; // 60 seconds
        this.runningProcesses = new Set(); // Track what's currently running
        this.checkTimer = null;
        
        // Thresholds for automated actions
        this.validationThreshold = 10; // Run validation if 10+ tickers need validation
        this.dataUpdateThreshold = 50; // Run gather if 50+ tickers need data updates
        this.hoursThreshold = 24; // Consider tickers older than 24 hours for updates
    }

    async initialize() {
        console.log('🤖 Auto-Monitor Starting...');
        console.log('=' .repeat(50));
        
        this.dbManager = await createDatabaseManager();
        console.log('✅ Database connected');
        
        console.log(`⏱️  Check interval: ${this.checkInterval / 1000} seconds`);
        console.log(`📊 Validation threshold: ${this.validationThreshold} unvalidated tickers`);
        console.log(`📈 Data update threshold: ${this.dataUpdateThreshold} tickers needing updates`);
        console.log(`🕒 Update age threshold: ${this.hoursThreshold} hours`);
        console.log('=' .repeat(50));
    }

    async getStats() {
        try {
            // Get counts for unvalidated tickers
            const unvalidatedQuery = `
                SELECT COUNT(*) as count
                FROM tickers
                WHERE active IS NULL
            `;
            const unvalidatedResult = await this.dbManager.query(unvalidatedQuery);
            const unvalidatedCount = unvalidatedResult.rows[0].count;

            // Get counts for tickers needing data updates (active and old)
            const needUpdateQuery = `
                SELECT COUNT(*) as count
                FROM tickers
                WHERE active = 1
                    AND (updated_at IS NULL OR updated_at < datetime('now', '-${this.hoursThreshold} hours'))
            `;
            const needUpdateResult = await this.dbManager.query(needUpdateQuery);
            const needUpdateCount = needUpdateResult.rows[0].count;

            return {
                unvalidated: unvalidatedCount,
                needUpdate: needUpdateCount
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error.message);
            return { unvalidated: 0, needUpdate: 0 };
        }
    }

    isScriptRunning(scriptName) {
        return this.runningProcesses.has(scriptName);
    }

    runScript(scriptName, scriptPath) {
        return new Promise((resolve, reject) => {
            console.log(`\n🚀 Starting ${scriptName}...`);
            this.runningProcesses.add(scriptName);

            const startTime = Date.now();
            const child = spawn('node', ['--max-old-space-size=10240', scriptPath], {
                cwd: path.join(__dirname, '..'),
                stdio: 'inherit'
            });

            child.on('close', (code) => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                this.runningProcesses.delete(scriptName);
                
                if (code === 0) {
                    console.log(`✅ ${scriptName} completed successfully in ${duration}s`);
                    resolve(code);
                } else {
                    console.log(`⚠️  ${scriptName} exited with code ${code} after ${duration}s`);
                    resolve(code); // Still resolve to continue monitoring
                }
            });

            child.on('error', (error) => {
                this.runningProcesses.delete(scriptName);
                console.error(`❌ Error running ${scriptName}:`, error.message);
                reject(error);
            });
        });
    }

    async checkAndAct() {
        const timestamp = new Date().toLocaleString();
        console.log(`\n⏰ [${timestamp}] Checking for tasks...`);

        try {
            const stats = await this.getStats();
            console.log(`📊 Status: ${stats.unvalidated} unvalidated, ${stats.needUpdate} need updates`);

            // Check if validation is needed and not already running
            if (stats.unvalidated >= this.validationThreshold) {
                if (!this.isScriptRunning('validate')) {
                    console.log(`🔍 Found ${stats.unvalidated} unvalidated tickers (threshold: ${this.validationThreshold})`);
                    await this.runScript('validate', path.join(__dirname, '../src/validate/validate-tickers.js'));
                } else {
                    console.log(`⏳ Validation already running, skipping...`);
                }
            }

            // Check if data gathering is needed and not already running
            if (stats.needUpdate >= this.dataUpdateThreshold) {
                if (!this.isScriptRunning('gather')) {
                    console.log(`📥 Found ${stats.needUpdate} tickers needing updates (threshold: ${this.dataUpdateThreshold})`);
                    await this.runScript('gather', path.join(__dirname, '../src/return-data/return-data.js'));
                } else {
                    console.log(`⏳ Data gathering already running, skipping...`);
                }
            }

            // If nothing needs to be done
            if (stats.unvalidated < this.validationThreshold && stats.needUpdate < this.dataUpdateThreshold) {
                console.log(`✅ All systems nominal - no action needed`);
            }

        } catch (error) {
            console.error('❌ Error during check:', error.message);
        }
    }

    start() {
        console.log('\n🟢 Auto-Monitor is now running...');
        console.log('Press Ctrl+C to stop\n');

        // Run initial check immediately
        this.checkAndAct();

        // Set up recurring checks
        this.checkTimer = setInterval(() => {
            this.checkAndAct();
        }, this.checkInterval);
    }

    stop() {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
        
        if (this.dbManager) {
            this.dbManager.disconnect();
        }
        
        console.log('\n🛑 Auto-Monitor stopped');
    }
}

// Main execution
async function main() {
    const monitor = new AutoMonitor();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n⚠️  Received interrupt signal...');
        monitor.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\n⚠️  Received termination signal...');
        monitor.stop();
        process.exit(0);
    });

    try {
        await monitor.initialize();
        monitor.start();
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

module.exports = AutoMonitor;
