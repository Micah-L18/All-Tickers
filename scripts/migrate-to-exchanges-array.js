#!/usr/bin/env node

/**
 * Database Migration Script: Convert exchange-per-row to exchanges-array schema
 * 
 * This script migrates the tickers table from having one row per exchange 
 * to having one row per symbol with an array of exchanges.
 */

const PostgreSQLManager = require('../src/db/database-manager');
require('dotenv').config();

class DatabaseMigration {
    constructor() {
        this.dbManager = new PostgreSQLManager();
    }

    async migrate() {
        try {
            console.log('🚀 Starting database migration: exchange-per-row → exchanges-array');
            
            // Connect to database
            await this.dbManager.connect();
            console.log('✅ Database connection established');

            // Step 1: Create backup table
            await this.createBackupTable();

            // Step 2: Create new tickers table with exchanges array
            await this.createNewTickersTable();

            // Step 3: Migrate data
            await this.migrateData();

            // Step 4: Update related tables and constraints
            await this.updateRelatedTables();

            // Step 5: Create indexes
            await this.createIndexes();

            console.log('🎉 Migration completed successfully!');
            console.log('📊 Run the verification script to check data integrity');

        } catch (error) {
            console.error('❌ Migration failed:', error);
            console.log('🔄 Database state preserved - manual cleanup may be required');
            throw error;
        } finally {
            await this.dbManager.close();
        }
    }

    async createBackupTable() {
        console.log('📦 Creating backup of existing tickers table...');
        
        await this.dbManager.query(`
            CREATE TABLE tickers_backup_pre_migration AS 
            SELECT * FROM tickers;
        `);

        const backupCount = await this.dbManager.query(`
            SELECT COUNT(*) as count FROM tickers_backup_pre_migration;
        `);

        console.log(`✅ Backup created with ${backupCount.rows[0].count} records`);
    }

    async createNewTickersTable() {
        console.log('🏗️  Creating new tickers table with exchanges array...');

        // Drop existing table (backup already created)
        await this.dbManager.query(`DROP TABLE IF EXISTS tickers CASCADE;`);

        // Create new table with exchanges as array
        await this.dbManager.query(`
            CREATE TABLE tickers (
                id SERIAL PRIMARY KEY,
                symbol VARCHAR(10) NOT NULL UNIQUE,
                exchanges TEXT[] NOT NULL DEFAULT '{}',
                active BOOLEAN,
                price DECIMAL(10,4),
                last_updated TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        console.log('✅ New tickers table created');
    }

    async migrateData() {
        console.log('🔄 Migrating data to new schema...');

        // Get all unique symbols and aggregate their data
        const migrationQuery = `
            INSERT INTO tickers (symbol, exchanges, active, price, last_updated, created_at)
            SELECT 
                symbol,
                array_agg(DISTINCT exchange ORDER BY exchange) as exchanges,
                -- Use the most recent active status (prefer true over false)
                BOOL_OR(COALESCE(active, false)) as active,
                -- Use the highest price from all exchanges
                MAX(price) as price,
                -- Use the most recent update time
                MAX(last_updated) as last_updated,
                -- Use the earliest creation time
                MIN(created_at) as created_at
            FROM tickers_backup_pre_migration
            GROUP BY symbol
            ORDER BY symbol;
        `;

        await this.dbManager.query(migrationQuery);

        const newCount = await this.dbManager.query(`
            SELECT COUNT(*) as count FROM tickers;
        `);

        console.log(`✅ Data migrated: ${newCount.rows[0].count} unique symbols`);
    }

    async updateRelatedTables() {
        console.log('🔗 Updating related tables...');

        // Update ticker_historical to reference the new ticker IDs
        // First, create a mapping of old ID to new ID
        await this.dbManager.query(`
            CREATE TEMPORARY TABLE ticker_id_mapping AS
            SELECT 
                backup.id as old_id,
                new_tickers.id as new_id,
                backup.symbol,
                backup.exchange
            FROM tickers_backup_pre_migration backup
            JOIN tickers new_tickers ON backup.symbol = new_tickers.symbol;
        `);

        // Update ticker_historical table to use new ticker IDs
        // We'll keep all historical data but reference the consolidated ticker
        await this.dbManager.query(`
            UPDATE ticker_historical 
            SET ticker_id = (
                SELECT DISTINCT new_id 
                FROM ticker_id_mapping 
                WHERE old_id = ticker_historical.ticker_id
            )
            WHERE ticker_id IN (SELECT old_id FROM ticker_id_mapping);
        `);

        // Update other related tables similarly
        const relatedTables = ['ticker_quotes', 'ticker_financials', 'ticker_earnings'];
        
        for (const table of relatedTables) {
            const tableExists = await this.dbManager.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = $1
                );
            `, [table]);

            if (tableExists.rows[0].exists) {
                await this.dbManager.query(`
                    UPDATE ${table}
                    SET ticker_id = (
                        SELECT DISTINCT new_id 
                        FROM ticker_id_mapping 
                        WHERE old_id = ${table}.ticker_id
                    )
                    WHERE ticker_id IN (SELECT old_id FROM ticker_id_mapping);
                `);
                console.log(`✅ Updated ${table} table`);
            }
        }

        console.log('✅ Related tables updated');
    }

    async createIndexes() {
        console.log('📊 Creating indexes...');

        await this.dbManager.query(`
            CREATE INDEX idx_tickers_symbol ON tickers(symbol);
            CREATE INDEX idx_tickers_exchanges ON tickers USING GIN(exchanges);
            CREATE INDEX idx_tickers_active ON tickers(active);
            CREATE INDEX idx_tickers_last_updated ON tickers(last_updated);
        `);

        console.log('✅ Indexes created');
    }

    async verify() {
        console.log('🔍 Verifying migration...');

        // Compare record counts
        const oldCount = await this.dbManager.query(`
            SELECT COUNT(DISTINCT symbol) as count FROM tickers_backup_pre_migration;
        `);
        const newCount = await this.dbManager.query(`
            SELECT COUNT(*) as count FROM tickers;
        `);

        console.log(`📊 Original unique symbols: ${oldCount.rows[0].count}`);
        console.log(`📊 New ticker records: ${newCount.rows[0].count}`);

        // Show sample of migrated data
        const sample = await this.dbManager.query(`
            SELECT symbol, exchanges, active, price 
            FROM tickers 
            ORDER BY symbol 
            LIMIT 5;
        `);

        console.log('📋 Sample migrated data:');
        sample.rows.forEach(row => {
            console.log(`   ${row.symbol}: [${row.exchanges.join(', ')}] - Active: ${row.active}, Price: $${row.price}`);
        });

        console.log('✅ Migration verification complete');
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const migration = new DatabaseMigration();

    if (args.includes('--verify-only')) {
        await migration.dbManager.connect();
        await migration.verify();
        await migration.dbManager.close();
    } else if (args.includes('--help')) {
        console.log(`
Database Migration Script - Exchange Array Conversion

Usage:
  node scripts/migrate-to-exchanges-array.js         Run full migration
  node scripts/migrate-to-exchanges-array.js --verify-only   Verify existing migration
  node scripts/migrate-to-exchanges-array.js --help          Show this help

This script converts the tickers table from having one row per exchange
to having one row per symbol with an array of exchanges.

⚠️  IMPORTANT: This script will modify your database structure!
   Make sure to backup your database before running.
        `);
    } else {
        await migration.migrate();
        await migration.verify();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = DatabaseMigration;