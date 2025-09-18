const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Store running processes for interactive input
const runningProcesses = new Map();

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Database path
const dbPath = path.join(__dirname, 'src', 'db', 'tickers.db');

// API Routes
app.get('/api/status', async (req, res) => {
    try {
        if (!fs.existsSync(dbPath)) {
            return res.json({ 
                status: 'no_database',
                message: 'No database found. Please generate tickers first.',
                stats: null
            });
        }

        const db = new sqlite3.Database(dbPath);
        
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN last_checked IS NOT NULL THEN 1 ELSE 0 END) as validated,
                    COUNT(DISTINCT exchange) as exchanges
                FROM tickers
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows[0]);
            });
        });

        const recentActivity = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ticker, active, price, exchange, last_checked 
                FROM tickers 
                WHERE last_checked IS NOT NULL 
                ORDER BY last_checked DESC 
                LIMIT 10
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        db.close();

        res.json({
            status: 'ready',
            stats,
            recentActivity
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tickers', async (req, res) => {
    try {
        const { page = 1, limit = 50, filter = 'all' } = req.query;
        const offset = (page - 1) * limit;

        if (!fs.existsSync(dbPath)) {
            return res.json({ tickers: [], total: 0 });
        }

        const db = new sqlite3.Database(dbPath);

        let whereClause = '';
        if (filter === 'active') whereClause = 'WHERE active = 1';
        else if (filter === 'inactive') whereClause = 'WHERE active = 0';
        else if (filter === 'validated') whereClause = 'WHERE last_checked IS NOT NULL';

        const tickers = await new Promise((resolve, reject) => {
            db.all(`
                SELECT ticker, active, price, exchange, last_checked 
                FROM tickers 
                ${whereClause}
                ORDER BY ticker 
                LIMIT ? OFFSET ?
            `, [limit, offset], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const total = await new Promise((resolve, reject) => {
            db.get(`SELECT COUNT(*) as count FROM tickers ${whereClause}`, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        db.close();

        res.json({ tickers, total, page: parseInt(page), limit: parseInt(limit) });

    } catch (error) {
        res.status(500).json({ error: error.message });
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
        'pipeline'
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

    // Store process for interactive input
    const processId = `${command}_${Date.now()}`;
    runningProcesses.set(processId, child);

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

    // Set a longer timeout for pipeline command
    const timeoutDuration = command === 'pipeline' ? 30 * 60 * 1000 : 10 * 60 * 1000; // 30 min for pipeline, 10 min for others
    const timeout = setTimeout(() => {
        if (!isCompleted) {
            res.write(`\n⚠️  Command timed out after ${command === 'pipeline' ? '30' : '10'} minutes\n`);
            child.kill('SIGTERM');
        }
    }, timeoutDuration);

    child.on('close', () => {
        clearTimeout(timeout);
    });
});

// Send input to running interactive command
app.post('/api/send-input', (req, res) => {
    const { processId, input } = req.body;
    
    if (!processId || !input) {
        return res.status(400).json({ error: 'Process ID and input are required' });
    }
    
    const process = runningProcesses.get(processId);
    if (!process) {
        return res.status(404).json({ error: 'Process not found or already completed' });
    }
    
    try {
        process.stdin.write(input + '\n');
        res.json({ success: true, message: 'Input sent to process' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send input to process' });
    }
});

// Download endpoints
app.get('/api/files', (req, res) => {
    try {
        const outputDir = path.join(__dirname, 'output');
        const dbDir = path.join(__dirname, 'src', 'db');
        
        const files = [];
        
        // Check output files
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
                    type: 'output'
                });
            });
        }
        
        // Check database files
        if (fs.existsSync(dbDir)) {
            const dbFiles = fs.readdirSync(dbDir).filter(file => file.endsWith('.db'));
            dbFiles.forEach(file => {
                const filePath = path.join(dbDir, file);
                const stats = fs.statSync(filePath);
                files.push({
                    name: file,
                    path: `/api/download/db/${file}`,
                    size: stats.size,
                    modified: stats.mtime,
                    type: 'database'
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

app.get('/api/download/db/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, 'src', 'db', filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Database file not found' });
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