# Auto-Monitor Script

## Overview
The Auto-Monitor script automatically checks your ticker database every minute and runs validation or data gathering scripts as needed.

## How It Works

### Automated Checks (Every 60 seconds)
1. **Checks for unvalidated tickers** - If 10+ tickers need validation
2. **Checks for stale data** - If 50+ active tickers haven't been updated in 24+ hours

### Automatic Actions
- ✅ Runs `validate` script when unvalidated ticker count reaches threshold
- ✅ Runs `gather` script when stale data count reaches threshold
- ✅ Never runs duplicate processes (checks if script is already running)
- ✅ Logs all actions with timestamps

## Usage

### Start Auto-Monitor
```bash
npm run monitor
```

Or directly:
```bash
node scripts/auto-monitor.js
```

### From Dashboard
Click the **Auto Monitor** button (requires access code: `007`)

### Stop Auto-Monitor
Press `Ctrl+C` or stop the process from the dashboard

## Configuration

You can adjust thresholds by editing `scripts/auto-monitor.js`:

```javascript
this.validationThreshold = 10;     // Run validation at 10 unvalidated tickers
this.dataUpdateThreshold = 50;     // Run gather at 50 stale tickers
this.hoursThreshold = 24;          // Consider data stale after 24 hours
this.checkInterval = 60000;        // Check every 60 seconds (60000ms)
```

## Output Example

```
🤖 Auto-Monitor Starting...
==================================================
✅ Database connected
⏱️  Check interval: 60 seconds
📊 Validation threshold: 10 unvalidated tickers
📈 Data update threshold: 50 tickers needing updates
🕒 Update age threshold: 24 hours
==================================================

🟢 Auto-Monitor is now running...
Press Ctrl+C to stop

⏰ [10/18/2025, 3:00:00 PM] Checking for tasks...
📊 Status: 15 unvalidated, 75 need updates
🔍 Found 15 unvalidated tickers (threshold: 10)

🚀 Starting validate...
✅ validate completed successfully in 45.2s

📥 Found 75 tickers needing updates (threshold: 50)
🚀 Starting gather...
✅ gather completed successfully in 125.7s

⏰ [10/18/2025, 3:01:00 PM] Checking for tasks...
📊 Status: 0 unvalidated, 12 need updates
✅ All systems nominal - no action needed
```

## Features

- 🔄 **Continuous monitoring** - Runs indefinitely until stopped
- 🚫 **Duplicate prevention** - Won't run the same script twice simultaneously
- ⏱️ **Process tracking** - Shows duration and completion status
- 📊 **Detailed logging** - Timestamp and status for every check
- 🛡️ **Error handling** - Continues monitoring even if a script fails
- 🎯 **Smart thresholds** - Only runs when actually needed

## Use Cases

### Perfect For:
- **Production environments** - Keep data fresh automatically
- **Overnight monitoring** - Let it run while you sleep
- **Continuous data collection** - Maintain up-to-date ticker information
- **Hands-off operation** - Set it and forget it

### Not Needed For:
- One-time data collection
- Manual testing
- When you want full control over when scripts run

## Integration with Dashboard

When running through the dashboard:
- Shows as a running process
- Can be stopped via process details modal
- Displays live output in terminal window
- Protects with access code `007`

## Notes

- The monitor will NOT run validation/gather if they're already running
- Each check logs current status even if no action is taken
- Process continues running even if individual scripts encounter errors
- Safe to run continuously - designed for long-term operation
