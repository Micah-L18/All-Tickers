# Process Security & Access Control

## Overview

The All-Tickers dashboard now implements security measures to protect running processes from unauthorized termination while allowing full visibility of process details to all users.

## Features

### 🔓 **Public Access (No Code Required)**
- View all process details
- Monitor real-time process output
- Check process status and duration
- View process statistics and progress
- Refresh process information

### 🔒 **Protected Actions (Access Code Required)**
- Terminating/stopping running processes (`PROCESS_KILL_CODE`)
- Running protected commands (`ACCESS_CODE`):
  - Generate Tickers
  - Validate Tickers
  - Gather Data
  - Auto Monitor

## Access Code Configuration

Both the general access code (for running commands) and the process termination code are configured in the `.env` file:

```properties
# Security
ACCESS_CODE=007
PROCESS_KILL_CODE=007
```

**Default Codes:** `007` for both

### Changing the Access Codes

1. Open `.env` file in the project root
2. Locate the security variables:
   - `ACCESS_CODE` - Used for running protected commands (generate, validate, gather, monitor)
   - `PROCESS_KILL_CODE` - Used for terminating running processes
3. Set your desired codes:
   ```properties
   ACCESS_CODE=your-command-access-code
   PROCESS_KILL_CODE=your-process-kill-code
   ```
4. Restart the server for changes to take effect

**Tip:** You can use the same code for both, or different codes for additional security.

## Usage

### For Users (Viewing Processes)

1. Navigate to the **System Status** tab
2. View all running and completed processes
3. Click on any process to see full details
4. No access code needed for viewing

### For Administrators (Stopping Processes)

1. View process details as normal
2. Click the **Stop Process** button (🛑)
3. Enter the access code when prompted
4. Process will be terminated if code is correct

## Security Best Practices

1. **Change the Default Codes:** Don't use the default `007` in production
2. **Use Strong Codes:** Choose memorable but secure codes
3. **Keep them Secret:** Only share codes with authorized users/administrators
4. **Different Codes:** Consider using different codes for commands vs process termination
5. **Regular Updates:** Change the codes periodically
6. **Monitor Access:** Check logs for unauthorized access attempts

## API Endpoint

## API Endpoints

### POST `/api/validate-access-code`

Validates an access code for running protected commands.

**Request Body:**
```json
{
  "accessCode": "your-access-code"
}
```

**Response (Valid):**
```json
{
  "valid": true
}
```

**Response (Invalid):**
```json
{
  "valid": false
}
```

**Status Codes:**
- `200` - Validation result returned (check `valid` field)
- `400` - Missing access code

### POST `/api/kill-process`

Terminates a running process (requires process kill code).

**Request Body:**
```json
{
  "processId": "gather_1234567890",
  "accessCode": "your-access-code"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Process gather_1234567890 (gather) has been terminated"
}
```

**Response (Invalid Code):**
```json
{
  "error": "Invalid or missing access code",
  "requiresAuth": true
}
```

**Status Codes:**
- `200` - Process successfully terminated
- `400` - Missing process ID
- `403` - Invalid or missing access code
- `404` - Process not found
- `500` - Server error

## Implementation Details

### Backend (server.js)

The kill-process endpoint validates the access code before allowing termination:

```javascript
const requiredAccessCode = process.env.PROCESS_KILL_CODE || 'admin123';
if (!accessCode || accessCode !== requiredAccessCode) {
    return res.status(403).json({ 
        error: 'Invalid or missing access code',
        requiresAuth: true 
    });
}
```

### Frontend (app.js)

The UI prompts for the access code when attempting to stop a process:

```javascript
const accessCode = prompt(
    `⚠️ PROCESS TERMINATION REQUIRES ACCESS CODE\n\n` +
    `This will immediately stop the running process.\n` +
    `Enter access code to proceed:`
);
```

## Troubleshooting

### "Invalid access code" Error

- Verify the code matches what's in `.env`
- Check for typos or extra spaces
- Ensure server was restarted after changing `.env`
- Code is case-sensitive

### Can't View Process Details

- This should never happen - viewing doesn't require a code
- Check console for JavaScript errors
- Verify server is running (`npm start`)
- Try refreshing the page

### Process Not Stopping Even with Correct Code

- Check server logs for errors
- Verify process still exists (may have completed)
- Try refreshing system status first
- Check that process ID is correct

## Future Enhancements

Potential security improvements for future versions:

- [ ] Role-based access control (viewer vs admin)
- [ ] Session-based authentication
- [ ] Rate limiting on termination attempts
- [ ] Audit log of all termination actions
- [ ] Multiple access levels (view/pause/kill)
- [ ] Time-based access codes
- [ ] Two-factor authentication
- [ ] IP-based restrictions

## Support

For issues or questions about process security:

1. Check this documentation first
2. Review server logs for error messages
3. Verify `.env` configuration
4. Ensure latest code is running

---

**Note:** This security feature is designed for basic protection in trusted network environments. For production deployments with internet exposure, consider implementing more robust authentication mechanisms.
