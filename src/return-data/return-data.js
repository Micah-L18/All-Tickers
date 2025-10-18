const yahooFinance = require('yahoo-finance2').default;
const fs = require('fs');
const path = require('path');
const DatabaseFactory = require('../db/database-factory');
require('dotenv').config();

// Global processor instance for session refresh access
let globalProcessor = null;

// Rate limiting error handling
class RateLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RateLimitError';
        this.isRateLimit = true;
    }
}

// Function to detect rate limiting errors
function isRateLimitError(error) {
    const message = error.message || '';
    const statusCode = error.status || error.statusCode || 0;
    
    return message.includes('Edge: Too') || 
           message.includes('Unexpected token \'E\', "Edge: Too') ||
           message.includes('Too Many Requests') ||
           message.includes('Rate limit exceeded') ||
           message.includes('429') ||
           message.includes('503 Service Unavailable') ||
           message.includes('502 Bad Gateway') ||
           statusCode === 429 ||
           statusCode === 503 ||
           (statusCode === 0 && message.includes('fetch'));
}

// Function to handle rate limiting with process restart
async function handleRateLimitError(error, symbol) {
    console.log(`\n🚨 RATE LIMIT DETECTED for ${symbol}`);
    console.log(`📛 Error: ${error.message}`);
    console.log(`⏸️  Stopping process and waiting 30 seconds for rate limit reset...`);
    console.log(`🔄 Will restart automatically after cooldown\n`);
    
    // Wait longer for rate limits to reset - Yahoo seems to need more time
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    console.log(`🔄 Restarting process after extended rate limit cooldown...`);
    
    // Throw a special rate limit error to trigger process restart
    throw new RateLimitError(`Rate limit detected: ${error.message}`);
}

// Additional error suppression - redirect console errors during processing
const originalConsoleError = console.error;
let suppressErrors = false;
let capturedValidationWarnings = new Set();

function toggleErrorSuppression(suppress) {
    suppressErrors = suppress;
    if (suppress) {
        console.error = (...args) => {
            // Capture validation warnings for problematic tickers
            const message = args.join(' ');
            if (message.includes('validation') || message.includes('Expected union value') || 
                message.includes('yahoo-finance2') || message.includes('gadicc')) {
                
                // Try to extract ticker symbol from the error context if possible
                // This is a best-effort attempt to identify which ticker caused the warning
                const currentTicker = getCurrentProcessingTicker();
                if (currentTicker) {
                    capturedValidationWarnings.add(currentTicker);
                }
                return; // Suppress these errors
            }
            originalConsoleError.apply(console, args); // Allow other errors through
        };
    } else {
        console.error = originalConsoleError;
    }
}

// Track the currently processing ticker for validation warning capture
let currentProcessingTicker = null;
function setCurrentProcessingTicker(ticker) {
    currentProcessingTicker = ticker;
}
function getCurrentProcessingTicker() {
    return currentProcessingTicker;
}
function hasValidationWarning(ticker) {
    return capturedValidationWarnings.has(ticker);
}

class TickerDataDatabase {
    constructor() {
        this.dbManager = null; // Will be initialized in initializeDatabase
    }

    async initializeDatabase() {
        this.dbManager = await DatabaseFactory.createDatabaseManager();
        console.log('✅ SQLite ticker data system initialized');
    }

    async insertOrUpdateTicker(ticker, jsonData) {
        return await this.dbManager.upsertQuote(jsonData);
    }

    async getTickerCount() {
        const stats = await this.dbManager.getStats();
        return stats.totalQuotes || 0;
    }

    async getRecentlyUpdated(limit = 10) {
        // Use getTickerDataPaginated to get recent data, sorted by updated_at
        const result = await this.dbManager.query(`
            SELECT t.symbol, t.exchanges, t.active, t.updated_at,
                   q.current_price, q.market_cap, q.volume, q.quote_time
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            ORDER BY t.updated_at DESC
            LIMIT ?
        `, [limit]);
        
        return result.rows.map(row => ({
            ...row,
            exchanges: JSON.parse(row.exchanges || '[]')
        }));
    }

    async isTickerRecentlyChecked(ticker, hoursAgo = 24) {
        const result = await this.dbManager.query(`
            SELECT t.updated_at
            FROM tickers t
            WHERE t.symbol = ?
              AND t.updated_at > datetime('now', '-${hoursAgo} hours')
        `, [ticker]);
        
        return result.rows.length > 0;
    }

