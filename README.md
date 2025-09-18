# All-Tickers Dashboard

Generate and validate all possible stock tickers (A-ZZZZZ) to discover active stocks with comprehensive financial data collection and export capabilities. Now featuring a **web-based dashboard** with real-time streaming output and automated background processing.

## 🚀 Quick Start

### Option 1: Web Dashboard (Recommended)
1. **Install dependencies:**
   ```
   npm install
   ```

2. **Start the web dashboard:**
   ```
   npm start
   ```

3. **Open your browser:**
   ```
   http://localhost:3000
   ```

4. **Use the dashboard** to run commands with real-time streaming output, browse tickers, download results, and monitor automated processes.

### Option 2: Command Line
1. **Install dependencies:**
   ```
   npm install
   ```

2. **Run the complete pipeline:**
   ```
   npm run pipeline
   ```

## 🌐 Web Dashboard Features

### Real-Time Command Execution
- **Live streaming output** - Watch commands execute in real-time
- **Interactive prompts** - Handle user input for commands that require confirmation
- **Process management** - Multiple commands can run without conflicts
- **No timeouts** - Long-running processes complete naturally

### Dashboard Interface
- **System Status Panel** - Real-time ticker statistics and recent activity
- **Automation Status** - Monitor scheduled jobs and recent automation activity
- **Command Buttons** - Execute any pipeline step with one click
- **Ticker Browser** - Browse and filter your ticker database with pagination
- **File Downloads** - Download output files and database backups
- **Force Controls** - Manually trigger automated processes

### Available Commands via Web UI
- **Generate Tickers** - Create ticker combinations (A-ZZZZZ)
- **Validate Tickers** - Test tickers against market APIs
- **Gather Data** - Collect comprehensive financial data
- **Export Data** - Generate JSON/CSV exports
- **Revalidate Active/Inactive** - Refresh ticker status
- **Full Pipeline** - Run complete 6-step process

## 🔄 Pipeline Overview

The complete pipeline consists of 6 automated steps that can be run via web dashboard or command line:

1. **Generate Tickers** → Creates all possible ticker combinations (A-ZZZZ)
2. **Validate Tickers** → Tests each ticker against Yahoo Finance API
3. **Revalidate Active** → Double-checks active tickers for accuracy
4. **Revalidate Inactive** → Catches any missed active tickers  
5. **Collect Data** → Gathers comprehensive financial data for active tickers
6. **Export Data** → Outputs structured JSON and CSV files

## 🤖 Automation Features

### Background Processing
The system includes intelligent automation that runs alongside the web dashboard:

- **📅 Hourly Revalidation Check**: Automatically identifies tickers not validated in 30+ days and runs revalidation
- **📊 30-Minute Data Refresh**: Automatically collects fresh financial data for active tickers older than 24 hours
- **🧹 Daily Maintenance**: Generates reports, statistics, and system health checks at 2 AM
- **🎯 Smart Scheduling**: Only processes when needed, avoids duplicate jobs, logs all activity

### Manual Override Controls
- **Force Revalidation**: Manually trigger 30-day revalidation check
- **Force Data Gathering**: Manually trigger 24-hour data collection
- **Real-time Monitoring**: View active automation jobs and recent activity logs

## 📁 Project Structure

