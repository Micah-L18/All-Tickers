const { createDatabaseManager } = require('./database-factory');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

class TickerGenerator {
    constructor() {
        this.dbManager = null; // Will be initialized in initDatabase
        this.batchSize = 10000; // Process in batches for better performance
    }

    // Initialize database connection
    async initDatabase() {
        this.dbManager = await createDatabaseManager();
        console.log('✅ Database connection established for ticker generation');
    }

    // Generate all possible ticker combinations from A to ZZZZZ
    generateTickerCombinations() {
        const tickers = [];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const exchanges = ['NYSE', 'NASDAQ', 'AMEX']; // All exchanges for each ticker

        // Generate 1-letter tickers (A-Z)
        for (let i = 0; i < alphabet.length; i++) {
            tickers.push({ symbol: alphabet[i], exchanges: [...exchanges] });
        }

        // Generate 2-letter tickers (AA-ZZ)
        for (let i = 0; i < alphabet.length; i++) {
            for (let j = 0; j < alphabet.length; j++) {
                const symbol = alphabet[i] + alphabet[j];
                tickers.push({ symbol, exchanges: [...exchanges] });
            }
        }

        // // Generate 3-letter tickers (AAA-ZZZ)
        // for (let i = 0; i < alphabet.length; i++) {
        //     for (let j = 0; j < alphabet.length; j++) {
        //         for (let k = 0; k < alphabet.length; k++) {
        //             const symbol = alphabet[i] + alphabet[j] + alphabet[k];
        //             tickers.push({ symbol, exchanges: [...exchanges] });
        //         }
        //     }
        // }

        // // Generate 4-letter tickers (AAAA-ZZZZ)
        // for (let i = 0; i < alphabet.length; i++) {
        //     for (let j = 0; j < alphabet.length; j++) {
        //         for (let k = 0; k < alphabet.length; k++) {
        //             for (let l = 0; l < alphabet.length; l++) {
        //                 const symbol = alphabet[i] + alphabet[j] + alphabet[k] + alphabet[l];
        //                 tickers.push({ symbol, exchanges: [...exchanges] });
        //             }
        //         }
        //     }
        // }

        // // Generate 5-letter tickers (AAAAA-ZZZZZ)
        // // NOTE: This will generate a very large number of combinations
        // // Consider running this separately or with additional filtering
        // for (let i = 0; i < alphabet.length; i++) {
        //     for (let j = 0; j < alphabet.length; j++) {
        //         for (let k = 0; k < alphabet.length; k++) {
        //             for (let l = 0; l < alphabet.length; l++) {
        //                 for (let m = 0; m < alphabet.length; m++) {
        //                     const symbol = alphabet[i] + alphabet[j] + alphabet[k] + alphabet[l] + alphabet[m];
        //                     tickers.push({ symbol, exchanges: [...exchanges] });
        //                 }
        //             }
        //         }
        //     }
        // }

        return tickers;
    }

    // Generate tickers up to a specific length (for testing or partial generation)
    generateTickerCombinationsUpTo(maxLength = 4) {
        const tickers = [];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const exchanges = ['NYSE', 'NASDAQ', 'AMEX'];

        // Generate combinations up to maxLength
        for (let length = 1; length <= maxLength; length++) {
            console.log(`🎯 Generating ${length}-letter ticker combinations...`);
            
            const combinations = this.generateCombinationsOfLength(alphabet, length);
            for (const symbol of combinations) {
                tickers.push({ symbol, exchanges: [...exchanges] });
            }
        }

        return tickers;
    }

    // Helper function to generate combinations of specific length
    generateCombinationsOfLength(alphabet, length) {
        const combinations = [];
        
        function generate(current, remaining) {
            if (remaining === 0) {
                combinations.push(current);
                return;
            }
            
            for (let i = 0; i < alphabet.length; i++) {
                generate(current + alphabet[i], remaining - 1);
            }
        }
        
        generate('', length);
        return combinations;
    }