    async markTickerInactive(ticker, reason = 'Schema validation error') {
        try {
            // Parse ticker to get symbol (no longer processing individual exchanges)
            const symbol = ticker.includes('.') ? ticker.split('.')[0] : ticker;
            
            // Update the ticker as inactive in the main tickers table
            await this.dbManager.updateTicker(symbol, {
                active: false,
                price: -1,
                updateValidated: true  // Mark as validated during this check
            });
            
            console.log(`🔄 Marked ${symbol} as inactive due to: ${reason}`);
            return { ticker: symbol, success: true };
        } catch (error) {
            console.log(`⚠️  Could not mark ${ticker} as inactive: ${error.message}`);
            throw error;
        }
    }

    async markTickerActive(ticker, price) {
        try {
            // Parse ticker to get symbol (no longer processing individual exchanges)
            const symbol = ticker.includes('.') ? ticker.split('.')[0] : ticker;
            
            // Update the ticker as active in the main tickers table
            await this.dbManager.updateTicker(symbol, {
                active: true,
                price: price,
                updateValidated: true  // Mark as validated during this check
            });
            
            console.log(`✅ Marked ${symbol} as active with price: $${price}`);
            return { ticker: symbol, success: true };
        } catch (error) {
            console.log(`⚠️  Could not mark ${ticker} as active: ${error.message}`);
            throw error;
        }
    }

    async close() {
        if (this.dbManager) {
            await this.dbManager.disconnect();
            console.log('✅ Database connections closed');
        }
    }
}

// Helper function to safely convert Unix timestamps to dates
function safeTimestampToDate(timestamp) {
    if (!timestamp || timestamp === 0) return null;
    
    try {
        // Convert to number if it's a string
        const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
        
        // Check if timestamp is reasonable (between 1900 and 2100)
        const minTimestamp = -2208988800; // 1900-01-01
        const maxTimestamp = 4102444800;  // 2100-01-01
        
        if (ts < minTimestamp || ts > maxTimestamp) {
            console.log(`⚠️  Invalid timestamp ${ts}, skipping`);
            return null;
        }
        
        const date = new Date(ts * 1000);
        
        // Validate the resulting date
        if (isNaN(date.getTime())) {
            console.log(`⚠️  Invalid date from timestamp ${ts}, skipping`);
            return null;
        }
        
        return date.toISOString().split('T')[0];
    } catch (error) {
        console.log(`⚠️  Error converting timestamp ${timestamp}: ${error.message}`);
        return null;
    }
}

// Helper function to safely convert Unix timestamps to ISO strings
function safeTimestampToISO(timestamp) {
    if (!timestamp || timestamp === 0) return null;
    
    try {
        const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp;
        const minTimestamp = -2208988800; // 1900-01-01
        const maxTimestamp = 4102444800;  // 2100-01-01
        
        if (ts < minTimestamp || ts > maxTimestamp) {
            return null;
        }
        
        const date = new Date(ts * 1000);
        if (isNaN(date.getTime())) {
            return null;
        }
        
        return date.toISOString();
    } catch (error) {
        return null;
    }
}

