let currentPage = 1;
let isCommandRunning = false;
let currentProcessId = null;
let searchTimeout = null;
let progressPollingInterval = null;

// Global state for exports
let activeExports = new Map(); // Track files currently being exported with format info

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

// Manual refresh function
function refreshTickers() {
    const refreshBtn = document.getElementById('refresh-btn');
    const icon = refreshBtn.querySelector('i');
    
    // Add spinning animation
    icon.classList.add('fa-spin');
    refreshBtn.disabled = true;
    
    // Reload both status and tickers
    Promise.all([loadSystemStatus(), loadTickers(currentPage)])
        .finally(() => {
            // Remove spinning animation
            icon.classList.remove('fa-spin');
            refreshBtn.disabled = false;
        });
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', function() {
    loadSystemStatus();
    loadTickers(1);
    loadFiles();
    
    // Auto-refresh just stats numbers every 10 seconds (lightweight)
    setInterval(updateStatsNumbers, 10000);
    // Full status refresh every 60 seconds (includes running processes, etc.)
    setInterval(loadSystemStatus, 60000);
    // Auto-refresh files every 10 seconds
    setInterval(loadFiles, 10000);
    // Auto-refresh tickers every 30 seconds (less frequent to avoid disruption)
    setInterval(() => loadTickers(currentPage), 30000);
});

