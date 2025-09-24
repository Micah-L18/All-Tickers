const yahooFinance = require('yahoo-finance2').default;

// Suppress the survey notice
yahooFinance.suppressNotices(['yahooSurvey']);

// Mock validation warning system
let validationWarnings = new Set();
let currentTicker = null;

function setCurrentProcessingTicker(symbol) {
    currentTicker = symbol;
}

function hasValidationWarning(symbol) {
    return validationWarnings.has(symbol);
}

// Test a batch of tickers to see if there are patterns
async function testBatchTickers() {
    console.log('Testing batch of tickers to look for error patterns...\n');
    
    const tickers = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN', 'NVDA', 'META', 'NFLX', 'A', 'AA', 'AAL', 'BADTICKER123'];
    
    for (const ticker of tickers) {
        try {
            console.log(`Testing ${ticker}...`);
            const quote = await yahooFinance.quote(ticker, {}, { validateResult: false });
            console.log(`  Quote success: ${!!quote}, Price: ${quote?.regularMarketPrice || 'N/A'}`);
        } catch (error) {
            console.log(`  Quote failed: ${error.message}`);
        }
    }
    
    console.log('\nTest complete.');
    process.exit(0);
}

testBatchTickers();