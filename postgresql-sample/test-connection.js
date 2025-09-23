const PostgreSQLManager = require('./database-manager');
require('dotenv').config();

async function testDatabaseOperations() {
    const db = new PostgreSQLManager();
    
    try {
        console.log('🔍 Testing PostgreSQL Database Operations\n');
        
        // Test connection
        console.log('1. Testing connection...');
        await db.connect();
        
        // Test basic statistics
        console.log('2. Getting database statistics...');
        const stats = await db.getStats();
        console.log('   Database Stats:', stats);
        
        // Test ticker creation/retrieval
        console.log('3. Testing ticker operations...');
        const tickerId = await db.getOrCreateTickerId('TEST', 'NYSE');
        console.log(`   Created/Retrieved ticker ID: ${tickerId}`);
        
        // Test ticker update
        console.log('4. Testing ticker update...');
        await db.updateTicker('TEST', 'NYSE', { active: true, price: 100.50 });
        console.log('   ✅ Ticker updated successfully');
        
        // Test sample historical data insertion
        console.log('5. Testing historical data insertion...');
        const sampleHistorical = [
            {
                date: '2023-01-01',
                open: 100,
                high: 105,
                low: 99,
                close: 103,
                adjClose: 103,
                volume: 1000000
            },
            {
                date: '2023-01-02',
                open: 103,
                high: 107,
                low: 102,
                close: 106,
                adjClose: 106,
                volume: 1200000
            }
        ];
        
        const historicalResult = await db.upsertHistoricalData('TEST', 'NYSE', sampleHistorical);
        console.log('   Historical data result:', historicalResult);
        
        // Test sample quote data
        console.log('6. Testing quote data insertion...');
        const sampleQuote = {
            regularMarketPrice: 106.75,
            regularMarketTime: new Date(),
            currency: 'USD',
            exchange: 'NYSE',
            market: 'us_market',
            marketCap: 1000000000,
            fiftyDayAverage: 105.25,
            epsTrailingTwelveMonths: 5.25
        };
        
        await db.upsertQuoteData('TEST', 'NYSE', sampleQuote);
        console.log('   ✅ Quote data inserted successfully');
        
        // Test ticker data retrieval
        console.log('7. Testing ticker data retrieval...');
        const tickerData = await db.getTickerData('TEST', 'NYSE');
        console.log('   Retrieved ticker data structure:', {
            ticker: tickerData?.ticker,
            hasQuote: !!tickerData?.data?.quote,
            historicalRecords: tickerData?.data?.historical?.length || 0
        });
        
        // Test search functionality
        console.log('8. Testing ticker search...');
        const searchResults = await db.searchTickers('TEST', 10, 0);
        console.log(`   Found ${searchResults.length} tickers matching 'TEST'`);
        
        // Final statistics
        console.log('9. Final database statistics...');
        const finalStats = await db.getStats();
        console.log('   Final Stats:', finalStats);
        
        console.log('\n🎉 All tests completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        await db.disconnect();
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    testDatabaseOperations();
}

module.exports = testDatabaseOperations;