const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const { createDatabaseManager } = require('./src/db/database-factory');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Store running processes for interactive input
// Initialize process tracking
const runningProcesses = new Map();

// Global instances for export progress tracking
let dataExporterInstance = null;

// Helper function to get or create data exporter instance
async function getDataExporter() {
    if (!dataExporterInstance) {
        const { DataExporter } = require('./src/export/export-data');
        // Ensure dbManager is initialized
        if (!dbManager) {
            throw new Error('Database manager not initialized');
        }
        // Pass the existing dbManager to avoid creating new connections
        dataExporterInstance = new DataExporter(dbManager);
        await dataExporterInstance.initialize();
    }
    return dataExporterInstance;
}

// Clean up old completed processes periodically (every 10 minutes)
setInterval(() => {
    const now = new Date();
    const processesToCleanup = [];
    
    for (const [processId, processInfo] of runningProcesses.entries()) {
        // Clean up processes completed more than 10 minutes ago
        if (processInfo.status === 'completed' || processInfo.status === 'failed') {
            if (processInfo.endTime && (now - processInfo.endTime) > 10 * 60 * 1000) {
                processesToCleanup.push(processId);
            }
        }
        // Clean up very old running processes (more than 2 hours)
        else if (processInfo.status === 'running') {
            if (processInfo.startTime && (now - processInfo.startTime) > 2 * 60 * 60 * 1000) {
                processesToCleanup.push(processId);
            }
        }
    }
    
    if (processesToCleanup.length > 0) {
        console.log(`🧹 Cleaning up ${processesToCleanup.length} old processes...`);
        processesToCleanup.forEach(processId => {
            runningProcesses.delete(processId);
        });
    }
}, 10 * 60 * 1000); // Every 10 minutes

// Helper function to format duration in human-readable format
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    } else if (minutes > 0) {
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        return `${seconds}s`;
    }
}

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// JSON Export endpoint
app.post('/api/export', async (req, res) => {
    try {
        const { filename, historicalDays, activeOnly } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        console.log(`📤 Starting JSON export with historical data: ${historicalDays ? `${historicalDays} days` : 'all data'}, active only: ${activeOnly ? 'yes' : 'no'}`);
        
        // Use SQLite manager's built-in export method
        const exportPath = path.join(__dirname, 'output', filename);
        
        // Ensure output directory exists
        if (!fs.existsSync(path.dirname(exportPath))) {
            fs.mkdirSync(path.dirname(exportPath), { recursive: true });
        }
        
        await dbManager.exportToJSON(exportPath, { historicalDays, activeOnly });
        
        res.json({
            success: true,
            message: `Export completed successfully`,
            exportPath
        });
        
    } catch (error) {
        console.error('❌ Export error:', error);
        res.status(500).json({ 
            error: `Failed to export data: ${error.message}` 
        });
    }
});

// CSV Export endpoint
app.post('/api/export-csv', async (req, res) => {
    try {
        const { filename, historicalDays, activeOnly } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        console.log(`📤 Starting CSV export with historical data: ${historicalDays ? `${historicalDays} days` : 'all data'}, active only: ${activeOnly ? 'yes' : 'no'}`);
        
        // Use SQLite manager's built-in export method
        const exportPath = path.join(__dirname, 'output', filename);
        
        // Ensure output directory exists
        if (!fs.existsSync(path.dirname(exportPath))) {
            fs.mkdirSync(path.dirname(exportPath), { recursive: true });
        }
        
        await dbManager.exportToCSV(exportPath, { historicalDays, activeOnly });
        
        res.json({
            success: true,
            message: `CSV export completed successfully`,
            exportPath
        });
        
    } catch (error) {
        console.error('❌ CSV Export error:', error);
        res.status(500).json({ 
            error: `Failed to export CSV data: ${error.message}` 
        });
    }
});

// Initialize database manager
let dbManager = null;

// Connect to database on startup
async function initializeDatabase() {
    try {
        dbManager = await createDatabaseManager();
        console.log('✅ Database connected successfully');
    } catch (error) {
        console.error('❌ Failed to connect to database:', error.message);
        process.exit(1);
    }
}

// Initialize database connection
initializeDatabase();