```
All-Tickers/
├── server.js                     # Web dashboard server with automation
├── public/                       # Web dashboard frontend
│   ├── index.html               # Dashboard interface
│   └── app.js                   # Frontend JavaScript with streaming
├── src/
│   ├── scheduler/
│   │   └── scheduler.js         # Automated background processing
│   ├── db/
│   │   ├── generate-tickers.js  # Step 1: Generate ticker combinations
│   │   ├── tickers.db          # Main validation database
│   │   └── ticker_data.db      # Comprehensive financial data
│   ├── validate/
│   │   ├── validate-tickers.js    # Step 2: Initial validation
│   │   ├── revalidate-active.js   # Step 3: Active ticker revalidation
│   │   └── revalidate-inactive.js # Step 4: Inactive ticker revalidation
│   ├── return-data/
│   │   └── return-data.js         # Step 5: Comprehensive data collection
│   └── export/
│       ├── export-data.js         # Step 6: JSON/CSV export
│       ├── export-results.js      # Legacy validation exports
│       └── export-nyse-results.js # NYSE-specific exports
├── scripts/                      # NPM script wrappers with memory allocation
│   ├── generate.sh               # Generate ticker combinations
│   ├── validate.sh               # Initial validation
│   ├── revalidate-active.sh      # Active ticker revalidation (24h skip logic)
│   ├── revalidate-inactive.sh    # Inactive ticker revalidation (24h skip logic)
│   ├── gather.sh                 # Comprehensive data collection
│   ├── export.sh                 # Comprehensive JSON/CSV export (streaming)
│   ├── export-legacy.sh          # Simple validation data export
│   ├── export-nyse.sh            # NYSE-specific ticker export
│   ├── test-validate.sh          # Test validation with limits
│   └── pipeline.sh               # Complete 6-step pipeline
├── output/                        # All results saved here (auto-downloadable via UI)
│   ├── DATA.json                 # Comprehensive financial data (JSON)
│   ├── DATA.csv                  # Comprehensive financial data (CSV) 
│   ├── active_tickers.json       # Simple active ticker list
│   ├── delisted_tickers.json     # Simple inactive ticker list
│   └── daily-summary-*.json      # Automated daily reports
├── index.sh                      # Main pipeline script
└── package.json                  # Dependencies and scripts
```
│   │   └── ticker_data.db        # Comprehensive financial data
│   ├── validate/
│   │   ├── validate-tickers.js    # Step 2: Initial validation
│   │   ├── revalidate-active.js   # Step 3: Active ticker revalidation
│   │   └── revalidate-inactive.js # Step 4: Inactive ticker revalidation
│   ├── return-data/
│   │   └── return-data.js         # Step 5: Comprehensive data collection
│   └── export/
│       ├── export-data.js         # Step 6: JSON/CSV export
│       ├── export-results.js      # Legacy validation exports
│       └── export-nyse-results.js # NYSE-specific exports
├── output/                        # All results saved here
│   ├── DATA.json                 # Comprehensive financial data (JSON)
│   ├── DATA.csv                  # Comprehensive financial data (CSV) 
│   ├── active_tickers.json       # Simple active ticker list
│   └── delisted_tickers.json     # Simple inactive ticker list
├── index.sh                      # Main pipeline script
└── package.json                  # Dependencies and scripts
```

## Script Summary

### **Available Scripts (10 total):**

#### **Core Pipeline Scripts (6):**
- **`generate.sh`** - Generate all possible ticker combinations (A-ZZZZ)
- **`validate.sh`** - Initial validation against Yahoo Finance API
- **`revalidate-active.sh`** - Re-check active tickers (with 24h skip logic)
- **`revalidate-inactive.sh`** - Re-check inactive tickers (with 24h skip logic)  
- **`gather.sh`** - Collect comprehensive financial data for active tickers
- **`export.sh`** - Export comprehensive data to JSON/CSV (streaming)

#### **Specialized Export Scripts (2):**
- **`export-legacy.sh`** - Export simple validation data (ticker, price, status)
- **`export-nyse.sh`** - Export NYSE/NASDAQ tickers only

#### **Utility Scripts (2):**
- **`test-validate.sh`** - Test validation with limited ticker batch
- **`pipeline.sh`** - Run complete 6-step pipeline sequence

### **Key Features:**
- ✅ **Memory Optimized**: All scripts use `--max-old-space-size=10240` (10GB)
- ✅ **24-Hour Skip Logic**: Revalidation scripts avoid recently checked tickers
- ✅ **Streaming Exports**: Handle large datasets without memory issues
- ✅ **Constant crumb updates**: Updates a new crumb every 10000 tickers to make sure 
- ✅ **Clean Organization**: No duplicate scripts, single purpose each

## 🎮 Commands

### Web Dashboard (Recommended)
```bash
npm start                       # Start web dashboard on http://localhost:3000
npm run dev                     # Start with nodemon for development
```

**Dashboard Features:**
- Real-time streaming command output
- Interactive prompts with input fields
- Automated background processing monitoring
- One-click command execution
- File browser and downloads
- Ticker database browser with filtering and pagination

### Command Line Interface

#### Primary Commands (With Memory Allocation)
```bash
# Complete pipeline (recommended)
./index.sh                  # Full 6-step process with progress tracking
npm run pipeline            # Alternative complete pipeline script

