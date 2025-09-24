const yahooFinance = require('yahoo-finance2').default;

async function testYahooFinance() {
  console.log('Testing Yahoo Finance API behavior...\n');
  
  // Test 1: Known good ticker
  try {
    console.log('1. Testing AAPL (should work)...');
    const aapl = await yahooFinance.quote('AAPL', {}, { validateResult: false });
    console.log('   Success:', !!aapl);
    console.log('   Price:', aapl?.regularMarketPrice || 'N/A');
    console.log('   Symbol:', aapl?.symbol || 'N/A');
  } catch (error) {
    console.log('   Error:', error.message);
  }
  
  // Test 2: Bad ticker
  try {
    console.log('\n2. Testing BADTICKER123 (should fail)...');
    const bad = await yahooFinance.quote('BADTICKER123', {}, { validateResult: false });
    console.log('   Result:', bad);
  } catch (error) {
    console.log('   Error:', error.message);
  }
  
  // Test 3: Network simulation
  try {
    console.log('\n3. Testing with very short timeout (simulate network issue)...');
    const timeout = await yahooFinance.quote('AAPL', { timeout: 1 }, { validateResult: false });
    console.log('   Success:', !!timeout);
  } catch (error) {
    console.log('   Error:', error.message);
  }
  
  console.log('\nTest complete.');
  process.exit(0);
}

testYahooFinance();