// New: Use same reliable chart endpoint as validate process
async function getTickerDataFromChart(symbol) {
    try {
        // Set current ticker for validation warning tracking
        setCurrentProcessingTicker(symbol);
        
        // Get random user agent and increment request counter
        const userAgent = globalProcessor ? globalProcessor.userAgents[Math.floor(Math.random() * globalProcessor.userAgents.length)] : 'Mozilla/5.0 (compatible; TickerBot/1.0)';
        if (globalProcessor) {
            globalProcessor.requestCounter++;
            
            // Check if we need to refresh session
            if (globalProcessor.requestCounter % globalProcessor.refreshInterval === 0) {
                console.log(`🔄 Session refresh after ${globalProcessor.requestCounter} requests...`);
                await globalProcessor.refreshSession();
            }
        }
        
        // Use single comprehensive chart endpoint for ALL data (Option 1 implementation)
        // This gets full historical data from 1900 to now in one API call
        const axios = require('axios');
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=0&period2=9999999999&interval=1d&includePrePost=true&events=div%2Csplit`;
        
        const response = await axios.get(url, {
            timeout: 15000, // Increased timeout for comprehensive data requests
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            },
            // Add retry and error handling
            maxRedirects: 3,
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Reject only on HTTP errors
            }
        });

        // Check for rate limiting in response (same as validate)
        if (isRateLimitError(response)) {
            throw new RateLimitError(`Rate limit detected for ${symbol}`);
        }

        // Parse the chart data
        if (!response.data || !response.data.chart || !response.data.chart.result || response.data.chart.result.length === 0) {
            throw new Error('Invalid ticker - no chart data');
        }

        const result = response.data.chart.result[0];
        const meta = result.meta;
        const timestamps = result.timestamp || [];
        const indicators = result.indicators;
        const quotes = indicators?.quote?.[0] || {};
        const events = result.events || {};
        
        // Extract dividend and split information with safe timestamp conversion
        const dividends = [];
        if (events.dividends) {
            Object.entries(events.dividends).forEach(([timestamp, divData]) => {
                const date = safeTimestampToDate(timestamp);
                if (date) {
                    dividends.push({
                        date: date,
                        amount: divData.amount
                    });
                }
            });
        }

        const splits = [];
        if (events.splits) {
            Object.entries(events.splits).forEach(([timestamp, splitData]) => {
                const date = safeTimestampToDate(timestamp);
                if (date) {
                    splits.push({
                        date: date,
                        numerator: splitData.numerator,
                        denominator: splitData.denominator,
                        splitRatio: `${splitData.numerator}:${splitData.denominator}`
                    });
                }
            });
        }
        
        // Extract current quote data from meta with safe timestamp conversion
        const currentQuote = {
            symbol: meta.symbol,
            regularMarketPrice: meta.regularMarketPrice,
            regularMarketTime: safeTimestampToISO(meta.regularMarketTime),
            regularMarketDayHigh: meta.regularMarketDayHigh,
            regularMarketDayLow: meta.regularMarketDayLow,
            regularMarketVolume: meta.regularMarketVolume,
            regularMarketPreviousClose: meta.regularMarketPreviousClose,
            regularMarketOpen: meta.regularMarketDayOpen || meta.regularMarketOpen,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
            currency: meta.currency,
            exchangeName: meta.exchangeName,
            instrumentType: meta.instrumentType,
            firstTradeDate: safeTimestampToISO(meta.firstTradeDate),
            regularMarketTimeZone: meta.timezone,
            fullExchangeName: meta.fullExchangeName,
            longName: meta.longName,
            shortName: meta.shortName
        };

        // Extract historical data from timestamps and quotes with safe date conversion
        const historicalData = [];
        if (timestamps.length > 0 && quotes.close) {
            for (let i = 0; i < timestamps.length; i++) {
                if (quotes.close[i] !== null) {
                    const date = safeTimestampToDate(timestamps[i]);
                    if (date) {
                        historicalData.push({
                            date: date,
                            open: quotes.open?.[i] || null,
                            high: quotes.high?.[i] || null,
                            low: quotes.low?.[i] || null,
                            close: quotes.close[i],
                            volume: quotes.volume?.[i] || null
                        });
                    }
                }
            }
        }

        // Calculate derived statistics
        const closePrices = historicalData.map(d => d.close).filter(p => p !== null);
        const volumes = historicalData.map(d => d.volume).filter(v => v !== null);

        // Clear current ticker
        setCurrentProcessingTicker(null);

        // Create structured data with metadata (similar to original but from single endpoint)
        const tickerDataWithMetadata = {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                version: '2.0.0',
                source: 'yahoo-chart-comprehensive-api',
                error: false,
                errorMessage: null,
                hadValidationWarnings: hasValidationWarning(symbol)
            },
            quote: currentQuote,
            historical: historicalData,
            dividends: dividends,
            splits: splits,
            summary: {
                // Basic summary from available chart data
                regularMarketPrice: meta.regularMarketPrice,
                regularMarketDayHigh: meta.regularMarketDayHigh,
                regularMarketDayLow: meta.regularMarketDayLow,
                regularMarketVolume: meta.regularMarketVolume,
                averageVolume: volumes.length > 0 ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : null,
                fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
                fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
                marketCap: null, // Not available in chart endpoint
                priceEarningsRatio: null, // Not available in chart endpoint
                earningsPerShare: null, // Not available in chart endpoint
                dividendYield: dividends.length > 0 ? 'Available in dividends array' : null,
                beta: null, // Not available in chart endpoint
                // Calculated stats from historical data
                highestClose: closePrices.length > 0 ? Math.max(...closePrices).toFixed(2) : null,
                lowestClose: closePrices.length > 0 ? Math.min(...closePrices).toFixed(2) : null,
                priceRange: closePrices.length > 0 ? (Math.max(...closePrices) - Math.min(...closePrices)).toFixed(2) : null,
                // Additional statistics from comprehensive data
                totalDividends: dividends.length,
                totalSplits: splits.length,
                firstTradeDate: safeTimestampToDate(meta.firstTradeDate),
                dataPoints: historicalData.length
            },
            error: null
        };

        return tickerDataWithMetadata;

    } catch (error) {
        // Check if this is a rate limiting error
        if (isRateLimitError(error)) {
            await handleRateLimitError(error, symbol);
        }
        
        // Check for network stream errors
        if (error.code === 'ECONNRESET' || error.message.includes('network error') || error.message.includes('socket hang up')) {
            console.log(`🌐 Network error for ${symbol}, will retry in next batch: ${error.message}`);
        } else {
            console.log(`❌ Error processing ${symbol}: ${error.message}`);
        }
        
        // Clear current ticker
        setCurrentProcessingTicker(null);
        
        // Return error structure
        return {
            metadata: {
                symbol: symbol,
                fetchDate: new Date().toISOString(),
                version: '2.0.0',
                source: 'yahoo-chart-comprehensive-api',
                error: true,
                errorMessage: error.message,
                hadValidationWarnings: hasValidationWarning(symbol)
            },
            quote: null,
            historical: null,
            dividends: null,
            splits: null,
            summary: null,
            error: error.message
        };
    }
}

async function getTickerData(symbol) {
    try {
        // Set current ticker for validation warning tracking
        setCurrentProcessingTicker(symbol);
        
        // Get random user agent and increment request counter (borrowed from old validator)
        const userAgent = globalProcessor ? globalProcessor.userAgents[Math.floor(Math.random() * globalProcessor.userAgents.length)] : 'Mozilla/5.0 (compatible; TickerBot/1.0)';
        if (globalProcessor) {
            globalProcessor.requestCounter++;
            
            // Check if we need to refresh session (borrowed from old validator)
            if (globalProcessor.requestCounter % globalProcessor.refreshInterval === 0) {
                console.log(`🔄 Session refresh after ${globalProcessor.requestCounter} requests...`);
                await globalProcessor.refreshSession();
            }
        }
        
        // Get comprehensive ticker data with error suppression and optimized timeouts
        const quote = await yahooFinance.quote(symbol, {}, { 
            validateResult: false,
            timeout: 3000, // Faster timeout from old validator
            headers: { 'User-Agent': userAgent }
        });
        const historicalData = await yahooFinance.historical(symbol, {
            period1: '1900-01-01',
            period2: new Date().toISOString().split('T')[0],
            interval: '1d'
        }, { 
            validateResult: false,
            timeout: 3000, // Faster timeout from old validator
            headers: { 'User-Agent': userAgent }
        });
        const summary = await yahooFinance.quoteSummary(symbol, {
            modules: ['summaryDetail', 'financialData', 'defaultKeyStatistics', 'assetProfile']
        }, { 
            validateResult: false,
            timeout: 3000, // Faster timeout from old validator
            headers: { 'User-Agent': userAgent }
        });

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
        // Check for rate limiting errors first
        if (isRateLimitError(error)) {
            await handleRateLimitError(error, symbol);
        }
        
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

// Ticker data processing functions
class TickerDataProcessor {
    constructor() {
        this.database = new TickerDataDatabase();
        this.concurrency = 6; // Controlled concurrency for optimal performance
        this.requestCounter = 0; // Track total API requests for session refresh
        this.refreshInterval = 2000; // Frequent refresh since we're making fewer but larger requests
        this.requestDelay = 250; // Longer delay between comprehensive requests
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)'
        ];
        this.retryDelay = 500; // Optimized: faster retry for errors
        this.maxRetries = 3;
        this.processingStats = {
            total: 0,
            successful: 0,
            failed: 0,
            skipped: 0,
            inactiveMarked: 0
        };
    }

    // Get a random active ticker for session refresh to avoid rate limiting on AAPL
    async getRandomActiveTicker() {
        try {
            // Get a few random active tickers from database
            const query = `
                SELECT symbol 
                FROM tickers 
                WHERE active = true 
                    AND price IS NOT NULL 
                    AND last_updated > NOW() - INTERVAL '7 days'
                ORDER BY RANDOM() 
                LIMIT 5
            `;
            
            const result = await this.database.query(query);
            
            if (result.rows.length > 0) {
                // Return a random ticker from the results
                const randomTicker = result.rows[Math.floor(Math.random() * result.rows.length)];
                return randomTicker.symbol;
            }
        } catch (error) {
            console.log('⚠️  Could not get random active ticker:', error.message);
        }
        
        // Fallback to a list of reliable tickers if database query fails
        const fallbackTickers = ['MSFT', 'GOOGL', 'TSLA', 'AMZN', 'META', 'NVDA', 'JPM', 'JNJ'];
        return fallbackTickers[Math.floor(Math.random() * fallbackTickers.length)];
    }

    // Session refresh to prevent rate limiting (borrowed from old validator)
    async refreshSession() {
        try {
            console.log('🔄 Refreshing session to prevent rate limiting...');
            
            // Use random active ticker instead of always AAPL
            const refreshSymbol = await this.getRandomActiveTicker();
            console.log(`📊 Using ${refreshSymbol} for session refresh`);
            
            const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
            
            await yahooFinance.quote(refreshSymbol, {}, { 
                validateResult: false,
                timeout: 10000, // Increased timeout
                headers: { 'User-Agent': userAgent }
            });
            
            console.log('✅ Session refreshed successfully');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Longer pause after refresh
        } catch (error) {
            console.log('⚠️  Session refresh warning (continuing anyway):', error.message);
            
            // If refresh failed, wait longer before continuing
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    async initialize() {
        await this.database.initializeDatabase();
    }

    async getActiveTickers() {
        const result = await this.database.dbManager.query(`
            SELECT (symbol || '.' || COALESCE(json_extract(exchanges, '$[0]'), 'UNKNOWN')) as ticker, 
                   symbol, 
                   json_extract(exchanges, '$[0]') as exchange
            FROM tickers 
            WHERE active = 1
            ORDER BY updated_at ASC
        `);
        
        return result.rows;
    }

    async getUnvalidatedTickers() {
        const result = await this.database.dbManager.query(`
            SELECT symbol, exchanges
            FROM tickers 
            WHERE active IS NULL
            ORDER BY symbol
            LIMIT 1000
        `);
        
        // Convert to the expected format that includes individual exchange combinations
        const tickers = [];
        for (const row of result.rows) {
            const exchanges = JSON.parse(row.exchanges || '[]');
            for (const exchange of exchanges) {
                tickers.push({
                    ticker: `${row.symbol}.${exchange}`,
                    symbol: row.symbol,
                    exchange: exchange
                });
            }
        }
        
        return tickers;
    }

    async getTickersNeedingValidation(daysThreshold = 5) {
        const result = await this.database.dbManager.query(`
            SELECT t.symbol, t.exchanges
            FROM tickers t
            WHERE t.active = 1
                AND (t.updated_at IS NULL OR t.updated_at < datetime('now', '-${daysThreshold} days'))
            ORDER BY t.updated_at ASC
            LIMIT 1000
        `);
        
        // Return symbols with their exchanges (no longer creating duplicate entries per exchange)
        const tickers = [];
        for (const row of result.rows) {
            tickers.push({
                ticker: row.symbol, // Use symbol only, not symbol.exchange
                symbol: row.symbol,
                exchanges: JSON.parse(row.exchanges || '[]') // Parse JSON exchanges
            });
        }
        
        return tickers;
    }

    async getTickersNeedingUpdate(hoursThreshold = 24) {
        const result = await this.database.dbManager.query(`
            SELECT t.symbol, t.exchanges
            FROM tickers t
            WHERE t.active = 1
                AND (t.updated_at IS NULL OR t.updated_at < datetime('now', '-${hoursThreshold} hours'))
            ORDER BY t.updated_at ASC
            LIMIT 1000
        `);
        
        // Return symbols with their exchanges (no longer creating duplicate entries per exchange)
        const tickers = [];
        for (const row of result.rows) {
            tickers.push({
                ticker: row.symbol, // Use symbol only, not symbol.exchange
                symbol: row.symbol,
                exchanges: JSON.parse(row.exchanges || '[]') // Parse JSON exchanges
            });
        }
        
        return tickers;
    }

    async processTickersConcurrent(tickers, skipRecent = true, hoursThreshold = 24) {
        console.log(`🚀 Starting concurrent ticker processing...`);
        console.log(`📊 Total tickers to process: ${tickers.length}`);
        console.log(`⚙️  Concurrency: ${this.concurrency}`);
        console.log(`⏱️  Skip recent (${hoursThreshold}h): ${skipRecent ? 'Yes' : 'No'}`);
        console.log('=' .repeat(50));

        const startTime = Date.now();
        this.processingStats = { total: tickers.length, successful: 0, failed: 0, skipped: 0, inactiveMarked: 0 };

        // Enable error suppression during processing
        toggleErrorSuppression(true);

        // Process in batches with concurrency control
        const batches = [];
        for (let i = 0; i < tickers.length; i += this.concurrency) {
            batches.push(tickers.slice(i, i + this.concurrency));
        }

        let processedCount = 0;
        for (const [batchIndex, batch] of batches.entries()) {
            const batchStartTime = Date.now();
            
            // Check if we need to refresh session (borrowed from old validator)
            if (this.requestCounter > 0 && this.requestCounter % this.refreshInterval === 0) {
                await this.refreshSession();
            }
            
            console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} tickers)`);
            
            // Process batch concurrently with rate limit error detection
            try {
                const batchPromises = batch.map(tickerInfo => this.processTickerWithRetry(tickerInfo, skipRecent, hoursThreshold));
                const batchResults = await Promise.allSettled(batchPromises);
                
                // Check for rate limiting errors in results
                for (let i = 0; i < batchResults.length; i++) {
                    const result = batchResults[i];
                    if (result.status === 'rejected' && result.reason instanceof RateLimitError) {
                        throw result.reason; // Re-throw rate limiting error to stop processing
                    }
                }
                
                // Process results
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        const { status } = result.value;
                        this.processingStats[status]++;
                    } else {
                        console.error(`❌ Batch error for ${batch[index].ticker}:`, result.reason);
                        this.processingStats.failed++;
                    }
                });
            } catch (error) {
                // If it's a rate limiting error, let it bubble up to restart the process
                if (error instanceof RateLimitError) {
                    throw error;
                }
                // Handle other errors normally
                console.error(`❌ Batch processing error:`, error);
                throw error;
            }

            processedCount += batch.length;
            const batchTime = Date.now() - batchStartTime;
            const tickersPerSecond = (batch.length / batchTime * 1000).toFixed(2);
            
            console.log(`✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s (${tickersPerSecond} tickers/sec)`);
            this.logProgress(processedCount, startTime);
            
            // Pause between batches for optimal performance
            if (batchIndex < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay for performance management
            }
        }

        // Disable error suppression
        toggleErrorSuppression(false);

        const totalTime = Date.now() - startTime;
        const overallRate = (processedCount / (totalTime / 1000)).toFixed(2);
        
        console.log(`\n🎉 Processing completed!`);
        console.log(`📊 Total: ${this.processingStats.total}, Successful: ${this.processingStats.successful}, Failed: ${this.processingStats.failed}, Skipped: ${this.processingStats.skipped}`);
        console.log(`🔄 Marked inactive: ${this.processingStats.inactiveMarked}`);
        console.log(`⚡ Overall rate: ${overallRate} tickers/second`);
        console.log(`⏱️  Total time: ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
        
        return this.processingStats;
    }

    async processTickerWithRetry(tickerInfo, skipRecent, hoursThreshold) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.processTicker(tickerInfo, skipRecent, hoursThreshold);
            } catch (error) {
                // Let rate limiting errors bubble up immediately to restart the process
                if (error instanceof RateLimitError) {
                    throw error;
                }
                
                if (attempt === this.maxRetries) {
                    console.error(`❌ Final attempt failed for ${tickerInfo.ticker}: ${error.message}`);
                    return { status: 'failed', ticker: tickerInfo.ticker, error: error.message };
                }
                
                console.log(`⚠️  Attempt ${attempt}/${this.maxRetries} failed for ${tickerInfo.ticker}, retrying...`);
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
        }
    }

    async processTicker(tickerInfo, skipRecent = true, hoursThreshold = 24) {
        try {
            const ticker = tickerInfo.ticker;
            
            // Check if ticker was recently processed
            if (skipRecent) {
                const recentCheck = await this.database.isTickerRecentlyChecked(ticker, hoursThreshold);
                if (recentCheck.isRecent) {
                    return { status: 'skipped', ticker, reason: `Updated ${recentCheck.hoursSince}h ago` };
                }
            }

            // Get ticker data using same reliable chart endpoint as validate process
            const symbolOnly = ticker.includes('.') ? ticker.split('.')[0] : ticker;
            const tickerData = await getTickerDataFromChart(symbolOnly);
            
            // Add delay between API requests to be gentler on Yahoo Finance
            if (this.requestDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.requestDelay));
            }
            
            // Check if data retrieval was successful
            if (tickerData.metadata.error) {
                // Mark ticker as inactive if there was an error
                await this.database.markTickerInactive(ticker, tickerData.metadata.errorMessage);
                return { status: 'inactiveMarked', ticker, reason: tickerData.metadata.errorMessage };
            }
            
            // Store raw JSON in database
            await this.database.insertOrUpdateTicker(ticker, tickerData);
            
            // Store structured data in normalized tables
            console.log(`📊 Processing structured data for ${ticker}...`);
            await this.database.dbManager.processTickerData({
                ticker: ticker,
                data: tickerData
            });
            
            // Mark ticker as active with current price
            const currentPrice = tickerData.quote?.regularMarketPrice || 
                                tickerData.quote?.ask || 
                                tickerData.quote?.bid || 
                                tickerData.quote?.price || 0;
            await this.database.markTickerActive(ticker, currentPrice);
            
            return { status: 'successful', ticker };
            
        } catch (error) {
            const errorMessage = error.message.toLowerCase();
            const isMemoryError = errorMessage.includes('out of shared memory') || 
                                errorMessage.includes('memory') ||
                                errorMessage.includes('out of memory');
            
            if (isMemoryError) {
                console.error(`💾 Memory error processing ${tickerInfo.ticker}: ${error.message}`);
                // For memory errors, wait longer before continuing
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }
            } else {
                console.error(`❌ Error processing ${tickerInfo.ticker}: ${error.message}`);
            }
            
            throw error;
        }
    }

    logProgress(processedCount, startTime) {
        const elapsedTime = Date.now() - startTime;
        const remainingTickers = this.processingStats.total - processedCount;
        const overallRate = processedCount / (elapsedTime / 1000);
        
        if (remainingTickers > 0 && overallRate > 0) {
            const eta = this.calculateETA(remainingTickers, overallRate);
            console.log(`⏱️  Progress: ${processedCount}/${this.processingStats.total} (${(processedCount/this.processingStats.total*100).toFixed(1)}%) - ETA: ${eta}`);
        }
        
        console.log(`📈 Success: ${this.processingStats.successful}, Failed: ${this.processingStats.failed}, Skipped: ${this.processingStats.skipped}, Inactive: ${this.processingStats.inactiveMarked}`);
    }

    calculateETA(remainingTickers, tickersPerSecond) {
        if (tickersPerSecond === 0) return 'Unknown';
        
        const remainingSeconds = remainingTickers / tickersPerSecond;
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    async close() {
        await this.database.close();
    }
}

// Main execution function
async function main() {
    if (require.main === module) {
        const processor = new TickerDataProcessor();
        globalProcessor = processor; // Set global reference for session refresh access
        
        // Check for help flag
        const args = process.argv.slice(2);
        if (args.includes('--help') || args.includes('-h')) {
            console.log('📊 Ticker Data Processor - SQLite Edition');
            console.log('=' .repeat(50));
            console.log('Fetches and stores comprehensive ticker data from Yahoo Finance');
            console.log('');
            console.log('Usage: node return-data.js [options]');
            console.log('');
            console.log('Options:');
            console.log('  --all           Process all active tickers (ignores time limits)');
            console.log('  --fresh         Force fresh data fetch (ignore recent data)');
            console.log('  --validate      Validate tickers (unvalidated + active tickers >5 days old)');
            console.log('  --unvalidated   Same as --validate');
            console.log('  --hours=N       Only process tickers older than N hours (default: 24)');
            console.log('  --help, -h      Show this help message');
            console.log('');
            console.log('Examples:');
            console.log('  node return-data.js                    # Update tickers older than 24 hours');
            console.log('  node return-data.js --validate         # Validate unvalidated and revalidate active tickers');
            console.log('  node return-data.js --all --fresh      # Force update all active tickers');
            console.log('  node return-data.js --hours=6          # Update tickers older than 6 hours');
            console.log('');
            console.log('Note: --validate processes both unvalidated tickers (active IS NULL) and');
            console.log('      active tickers that haven\'t been validated in 5+ days.');
            console.log('Note: Use --validate to process generated ticker combinations and');
            console.log('      determine which ones represent real, active stocks.');
            return;
        }
        
        try {
            console.log('📊 Ticker Data Processor - SQLite Edition');
            console.log('=' .repeat(50));
            
            await processor.initialize();
            
            // Get command line arguments
            const args = process.argv.slice(2);
            const allFlag = args.includes('--all');
            const freshFlag = args.includes('--fresh');
            const validateFlag = args.includes('--validate');
            const unvalidatedFlag = args.includes('--unvalidated');
            const hoursArg = args.find(arg => arg.startsWith('--hours='));
            const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 24;
            
            console.log('📊 Getting database statistics...');
            const stats = await processor.database.dbManager.getStats();
            const tickerDataCount = await processor.database.getTickerCount();
            const unvalidatedCount = await processor.getUnvalidatedTickers();
            
            console.log(`📈 Tickers: ${stats.total} (Active: ${stats.active_count}, Inactive: ${stats.inactive_count}, Unvalidated: ${unvalidatedCount.length})`);
            console.log(`💾 Stored ticker data: ${tickerDataCount} records`);
            
            // Get tickers to process based on flags
            let tickersToProcess;
            if (validateFlag || unvalidatedFlag) {
                console.log('🔍 Getting tickers for validation...');
                // First get truly unvalidated tickers (active IS NULL)
                const unvalidatedTickers = await processor.getUnvalidatedTickers();
                // Then get active tickers that need revalidation (older than 5 days)
                const revalidationTickers = await processor.getTickersNeedingValidation(5);
                
                tickersToProcess = [...unvalidatedTickers, ...revalidationTickers];
                
                if (unvalidatedTickers.length > 0) {
                    console.log(`📋 Found ${unvalidatedTickers.length} unvalidated tickers`);
                }
                if (revalidationTickers.length > 0) {
                    console.log(`📋 Found ${revalidationTickers.length} active tickers needing revalidation (>5 days)`);
                }
            } else if (allFlag) {
                console.log('🔍 Getting ALL active tickers...');
                tickersToProcess = await processor.getActiveTickers();
            } else {
                console.log(`🔍 Getting tickers needing update (older than ${hours} hours)...`);
                tickersToProcess = await processor.getTickersNeedingUpdate(hours);
            }
            
            if (tickersToProcess.length === 0) {
                console.log('✅ No tickers need data processing at this time!');
                
                // If no active tickers found, suggest validation options
                if (!validateFlag && !unvalidatedFlag) {
                    const unvalidatedTickers = await processor.getUnvalidatedTickers();
                    const revalidationTickers = await processor.getTickersNeedingValidation(5);
                    
                    if (unvalidatedTickers.length > 0 || revalidationTickers.length > 0) {
                        console.log(`💡 Tip: Found ${unvalidatedTickers.length} unvalidated tickers and ${revalidationTickers.length} active tickers needing revalidation. Run with --validate to process them.`);
                    }
                }
            } else {
                console.log(`📋 Found ${tickersToProcess.length} tickers needing data processing`);
                
                // Process the tickers
                const skipRecent = !freshFlag;
                await processor.processTickersConcurrent(tickersToProcess, skipRecent, hours);
                
                // Final statistics
                console.log('\n📊 Final statistics...');
                const finalTickerDataCount = await processor.database.getTickerCount();
                console.log(`💾 Final ticker data count: ${finalTickerDataCount} records (+${finalTickerDataCount - tickerDataCount})`);
            }
            
        } catch (error) {
            if (error instanceof RateLimitError) {
                console.log('🔄 Rate limit detected, restarting process...');
                await processor.close();
                
                // Restart the process by calling main again
                console.log('♻️  Restarting ticker processing...');
                return await main();
            } else {
                console.error('❌ Application error:', error);
            }
        } finally {
            await processor.close();
        }
    }
}

// Export the classes and functions
module.exports = {
    TickerDataDatabase,
    TickerDataProcessor,
    getTickerData,
    setCurrentProcessingTicker,
    getCurrentProcessingTicker,
    hasValidationWarning,
    toggleErrorSuppression,
    RateLimitError,
    isRateLimitError,
    handleRateLimitError
};

// Run main if this is the main module
main();