# Individual pipeline steps (all include --max-old-space-size=10240)
npm run generate            # Step 1: Generate ticker combinations  
npm run validate            # Step 2: Initial validation
npm run revalidate-active   # Step 3: Revalidate active tickers (24h skip)
npm run revalidate-inactive # Step 4: Revalidate inactive tickers (24h skip)
npm run gather              # Step 5: Collect comprehensive data
npm run export              # Step 6: Export to JSON/CSV (streaming)
```
```bash
# Complete pipeline (recommended)
./index.sh                  # Full 6-step process with progress tracking
npm start                   # Same as above
npm run pipeline            # Alternative complete pipeline script

# Individual pipeline steps (all include --max-old-space-size=10240)
npm run generate            # Step 1: Generate ticker combinations  
npm run validate            # Step 2: Initial validation
npm run revalidate-active   # Step 3: Revalidate active tickers (24h skip)
npm run revalidate-inactive # Step 4: Revalidate inactive tickers (24h skip)
npm run gather              # Step 5: Collect comprehensive data
npm run export              # Step 6: Export to JSON/CSV (streaming)
```

#### Legacy/Specialized Commands
```bash
# Legacy validation exports (simple ticker data with memory allocation)
npm run export-legacy              # Export active tickers only (memory-safe)
npm run test-validate              # Test validation with 100 ticker limit

# Specialized exports (with memory allocation)  
npm run export-nyse                # NYSE tickers only