    // Bulk insert tickers into SQLite database
    async insertTickers(tickers) {
        console.log(`📊 Starting bulk insert of ${tickers.length} ticker combinations...`);
        
        const startTime = Date.now();
        let completed = 0;
        let errors = 0;
        let duplicates = 0;

        // Process in batches to avoid memory issues
        for (let i = 0; i < tickers.length; i += this.batchSize) {
            const batch = tickers.slice(i, i + this.batchSize);
            const batchStartTime = Date.now();
            
            console.log(`📦 Processing batch ${Math.floor(i / this.batchSize) + 1}/${Math.ceil(tickers.length / this.batchSize)} (${batch.length} tickers)`);
            
            try {
                // Build VALUES clause for bulk insert
                const values = [];
                const placeholders = [];
                let paramIndex = 1;
                
                for (const ticker of batch) {
                    placeholders.push(`(?, ?, ?)`);
                    values.push(ticker.symbol, JSON.stringify(ticker.exchanges), null); // null = unvalidated
                }
                
                const query = `
                    INSERT INTO tickers (symbol, exchanges, active)
                    VALUES ${placeholders.join(', ')}
                    ON CONFLICT (symbol) DO NOTHING
                `;
                
                const result = await this.dbManager.query(query, values);
                
                // Calculate statistics
                const insertedCount = result.rowCount || 0;
                const duplicateCount = batch.length - insertedCount;
                
                completed += batch.length;
                duplicates += duplicateCount;
                
                const batchTime = Date.now() - batchStartTime;
                const tickersPerSecond = (batch.length / batchTime * 1000).toFixed(0);
                
                console.log(`✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s (${tickersPerSecond} tickers/sec)`);
                console.log(`📊 Inserted: ${insertedCount}, Duplicates: ${duplicateCount}`);
                
                // Progress update
                const progress = (completed / tickers.length * 100).toFixed(1);
                console.log(`📈 Progress: ${completed}/${tickers.length} (${progress}%)`);
                
            } catch (error) {
                console.error(`❌ Error processing batch:`, error.message);
                errors += batch.length;
                completed += batch.length;
            }
            
            // Brief pause between batches to avoid overwhelming the database
            if (i + this.batchSize < tickers.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        const totalTime = Date.now() - startTime;
        const overallRate = (completed / (totalTime / 1000)).toFixed(0);
        
        console.log(`\n✅ Bulk insert completed!`);
        console.log(`📊 Total processed: ${completed} ticker combinations`);
        console.log(`💾 Successfully inserted: ${completed - duplicates - errors}`);
        console.log(`🔄 Duplicates skipped: ${duplicates}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`⏱️  Total time: ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
        console.log(`⚡ Overall rate: ${overallRate} tickers/second`);
        
        return {
            total: completed,
            inserted: completed - duplicates - errors,
            duplicates,
            errors,
            time: totalTime
        };
    }

    // Get database statistics
    async getStats() {
        return await this.dbManager.getStats();
    }

    // Get exchange breakdown statistics
    async getExchangeStats() {
        return await this.dbManager.getExchangeStats();
    }

    // Clear existing ticker data (with confirmation)
    async clearExistingData() {
        const stats = await this.getStats();
        if (parseInt(stats.total) === 0) {
            console.log('📊 Database is empty, nothing to clear');
            return;
        }
        
        console.log(`⚠️  WARNING: This will delete ${stats.total} existing ticker records!`);
        console.log(`📊 Current data: Active: ${stats.active_count}, Inactive: ${stats.inactive_count}, Unvalidated: ${stats.unvalidated_count}`);
        
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        const answer = await new Promise((resolve) => {
            rl.question('Are you sure you want to DELETE ALL ticker data? (type "DELETE" to confirm): ', (answer) => {
                rl.close();
                resolve(answer);
            });
        });
        
        if (answer === 'DELETE') {
            console.log('🧹 Clearing existing ticker data...');
            await this.dbManager.query('DELETE FROM tickers');
            console.log('✅ All ticker data cleared');
        } else {
            console.log('🔄 Operation cancelled');
            throw new Error('User cancelled data clearing');
        }
    }

    // Close database connection
    async close() {
        if (this.dbManager) {
            await this.dbManager.disconnect();
        }
    }
}

// Main execution function
async function main() {
    console.log('🚀 All-Tickers Bulk Generator v3.0 - SQLite Edition');
    console.log('=' .repeat(60));
    
    const generator = new TickerGenerator();
    
    try {
        // Initialize database
        await generator.initDatabase();
        
        // Get command line arguments
        const args = process.argv.slice(2);
        const maxLengthArg = args.find(arg => arg.startsWith('--max-length='));
        const maxLength = maxLengthArg ? parseInt(maxLengthArg.split('=')[1]) : 5;
        const forceFlag = args.includes('--force');
        const clearFlag = args.includes('--clear');
        
        console.log(`⚙️  Configuration: Max ticker length: ${maxLength}, Force: ${forceFlag}, Clear: ${clearFlag}`);
        
        // Check if database already has data
        const stats = await generator.getStats();
        if (parseInt(stats.total) > 0) {
            console.log(`📊 Database already contains ${stats.total} ticker combinations`);
            console.log(`✅ Active: ${stats.active_count}, Inactive: ${stats.inactive_count}, Unvalidated: ${stats.unvalidated_count}`);
            
            // Show exchange breakdown
            const exchangeStats = await generator.getExchangeStats();
            console.log('\n📈 Exchange breakdown:');
            for (const stat of exchangeStats) {
                console.log(`   ${stat.exchange_name}: ${stat.total} total (Active: ${stat.active_count}, Inactive: ${stat.inactive_count}, Unvalidated: ${stat.unvalidated_count})`);
            }
            
            if (!forceFlag && !clearFlag) {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const answer = await new Promise((resolve) => {
                    rl.question('Do you want to regenerate all ticker combinations? (y/N): ', (answer) => {
                        rl.close();
                        resolve(answer.toLowerCase());
                    });
                });
                
                if (answer !== 'y' && answer !== 'yes') {
                    console.log('🔄 Skipping generation. Database unchanged.');
                    return;
                }
                
                // Clear existing data (like the original version)
                console.log('🧹 Clearing existing ticker data...');
                await generator.dbManager.query('DELETE FROM tickers');
                console.log('✅ Cleared existing ticker data');
            }
            
            if (clearFlag || forceFlag) {
                await generator.clearExistingData();
            }
        }
        
        // Generate ticker combinations
        console.log('\n🎯 Generating ticker combinations...');
        const startTime = Date.now();
        
        let tickers;
        if (maxLength < 5) {
            console.log(`📏 Generating tickers up to ${maxLength} letters`);
            tickers = generator.generateTickerCombinationsUpTo(maxLength);
        } else {
            console.log('📏 Generating all ticker combinations (1-5 letters)');
            tickers = generator.generateTickerCombinations();
        }
        
        const generationTime = Date.now() - startTime;
        
        console.log(`✅ Generated ${tickers.length} ticker combinations in ${(generationTime / 1000).toFixed(1)}s`);
        
        // Calculate breakdown by length and exchange
        const breakdown = {};
        for (const ticker of tickers) {
            const length = ticker.symbol.length;
            const exchange = ticker.exchange;
            const key = `${length}-letter-${exchange}`;
            breakdown[key] = (breakdown[key] || 0) + 1;
        }
        
        console.log(`\n📊 Generation breakdown:`);
        for (let length = 1; length <= maxLength; length++) {
            const exchanges = ['NYSE', 'NASDAQ', 'AMEX'];
            const lengthTotal = exchanges.reduce((sum, ex) => sum + (breakdown[`${length}-letter-${ex}`] || 0), 0);
            console.log(`   • ${length}-letter: ${lengthTotal.toLocaleString()} combinations (${(lengthTotal/3).toLocaleString()} symbols × 3 exchanges)`);
        }
        
        // Insert tickers into database
        console.log('\n💾 Inserting ticker combinations into SQLite...');
        const insertStartTime = Date.now();
        const insertResult = await generator.insertTickers(tickers);
        
        // Final statistics
        const finalStats = await generator.getStats();
        const finalExchangeStats = await generator.getExchangeStats();
        
        console.log(`\n🎉 Generation Complete!`);
        console.log('=' .repeat(60));
        console.log(`⏱️  Total time: ${Math.round((Date.now() - startTime) / 1000 / 60)} minutes`);
        console.log(`💾 Database: ${finalStats.total} ticker combinations ready for validation`);
        console.log(`📊 Breakdown: Active: ${finalStats.active_count}, Inactive: ${finalStats.inactive_count}, Unvalidated: ${finalStats.unvalidated_count}`);
        
        console.log('\n📈 Final exchange breakdown:');
        for (const stat of finalExchangeStats) {
            console.log(`   ${stat.exchange_name}: ${stat.total} combinations`);
        }
        
        console.log('\n🚀 Ready for ticker validation! Run the validation scripts to begin.');
        
    } catch (error) {
        if (error.message === 'User cancelled data clearing') {
            console.log('🔄 Operation cancelled by user');
        } else {
            console.error('❌ Error during generation:', error);
            process.exit(1);
        }
    } finally {
        await generator.close();
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TickerGenerator;