// API Routes
app.get('/api/status', async (req, res) => {
    try {
        const stats = await dbManager.getStats();
        
        // Get recent activity - last 10 updated tickers
        const recentActivity = await dbManager.query(`
            SELECT t.symbol as ticker, t.exchanges, t.active, q.current_price as price, t.updated_at as last_updated 
            FROM tickers t
            LEFT JOIN ticker_quotes q ON t.id = q.ticker_id
            WHERE t.updated_at IS NOT NULL 
            ORDER BY t.updated_at DESC 
            LIMIT 10
        `);

        // Transform stats to match frontend expectations
        const transformedStats = {
            total: stats.total || '0',
            active: stats.active_count || '0',
            validated: stats.validated_count || '0', 
            need_validation: stats.unvalidated_count || '0',
            need_data_update: '0', // We'll calculate this separately if needed
            historical_count: stats.historical_count || '0',
            total_historical_records: stats.total_historical_records || '0',
            database_size: stats.database_size || 'Unknown'
        };

        // Get running process information
        const runningProcessInfo = Array.from(runningProcesses.entries()).map(([processId, process]) => {
            const currentTime = Date.now();
            const startTime = process.startTime || currentTime;
            const durationMs = currentTime - startTime;
            
            return {
                processId,
                command: process.command || 'unknown',
                startTime: process.startTime || currentTime,
                duration: durationMs,
                formattedDuration: formatDuration(durationMs)
            };
        });

        res.json({
            status: 'ready',
            stats: transformedStats,
            recentActivity: recentActivity.rows,
            runningProcesses: runningProcessInfo
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tickers', async (req, res) => {
    try {
        const { page = 1, limit = 50, filter = 'all', search = '' } = req.query;
        const offset = (page - 1) * limit;

        // Use the SQLite manager's search function
        const searchTerm = search && search.trim() ? search.trim().toUpperCase() : '';
        let tickers;
        let totalCount;
        
        if (searchTerm) {
            const searchResults = await dbManager.searchTickers(searchTerm, parseInt(limit), parseInt(offset));
            tickers = searchResults.data.map(row => ({
                ticker: row.symbol,
                exchanges: row.exchanges,
                active: row.active,
                last_checked: row.updated_at,
                regular_market_price: row.current_price,
                market_cap: row.market_cap,
                quote_time: row.quote_time
            }));
            totalCount = searchResults.total;
        } else {
            // Build filter conditions for SQLite
            let whereClause = '';
            const queryParams = [];
            
            if (filter === 'active') {
                whereClause = 'WHERE t.active = 1';
            } else if (filter === 'inactive') {
                whereClause = 'WHERE t.active = 0';
            } else if (filter === 'validated') {
                whereClause = 'WHERE t.updated_at IS NOT NULL';
            }
            
            queryParams.push(limit, offset);
            
            const query = `
                SELECT t.symbol as ticker, t.exchanges, t.active, t.updated_at as last_checked,
                       tq.current_price as regular_market_price, tq.market_cap, tq.quote_time
                FROM tickers t
                LEFT JOIN ticker_quotes tq ON tq.ticker_id = t.id 
                    AND tq.quote_time = (
                        SELECT MAX(quote_time) 
                        FROM ticker_quotes 
                        WHERE ticker_id = t.id
                    )
                ${whereClause}
                ORDER BY t.symbol
                LIMIT ? OFFSET ?
            `;
            
            const result = await dbManager.query(query, queryParams);
            tickers = result.rows;
            
            // Get total count for non-search queries
            const totalResult = await dbManager.query(`
                SELECT COUNT(*) as count FROM tickers t
                ${filter === 'active' ? 'WHERE t.active = 1' : 
                  filter === 'inactive' ? 'WHERE t.active = 0' : 
                  filter === 'validated' ? 'WHERE t.updated_at IS NOT NULL' : ''}
            `);
            totalCount = parseInt(totalResult.rows[0].count);
        }

        res.json({ 
            tickers, 
            total: totalCount, 
            page: parseInt(page), 
            limit: parseInt(limit),
            search: search || '',
            filter
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get all tickers with errors/failures
app.get('/api/tickers/errors', async (req, res) => {
    try {
        const { page = 1, limit = 50, search = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = `WHERE (t.active = false OR t.price = -1 OR array_length(t.exchanges, 1) IS NULL)`;
        const queryParams = [];
        let paramIndex = 1;
        
        // Add search functionality for errors
        if (search && search.trim()) {
            whereClause += ` AND t.symbol ILIKE $${paramIndex++}`;
            queryParams.push(`%${search.trim().toUpperCase()}%`);
        }
        
        // Add limit and offset to query params
        queryParams.push(limit, offset);

        const errors = await dbManager.query(`
            SELECT t.symbol as ticker, t.active, t.price, t.exchanges, t.last_updated as last_checked,
                   CASE 
                       WHEN t.active = false THEN 'Ticker inactive'
                       WHEN t.price = -1 THEN 'Price unavailable'
                       WHEN array_length(t.exchanges, 1) IS NULL THEN 'No exchange data'
                       ELSE 'Unknown error'
                   END as error_type
            FROM tickers t
            ${whereClause}
            ORDER BY t.last_updated DESC, t.symbol 
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `, queryParams);

        const totalResult = await dbManager.query(`
            SELECT COUNT(*) as count 
            FROM tickers t
            ${whereClause.replace(/LIMIT.*/, '')}
        `, queryParams.slice(0, -2)); // Remove limit and offset

        res.json({ 
            errors: errors.rows, 
            total: parseInt(totalResult.rows[0].count), 
            page: parseInt(page), 
            limit: parseInt(limit),
            search: search || ''
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get all available stock data
app.get('/api/stock-data/all', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query; // Reduced default limit
        const offset = (page - 1) * limit;
        
        // Get ticker metadata with latest quote information
        const result = await dbManager.query(`
            SELECT t.symbol as ticker, t.updated_at as last_updated, t.created_at,
                   tq.current_price as regular_market_price, tq.market_cap, tq.quote_time,
                   (SELECT COUNT(*) FROM ticker_historical WHERE ticker_id = t.id) as historical_count
            FROM tickers t
            LEFT JOIN ticker_quotes tq ON tq.ticker_id = t.id 
                AND tq.quote_time = (
                    SELECT MAX(quote_time) 
                    FROM ticker_quotes 
                    WHERE ticker_id = t.id
                )
            WHERE t.active = 1
            ORDER BY t.updated_at DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const totalResult = await dbManager.query(`
            SELECT COUNT(*) as count FROM tickers WHERE active = 1
        `);

        const summaryData = result.rows.map(row => ({
            ticker: row.ticker,
            last_updated: row.last_updated,
            created_at: row.created_at,
            current_price: row.regular_market_price,
            market_cap: row.market_cap,
            historical_count: parseInt(row.historical_count),
            has_data: parseInt(row.historical_count) > 0
        }));

        res.json({ 
            success: true,
            data: summaryData, 
            total: parseInt(totalResult.rows[0].count), 
            page: parseInt(page), 
            limit: parseInt(limit),
            message: `Retrieved ${summaryData.length} of ${totalResult.rows[0].count} total active stock records`
        });

    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// API endpoint to get all data for a specific stock
app.get('/api/stock-data/:ticker', async (req, res) => {
    try {
        const ticker = req.params.ticker.toUpperCase();
        const [symbol, exchange] = ticker.includes('.') ? ticker.split('.') : [ticker, 'NYSE'];
        
        // Use the SQLite manager's getTickerData method
        const stockData = await dbManager.getTickerData(symbol, exchange);

        if (!stockData) {
            return res.json({ 
                success: false,
                found: false,
                ticker,
                message: `No data found for ticker: ${ticker}`
            });
        }

        res.json({ 
            success: true,
            found: true,
            ticker: stockData.ticker,
            last_updated: stockData.lastUpdated,
            created_at: stockData.createdAt,
            data: stockData.data,
            message: `Complete data retrieved for ${ticker}`
        });

    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// API endpoint to read ticker data from SQLite
app.get('/api/ticker-data', async (req, res) => {
    try {
        const { page = 1, limit = 50, ticker } = req.query;
        
        // Use the SQLite manager's getTickerDataPaginated method
        const result = await dbManager.getTickerDataPaginated(page, limit, ticker);
        
        // If specific ticker requested, return simplified format
        if (ticker) {
            const tickerData = result.data.length > 0 ? result.data[0] : null;
            return res.json({ 
                data: tickerData, 
                found: !!tickerData,
                ticker: ticker.toUpperCase()
            });
        }

        // For paginated data, add data size information (JSON length)
        const dataWithSize = result.data.map(row => ({
            ticker: row.ticker,
            last_updated: row.last_updated,
            created_at: row.created_at,
            data_size: JSON.stringify(row.json_data).length
        }));

        res.json({ 
            data: dataWithSize, 
            total: result.total, 
            page: result.page, 
            limit: result.limit,
            totalPages: result.totalPages
        });

    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            message: 'Error retrieving ticker data from SQLite'
        });
    }
});

app.post('/api/run-command', (req, res) => {
    const { command, input } = req.body;
    
    const allowedCommands = [
        'generate',
        'validate', 
        'revalidate-active',
        'revalidate-inactive',
        'gather',
        'export',
        'export-legacy',
        'test-validate',
        'pipeline',
        'monitor'
    ];

    if (!allowedCommands.includes(command)) {
        return res.status(400).json({ error: 'Invalid command' });
    }

    // Set headers for streaming
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked'
    });

    const child = spawn('npm', ['run', command], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
    });

    // Store process for interactive input and status tracking
    const processId = `${command}_${Date.now()}`;
    const startTime = new Date();
    const processInfo = {
        process: child,
        command: command,
        startTime: startTime,
        output: '', // Store accumulated output
        error: ''   // Store accumulated errors
    };
    runningProcesses.set(processId, processInfo);

    let output = '';
    let error = '';
    let isCompleted = false;
    let isWaitingForInput = false;

    // Send initial message with process ID for interactive commands
    if (command === 'generate' || command === 'pipeline') {
        res.write(`Starting ${command} command... (Process ID: ${processId})\n\n`);
    } else {
        res.write(`Starting ${command} command...\n\n`);
    }

    // Handle interactive prompts for generation and pipeline commands
    if ((command === 'generate' || command === 'pipeline') && input) {
        // Send the input immediately for non-interactive execution
        child.stdin.write(input + '\n');
        child.stdin.end();
    }

    child.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Store output in process info for later retrieval
        if (runningProcesses.has(processId)) {
            runningProcesses.get(processId).output += chunk;
        }
        
        if (!isCompleted) {
            res.write(chunk);
            
            // Check for interactive prompts
            if ((command === 'generate' || command === 'pipeline') && 
                chunk.includes('Do you want to regenerate all tickers?')) {
                isWaitingForInput = true;
                res.write('\n💡 This command requires user input. Use the input field below or run with input parameter.\n');
            }
        }
    });

    child.stderr.on('data', (data) => {
        const chunk = data.toString();
        error += chunk;
        
        // Store error output in process info for later retrieval
        if (runningProcesses.has(processId)) {
            runningProcesses.get(processId).error += chunk;
        }
        
        if (!isCompleted) {
            res.write(`STDERR: ${chunk}`);
        }
    });

    child.on('close', (code) => {
        if (!isCompleted) {
            isCompleted = true;
            runningProcesses.delete(processId); // Clean up stored process
            res.write(`\n\n--- Command Completed ---\n`);
            res.write(`Exit Code: ${code !== null ? code : 'unknown'}\n`);
            
            if (code === 0) {
                res.write(`✅ Command ${command} completed successfully!\n`);
            } else {
                res.write(`❌ Command ${command} failed with exit code ${code}!\n`);
                if (error) {
                    res.write(`\nError details:\n${error}\n`);
                }
            }
            res.end();
        }
    });

    child.on('error', (err) => {
        if (!isCompleted) {
            isCompleted = true;
            runningProcesses.delete(processId); // Clean up stored process
            res.write(`\nERROR: Failed to start command: ${err.message}\n`);
            res.end();
        }
    });

    child.on('exit', (code, signal) => {
        if (!isCompleted) {
            isCompleted = true;
            runningProcesses.delete(processId); // Clean up stored process
            res.write(`\n\n--- Process Exited ---\n`);
            res.write(`Exit Code: ${code}, Signal: ${signal}\n`);
            
            if (signal) {
                res.write(`⚠️  Process was terminated by signal: ${signal}\n`);
            } else if (code === 0) {
                res.write(`✅ Command ${command} completed successfully!\n`);
            } else {
                res.write(`❌ Command ${command} failed!\n`);
            }
            res.end();
        }
    });

    // Handle client disconnect - be lenient to prevent premature termination
    req.on('close', () => {
        if (!child.killed && !isCompleted) {
            console.log(`Client disconnected for command: ${command}`);
            // Don't immediately kill processes - let them complete naturally
            console.log(`Allowing ${command} to continue running despite client disconnect`);
            // Note: We don't write to res here since client is disconnected
        }
    });

    // Disable timeout for now - let commands complete naturally
    // const longRunningCommands = ['pipeline', 'generate', 'validate', 'gather', 'revalidate-active', 'revalidate-inactive'];
    // const timeoutDuration = longRunningCommands.includes(command) ? 45 * 60 * 1000 : 15 * 60 * 1000; // 45 min for long commands, 15 min for others
    // const timeoutMinutes = longRunningCommands.includes(command) ? 45 : 15;
    
    // const timeout = setTimeout(() => {
    //     if (!isCompleted) {
    //         res.write(`\n⚠️  Command timed out after ${timeoutMinutes} minutes\n`);
    //         child.kill('SIGTERM');
    //     }
    // }, timeoutDuration);

    // child.on('close', () => {
    //     clearTimeout(timeout);
    // });
});

// Send input to running interactive command
app.post('/api/send-input', (req, res) => {
    const { processId, input } = req.body;
    
    if (!processId || !input) {
        return res.status(400).json({ error: 'Process ID and input are required' });
    }
    
    const processInfo = runningProcesses.get(processId);
    if (!processInfo) {
        return res.status(404).json({ error: 'Process not found or already completed' });
    }
    
    try {
        processInfo.process.stdin.write(input + '\n');
        res.json({ success: true, message: 'Input sent to process' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send input to process' });
    }
});

// Validate individual ticker
app.post('/api/validate-ticker', async (req, res) => {
    try {
        const { symbol } = req.body;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Symbol is required' });
        }

        const FastTickerValidator = require('./src/validate/validate-tickers');
        const validator = new FastTickerValidator();
        
        const result = await validator.validateSingleTicker(symbol);
        
        res.json({
            success: true,
            symbol,
            result
        });
    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ 
            error: 'Failed to validate ticker',
            details: error.message 
        });
    }
});

// Get process output for live terminal display
app.get('/api/process-output/:processId', (req, res) => {
    const { processId } = req.params;
    
    const processInfo = runningProcesses.get(processId);
    if (!processInfo) {
        return res.status(404).json({ error: 'Process not found or already completed' });
    }
    
    res.json({
        processId,
        command: processInfo.command,
        output: processInfo.output,
        error: processInfo.error,
        startTime: processInfo.startTime,
        isRunning: true
    });
});

// Kill/terminate a running process
app.post('/api/kill-process', (req, res) => {
    const { processId } = req.body;
    
    if (!processId) {
        return res.status(400).json({ error: 'Process ID is required' });
    }
    
    const processInfo = runningProcesses.get(processId);
    if (!processInfo) {
        return res.status(404).json({ error: 'Process not found or already completed' });
    }
    
    try {
        // Kill the process
        processInfo.process.kill('SIGTERM');
        
        // Wait a bit and force kill if still running
        setTimeout(() => {
            if (!processInfo.process.killed) {
                processInfo.process.kill('SIGKILL');
            }
        }, 5000);
        
        // Clean up immediately
        runningProcesses.delete(processId);
        
        res.json({ 
            success: true, 
            message: `Process ${processId} (${processInfo.command}) has been terminated` 
        });
    } catch (error) {
        res.status(500).json({ error: `Failed to kill process: ${error.message}` });
    }
});

// Export progress endpoint
app.get('/api/export-progress/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        
        if (dataExporterInstance) {
            const progress = dataExporterInstance.getExportProgress(filename);
            res.json({
                success: true,
                progress: progress || null
            });
        } else {
            res.json({
                success: true,
                progress: null
            });
        }
        
    } catch (error) {
        console.error('❌ Error getting export progress:', error);
        res.status(500).json({ 
            error: `Failed to get export progress: ${error.message}` 
        });
    }
});

// Cancel export endpoint
app.post('/api/cancel-export/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        
        if (dataExporterInstance) {
            const success = dataExporterInstance.cancelExport(filename);
            res.json({
                success,
                message: success ? `Export ${filename} cancelled successfully` : 'Failed to cancel export'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'No active exporter instance found'
            });
        }
        
    } catch (error) {
        console.error('❌ Error cancelling export:', error);
        res.status(500).json({ 
            error: `Failed to cancel export: ${error.message}` 
        });
    }
});

// SQLite Export endpoint
app.post('/api/export-sqlite', async (req, res) => {
    try {
        const { filename, options = {} } = req.body;
        
        if (!filename) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        // Ensure .db extension
        const dbFilename = filename.endsWith('.db') ? filename : `${filename}.db`;
        
        console.log(`📤 Starting SQLite export to: ${dbFilename}`);
        
        // Default export options
        const exportOptions = {
            includeTickerData: options.includeTickerData !== false,
            includeHistorical: options.includeHistorical !== false,
            activeOnly: options.activeOnly !== false, // Default to active only
            historicalDays: options.historicalDays || null
        };
        
        console.log(`📤 Export Options:`, exportOptions);
        
        // Get the shared data exporter instance
        const exporter = await getDataExporter();
        
        // Run the export using the data exporter
        const result = await exporter.exportToSQLite(dbFilename, exportOptions);
        
        if (!result) {
            return res.status(400).json({ 
                error: 'SQLite export was cancelled' 
            });
        }
        
        console.log(`✅ SQLite export completed successfully: ${result.exportPath}`);
        
        res.json({
            success: true,
            message: `SQLite export completed successfully`,
            exportPath: result.exportPath,
            fileSizeMB: result.fileSizeMB,
            exportedCounts: result.exportedCounts
        });
        
    } catch (error) {
        console.error('❌ SQLite Export error:', error);
        res.status(500).json({ 
            error: `Failed to export to SQLite: ${error.message}` 
        });
    }
});

// Error handling for uncaught exceptions

// Download endpoints
app.get('/api/files', (req, res) => {
    try {
        const outputDir = path.join(__dirname, 'output');
        const processingDir = path.join(__dirname, 'processing');
        
        const files = [];
        
        // Check output files (completed exports)
        if (fs.existsSync(outputDir)) {
            const outputFiles = fs.readdirSync(outputDir);
            outputFiles.forEach(file => {
                const filePath = path.join(outputDir, file);
                const stats = fs.statSync(filePath);
                files.push({
                    name: file,
                    path: `/api/download/output/${file}`,
                    size: stats.size,
                    modified: stats.mtime,
                    type: 'output',
                    status: 'completed'
                });
            });
        }
        
        // Check processing files (exports in progress)
        if (fs.existsSync(processingDir)) {
            const processingFiles = fs.readdirSync(processingDir);
            processingFiles.forEach(file => {
                const filePath = path.join(processingDir, file);
                const stats = fs.statSync(filePath);
                files.push({
                    name: file,
                    path: `/api/download/processing/${file}`, // Note: this won't work until moved to output
                    size: stats.size,
                    modified: stats.mtime,
                    type: 'processing',
                    status: 'processing'
                });
            });
        }
        
        res.json({ files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download/output/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'output', filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Download error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Download failed' });
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete file endpoint
app.delete('/api/delete-file', (req, res) => {
    try {
        const { fileName } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ error: 'Filename is required' });
        }
        
        // Only allow deletion from output folder for security
        const filePath = path.join(__dirname, 'output', fileName);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Delete the file
        fs.unlinkSync(filePath);
        
        console.log(`🗑️  File deleted: ${fileName}`);
        
        res.json({
            success: true,
            message: `File "${fileName}" deleted successfully`
        });
        
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({ error: `Failed to delete file: ${error.message}` });
    }
});

// Route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(`🌟 All-Tickers Dashboard running on http://localhost:${PORT}`);
});