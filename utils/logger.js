// utils/logger.js - Enhanced logging system with filtering
const fs = require('fs');
const path = require('path');

/**
 * Initialize the logging system with improved filtering and formatting
 */
function initializeLogger() {
  // Create logs directory if it doesn't exist
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // Create a new log file with timestamp
  const startTime = new Date();
  const logFileName = `log-${startTime.toISOString().replace(/:/g, '-')}.txt`;
  const logFilePath = path.join(logsDir, logFileName);
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Store original console methods
  console.oldLog = console.log;
  console.oldError = console.error;
  console.oldWarn = console.warn;
  console.oldInfo = console.info;
  console.oldDebug = console.debug;

  // Track repeat messages to prevent log spam
  const messageCache = {
    lastMessage: '',
    repeatCount: 0,
    lastTime: 0,
    THROTTLE_TIME_MS: 1000, // Throttle identical messages within 1 second
    QR_CODE_THROTTLE_MS: 5000, // Special throttle for QR code messages (5 seconds)
  };

  // Helper to check if a message should be throttled
  const shouldThrottle = (message) => {
    const now = Date.now();
    
    // Check for QR code related messages - special handling with longer throttle
    if (message.includes('QR code') || message.includes('Received QR')) {
      // If it's the first QR message or it's been longer than the QR throttle time, allow it
      if (messageCache.lastMessage.includes('QR code') || messageCache.lastMessage.includes('Received QR')) {
        if (now - messageCache.lastTime < messageCache.QR_CODE_THROTTLE_MS) {
          messageCache.repeatCount++;
          return true; // Throttle this QR message
        }
      }
    }
    // For regular message repeats
    else if (message === messageCache.lastMessage) {
      if (now - messageCache.lastTime < messageCache.THROTTLE_TIME_MS) {
        messageCache.repeatCount++;
        return true; // Throttle this repeat message
      }
    }
    
    // Message passes throttle check
    if (message !== messageCache.lastMessage) {
      // If we had repeated messages before this, show a summary
      if (messageCache.repeatCount > 0) {
        const repeatMsg = `Last message repeated ${messageCache.repeatCount} more times`;
        logStream.write(`[${new Date().toISOString()}] [INFO] ${repeatMsg}\n`);
        console.oldLog(`\x1b[90m${repeatMsg}\x1b[0m`); // Gray color
      }
      messageCache.repeatCount = 0;
    }
    
    messageCache.lastMessage = message;
    messageCache.lastTime = now;
    return false;
  };

  // Override console.log with throttling for repetitive messages
  console.log = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    
    // Skip throttled messages
    if (shouldThrottle(message)) return;
    
    const line = `[${timestamp}] [INFO] ${message}`;
    logStream.write(line + '\n');
    console.oldLog(line);
  };

  // Override console.error
  console.error = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    const line = `[${timestamp}] [ERROR] ${message}`;
    
    // Never throttle errors
    logStream.write(line + '\n');
    console.oldError('\x1b[41m\x1b[37m' + line + '\x1b[0m'); // White on red background
  };

  // Override console.warn
  console.warn = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    
    // Skip throttled messages
    if (shouldThrottle(message)) return;
    
    const line = `[${timestamp}] [WARN] ${message}`;
    logStream.write(line + '\n');
    console.oldWarn('\x1b[33m' + line + '\x1b[0m'); // Yellow
  };

  // Override console.info
  console.info = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    
    // Skip throttled messages
    if (shouldThrottle(message)) return;
    
    const line = `[${timestamp}] [INFO] ${message}`;
    logStream.write(line + '\n');
    console.oldInfo('\x1b[36m' + line + '\x1b[0m'); // Cyan
  };

  // Override console.debug
  console.debug = function(...args) {
    // Only log debug in development environment
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      
      // Skip throttled messages
      if (shouldThrottle(message)) return;
      
      const line = `[${timestamp}] [DEBUG] ${message}`;
      logStream.write(line + '\n');
      console.oldDebug('\x1b[90m' + line + '\x1b[0m'); // Grey
    }
  };

  // Add custom loggers
  console.success = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    const line = `[${timestamp}] [SUCCESS] ${message}`;
    logStream.write(line + '\n');
    console.oldLog('\x1b[32m' + line + '\x1b[0m'); // Green
  };

  // Add trace with stack
  console.trace = function(...args) {
    const timestamp = new Date().toISOString();
    const message = args.join(' ');
    const line = `[${timestamp}] [TRACE] ${message}`;
    logStream.write(line + '\n');
    
    // Get stack trace
    const stackTrace = new Error().stack
      .split('\n')
      .slice(2) // Remove the Error object and this function from the trace
      .join('\n');
    
    logStream.write(stackTrace + '\n');
    console.oldLog('\x1b[90m' + line + '\n' + stackTrace + '\x1b[0m'); // Grey
  };

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [FATAL] Uncaught Exception: ${error.message}`;
    logStream.write(message + '\n');
    if (error.stack) {
      logStream.write(error.stack + '\n');
    }
    console.oldError('\x1b[41m\x1b[37m' + message + '\x1b[0m'); // White on red background
    if (error.stack) {
      console.oldError('\x1b[31m' + error.stack + '\x1b[0m');
    }
  });

  // Handle unhandled rejections
  process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [FATAL] Unhandled Rejection at: ${promise}`;
    logStream.write(message + '\n');
    logStream.write(`Reason: ${reason}\n`);
    if (reason && reason.stack) {
      logStream.write(reason.stack + '\n');
    }
    console.oldError('\x1b[41m\x1b[37m' + message + '\x1b[0m'); // White on red background
    console.oldError('\x1b[31mReason: ' + reason + '\x1b[0m');
    if (reason && reason.stack) {
      console.oldError('\x1b[31m' + reason.stack + '\x1b[0m');
    }
  });

  // Return the log stream for future use
  return logStream;
}

module.exports = initializeLogger;