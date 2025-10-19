# Database Configuration for Deployment

## The Problem

When deploying to Ubuntu server, the application was trying to use the development machine's hardcoded path:
```
/Users/micahlloyd/Documents/Github Projects/All-Tickers/ticker_data.db
```

This caused the error:
```
SQLITE_CANTOPEN: unable to open database file
```

## The Solution

The application now uses **relative paths** and **environment variables** to determine the database location.

### Configuration Priority

The database path is determined in this order:

1. **SQLITE_DATABASE** environment variable (full path)
2. **DB_DIR** environment variable (directory only)
3. **Current working directory** (default)

### Deployment Options

#### Option 1: Use Current Directory (Simplest)
```bash
# No configuration needed
# Database will be created in: /opt/All-Tickers/ticker_data.db
cd /opt/All-Tickers
npm start
```

#### Option 2: Use Custom Directory
```bash
# In .env file:
DB_DIR=/var/lib/all-tickers

# Create the directory:
sudo mkdir -p /var/lib/all-tickers
sudo chown $USER:$USER /var/lib/all-tickers

# Start the app:
npm start
```

#### Option 3: Use Full Custom Path
```bash
# In .env file:
SQLITE_DATABASE=/mnt/data/my-tickers/database.db

# Start the app:
npm start
```

### Quick Setup for Ubuntu

Use the automated setup script:

```bash
cd /opt/All-Tickers
chmod +x setup-ubuntu.sh
./setup-ubuntu.sh
```

This will:
1. Check Node.js version
2. Install dependencies
3. Configure .env file
4. Set up database location
5. Test database connection
6. Provide next steps

### Manual Setup

1. **Copy environment template**
   ```bash
   cp .env.example .env
   ```

2. **Edit configuration**
   ```bash
   nano .env
   ```

3. **Choose database location method:**

   For current directory (default):
   ```bash
   # Leave commented:
   # SQLITE_DATABASE=/path/to/your/ticker_data.db
   # DB_DIR=/var/lib/all-tickers
   ```

   For custom directory:
   ```bash
   DB_DIR=/var/lib/all-tickers
   ```

   For full path:
   ```bash
   SQLITE_DATABASE=/mnt/data/ticker_data.db
   ```

4. **Create directory** (if using custom location)
   ```bash
   sudo mkdir -p /var/lib/all-tickers
   sudo chown $USER:$USER /var/lib/all-tickers
   ```

5. **Start application**
   ```bash
   npm start
   ```

### Diagnostic Information

The application now logs:
- ✅ Database path
- ✅ Current working directory
- ✅ Script directory
- ✅ Directory creation (if needed)

Example output:
```
📁 SQLite database path: /var/lib/all-tickers/ticker_data.db
📂 Current working directory: /opt/All-Tickers
📂 Script directory: /opt/All-Tickers/src/db
```

### Troubleshooting

#### Permission Denied
```bash
# Fix directory permissions
sudo chown -R $USER:$USER /var/lib/all-tickers
chmod 755 /var/lib/all-tickers
```

#### Directory Doesn't Exist
```bash
# Application will create it automatically
# Or create manually:
mkdir -p /path/to/database/directory
```

#### Wrong Path Being Used
```bash
# Check environment variables
echo $SQLITE_DATABASE
echo $DB_DIR

# Check .env file
cat .env | grep -E "(SQLITE_DATABASE|DB_DIR)"

# Restart application after changes
```

### Production Recommendations

1. **Use dedicated directory**
   ```bash
   DB_DIR=/var/lib/all-tickers
   ```

2. **Set permissions properly**
   ```bash
   sudo chown app-user:app-user /var/lib/all-tickers
   chmod 755 /var/lib/all-tickers
   ```

3. **Enable automatic backups**
   ```bash
   # Add to crontab
   0 2 * * * sqlite3 /var/lib/all-tickers/ticker_data.db ".backup '/backup/ticker_data_$(date +\%Y\%m\%d).db'"
   ```

4. **Monitor disk space**
   ```bash
   df -h /var/lib/all-tickers
   du -h /var/lib/all-tickers/ticker_data.db
   ```

### Files Changed

- `src/config/database.js` - Added environment variable support with priority
- `src/db/sqlite-manager.js` - Added directory creation and diagnostic logging
- `.env.example` - Updated with new database configuration options
- `setup-ubuntu.sh` - Automated setup script
- `docs/DEPLOYMENT.md` - Complete deployment guide

### Migration from Development

If you have an existing database on your development machine:

```bash
# On dev machine:
scp ticker_data.db user@server:/var/lib/all-tickers/

# On server:
cd /opt/All-Tickers
echo "DB_DIR=/var/lib/all-tickers" >> .env
npm start
```

Your application will now work correctly on Ubuntu server! 🎉
