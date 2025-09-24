const yahooFinance = require('yahoo-finance2').default;

// Mock validation warning system
let validationWarnings = new Set();
let currentTicker = null;

function setCurrentProcessingTicker(symbol) {
    currentTicker = symbol;
}

function hasValidationWarning(symbol) {
    return validationWarnings.has(symbol);
}

// Exact copy of getTickerData from return-data.js
async function getTickerData(symbol) {
    try {
        // Set current ticker for validation warning tracking
        setCurrentProcessingTicker(symbol);
        
        // Get comprehensive ticker data with error suppression
        const quote = await yahooFinance.quote(symbol, {}, { validateResult: false });
        const historicalData = await yahooFinance.historical(symbol, {
            period1: '1900-01-01',
            period2: new Date().toISOString().split('T')[0],
            interval: '1d'
        }, { validateResult: false });
        const summary = await yahooFinance.quoteSummary(symbol, {
            modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile']
        }, { validateResult: false });

        // Check if this ticker had validation warnings
        const hadValidationWarnings = hasValidationWarning(symbol);
        
        // Clear current ticker
        setCurrentProcessingTicker(null);

        // Create structured data with metadata
        const tickerDataWithMetadata = {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                dataSource: 'Yahoo Finance API (yahoo-finance2)',
                version: '2.0.0',
                hadValidationWarnings: hadValidationWarnings,
                historicalPeriod: {
                    start: '1900-01-01',
                    end: new Date().toISOString().split('T')[0]
                },
                recordCount: {
                    historical: historicalData ? historicalData.length : 0,
                    summaryModules: summary ? Object.keys(summary).length : 0
                }
            },
            quote: quote,
            historical: historicalData,
            summary: summary,
            statistics: {
                // Calculate basic statistics from historical data
                historicalStats: historicalData && historicalData.length > 0 ? {
                    totalDays: historicalData.length,
                    averageClose: (historicalData.reduce((sum, day) => sum + (day.close || 0), 0) / historicalData.length).toFixed(2),
                    highestClose: Math.max(...historicalData.map(day => day.close || 0)).toFixed(2),
                    lowestClose: Math.min(...historicalData.map(day => day.close || 0)).toFixed(2),
                    priceRange: (Math.max(...historicalData.map(day => day.close || 0)) - Math.min(...historicalData.map(day => day.close || 0))).toFixed(2)
                } : null,
                // Basic quote statistics
                quoteStats: quote ? {
                    currentPrice: quote.regularMarketPrice || quote.price || 'N/A',
                    marketCap: quote.marketCap || 'N/A',
                    volume: quote.regularMarketVolume || quote.volume || 'N/A',
                    peRatio: quote.trailingPE || 'N/A'
                } : null
            }
        };

        return tickerDataWithMetadata;
    } catch (error) {
        console.error(`❌ Error fetching data for ${symbol}:`, error.message);
        
        // Return error structure
        return {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                dataSource: 'Yahoo Finance API (yahoo-finance2)',
                version: '2.0.0',
                error: true,
                errorMessage: error.message,
                hadValidationWarnings: hasValidationWarning(symbol)
            },
            quote: null,
            historical: null,
            summary: null,
            error: error.message
        };
    }
}

async function testRealFunction() {
    console.log('Testing the actual getTickerData function...\n');
    
    // Test good ticker
    console.log('=== Testing AAPL ===');
    const aaplResult = await getTickerData('AAPL');
    console.log('Has error flag:', !!aaplResult.metadata.error);
    console.log('Has quote:', !!aaplResult.quote);
    console.log('Has historical:', !!aaplResult.historical);
    console.log('Has summary:', !!aaplResult.summary);
    if (aaplResult.metadata.error) {
        console.log('Error message:', aaplResult.metadata.errorMessage);
    }
    
    // Test bad ticker
    console.log('\n=== Testing BADTICKER123 ===');
    const badResult = await getTickerData('BADTICKER123');
    console.log('Has error flag:', !!badResult.metadata.error);
    console.log('Has quote:', !!badResult.quote);
    console.log('Has historical:', !!badResult.historical);
    console.log('Has summary:', !!badResult.summary);
    if (badResult.metadata.error) {
        console.log('Error message:', badResult.metadata.errorMessage);
    }
    
    console.log('\n=== Test Complete ===');
    process.exit(0);
}

testRealFunction();