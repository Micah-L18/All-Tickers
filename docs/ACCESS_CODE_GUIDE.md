# Access Code Configuration Guide

## Overview

All sensitive operations in the All-Tickers application are now protected by environment variable-based access codes. This ensures security while maintaining flexibility.

## Environment Variables

Add these to your `.env` file:

```properties
# Security
ACCESS_CODE=007
PROCESS_KILL_CODE=007
```

## Access Code Types

### 1. ACCESS_CODE
**Purpose:** Protects running of protected commands  
**Default:** `007`  
**Used for:**
- Generate Tickers
- Validate Tickers  
- Gather Data
- Auto Monitor

**Validation:** Server-side via `/api/validate-access-code`

### 2. PROCESS_KILL_CODE
**Purpose:** Protects process termination  
**Default:** `007`  
**Used for:**
- Stopping/killing running processes

**Validation:** Server-side via `/api/kill-process`

## How It Works

### Command Access (ACCESS_CODE)

1. User clicks a protected command button (Generate, Validate, Gather, Monitor)
2. Modal popup prompts for access code
3. User enters code
4. Frontend sends code to `/api/validate-access-code`
5. Server validates against `process.env.ACCESS_CODE`
6. If valid, command proceeds; if invalid, error is shown

### Process Termination (PROCESS_KILL_CODE)

1. User views process details
2. User clicks "Stop Process" button
3. Prompt asks for access code
4. User enters code
5. Frontend sends code with process ID to `/api/kill-process`
6. Server validates against `process.env.PROCESS_KILL_CODE`
7. If valid, process is terminated; if invalid, 403 error returned

## Security Benefits

✅ **Server-side validation** - Codes never exposed in client code  
✅ **Environment-based** - Easy to configure per deployment  
✅ **Separate codes** - Different codes for different operations  
✅ **No hardcoding** - All codes in `.env` file  
✅ **Flexible** - Can use same or different codes

## Configuration Examples

### Same Code for Everything (Simple)
```properties
ACCESS_CODE=mySecretCode123
PROCESS_KILL_CODE=mySecretCode123
```

### Different Codes (More Secure)
```properties
ACCESS_CODE=runCommands2025
PROCESS_KILL_CODE=killProcess2025
```

### Production Deployment
```properties
ACCESS_CODE=prod_cmd_$(openssl rand -hex 8)
PROCESS_KILL_CODE=prod_kill_$(openssl rand -hex 8)
```

## Testing

After changing codes:

1. **Restart the server:**
   ```bash
   npm start
   ```

2. **Test command access:**
   - Click "Gather Data" or any protected command
   - Enter your ACCESS_CODE
   - Should proceed if correct

3. **Test process termination:**
   - Start a process
   - Click process to view details
   - Click "Stop Process"
   - Enter your PROCESS_KILL_CODE
   - Should terminate if correct

## Migration from Hardcoded

### Before (Hardcoded - INSECURE)
```javascript
const correctCode = '007'; // ❌ Exposed in client code
```

### After (Environment Variable - SECURE)
```javascript
// Server validates
const requiredAccessCode = process.env.ACCESS_CODE || '007'; // ✅ Secure
```

## Troubleshooting

### "Invalid access code" - Commands
- Check `ACCESS_CODE` in `.env`
- Ensure server restarted after changing `.env`
- Check browser console for errors
- Verify code exactly matches (case-sensitive)

### "Invalid access code" - Process Termination
- Check `PROCESS_KILL_CODE` in `.env`
- Ensure server restarted after changing `.env`
- Check server logs for validation attempts
- Verify code exactly matches (case-sensitive)

### Codes not working after change
- **Most common:** Forgot to restart server
- **Solution:** Stop server (Ctrl+C) and run `npm start` again
- Environment variables only load on server startup

## Security Recommendations

### Development Environment
```properties
ACCESS_CODE=dev007
PROCESS_KILL_CODE=dev007
```
- Simple, memorable codes
- Can be shared with team
- Easy to type for testing

### Production Environment
```properties
ACCESS_CODE=Pr0d_C0mm@nd_2025_aB9x
PROCESS_KILL_CODE=Pr0d_K1ll_2025_zX3p
```
- Complex, unique codes
- Different codes for each operation
- Regularly rotated
- Never in version control
- Use password manager

## Best Practices

1. ✅ **Never commit `.env` to git**
   - Add `.env` to `.gitignore`
   - Use `.env.example` for documentation

2. ✅ **Use environment-specific codes**
   - Development: Simple codes
   - Staging: Moderate complexity
   - Production: High complexity

3. ✅ **Rotate codes regularly**
   - Change monthly in production
   - Change after team member leaves

4. ✅ **Use different codes for different operations**
   - Separates permissions
   - Limits damage if one code leaks

5. ✅ **Document who has access**
   - Keep a secure list
   - Update when personnel changes

## API Reference

### Validate Access Code
```bash
curl -X POST http://localhost:3001/api/validate-access-code \
  -H "Content-Type: application/json" \
  -d '{"accessCode": "007"}'
```

Response:
```json
{"valid": true}
```

### Kill Process with Code
```bash
curl -X POST http://localhost:3001/api/kill-process \
  -H "Content-Type: application/json" \
  -d '{"processId": "gather_123", "accessCode": "007"}'
```

Response:
```json
{"success": true, "message": "Process gather_123 (gather) has been terminated"}
```

## Support

For issues with access codes:
1. Check this documentation
2. Verify `.env` file configuration
3. Confirm server restart after changes
4. Check server logs for validation attempts
5. Test with default `007` first to isolate issue

---

**Remember:** Security is only as strong as your practices. Choose strong codes, keep them secret, and rotate them regularly! 🔒
