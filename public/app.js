let currentPage = 1;
let isCommandRunning = false;
let currentProcessId = null;

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', function() {
    loadSystemStatus();
    loadTickers(1);
    loadFiles();
    
    // Auto-refresh status every 30 seconds
    setInterval(loadSystemStatus, 30000);
    // Auto-refresh files every 10 seconds
    setInterval(loadFiles, 10000);
});

async function loadSystemStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        const statusDiv = document.getElementById('status-overview');
        
        if (data.status === 'no_database') {
            statusDiv.innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i> 
                    ${data.message}
                </div>
            `;
        } else if (data.stats) {
            statusDiv.innerHTML = `
                <div class="row">
                    <div class="col-md-3">
                        <div class="text-center">
                            <h3 class="text-primary">${(data.stats.total || 0).toLocaleString()}</h3>
                            <small>Total Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center">
                            <h3 class="text-success">${(data.stats.active || 0).toLocaleString()}</h3>
                            <small>Active Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center">
                            <h3 class="text-info">${(data.stats.validated || 0).toLocaleString()}</h3>
                            <small>Validated Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center">
                            <h3 class="text-secondary">${data.stats.exchanges || 0}</h3>
                            <small>Exchanges</small>
                        </div>
                    </div>
                </div>
                ${data.recentActivity && data.recentActivity.length > 0 ? `
                <hr>
                <h6>Recent Activity</h6>
                <div class="row">
                    ${data.recentActivity.map(ticker => `
                        <div class="col-md-2">
                            <small class="${ticker.active ? 'active-ticker' : 'inactive-ticker'}">
                                ${ticker.ticker}
                            </small>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            `;
        } else {
            statusDiv.innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i> 
                    Database stats not available. Please generate tickers first.
                </div>
            `;
        }
    } catch (error) {
        document.getElementById('status-overview').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> 
                Error loading status: ${error.message}
            </div>
        `;
    }
}

async function loadTickers(page = 1) {
    const filter = document.getElementById('ticker-filter').value;
    const tableBody = document.getElementById('ticker-table');
    
    try {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center">
                    <div class="spinner-border spinner-border-sm" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    Loading tickers...
                </td>
            </tr>
        `;

        const response = await fetch(`/api/tickers?page=${page}&limit=50&filter=${filter}`);
        const data = await response.json();
        
        if (data.tickers.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center text-muted">
                        No tickers found
                    </td>
                </tr>
            `;
        } else {
            tableBody.innerHTML = data.tickers.map(ticker => `
                <tr class="ticker-row">
                    <td><strong>${ticker.ticker}</strong></td>
                    <td>
                        <span class="badge ${ticker.active ? 'bg-success' : 'bg-secondary'}">
                            ${ticker.active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>${ticker.price ? `$${ticker.price}` : 'N/A'}</td>
                    <td>${ticker.exchange || 'N/A'}</td>
                    <td>${ticker.last_checked ? new Date(ticker.last_checked).toLocaleString() : 'Never'}</td>
                </tr>
            `).join('');
        }
        
        updatePagination(data.page, Math.ceil(data.total / data.limit), data.total);
        currentPage = page;
        
    } catch (error) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-danger">
                    Error loading tickers: ${error.message}
                </td>
            </tr>
        `;
    }
}

function updatePagination(currentPage, totalPages, totalItems) {
    const pagination = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    
    // Previous button
    paginationHTML += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadTickers(${currentPage - 1})">Previous</a>
        </li>
    `;
    
    // Page numbers (show max 5 pages)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadTickers(${i})">${i}</a>
            </li>
        `;
    }
    
    // Next button
    paginationHTML += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadTickers(${currentPage + 1})">Next</a>
        </li>
    `;
    
    pagination.innerHTML = paginationHTML;
}

async function runCommand(command) {
    if (isCommandRunning) {
        alert('A command is already running. Please wait for it to complete.');
        return;
    }
    
    isCommandRunning = true;
    
    // Disable all command buttons
    const buttons = document.querySelectorAll('.command-btn');
    buttons.forEach(btn => {
        btn.classList.add('loading');
        btn.disabled = true;
    });
    
    // Show output section and streaming indicator
    const outputSection = document.getElementById('output-section');
    const outputDiv = document.getElementById('command-output');
    const streamingIndicator = document.getElementById('streaming-indicator');
    
    outputSection.style.display = 'block';
    streamingIndicator.style.display = 'inline-block';
    outputDiv.textContent = ''; // Clear previous output
    
    try {
        const response = await fetch('/api/run-command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command }),
            // Prevent browser timeout for long-running commands
            signal: null, // Disable automatic abort
            keepalive: true
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let done = false;
        let lastActivity = Date.now();
        
        // Send periodic keepalive to prevent connection timeout
        const keepAliveInterval = setInterval(() => {
            if (Date.now() - lastActivity > 30000) { // 30 seconds of no activity
                console.log('Sending keepalive signal');
            }
        }, 30000);
        
        while (!done) {
            try {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                
                if (value) {
                    lastActivity = Date.now();
                    const chunk = decoder.decode(value, { stream: true });
                    outputDiv.textContent += chunk;
                    
                    // Extract process ID for interactive commands
                    if (!currentProcessId && chunk.includes('Process ID:')) {
                        const match = chunk.match(/Process ID: (\w+_\d+)/);
                        if (match) {
                            currentProcessId = match[1];
                            console.log('Extracted process ID:', currentProcessId);
                        }
                    }
                    
                    // Check for interactive prompts
                    if (chunk.includes('Do you want to regenerate all tickers?') || 
                        chunk.includes('This command requires user input')) {
                        document.getElementById('interactive-input').style.display = 'block';
                        document.getElementById('command-input').focus();
                    }
                    
                    // Auto-scroll to bottom
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                }
            } catch (readError) {
                console.error('Stream read error:', readError);
                outputDiv.textContent += `\nStream read error: ${readError.message}`;
                break;
            }
        }
        
        clearInterval(keepAliveInterval);
        
        // Command completed - refresh data
        setTimeout(() => {
            loadSystemStatus();
            loadTickers(currentPage);
            loadFiles();
        }, 1000);
        
    } catch (error) {
        outputDiv.textContent += `\nError executing command: ${error.message}`;
    } finally {
        isCommandRunning = false;
        currentProcessId = null;
        
        // Hide streaming indicator and interactive input
        streamingIndicator.style.display = 'none';
        document.getElementById('interactive-input').style.display = 'none';
        
        // Re-enable all command buttons
        buttons.forEach(btn => {
            btn.classList.remove('loading');
            btn.disabled = false;
        });
    }
}

function clearOutput() {
    document.getElementById('command-output').textContent = '';
    document.getElementById('output-section').style.display = 'none';
}

async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        const data = await response.json();
        
        const outputFiles = data.files.filter(file => file.type === 'output');
        const databaseFiles = data.files.filter(file => file.type === 'database');
        
        // Update output files section
        const outputFilesDiv = document.getElementById('output-files');
        if (outputFiles.length === 0) {
            outputFilesDiv.innerHTML = '<div class="text-center text-muted"><small>No output files available</small></div>';
        } else {
            outputFilesDiv.innerHTML = outputFiles.map(file => `
                <div class="file-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${file.name}</strong>
                            <div class="file-size">
                                ${formatFileSize(file.size)} • Modified: ${new Date(file.modified).toLocaleString()}
                            </div>
                        </div>
                        <button class="btn btn-sm btn-outline-primary download-btn" onclick="downloadFile('${file.path}', '${file.name}')">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                </div>
            `).join('');
        }
        
        // Update database files section
        const databaseFilesDiv = document.getElementById('database-files');
        if (databaseFiles.length === 0) {
            databaseFilesDiv.innerHTML = '<div class="text-center text-muted"><small>No database files available</small></div>';
        } else {
            databaseFilesDiv.innerHTML = databaseFiles.map(file => `
                <div class="file-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${file.name}</strong>
                            <div class="file-size">
                                ${formatFileSize(file.size)} • Modified: ${new Date(file.modified).toLocaleString()}
                            </div>
                        </div>
                        <button class="btn btn-sm btn-outline-success download-btn" onclick="downloadFile('${file.path}', '${file.name}')">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                </div>
            `).join('');
        }
        
    } catch (error) {
        document.getElementById('output-files').innerHTML = 
            `<div class="alert alert-danger">Error loading files: ${error.message}</div>`;
        document.getElementById('database-files').innerHTML = 
            `<div class="alert alert-danger">Error loading files: ${error.message}</div>`;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function downloadFile(filePath, fileName) {
    // Create a temporary link element and trigger download
    const link = document.createElement('a');
    link.href = filePath;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Interactive input functions
async function sendInput() {
    const inputField = document.getElementById('command-input');
    const input = inputField.value.trim();
    
    if (!input) {
        alert('Please enter a value');
        return;
    }
    
    if (!currentProcessId) {
        alert('No active process to send input to');
        return;
    }
    
    try {
        const response = await fetch('/api/send-input', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                processId: currentProcessId, 
                input: input 
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Clear input and hide interactive section
            inputField.value = '';
            document.getElementById('interactive-input').style.display = 'none';
            
            // Add visual feedback to output
            const outputDiv = document.getElementById('command-output');
            outputDiv.textContent += `\n>>> ${input}\n`;
            outputDiv.scrollTop = outputDiv.scrollHeight;
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (error) {
        alert(`Failed to send input: ${error.message}`);
    }
}

function handleInputKeypress(event) {
    if (event.key === 'Enter') {
        sendInput();
    }
}

function clearOutput() {
    document.getElementById('command-output').textContent = '';
    document.getElementById('interactive-input').style.display = 'none';
    currentProcessId = null;
}