// Function to update just the stats numbers without reloading the entire status
async function updateStatsNumbers() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        if (data.stats) {
            // Update each stat number individually
            const statElements = {
                'total': document.querySelector('#status-overview .text-primary'),
                'validated': document.querySelector('#status-overview .text-info'),
                'active': document.querySelector('#status-overview .text-success'),
                'need_validation': document.querySelector('#status-overview .text-warning'),
                'need_data_update': document.querySelector('#status-overview .text-danger')
            };
            
            if (statElements.total) statElements.total.textContent = (data.stats.total || 0).toLocaleString();
            if (statElements.validated) statElements.validated.textContent = (data.stats.validated || 0).toLocaleString();
            if (statElements.active) statElements.active.textContent = (data.stats.active || 0).toLocaleString();
            if (statElements.need_validation) statElements.need_validation.textContent = (data.stats.need_validation || 0).toLocaleString();
            if (statElements.need_data_update) statElements.need_data_update.textContent = (data.stats.need_data_update || 0).toLocaleString();
        }
    } catch (error) {
        console.log('Error updating stats numbers:', error);
        // Fallback to full status refresh if selective update fails
        loadSystemStatus();
    }
}

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
                            <h3 class="text-info">${(data.stats.validated || 0).toLocaleString()}</h3>
                            <small>Validated Tickers</small>
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
                            <h3 class="text-warning">${(data.stats.need_validation || 0).toLocaleString()}</h3>
                            <small>Need Validation</small>
                            <br><small class="text-muted">(never or >5 days)</small>
                        </div>
                    </div>
                    <div class="col-md-4">
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
                <td colspan="5" class="text-center">
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
                <td colspan="5" class="text-center text-danger">
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
    
    // Check if data has tickers property (handle API error case)
    if (!data || !data.tickers) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-danger">
                    Error loading tickers: Invalid data received
                </td>
            </tr>
        `;
        return;
    }
    
    // Update table header for tickers
    tableHeader.innerHTML = `
        <tr>
            <th>Ticker</th>
            <th>Status</th>
            <th>Price</th>
            <th>Last Updated</th>
            <th>Actions</th>
        </tr>
    `;
    
    if (data.tickers.length === 0) {
        const searchInfo = data.search ? ` matching "${data.search}"` : '';
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted">
                    No tickers found${searchInfo}
                </td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = data.tickers.map(ticker => {
            // Show N/A for inactive tickers or when price is invalid
            const priceDisplay = ticker.active && ticker.price && ticker.price !== -1 
                ? `$${parseFloat(ticker.price).toFixed(2)}` 
                : 'N/A';
            
            return `
                <tr class="ticker-row">
                    <td><strong>${ticker.ticker}</strong></td>
                    <td>
                        <span class="badge ${ticker.active ? 'bg-success' : 'bg-secondary'}">
                            ${ticker.active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>${priceDisplay}</td>
                    <td>${ticker.last_checked ? formatTimeAgo(ticker.last_checked) : 'Never'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" 
                                onclick="validateRowTicker('${ticker.ticker}', this)"
                                title="Validate ${ticker.ticker}">
                            <i class="fas fa-check"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

function displayErrors(data) {
    const tableBody = document.getElementById('ticker-table');
    const tableHeader = document.getElementById('table-header');
    
    // Check if data has errors property (handle API error case)
    if (!data || !data.errors) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-danger">
                    Error loading errors: Invalid data received
                </td>
            </tr>
        `;
        return;
    }
    
    // Update table header for errors
    tableHeader.innerHTML = `
        <tr>
            <th>Ticker</th>
            <th>Error Type</th>
            <th>Price</th>
            <th>Last Updated</th>
            <th>Actions</th>
        </tr>
    `;
    
    if (data.errors.length === 0) {
        const searchInfo = data.search ? ` matching "${data.search}"` : '';
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted">
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
                <td>${error.price && error.price !== -1 ? `$${parseFloat(error.price).toFixed(2)}` : 'N/A'}</td>
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
        
        // Get all files (now includes both output and processing files)
        const files = data.files || [];
        
        // Add pending exports that don't exist as files yet
        const allFilesToShow = [...files];
        
        // Add pending exports to the display (that aren't already in processing)
        for (const [fileName, exportInfo] of activeExports) {
            // Only add if the file doesn't already exist in the files list
            if (!files.find(file => file.name === fileName)) {
                allFilesToShow.push({
                    name: fileName,
                    size: 0,
                    modified: new Date().toISOString(),
                    path: `processing/${fileName}`,
                    isPending: true,
                    status: 'starting',
                    exportFormat: exportInfo.format
                });
            }
        }
        
        const outputFilesDiv = document.getElementById('output-files');
        if (allFilesToShow.length === 0) {
            outputFilesDiv.innerHTML = '<div class="col-12 text-center text-muted"><small>No files available</small></div>';
        } else {
            // Create 3-column layout with file cards
            outputFilesDiv.innerHTML = allFilesToShow.map(file => {
                const fileExtension = file.name.split('.').pop().toLowerCase();
                let iconClass = 'fas fa-file';
                let iconColor = '#6c757d';
                
                // Set icon based on file type
                switch (fileExtension) {
                    case 'json':
                        iconClass = 'fas fa-file-code';
                        iconColor = '#28a745';
                        break;
                    case 'csv':
                        iconClass = 'fas fa-file-csv';
                        iconColor = '#007bff';
                        break;
                    case 'db':
                    case 'sqlite':
                        iconClass = 'fas fa-database';
                        iconColor = '#ffc107';
                        break;
                }
                
                const isExporting = activeExports.has(file.name) || file.status === 'processing';
                const isPending = file.isPending || file.status === 'processing';
                
                return `
                    <div class="col-lg-4 col-md-6 col-sm-12">
                        <div class="file-card ${isPending ? 'border-warning' : ''}" data-filename="${file.name}">
                            <div class="text-center">
                                <div class="file-icon" style="color: ${isExporting ? '#ffc107' : iconColor}">
                                    ${isExporting 
                                        ? '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div>'
                                        : `<i class="${iconClass}"></i>`
                                    }
                                </div>
                                <div class="file-name">${file.name}</div>
                                <div class="file-size">
                                    ${isPending ? '<span class="processing-status">Preparing...</span>' : formatFileSize(file.size)}
                                </div>
                                <div class="file-size">
                                    ${isPending 
                                        ? '<span class="processing-progress">Export in progress</span>' 
                                        : `${new Date(file.modified).toLocaleDateString()} ${new Date(file.modified).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
                                    }
                                </div>
                                <div class="file-actions">
                                    ${isExporting 
                                        ? `<div class="d-flex align-items-center justify-content-center flex-column">
                                               <div class="d-flex align-items-center mb-2">
                                                   <div class="spinner-border spinner-border-sm text-warning me-2" role="status">
                                                       <span class="visually-hidden">Exporting...</span>
                                                   </div>
                                                   <small class="text-warning">Exporting ${activeExports.get(file.name)?.format?.toUpperCase() || file.type?.toUpperCase() || ''}...</small>
                                               </div>
                                               <div class="progress w-100" style="height: 4px;">
                                                   <div class="progress-bar progress-bar-striped progress-bar-animated bg-warning" 
                                                        style="width: 0%" 
                                                        id="progress-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}">
                                                   </div>
                                               </div>
                                               <small class="text-muted mt-1" id="progress-text-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}">0%</small>
                                               <button class="btn btn-sm btn-outline-danger mt-2" onclick="cancelExport('${file.name}')" title="Cancel export">
                                                   <i class="fas fa-times"></i> Cancel
                                               </button>
                                           </div>`
                                        : `<button class="btn btn-sm btn-primary btn-file-action" onclick="downloadFile('${file.path}', '${file.name}')" title="Download file">
                                               <i class="fas fa-download"></i> Download
                                           </button>
                                           <button class="btn btn-sm btn-danger btn-file-action" onclick="deleteFile('${file.name}', '${file.path}')" title="Delete file">
                                               <i class="fas fa-trash"></i> Delete
                                           </button>`
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Start progress polling for processing files
            startProgressPolling();
        }
        
    } catch (error) {
        document.getElementById('output-files').innerHTML = 
            `<div class="col-12"><div class="alert alert-danger">Error loading files: ${error.message}</div></div>`;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Progress polling for export operations
function startProgressPolling() {
    if (progressPollingInterval) {
        clearInterval(progressPollingInterval);
    }
    
    progressPollingInterval = setInterval(async () => {
        // Check if there are any processing files
        const processingCards = document.querySelectorAll('.file-card[data-filename]');
        let hasProcessingFiles = false;
        
        for (const card of processingCards) {
            const filename = card.getAttribute('data-filename');
            const isProcessing = card.querySelector('.spinner-border') !== null;
            
            if (isProcessing) {
                hasProcessingFiles = true;
                await updateProgressForFile(filename);
            }
        }
        
        // Stop polling if no files are being processed
        if (!hasProcessingFiles && activeExports.size === 0) {
            clearInterval(progressPollingInterval);
            progressPollingInterval = null;
        }
    }, 2000); // Poll every 2 seconds
}

async function updateProgressForFile(filename) {
    try {
        const response = await fetch(`/api/export-progress/${encodeURIComponent(filename)}`);
        const data = await response.json();
        
        if (data.success && data.progress) {
            const progress = data.progress;
            const sanitizedFilename = filename.replace(/[^a-zA-Z0-9]/g, '-');
            const progressBar = document.getElementById(`progress-${sanitizedFilename}`);
            const progressText = document.getElementById(`progress-text-${sanitizedFilename}`);
            
            if (progressBar && progressText) {
                progressBar.style.width = `${progress.percentage}%`;
                progressText.textContent = `${progress.percentage}% (${progress.current}/${progress.total})`;
            }
            
            // Update status text in modal if export modal is open
            const exportModal = document.getElementById('exportModal');
            if (exportModal && exportModal.classList.contains('show')) {
                updateModalProgress(progress);
            }
        }
    } catch (error) {
        console.warn('Failed to update progress for', filename, ':', error);
    }
}

function updateModalProgress(progress) {
    const statusElement = document.getElementById('export-status');
    if (statusElement) {
        statusElement.textContent = `Exporting... ${progress.percentage}% (${progress.current}/${progress.total} records)`;
    }
    
    const progressBar = document.getElementById('export-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${progress.percentage}%`;
    }
}

function downloadFile(filePath, fileName) {
    // Check if file is currently being exported
    if (activeExports.has(fileName)) {
        alert('This file is currently being exported. Please wait for the export to complete.');
        return;
    }
    
    // Create a temporary link element and trigger download
    const link = document.createElement('a');
    link.href = filePath;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function deleteFile(fileName, filePath) {
    // Check if file is currently being exported
    if (activeExports.has(fileName)) {
        alert('This file is currently being exported. Please wait for the export to complete before deleting.');
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/delete-file`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fileName: fileName,
                filePath: filePath
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Refresh the file list
            loadFiles();
            
            // Show success message (optional)
            // You could add a toast notification here if desired
        } else {
            alert(`Failed to delete file: ${data.error}`);
        }
        
    } catch (error) {
        alert(`Error deleting file: ${error.message}`);
    }
}

async function cancelExport(fileName) {
    // Confirm cancellation
    if (!confirm(`Are you sure you want to cancel the export of "${fileName}"? This will remove the partially exported file.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/cancel-export/${encodeURIComponent(fileName)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Remove from active exports
            activeExports.delete(fileName);
            
            // Refresh the file list to remove the processing file
            loadFiles();
            
            // Show success message
            alert(`Export of "${fileName}" has been cancelled.`);
        } else {
            alert(`Failed to cancel export: ${data.error}`);
        }
        
    } catch (error) {
        console.error('Error cancelling export:', error);
        alert(`Error cancelling export: ${error.message}`);
    }
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
            const isValid = result.active; // Fixed: use result.active instead of result.validation.active
            
            // Update the row with new data
            if (isValid) {
                // Update status badge
                const statusCell = row.cells[1];
                statusCell.innerHTML = '<span class="badge bg-success">Active</span>';
                
                // Update price
                const priceCell = row.cells[2];
                priceCell.textContent = `$${parseFloat(result.price).toFixed(2)}`;
                
                // Update last checked
                const lastCheckedCell = row.cells[3];
                lastCheckedCell.textContent = new Date().toLocaleString();
                
                // Show success feedback
                showRowFeedback(buttonElement, 'success', 'fas fa-check-circle');
            } else {
                // Update status badge
                const statusCell = row.cells[1];
                statusCell.innerHTML = '<span class="badge bg-secondary">Inactive</span>';
                
                // Update price
                const priceCell = row.cells[2];
                priceCell.textContent = 'N/A';
                
                // Update last checked
                const lastCheckedCell = row.cells[3];
                lastCheckedCell.textContent = new Date().toLocaleString();
                
                // Show warning feedback
                showRowFeedback(buttonElement, 'warning', 'fas fa-exclamation-triangle');
            }
            
            // Update stats numbers without full page refresh
            updateStatsNumbers();
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

// Unified Export functions
function showExportModal() {
    const modal = new bootstrap.Modal(document.getElementById('exportModal'));
    
    // Reset form
    document.getElementById('export-filename').value = 'all-tickers-export';
    document.getElementById('format-json').checked = true;
    
    // Reset time range selection to default (30 days)
    selectTimeRange('30');
    
    // Update UI based on selected format
    updateFormatUI();
    
    // Hide progress and results
    document.getElementById('export-progress').style.display = 'none';
    document.getElementById('export-result').style.display = 'none';
    
    // Setup format change listeners
    document.querySelectorAll('input[name="exportFormat"]').forEach(radio => {
        radio.addEventListener('change', updateFormatUI);
    });
    
    // Setup time range button listeners
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectTimeRange(btn.dataset.days);
        });
    });
    
    modal.show();
}

