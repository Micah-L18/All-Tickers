const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class TickerGenerator {
    constructor() {
        this.dbPath = path.join(__dirname, 'tickers.db');
        this.db = new sqlite3.Database(this.dbPath);
    }

    // Initialize the database with the required table
    async initDatabase() {
        return new Promise((resolve, reject) => {
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS tickers (
                    ticker TEXT PRIMARY KEY,
                    active BOOLEAN DEFAULT 0,
                    price REAL DEFAULT NULL,
                    exchange TEXT DEFAULT NULL,
                    last_checked DATETIME DEFAULT NULL
                )
            `;
            
            this.db.run(createTableQuery, (err) => {
                if (err) {
                    console.error('❌ Error creating table:', err);
                    reject(err);
                } else {
                    console.log('✅ Database table initialized');
                    resolve();
                }
            });
        });
    }

    // Generate all possible ticker combinations from A to ZZZZ
    generateTickerCombinations() {
        const tickers = [];
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        // Generate 1-letter tickers (A-Z)
        for (let i = 0; i < alphabet.length; i++) {
            tickers.push(alphabet[i]);
        }

        // tickers.push('KO')

        // Generate 2-letter tickers (AA-ZZ)
        for (let i = 0; i < alphabet.length; i++) {
            for (let j = 0; j < alphabet.length; j++) {
                tickers.push(alphabet[i] + alphabet[j]);
            }
        }

    //     // Generate 3-letter tickers (AAA-ZZZ)
    //     for (let i = 0; i < alphabet.length; i++) {
    //         for (let j = 0; j < alphabet.length; j++) {
    //             for (let k = 0; k < alphabet.length; k++) {
    //                 tickers.push(alphabet[i] + alphabet[j] + alphabet[k]);
    //             }
    //         }
    //     }

    //     //Generate 4-letter tickers (AAAA-ZZZZ)
    //     for (let i = 0; i < alphabet.length; i++) {
    //         for (let j = 0; j < alphabet.length; j++) {
    //             for (let k = 0; k < alphabet.length; k++) {
    //                 for (let l = 0; l < alphabet.length; l++) {
    //                     tickers.push(alphabet[i] + alphabet[j] + alphabet[k] + alphabet[l]);
    //                 }
    //             }
    //         }
    //     }

    //   //  (NOTE!) this command will run into the time limit of the Yahoo Finance API, still working on a solution!
    //   //  the 5-letter ticker generation is commented out for now to prevent excessive API calls, it is anticipated that it will take 100+ hours to complete validation of all 1-5 letter tickers alone which is way beyond the scopt, so i may need to figure out a way to batch the tickers and have a checkpoint system to resume where it left off.
       
    //   //  Generate 5-letter tickers (AAAAA-ZZZZZ)
    //     for (let i = 0; i < alphabet.length; i++) {
    //         for (let j = 0; j < alphabet.length; j++) {
    //             for (let k = 0; k < alphabet.length; k++) {
    //                 for (let l = 0; l < alphabet.length; l++) {
    //                     for (let m = 0; m < alphabet.length; m++) {
    //                         tickers.push(alphabet[i] + alphabet[j] + alphabet[k] + alphabet[l] + alphabet[m]);
    //                     }
    //                 }
    //             }
    //         }
    //     }

        return tickers;
    }

    // Bulk insert tickers into the database
    async insertTickers(tickers) {
        return new Promise((resolve, reject) => {
            const insertQuery = 'INSERT OR IGNORE INTO tickers (ticker, active) VALUES (?, 0)';
            const stmt = this.db.prepare(insertQuery);
            
            let completed = 0;
            let errors = 0;
            
            console.log(`📊 Starting bulk insert of ${tickers.length} tickers...`);
            
            // Start transaction for better performance
            this.db.run('BEGIN TRANSACTION');
            
            tickers.forEach((ticker, index) => {
                stmt.run(ticker, (err) => {
                    if (err && !err.message.includes('UNIQUE constraint failed')) {
                        errors++;
                        console.error(`❌ Error inserting ${ticker}:`, err.message);
                    }
                    
                    completed++;
                    
                    // Show progress every 10,000 insertions
                    if (completed % 10000 === 0) {
                        console.log(`📈 Progress: ${completed}/${tickers.length} (${Math.round(completed/tickers.length*100)}%)`);
                    }
                    
                    // Complete when all tickers processed
                    if (completed === tickers.length) {
                        this.db.run('COMMIT');
                        stmt.finalize();
                        
                        console.log(`✅ Bulk insert completed!`);
                        console.log(`📊 Total: ${tickers.length}, Errors: ${errors}`);
                        resolve();
                    }
                });
            });
        });
    }

    // Get database statistics
    async getStats() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
                    SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) as inactive_count
                FROM tickers
            `;
            
            this.db.get(query, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Close database connection
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('❌ Error closing database:', err);
            } else {
                console.log('✅ Database connection closed');
            }
        });
    }
}

// Main execution
async function main() {
    console.log('🚀 All-Tickers Bulk Generator v2.0');
    console.log('====================================');
    
    const generator = new TickerGenerator();
    
    try {
        // Initialize database
        await generator.initDatabase();
        
        // Check if database already has data
        const stats = await generator.getStats();
        if (stats.total > 0) {
            console.log(`📊 Database already contains ${stats.total} tickers`);
            console.log(`✅ Active: ${stats.active_count}, Inactive: ${stats.inactive_count}`);
            
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            const answer = await new Promise((resolve) => {
                rl.question('Do you want to regenerate all tickers? (y/N): ', (answer) => {
                    rl.close();
                    resolve(answer.toLowerCase());
                });
            });
            
            if (answer !== 'y' && answer !== 'yes') {
                console.log('🔄 Skipping generation. Database unchanged.');
                generator.close();
                return;
            }
            
            // Clear existing data
            await new Promise((resolve, reject) => {
                generator.db.run('DELETE FROM tickers', (err) => {
                    if (err) reject(err);
                    else {
                        console.log('🧹 Cleared existing ticker data');
                        resolve();
                    }
                });
            });
        }
        
        // Generate all ticker combinations
        console.log('🎯 Generating ticker combinations...');
        const startTime = Date.now();
        const tickers = generator.generateTickerCombinations();
        const generationTime = Date.now() - startTime;
        
        console.log(`✅ Generated ${tickers.length} ticker combinations in ${generationTime}ms`);
        console.log(`📊 Breakdown:`);
        console.log(`   • 1-letter: 26 tickers (A-Z)`);
        console.log(`   • 2-letter: 676 tickers (AA-ZZ)`);
        console.log(`   • 3-letter: 17,576 tickers (AAA-ZZZ)`);
        console.log(`   • 4-letter: 456,976 tickers (AAAA-ZZZZ)`);
        console.log(`   • 5-letter: 11,881,376 tickers (AAAAA-ZZZZZ)`);
        
        // Insert tickers into database
        const insertStartTime = Date.now();
        await generator.insertTickers(tickers);
        const insertTime = Date.now() - insertStartTime;
        
        // Final statistics
        const finalStats = await generator.getStats();
        console.log(`\n📈 Generation Complete!`);
        console.log(`⏱️  Total time: ${Math.round((Date.now() - startTime) / 1000)}s`);
        console.log(`💾 Database: ${finalStats.total} tickers ready for validation`);
        
    } catch (error) {
        console.error('❌ Error during generation:', error);
        process.exit(1);
    } finally {
        generator.close();
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TickerGenerator;
