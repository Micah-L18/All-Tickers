# PostgreSQL Setup Guide for All-Tickers

This guide helps you set up PostgreSQL database for the All-Tickers project with automated installation and configuration.

## 🚀 Quick Setup

### Option 1: Automated Setup (Recommended)
```bash
cd scripts
./setup-postgresql.sh
```

### Option 2: Manual Setup
Follow the manual steps below if the automated script doesn't work in your environment.

## 📋 Prerequisites

### Install PostgreSQL

**macOS (with Homebrew):**
```bash
brew install postgresql
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**CentOS/RHEL/Fedora:**
```bash
sudo dnf install postgresql postgresql-server postgresql-contrib
sudo postgresql-setup initdb
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## 🔧 Configuration Details

### Database Configuration
- **Database Name:** `all_tickers`
- **User:** `all_tickers_user`
- **Host:** `localhost`
- **Port:** `5432`
- **Password:** Auto-generated (stored in `.env`)

### Schema Structure
The setup creates these tables:
- `tickers` - Core ticker symbols with exchanges array
- `ticker_quotes` - Real-time quote data with comprehensive financial metrics
- `ticker_metadata` - Data fetch tracking and validation info
- `ticker_historical` - Historical OHLCV data
- `ticker_financials` - Financial statements and ratios

### Performance Optimization
The script creates optimized indexes for:
- Symbol lookups
- Exchange filtering (GIN indexes for arrays)
- Time-based queries
- Active ticker filtering

## 📁 File Structure After Setup

```
All-Tickers/
├── .env                           # Database configuration
├── schema.sql                     # Complete database schema
├── scripts/
│   ├── setup-postgresql.sh       # Main setup script
│   ├── validate-postgresql.sh    # Validation script
│   └── create-array-functions.sql # Additional stored procedures
└── src/db/
    └── database-manager.js       # Database connection manager
```

## 🛠️ Manual Setup Steps

If the automated script fails, follow these manual steps:

### 1. Create Database and User

```sql
-- Connect to PostgreSQL as superuser
sudo -u postgres psql

-- Create user and database
CREATE USER all_tickers_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE all_tickers OWNER all_tickers_user;
GRANT ALL PRIVILEGES ON DATABASE all_tickers TO all_tickers_user;

-- Exit
\q
```

### 2. Create Tables

The setup script automatically uses the comprehensive `schema.sql` file:

```bash
PGPASSWORD='your_password' psql -h localhost -U all_tickers_user -d all_tickers -f schema.sql
```

This creates all tables, indexes, stored procedures, and views in one step.

### 3. Schema Applied Automatically

The `schema.sql` file includes:
- All core tables with proper constraints
- 20+ performance indexes 
- Stored procedures for data management
- Views for common queries
- Database maintenance functions

### 4. Additional Stored Procedures (Optional)
```bash
PGPASSWORD='your_password' psql -h localhost -U all_tickers_user -d all_tickers -f scripts/create-array-functions.sql
```

### 5. Create Environment File
```bash
cp .env.example .env
# Edit .env with your database credentials
```

## 🔍 Verification

### Test Database Connection
```bash
PGPASSWORD='your_password' psql -h localhost -U all_tickers_user -d all_tickers -c "SELECT version();"
```

### Check Tables
```sql
\dt
```

### Verify Indexes
```sql
SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname;
```

## 🚀 Getting Started

After setup completion:

1. **Start the application:**
   ```bash
   npm start
   ```

2. **Access the web interface:**
   ```
   http://localhost:3000
   ```

3. **Generate ticker combinations:**
   - Click the **"Generate Tickers"** button in the web interface
   - This will populate your database with millions of ticker combinations (A-ZZZZZ × 3 exchanges)
   - The process takes 10-30 minutes depending on your system

4. **Begin ticker validation and data collection:**
   - Use the **"Validate Tickers"** button to start checking ticker validity
   - Use the **"Gather Data"** button to collect market data for valid tickers

## 🔒 Security Notes

- The setup script generates a secure random password
- Database user has limited privileges (only access to `all_tickers` database)
- Consider using environment variables for production deployments
- Regularly backup your database

## 📊 Performance Tuning

For large datasets, consider these PostgreSQL optimizations:

```sql
-- Increase work memory for complex queries
ALTER SYSTEM SET work_mem = '256MB';

-- Optimize checkpoint settings
ALTER SYSTEM SET checkpoint_completion_target = 0.7;

-- Increase shared buffers for better caching
ALTER SYSTEM SET shared_buffers = '1GB';

-- Reload configuration
SELECT pg_reload_conf();
```

## 🐛 Troubleshooting

### Common Issues

**Permission Denied:**
```bash
sudo -u postgres createuser all_tickers_user
sudo -u postgres createdb all_tickers -O all_tickers_user
```

**Connection Refused:**
```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL service
# macOS:
brew services start postgresql
# Linux:
sudo systemctl start postgresql
```

**Port Already in Use:**
- Check if another PostgreSQL instance is running
- Modify `DB_PORT` in `.env` if needed

**Authentication Failed:**
- Verify password in `.env` matches database user password
- Check `pg_hba.conf` for authentication method

### Reset Database
```bash
# Drop and recreate (destroys all data!)
PGPASSWORD='your_password' psql -h localhost -U all_tickers_user -d postgres -c "DROP DATABASE IF EXISTS all_tickers;"
./setup-postgresql.sh
```

## 📈 Monitoring

### Check Database Size
```sql
SELECT pg_database.datname, pg_database_size(pg_database.datname), pg_size_pretty(pg_database_size(pg_database.datname)) FROM pg_database;
```

### Monitor Active Connections
```sql
SELECT count(*) FROM pg_stat_activity WHERE datname = 'all_tickers';
```

### View Table Statistics
```sql
SELECT schemaname, tablename, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_user_tables;
```

## 🔄 Backup and Restore

### Create Backup
```bash
PGPASSWORD='your_password' pg_dump -h localhost -U all_tickers_user -d all_tickers > all_tickers_backup.sql
```

### Restore from Backup
```bash
PGPASSWORD='your_password' psql -h localhost -U all_tickers_user -d all_tickers < all_tickers_backup.sql
```

## 📞 Support

If you encounter issues:
1. Check the PostgreSQL logs
2. Verify all prerequisites are installed
3. Ensure PostgreSQL service is running
4. Check firewall settings
5. Verify disk space availability

For additional help, check the project documentation or open an issue in the repository.

---

**Next:** Start your All-Tickers application and begin ticker data collection! 🎉