# All-Tickers Deployment Guide

## Ubuntu Server Deployment

### Prerequisites
- Node.js 18+ installed
- Sufficient disk space (database can grow to several GB)
- Write permissions to the database directory

### Installation Steps

1. **Clone the repository**
   ```bash
   cd /opt
   git clone https://github.com/Micah-L18/All-Tickers.git
   cd All-Tickers
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   nano .env
   ```

4. **Set database location** (choose one method):

   **Option A: Use a specific directory**
   ```bash
   # In .env file:
   DB_DIR=/var/lib/all-tickers
   ACCESS_CODE=your_secure_code_here
   PROCESS_KILL_CODE=your_secure_code_here
   PORT=3001
   ```

   **Option B: Use full database path**
   ```bash
   # In .env file:
   SQLITE_DATABASE=/var/lib/all-tickers/ticker_data.db
   ACCESS_CODE=your_secure_code_here
   PROCESS_KILL_CODE=your_secure_code_here
   PORT=3001
   ```

   **Option C: Use current directory (default)**
   ```bash
   # Database will be created in /opt/All-Tickers/ticker_data.db
   # Just set access codes:
   ACCESS_CODE=your_secure_code_here
   PROCESS_KILL_CODE=your_secure_code_here
   PORT=3001
   ```

5. **Create database directory** (if using custom location)
   ```bash
   sudo mkdir -p /var/lib/all-tickers
   sudo chown $USER:$USER /var/lib/all-tickers
   ```

6. **Initialize the database schema**
   ```bash
   npm start
   # This will create the database and tables
   # Stop with Ctrl+C once you see "Server Started"
   ```

### Running as a Service (systemd)

1. **Create service file**
   ```bash
   sudo nano /etc/systemd/system/all-tickers.service
   ```

2. **Add the following content**
   ```ini
   [Unit]
   Description=All-Tickers Stock Data Service
   After=network.target

   [Service]
   Type=simple
   User=your_username
   WorkingDirectory=/opt/All-Tickers
   Environment="NODE_ENV=production"
   ExecStart=/usr/bin/node --max-old-space-size=8192 server.js
   Restart=always
   RestartSec=10
   StandardOutput=journal
   StandardError=journal
   SyslogIdentifier=all-tickers

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable all-tickers
   sudo systemctl start all-tickers
   ```

4. **Check service status**
   ```bash
   sudo systemctl status all-tickers
   sudo journalctl -u all-tickers -f  # View logs
   ```

### Using PM2 (Alternative)

1. **Install PM2**
   ```bash
   npm install -g pm2
   ```

2. **Start the application**
   ```bash
   cd /opt/All-Tickers
   pm2 start server.js --name all-tickers --max-memory-restart 8G
   ```

3. **Save PM2 configuration**
   ```bash
   pm2 save
   pm2 startup  # Follow the instructions
   ```

4. **View logs**
   ```bash
   pm2 logs all-tickers
   pm2 monit
   ```

### Nginx Reverse Proxy (Optional)

If you want to access the dashboard via a domain name:

1. **Install Nginx**
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. **Create Nginx configuration**
   ```bash
   sudo nano /etc/nginx/sites-available/all-tickers
   ```

3. **Add configuration**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. **Enable site and restart Nginx**
   ```bash
   sudo ln -s /etc/nginx/sites-available/all-tickers /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

### Troubleshooting

#### Database Permission Issues
```bash
# Check directory permissions
ls -la /var/lib/all-tickers

# Fix permissions
sudo chown -R your_username:your_username /var/lib/all-tickers
chmod 755 /var/lib/all-tickers
```

#### Port Already in Use
```bash
# Find what's using port 3001
sudo lsof -i :3001

# Change port in .env file
PORT=3002
```

#### View Application Logs
```bash
# If using systemd
sudo journalctl -u all-tickers -f --lines=100

# If using PM2
pm2 logs all-tickers --lines 100

# Or check the application directly
cd /opt/All-Tickers
npm start
```

### Security Recommendations

1. **Change default access codes**
   - Set strong ACCESS_CODE and PROCESS_KILL_CODE in .env

2. **Use firewall**
   ```bash
   sudo ufw allow 3001/tcp
   sudo ufw enable
   ```

3. **Regular backups**
   ```bash
   # Backup database
   cp /var/lib/all-tickers/ticker_data.db /backup/ticker_data_$(date +%Y%m%d).db
   ```

4. **Keep dependencies updated**
   ```bash
   npm audit
   npm audit fix
   ```

### Database Management

#### Check database size
```bash
du -h /var/lib/all-tickers/ticker_data.db
```

#### Backup database
```bash
sqlite3 /var/lib/all-tickers/ticker_data.db ".backup '/backup/ticker_data.db'"
```

#### Vacuum database (optimize)
```bash
sqlite3 /var/lib/all-tickers/ticker_data.db "VACUUM;"
```

### Monitoring

Access the dashboard at: `http://your-server-ip:3001`

The dashboard provides:
- Real-time statistics
- Process monitoring
- Ticker validation status
- Data gathering status