function updateFormatUI() {
    const selectedFormat = document.querySelector('input[name="exportFormat"]:checked').value;
    const fileExtension = document.getElementById('file-extension');
    const fileLocation = document.getElementById('file-location');
    const sqliteOptions = document.getElementById('sqlite-options');
    const timeRangeSection = document.getElementById('time-range-section');
    
    // Update file extension and location
    switch (selectedFormat) {
        case 'json':
            fileExtension.textContent = '.json';
            fileLocation.textContent = 'File will be saved to the output/ folder';
            sqliteOptions.style.display = 'none';
            timeRangeSection.style.display = 'block';
            break;
        case 'csv':
            fileExtension.textContent = '.csv';
            fileLocation.textContent = 'File will be saved to the output/ folder';
            sqliteOptions.style.display = 'none';
            timeRangeSection.style.display = 'none'; // Hide time range for CSV
            break;
        case 'sqlite':
            fileExtension.textContent = '.db';
            fileLocation.textContent = 'File will be saved to the output/ folder'; // Changed from db/ to output/
            sqliteOptions.style.display = 'block';
            
            // Show/hide time range section based on historical checkbox
            const historicalCheckbox = document.getElementById('include-historical');
            function toggleTimeRangeSection() {
                timeRangeSection.style.display = historicalCheckbox.checked ? 'block' : 'none';
            }
            historicalCheckbox.addEventListener('change', toggleTimeRangeSection);
            toggleTimeRangeSection();
            break;
    }
}

