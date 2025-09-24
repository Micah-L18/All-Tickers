const yahooFinance = require('yahoo-finance2').default;

async function getTickerData(symbol) {
    console.log(`\n=== Testing getTickerData for ${symbol} ===`);
    
    const result = {
        symbol: symbol,
        timestamp: new Date().toISOString(),
        quote: null,
        historical: null,
        financials: null,
        metadata: { error: false, warnings: [] }
    };

    // Capture warnings
    const originalWarn = console.warn;
    console.warn = (...args) => {
        result.metadata.warnings.push(args.join(' '));
    };

    try {
        console.log('Fetching quote...');
        result.quote = await yahooFinance.quote(symbol, {}, { validateResult: false });
        console.log('Quote success:', !!result.quote);
    } catch (error) {
        console.log('Quote error:', error.message);
        result.metadata.error = true;
    }

    try {
        console.log('Fetching historical data...');
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        result.historical = await yahooFinance.historical(symbol, {
            period1: startDate,
            period2: endDate
        }, { validateResult: false });
        console.log('Historical success:', !!result.historical && result.historical.length > 0);
    } catch (error) {
        console.log('Historical error:', error.message);
        result.metadata.error = true;
    }

    try {
        console.log('Fetching financials...');
        result.financials = await yahooFinance.fundamentals(symbol, { modules: ['financialData'] }, { validateResult: false });
        console.log('Financials success:', !!result.financials);
    } catch (error) {
        console.log('Financials error:', error.message);
        result.metadata.error = true;
    }

    // Restore console.warn
    console.warn = originalWarn;

    console.log('Final metadata.error:', result.metadata.error);
    console.log('Warnings count:', result.metadata.warnings.length);
    if (result.metadata.warnings.length > 0) {
        console.log('Sample warnings:', result.metadata.warnings.slice(0, 3));
    }
    
    return result;
}

async function runTests() {
    console.log('Testing getTickerData function behavior...');
    
    // Test known good ticker
    await getTickerData('AAPL');
    
    // Test likely bad ticker
    await getTickerData('BADTICKER123');
    
    // Test another good ticker
    await getTickerData('MSFT');
    
    console.log('\n=== Analysis Complete ===');
    process.exit(0);
}

runTests();