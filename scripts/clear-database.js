#!/usr/bin/env node
/**
 * Clear PostgreSQL Database Script
 * 
 * This script clears all data from the All-Tickers PostgreSQL database
 * while preserving the table structure and indexes.
 * 
 * Usage:
 *   node scripts/clear-database.js [options]
 * 
 * Options:
 *   --confirm     Skip confirmation prompt
 *   --tables-only Clear only the main tables (tickers, ticker_data)
 *   --all         Clear all data including logs and stats
 *   --help        Show this help message
 */

const PostgreSQLManager = require('../src/db/database-manager');
const readline = require('readline');
require('dotenv').config();

class DatabaseCleaner {
    constructor() {
        this.dbManager = new PostgreSQLManager();
    }

    async initialize() {
        await this.dbManager.connect();
        console.log('✅ Connected to PostgreSQL database');
    }

    async clearMainTables() {
        console.log('🗑️  Clearing main tables...');
        
        const tables = [
            'ticker_data',
            'ticker_quotes', 
            'ticker_historical',
            'ticker_financials',
            'tickers'
        ];

        for (const table of tables) {
            try {
                const result = await this.dbManager.query(`DELETE FROM ${table}`);
                console.log(`   ✅ Cleared ${table} (${result.rowCount || 0} rows deleted)`);
            } catch (error) {
                if (error.message.includes('does not exist')) {
                    console.log(`   ⚠️  Table ${table} does not exist, skipping`);
                } else {
                    console.error(`   ❌ Error clearing ${table}:`, error.message);
                }
            }
        }
    }