function selectTimeRange(days) {
    // Update visual selection
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.classList.remove('btn-primary', 'btn-success');
        btn.classList.add('btn-outline-primary');
        if (btn.dataset.days === 'all') {
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-outline-success');
        }
    });
    
    // Highlight selected button
    const selectedBtn = document.querySelector(`[data-days="${days}"]`);
    if (selectedBtn) {
        selectedBtn.classList.remove('btn-outline-primary', 'btn-outline-success');
        if (days === 'all') {
            selectedBtn.classList.add('btn-success');
        } else {
            selectedBtn.classList.add('btn-primary');
        }
    }
    
    // Update display text
    const rangeText = {
        '7': 'Last 7 Days',
        '30': 'Last 30 Days',
        '90': 'Last 90 Days',
        '180': 'Last 6 Months',
        '365': 'Last 1 Year',
        '730': 'Last 2 Years',
        'all': 'All Historical Data'
    };
    
    document.getElementById('selected-time-range').textContent = rangeText[days] || `Last ${days} Days`;
    document.getElementById('selected-historical-days').value = days;
    
    // Hide custom input if it was showing
    document.getElementById('custom-days-section').style.display = 'none';
}

function showCustomDaysInput() {
    document.getElementById('custom-days-section').style.display = 'block';
    document.getElementById('custom-days').focus();
}

