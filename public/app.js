let currentPage = 1;
let isCommandRunning = false;
let currentProcessId = null;
let searchTimeout = null;

// Helper function to format timestamps as "time ago"
function formatTimeAgo(timestamp) {
    const now = new Date();
    const past = new Date(timestamp);
    const diffMs = now - past;
    
    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (seconds > 30) {
        return `${seconds} seconds ago`;
    } else {
        return 'Just now';
    }
}

// Handle real-time search with debouncing
function handleSearchKeyup(event) {
    // Clear existing timeout
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    // Set new timeout for 300ms delay
    searchTimeout = setTimeout(() => {
        loadTickers(1); // Reset to page 1 when searching
    }, 300);
}

// Handle view type changes
function handleViewChange() {
    loadTickers(1); // Reset to page 1 when changing view
}

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
        
        // Check for running processes
        let runningProcessesHtml = '';
        if (data.runningProcesses && data.runningProcesses.length > 0) {
            runningProcessesHtml = `
                <div class="alert alert-info">
                    <i class="fas fa-cog fa-spin"></i> 
                    <strong>Running Processes:</strong>
                    <ul class="mb-0 mt-2 list-unstyled">
                        ${data.runningProcesses.map(proc => `
                            <li class="running-process-item" style="cursor: pointer; padding: 5px; border-radius: 5px;" 
                                onclick="showProcessDetails('${proc.processId}', '${proc.command}', '${proc.formattedDuration}', '${new Date(proc.startTime).toLocaleString()}')">
                                <i class="fas fa-hand-pointer me-2"></i>
                                <strong>${proc.command}</strong> - Running for ${proc.formattedDuration}
                                <small class="text-muted ms-2">(click for details)</small>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }
        
        if (data.status === 'no_database') {
            statusDiv.innerHTML = runningProcessesHtml + `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i> 
                    ${data.message}
                </div>
            `;
        } else if (data.stats) {
            statusDiv.innerHTML = runningProcessesHtml + `
                <div class="row">
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-primary">${(data.stats.total || 0).toLocaleString()}</h3>
                            <small>Total Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-success">${(data.stats.active || 0).toLocaleString()}</h3>
                            <small>Active Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-info">${(data.stats.validated || 0).toLocaleString()}</h3>
                            <small>Validated Tickers</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-secondary">${data.stats.exchanges || 0}</h3>
                            <small>Exchanges</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-warning">${(data.stats.need_validation || 0).toLocaleString()}</h3>
                            <small>Need Validation</small>
                            <br><small class="text-muted">(never or >5 days)</small>
                        </div>
                    </div>
                    <div class="col-md-2">
                        <div class="text-center">
                            <h3 class="text-danger">${(data.stats.need_data_update || 0).toLocaleString()}</h3>
                            <small>Need Data Update</small>
                            <br><small class="text-muted">(active, >1 day old)</small>
                        </div>
                    </div>
                </div>
                <div class="row mt-3">
                    <div class="col-md-3">
                        <div class="text-center">
                            <h4 class="text-info">${data.stats.database_size || 'Unknown'}</h4>
                            <small><i class="fas fa-database"></i> Database Size</small>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center">
                            <h4 class="text-secondary">${(data.stats.historical_count || 0).toLocaleString()}</h4>
                            <small><i class="fas fa-chart-line"></i> Tickers with History</small>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="text-center">
                            <h4 class="text-primary">${(data.stats.total_historical_records || 0).toLocaleString()}</h4>
                            <small><i class="fas fa-history"></i> Total Historical Records</small>
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
            statusDiv.innerHTML = runningProcessesHtml + `
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
    
    // Update button states based on running processes
    updateButtonStates(data?.runningProcesses || []);
}

function updateButtonStates(runningProcesses) {
    const buttons = document.querySelectorAll('.command-btn[data-command]');
    
    buttons.forEach(button => {
        const command = button.getAttribute('data-command');
        const isRunning = runningProcesses.some(proc => proc.command === command);
        
        if (isRunning) {
            button.classList.add('disabled');
            button.disabled = true;
            // Add spinning icon to show it's running
            const icon = button.querySelector('i');
            if (icon && !icon.classList.contains('fa-spin')) {
                icon.classList.add('fa-spin');
            }
        } else {
            button.classList.remove('disabled');
            button.disabled = false;
            // Remove spinning icon
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-spin');
            }
        }
    });
}