    async clearAllTables() {
        console.log('🗑️  Clearing ALL tables...');
        
        // Get all tables in the database
        const result = await this.dbManager.query(`
            SELECT table_name as tablename
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);

        const tables = result.rows.map(row => row.tablename);
        
        for (const table of tables) {
            try {
                const deleteResult = await this.dbManager.query(`DELETE FROM ${table}`);
                console.log(`   ✅ Cleared ${table} (${deleteResult.rowCount || 0} rows deleted)`);
            } catch (error) {
                console.error(`   ❌ Error clearing ${table}:`, error.message);
            }
        }
    }

    async resetSequences() {
        console.log('🔄 Resetting sequences...');
        
        try {
            // Get all sequences
            const result = await this.dbManager.query(`
                SELECT sequence_name 
                FROM information_schema.sequences 
                WHERE sequence_schema = 'public'
            `);

            for (const row of result.rows) {
                const sequenceName = row.sequence_name;
                await this.dbManager.query(`ALTER SEQUENCE ${sequenceName} RESTART WITH 1`);
                console.log(`   ✅ Reset sequence ${sequenceName}`);
            }
        } catch (error) {
            console.log(`   ⚠️  No sequences to reset or error: ${error.message}`);
        }
    }

    async vacuumDatabase() {
        console.log('🧹 Reclaiming disk space (VACUUM FULL)...');
        
        try {
            await this.dbManager.query('VACUUM FULL');
            console.log('   ✅ Database vacuum completed - disk space reclaimed');
        } catch (error) {
            console.log(`   ⚠️  Vacuum failed: ${error.message}`);
        }
    }

    async getTableStats() {
        console.log('📊 Getting table statistics...');
        
        try {
            const result = await this.dbManager.query(`
                SELECT 
                    schemaname,
                    relname as tablename,
                    n_tup_ins as inserts,
                    n_tup_upd as updates,
                    n_tup_del as deletes,
                    n_live_tup as live_rows,
                    n_dead_tup as dead_rows
                FROM pg_stat_user_tables 
                ORDER BY relname
            `);

            if (result.rows.length === 0) {
                console.log('   📋 No user tables found');
                return;
            }

            console.log('\n   Table Statistics:');
            console.log('   ' + '='.repeat(80));
            console.log('   Table Name          | Live Rows | Dead Rows | Inserts | Updates | Deletes');
            console.log('   ' + '-'.repeat(80));
            
            for (const row of result.rows) {
                const tableName = row.tablename.padEnd(18);
                const liveRows = (row.live_rows || 0).toString().padStart(8);
                const deadRows = (row.dead_rows || 0).toString().padStart(8);
                const inserts = (row.inserts || 0).toString().padStart(8);
                const updates = (row.updates || 0).toString().padStart(8);
                const deletes = (row.deletes || 0).toString().padStart(8);
                
                console.log(`   ${tableName} | ${liveRows} | ${deadRows} | ${inserts} | ${updates} | ${deletes}`);
            }
            console.log('   ' + '='.repeat(80));
        } catch (error) {
            console.error('   ❌ Error getting table stats:', error.message);
        }
    }

    async close() {
        if (this.dbManager && this.dbManager.isConnected) {
            await this.dbManager.disconnect();
            console.log('✅ Database connection closed');
        }
    }
}

async function askConfirmation(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.toLowerCase().trim());
        });
    });
}

async function main() {
    const args = process.argv.slice(2);
    
    // Show help
    if (args.includes('--help') || args.includes('-h')) {
        console.log('🗑️  PostgreSQL Database Cleaner');
        console.log('=' .repeat(50));
        console.log('Clears data from the All-Tickers PostgreSQL database');
        console.log('');
        console.log('Usage: node scripts/clear-database.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --confirm       Skip confirmation prompt');
        console.log('  --tables-only   Clear only main tables (tickers, ticker_data, etc.)');
        console.log('  --all           Clear all data including logs and stats');
        console.log('  --stats         Show table statistics before clearing');
        console.log('  --help, -h      Show this help message');
        console.log('');
        console.log('Examples:');
        console.log('  node scripts/clear-database.js --stats         # Show stats only');
        console.log('  node scripts/clear-database.js --confirm       # Clear with no prompt');
        console.log('  node scripts/clear-database.js --tables-only   # Clear main tables only');
        console.log('  node scripts/clear-database.js --all           # Clear everything');
        return;
    }

    const cleaner = new DatabaseCleaner();
    
    try {
        await cleaner.initialize();
        
        // Show statistics first if requested
        if (args.includes('--stats')) {
            await cleaner.getTableStats();
            if (args.length === 1) {
                // Only showing stats, exit
                await cleaner.close();
                return;
            }
        }

        const confirmFlag = args.includes('--confirm');
        const tablesOnly = args.includes('--tables-only');
        const allTables = args.includes('--all');

        // Determine what to clear
        let clearType = 'main tables';
        if (allTables) {
            clearType = 'ALL tables';
        } else if (tablesOnly) {
            clearType = 'main tables only';
        }

        // Confirmation prompt
        if (!confirmFlag) {
            console.log('🗑️  PostgreSQL Database Cleaner');
            console.log('=' .repeat(50));
            console.log(`⚠️  This will clear ${clearType} in the database:`);
            console.log(`   Database: ${process.env.DB_NAME || 'all_tickers'}`);
            console.log(`   Host: ${process.env.DB_HOST || 'localhost'}`);
            console.log(`   Port: ${process.env.DB_PORT || '5432'}`);
            console.log('');
            
            const answer = await askConfirmation('Are you sure you want to proceed? (yes/no): ');
            
            if (answer !== 'yes' && answer !== 'y') {
                console.log('❌ Operation cancelled');
                await cleaner.close();
                return;
            }
        }

        console.log('🗑️  Starting database cleanup...');
        console.log('=' .repeat(50));

        // Clear tables based on options
        if (allTables) {
            await cleaner.clearAllTables();
        } else {
            await cleaner.clearMainTables();
        }

        // Reset sequences
        await cleaner.resetSequences();

        // Reclaim disk space
        await cleaner.vacuumDatabase();

        console.log('');
        console.log('🎉 Database cleanup completed successfully!');
        console.log('');
        console.log('📋 Summary:');
        console.log(`   • Cleared: ${clearType}`);
        console.log('   • Reset sequences to start from 1');
        console.log('   • Table structure preserved');
        console.log('');
        console.log('💡 To repopulate the database:');
        console.log('   1. Run: node src/db/generate-tickers.js');
        console.log('   2. Run: node src/return-data/return-data.js --validate');
        
    } catch (error) {
        console.error('❌ Error during database cleanup:', error.message);
        process.exit(1);
    } finally {
        await cleaner.close();
    }
}

// Export the class for potential use in other scripts
module.exports = DatabaseCleaner;

// Run main function if this script is executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}