function selectCustomDays() {
    const customDays = parseInt(document.getElementById('custom-days').value);
    if (!customDays || customDays < 1) {
        alert('Please enter a valid number of days (minimum 1)');
        return;
    }
    
    // Clear button selections
    document.querySelectorAll('.time-range-btn').forEach(btn => {
        btn.classList.remove('btn-primary', 'btn-success');
        btn.classList.add('btn-outline-primary');
        if (btn.dataset.days === 'all') {
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-outline-success');
        }
    });
    
    // Update display
    document.getElementById('selected-time-range').textContent = `Last ${customDays} Days (Custom)`;
    document.getElementById('selected-historical-days').value = customDays;
    document.getElementById('custom-days-section').style.display = 'none';
}

async function startExport() {
    const filename = document.getElementById('export-filename').value.trim();
    const selectedFormat = document.querySelector('input[name="exportFormat"]:checked').value;
    const historicalDays = document.getElementById('selected-historical-days').value;
    const activeOnly = document.getElementById('active-only').checked;
    
    if (!filename) {
        alert('Please enter a filename');
        return;
    }
    
    // Create full filename with extension
    const fileExtensions = {
        'json': '.json',
        'csv': '.csv', 
        'sqlite': '.db'
    };
    const fullFilename = filename + fileExtensions[selectedFormat];
    
    // Track current modal export for cancellation
    currentModalExportFilename = fullFilename;
    
    // Add to active exports to show loading state with format info
    activeExports.set(fullFilename, {
        format: selectedFormat,
        startTime: new Date().toISOString()
    });
    
    // Refresh files list to show loading indicator
    loadFiles();
    
    // Show progress and hide/show appropriate buttons
    document.getElementById('export-progress').style.display = 'block';
    document.getElementById('export-result').style.display = 'none';
    document.getElementById('start-export-btn').disabled = true;
    document.getElementById('start-export-btn').style.display = 'none';
    document.getElementById('cancel-export-btn').style.display = 'inline-block';
    
    // Update progress text based on format
    const statusElement = document.getElementById('export-status');
    const formatNames = {
        'json': 'JSON',
        'csv': 'CSV',
        'sqlite': 'SQLite database'
    };
    statusElement.textContent = `Exporting ${formatNames[selectedFormat]}...`;
    
    try {
        let response;
        
        if (selectedFormat === 'sqlite') {
            // SQLite export
            const includeTickerData = document.getElementById('include-ticker-data').checked;
            const includeHistorical = document.getElementById('include-historical').checked;
            
            response = await fetch('/api/export-sqlite', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: filename,
                    options: {
                        includeTickerData,
                        includeHistorical,
                        activeOnly,
                        historicalDays: historicalDays === 'all' ? null : parseInt(historicalDays)
                    }
                })
            });
        } else if (selectedFormat === 'csv') {
            // CSV export
            response = await fetch('/api/export-csv', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: filename,
                    activeOnly,
                    historicalDays: null // Always export all data for CSV
                })
            });
        } else {
            // JSON export
            response = await fetch('/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: filename,
                    activeOnly,
                    historicalDays: historicalDays === 'all' ? null : parseInt(historicalDays)
                })
            });
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Hide progress
        document.getElementById('export-progress').style.display = 'none';
        
        if (data.success) {
            const formatLabels = {
                'json': 'JSON Export',
                'csv': 'CSV Export',
                'sqlite': 'SQLite Export'
            };
            
            // Show success result
            document.getElementById('export-result').innerHTML = `
                <div class="alert alert-success">
                    <h6><i class="fas fa-check-circle"></i> ${formatLabels[selectedFormat]} Successful!</h6>
                    <p class="mb-1"><strong>File:</strong> ${data.exportPath}</p>
                    <hr>
                    <small class="text-muted">
                        The ${selectedFormat.toUpperCase()} file has been saved to the output/ folder.
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
        // Remove from active exports
        activeExports.delete(fullFilename);
        
        // Re-enable export button
        document.getElementById('start-export-btn').disabled = false;
        
        // Reset modal export tracking
        currentModalExportFilename = null;
        
        // Hide cancel button and show start button
        document.getElementById('cancel-export-btn').style.display = 'none';
        document.getElementById('start-export-btn').style.display = 'inline-block';
        
        // Refresh files list to remove loading indicator
        loadFiles();
    }
}

let currentModalExportFilename = null; // Track current modal export for cancellation

async function cancelModalExport() {
    if (!currentModalExportFilename) {
        alert('No active export to cancel');
        return;
    }
    
    // Use the same cancel function as file cards
    await cancelExport(currentModalExportFilename);
    
    // Clean up modal state
    currentModalExportFilename = null;
    
    // Hide cancel button and show start button
    document.getElementById('cancel-export-btn').style.display = 'none';
    document.getElementById('start-export-btn').style.display = 'inline-block';
    document.getElementById('start-export-btn').disabled = false;
    
    // Hide progress
    document.getElementById('export-progress').style.display = 'none';
    
    // Show cancellation message
    document.getElementById('export-result').innerHTML = `
        <div class="alert alert-warning">
            <h6><i class="fas fa-ban"></i> Export Cancelled</h6>
            <p class="mb-0">The export operation has been cancelled and any partial files have been removed.</p>
        </div>
    `;
    document.getElementById('export-result').style.display = 'block';
}