async function loadTickers(page = 1) {
    const filter = document.getElementById('ticker-filter').value;
    const search = document.getElementById('ticker-search').value;
    const viewType = document.getElementById('view-type').value;
    const tableBody = document.getElementById('ticker-table');
    
    try {
        // Update loading message based on view type
        const loadingMessage = viewType === 'errors' ? 'Loading errors...' : 'Loading tickers...';
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center">
                    <div class="spinner-border spinner-border-sm" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    ${loadingMessage}
                </td>
            </tr>
        `;

        let response, data;
        
        if (viewType === 'errors') {
            // Load errors
            response = await fetch(`/api/tickers/errors?page=${page}&limit=50&search=${encodeURIComponent(search)}`);
            data = await response.json();
            displayErrors(data);
        } else {
            // Load tickers
            response = await fetch(`/api/tickers?page=${page}&limit=50&filter=${filter}&search=${encodeURIComponent(search)}`);
            data = await response.json();
            displayTickers(data);
        }
        
        // Update pagination
        updatePagination(data.total, page, 50, viewType);
        
    } catch (error) {
        console.error('Error loading data:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-danger">
                    Error loading data: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Simple wrapper function for pagination compatibility
function loadData(page = 1, viewType = null, search = null) {
    // Update form values if provided
    if (viewType) {
        document.getElementById('view-type').value = viewType;
    }
    if (search !== null) {
        document.getElementById('ticker-search').value = search;
    }
    
    // Call the main load function
    loadTickers(page);
}

function displayTickers(data) {
    const tableBody = document.getElementById('ticker-table');
    const tableHeader = document.getElementById('table-header');
    
    // Update table header for tickers
    tableHeader.innerHTML = `
        <tr>
            <th>Ticker</th>
            <th>Status</th>
            <th>Price</th>
            <th>Exchange</th>
            <th>Last Updated</th>
            <th>Actions</th>
        </tr>
    `;
    
    if (data.tickers.length === 0) {
        const searchInfo = data.search ? ` matching "${data.search}"` : '';
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted">
                    No tickers found${searchInfo}
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
                <td>${ticker.price && ticker.price !== -1 ? `$${ticker.price}` : 'N/A'}</td>
                <td>${ticker.exchanges && ticker.exchanges.length > 0 ? ticker.exchanges.join(', ') : 'N/A'}</td>
                <td>${ticker.last_checked ? formatTimeAgo(ticker.last_checked) : 'Never'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" 
                            onclick="validateRowTicker('${ticker.ticker}', this)"
                            title="Validate ${ticker.ticker}">
                        <i class="fas fa-check"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

function displayErrors(data) {
    const tableBody = document.getElementById('ticker-table');
    const tableHeader = document.getElementById('table-header');
    
    // Update table header for errors
    tableHeader.innerHTML = `
        <tr>
            <th>Ticker</th>
            <th>Error Type</th>
            <th>Price</th>
            <th>Exchange</th>
            <th>Last Updated</th>
            <th>Actions</th>
        </tr>
    `;
    
    if (data.errors.length === 0) {
        const searchInfo = data.search ? ` matching "${data.search}"` : '';
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted">
                    No errors found${searchInfo}
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = data.errors.map(error => `
            <tr class="ticker-row">
                <td><strong>${error.ticker}</strong></td>
                <td>
                    <span class="badge bg-danger">
                        ${error.error_type}
                    </span>
                </td>
                <td>${error.price && error.price !== -1 ? `$${error.price}` : 'N/A'}</td>
                <td>${error.exchanges && error.exchanges.length > 0 ? error.exchanges.join(', ') : 'N/A'}</td>
                <td>${error.last_checked ? formatTimeAgo(error.last_checked) : 'Never'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-warning" 
                            onclick="validateRowTicker('${error.ticker}', this)"
                            title="Retry validation for ${error.ticker}">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

function updatePagination(totalItems, currentPage, itemsPerPage, viewType = 'tickers') {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let paginationHTML = '';
    const searchInput = document.getElementById('search');
    const search = searchInput ? searchInput.value : '';
    
    // Previous button
    paginationHTML += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadData(${currentPage - 1}, '${viewType}', '${search}')">Previous</a>
        </li>
    `;
    
    // Page numbers (show max 5 pages)
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, startPage + 4);
    
    for (let i = startPage; i <= endPage; i++) {
        paginationHTML += `
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="loadData(${i}, '${viewType}', '${search}')">${i}</a>
            </li>
        `;
    }
    
    // Next button
    paginationHTML += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="loadData(${currentPage + 1}, '${viewType}', '${search}')">Next</a>
        </li>
    `;
    
    pagination.innerHTML = paginationHTML;
}

async function runCommand(command) {
    // Check if the specific command is already running
    try {
        const statusResponse = await fetch('/api/status');
        const statusData = await statusResponse.json();
        
        if (statusData.runningProcesses && statusData.runningProcesses.length > 0) {
            const runningCommand = statusData.runningProcesses.find(proc => proc.command === command);
            if (runningCommand) {
                alert(`The ${command} command is already running (started ${runningCommand.duration} ago). Please wait for it to complete.`);
                return;
            }
        }
    } catch (error) {
        console.warn('Could not check running processes:', error);
    }
    
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
                    if (chunk.includes('Do you want to regenerate all ticker combinations?') || 
                        chunk.includes('Do you want to regenerate all tickers?') ||
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
        
        // Refresh system status to update running processes and button states
        setTimeout(() => {
            loadSystemStatus();
        }, 500);
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

// Function to show process details in modal
let currentModalProcessId = null;
let modalUpdateInterval = null;

function showProcessDetails(processId, command, formattedDuration, startTime) {
    // Store current process ID for updates
    currentModalProcessId = processId;
    
    // Populate modal with process information
    document.getElementById('modal-command').textContent = command;
    document.getElementById('modal-duration').textContent = formattedDuration;
    document.getElementById('modal-start-time').textContent = startTime;
    document.getElementById('modal-process-id').textContent = processId;
    
    // Set up the kill button
    const killBtn = document.getElementById('kill-process-btn');
    killBtn.setAttribute('data-process-id', processId);
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('processDetailsModal'));
    modal.show();
    
    // Start loading live terminal output
    loadProcessOutput();
    
    // Set up auto-refresh for live terminal
    modalUpdateInterval = setInterval(loadProcessOutput, 2000);
    
    // Clean up when modal is closed
    document.getElementById('processDetailsModal').addEventListener('hidden.bs.modal', function () {
        if (modalUpdateInterval) {
            clearInterval(modalUpdateInterval);
            modalUpdateInterval = null;
        }
        currentModalProcessId = null;
    }, { once: true });
}

// Function to load and display process output
async function loadProcessOutput() {
    if (!currentModalProcessId) return;
    
    try {
        const response = await fetch(`/api/process-output/${currentModalProcessId}`);
        const terminalDiv = document.getElementById('modal-terminal-output');
        
        if (response.ok) {
            const data = await response.json();
            
            // Combine output and error streams
            let fullOutput = data.output;
            if (data.error) {
                fullOutput += '\n--- STDERR ---\n' + data.error;
            }
            
            if (fullOutput.trim()) {
                terminalDiv.innerHTML = `<pre>${escapeHtml(fullOutput)}</pre>`;
                // Auto-scroll to bottom
                terminalDiv.scrollTop = terminalDiv.scrollHeight;
            } else {
                terminalDiv.innerHTML = '<div class="text-muted">No output yet...</div>';
            }
        } else {
            // Process no longer exists
            terminalDiv.innerHTML = '<div class="text-warning">Process has completed or been terminated.</div>';
            if (modalUpdateInterval) {
                clearInterval(modalUpdateInterval);
                modalUpdateInterval = null;
            }
        }
    } catch (error) {
        console.error('Failed to load process output:', error);
        document.getElementById('modal-terminal-output').innerHTML = 
            `<div class="text-danger">Error loading output: ${error.message}</div>`;
    }
}

// Function to escape HTML for safe display
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Function to confirm and kill process
async function confirmKillProcess() {
    if (!currentModalProcessId) return;
    
    const confirmed = confirm(
        `Are you sure you want to stop this process?\n\n` +
        `This will terminate the running command and cannot be undone.`
    );
    
    if (!confirmed) return;
    
    try {
        const response = await fetch('/api/kill-process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ processId: currentModalProcessId })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(`Process stopped successfully: ${data.message}`);
            
            // Close the modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('processDetailsModal'));
            modal.hide();
            
            // Refresh system status
            loadSystemStatus();
        } else {
            alert(`Failed to stop process: ${data.error}`);
        }
    } catch (error) {
        alert(`Error stopping process: ${error.message}`);
    }
}

// Function to validate a single ticker from a table row
async function validateRowTicker(symbol, buttonElement) {
    const row = buttonElement.closest('tr');
    const originalHtml = buttonElement.innerHTML;
    
    // Update button to show loading
    buttonElement.disabled = true;
    buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    try {
        const response = await fetch('/api/validate-ticker', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ symbol })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            const result = data.result;
            const isValid = result.validation.active;
            
            // Update the row with new data
            if (isValid) {
                // Update status badge
                const statusCell = row.cells[1];
                statusCell.innerHTML = '<span class="badge bg-success">Active</span>';
                
                // Update price
                const priceCell = row.cells[2];
                priceCell.textContent = `$${result.validation.price}`;
                
                // Update exchange
                const exchangeCell = row.cells[3];
                exchangeCell.textContent = result.validation.exchanges && result.validation.exchanges.length > 0 
                    ? result.validation.exchanges.join(', ') 
                    : result.validation.exchange || 'N/A';
                
                // Update last checked
                const lastCheckedCell = row.cells[4];
                lastCheckedCell.textContent = new Date().toLocaleString();
                
                // Show success feedback
                showRowFeedback(buttonElement, 'success', 'fas fa-check-circle');
            } else {
                // Update status badge
                const statusCell = row.cells[1];
                statusCell.innerHTML = '<span class="badge bg-secondary">Inactive</span>';
                
                // Show warning feedback
                showRowFeedback(buttonElement, 'warning', 'fas fa-exclamation-triangle');
            }
            
            // Refresh system status to update counts
            loadSystemStatus();
        } else {
            showRowFeedback(buttonElement, 'danger', 'fas fa-times-circle');
        }
    } catch (error) {
        showRowFeedback(buttonElement, 'danger', 'fas fa-times-circle');
    } finally {
        // Reset button after a delay
        setTimeout(() => {
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalHtml;
        }, 2000);
    }
}

// Helper function to show temporary feedback on validation button
function showRowFeedback(buttonElement, type, iconClass) {
    const colorMap = {
        'success': 'btn-outline-success',
        'warning': 'btn-outline-warning', 
        'danger': 'btn-outline-danger'
    };
    
    // Remove existing color classes
    buttonElement.className = buttonElement.className.replace(/btn-outline-\w+/g, '');
    
    // Add feedback color and icon
    buttonElement.classList.add(colorMap[type]);
    buttonElement.innerHTML = `<i class="${iconClass}"></i>`;
}

// SQLite Export functions
function showSQLiteExportModal() {
    const modal = new bootstrap.Modal(document.getElementById('sqliteExportModal'));
    
    // Reset form
    document.getElementById('sqlite-filename').value = 'all-tickers-export';
    document.getElementById('include-ticker-data').checked = true;
    document.getElementById('include-historical').checked = true;
    document.getElementById('historical-limit').value = '100000';
    
    // Hide progress and results
    document.getElementById('export-progress').style.display = 'none';
    document.getElementById('export-result').style.display = 'none';
    
    // Show/hide historical limit based on checkbox
    const historicalCheckbox = document.getElementById('include-historical');
    const limitSection = document.getElementById('historical-limit-section');
    
    function toggleLimitSection() {
        limitSection.style.display = historicalCheckbox.checked ? 'block' : 'none';
    }
    
    historicalCheckbox.addEventListener('change', toggleLimitSection);
    toggleLimitSection(); // Set initial state
    
    modal.show();
}

async function startSQLiteExport() {
    const filename = document.getElementById('sqlite-filename').value.trim();
    const includeTickerData = document.getElementById('include-ticker-data').checked;
    const includeHistorical = document.getElementById('include-historical').checked;
    const historicalLimit = parseInt(document.getElementById('historical-limit').value) || 100000;
    
    if (!filename) {
        alert('Please enter a filename');
        return;
    }
    
    // Show progress
    document.getElementById('export-progress').style.display = 'block';
    document.getElementById('export-result').style.display = 'none';
    document.getElementById('start-export-btn').disabled = true;
    
    try {
        const response = await fetch('/api/export-sqlite', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: filename,
                options: {
                    includeTickerData,
                    includeHistorical,
                    historicalLimit
                }
            })
        });
        
        const data = await response.json();
        
        // Hide progress
        document.getElementById('export-progress').style.display = 'none';
        
        if (data.success) {
            // Show success result
            document.getElementById('export-result').innerHTML = `
                <div class="alert alert-success">
                    <h6><i class="fas fa-check-circle"></i> Export Successful!</h6>
                    <p class="mb-1"><strong>File:</strong> ${data.result.filePath}</p>
                    <p class="mb-1"><strong>Size:</strong> ${data.result.fileSizeMB} MB</p>
                    <p class="mb-1"><strong>Tables:</strong> ${data.result.tablesExported}</p>
                    <p class="mb-0"><strong>Records:</strong> ${data.result.totalRecords.toLocaleString()}</p>
                    <hr>
                    <small class="text-muted">
                        The SQLite database has been saved to the db/ folder and is available for download.
                    </small>
                </div>
            `;
            
            // Refresh file list to show the new export
            loadFiles();
        } else {
            // Show error
            document.getElementById('export-result').innerHTML = `
                <div class="alert alert-danger">
                    <h6><i class="fas fa-exclamation-triangle"></i> Export Failed</h6>
                    <p class="mb-0">${data.error || 'Unknown error occurred'}</p>
                </div>
            `;
        }
        
        document.getElementById('export-result').style.display = 'block';
        
    } catch (error) {
        // Hide progress
        document.getElementById('export-progress').style.display = 'none';
        
        // Show error
        document.getElementById('export-result').innerHTML = `
            <div class="alert alert-danger">
                <h6><i class="fas fa-exclamation-triangle"></i> Export Failed</h6>
                <p class="mb-0">Network error: ${error.message}</p>
            </div>
        `;
        document.getElementById('export-result').style.display = 'block';
    } finally {
        document.getElementById('start-export-btn').disabled = false;
    }
}