# Note: Legacy exports focus on active tickers to avoid memory issues with 12M+ records
```

#### Direct Script Access
```bash
# All scripts include proper memory allocation (--max-old-space-size=10240)
./scripts/generate.sh              # Generate ticker combinations
./scripts/validate.sh              # Validate tickers against market APIs  
./scripts/revalidate-active.sh     # Revalidate active tickers (24h skip)
./scripts/revalidate-inactive.sh   # Revalidate inactive tickers (24h skip)
./scripts/gather.sh                # Collect comprehensive financial data
./scripts/export.sh                # Export comprehensive data (streaming)
./scripts/export-legacy.sh         # Export simple validation data
./scripts/export-nyse.sh           # Export NYSE-specific data
./scripts/test-validate.sh         # Test validation (limited batch)
./scripts/pipeline.sh              # Complete pipeline sequence
```

## 📊 Output Files

All output files are automatically available for download through the web dashboard's file browser.

### Comprehensive Data (Primary Output)
- **`DATA.json`** - Complete financial data with metadata structure
- **`DATA.csv`** - Same data in spreadsheet format for analysis

### Legacy Validation Output
- **`active_tickers.json`** - Simple list of active tickers with basic prices
- **`delisted_tickers.json`** - List of inactive/delisted tickers

### Specialized Output
- **`nyse_tickers.json`** - NYSE/NASDAQ tickers only 
- **`nyse_tickers.csv`** - NYSE tickers in CSV format

### Automated Reports
- **`daily-summary-YYYY-MM-DD.json`** - Daily automation reports with statistics
- **`checkpoint.json`** - System state and progress tracking

## ✨ Features

### Web Dashboard
- **Real-time Streaming**: Watch command execution with live output
- **Interactive Commands**: Handle prompts and user input seamlessly
- **Background Automation**: Automated revalidation and data gathering
- **File Management**: Browse, download, and manage output files
- **Database Browser**: Search and filter ticker data with pagination
- **Process Monitoring**: Track automation jobs and system status
- **No Timeouts**: Commands run to natural completion
- **Responsive Design**: Modern Bootstrap interface with real-time updates

### Core Capabilities
- **Complete Coverage**: All possible tickers A-ZZZZZ (12.3 million combinations when fully enabled)
- **Intelligent Rate Limiting**: Respects Yahoo Finance API limits with smart delays
- **Resumable Processing**: Can stop and restart at any point
- **Smart Caching**: Avoids reprocessing recently updated data (24-hour skip logic)
- **Memory Efficient**: All scripts include 10GB heap allocation (`--max-old-space-size=10240`)
- **Streaming Exports**: Handles large datasets without memory issues
- **24-Hour Revalidation**: Skips recently checked tickers to optimize performance

### Automation & Scheduling
- **Automated Revalidation**: Checks tickers older than 30 days (hourly)
- **Automated Data Gathering**: Refreshes active ticker data older than 24 hours (every 30 minutes)
- **Daily Maintenance**: System reports and cleanup (2 AM daily)
- **Manual Override**: Force any automated process immediately
- **Job Management**: Prevents duplicate processes, logs all activity
- **Background Processing**: Runs alongside web dashboard without interference

### Data Collection
- **Real-time Quotes**: Current prices, market cap, P/E ratios
- **Historical Data**: Price history and volume data  
- **Company Information**: Sector, industry, exchange information
- **Financial Metrics**: Dividend yields, 52-week ranges, statistics

### Export Formats
- **Structured JSON**: Hierarchical data with metadata
- **CSV Spreadsheets**: Flat format for analysis tools
- **Streaming Support**: Handles large datasets without memory issues

## 🚀 Performance & Scale

- **Current Config**: Single-letter tickers only (A-Z = 26 tickers)
- **Full Scale**: Enable 1-5 letter combinations (A-ZZZZZ = ~12.3M tickers)
- **Processing Time**: Extended timeline for full dataset (with rate limiting)
- **Expected Results**: ~3% active tickers per 1-zzzz (potentially 300K+ stocks at full scale)
- **Memory Usage**: 10GB heap allocation for large dataset processing
- **Web Dashboard**: Real-time monitoring and control of all processes
- **Automation**: Background processing maintains data freshness automatically

## 📱 Usage Examples

### Quick Start with Web Dashboard
1. `npm start` - Start the dashboard
2. Open `http://localhost:3000`
3. Click "Full Pipeline" to run complete process
4. Monitor progress in real-time
5. Download results from the Files section

### Automation in Action
The system automatically:
- Checks for stale tickers every hour (30+ days old)
- Refreshes active ticker data every 30 minutes (24+ hours old)  
- Generates daily reports and statistics
- Logs all activity for monitoring

### Manual Control
Use the dashboard's Force buttons to:
- Immediately trigger revalidation checks
- Force data gathering for all active tickers
- Override automation timing when needed

## 🛠️ Technical Details

### Dependencies
- **Express.js**: Web server and API endpoints
- **SQLite3**: Lightweight database for ticker storage
- **node-cron**: Automated scheduling and background jobs
- **Yahoo Finance 2**: Market data API integration
- **Bootstrap 5**: Modern responsive UI framework

## 💰 Support This Project

If this project saved you time or helped with your research, consider supporting the development:

**[☕ Support a starving dev for just $1](https://givemicahmoney.com)**

This comprehensive financial data collection system with web dashboard and automation took significant time to build - your support helps maintain and improve it!

---

## 📋 Recent Updates

### v1.4 - Web Dashboard & Automation
- ✅ **Web-based dashboard** with real-time streaming output
- ✅ **Interactive command execution** with user input support  
- ✅ **Automated background processing** (30-day revalidation, 24-hour data refresh)
- ✅ **File browser and downloads** for all output files
- ✅ **Ticker database browser** with filtering and pagination
- ✅ **Process monitoring** and automation status tracking
- ✅ **No timeout limits** - commands run to natural completion
- ✅ **Responsive design** with Bootstrap 5 interface

### Previous Versions
- **v1.3**: Memory optimization and streaming exports
- **v1.2**: 24-hour skip logic and revalidation improvements  
- **v1.1**: Complete pipeline automation and comprehensive data collection
- **v1.0**: Initial ticker generation and validation system