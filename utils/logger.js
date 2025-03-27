// utils/logger.js - Enhanced logging system
const fs = require('fs');
const path = require('path');

/**
 * Initialize the logging system with timestamped logs
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

  // Override console.log
  console.log = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [INFO] ${args.join(' ')}`;
    logStream.write(line + '\n');
    console.oldLog(line);
  };

  // Override console.error
  console.error = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [ERROR] ${args.join(' ')}`;
    logStream.write(line + '\n');
    console.oldError('\x1b[31m' + line + '\x1b[0m'); // Red
  };

  // Override console.warn
  console.warn = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [WARN] ${args.join(' ')}`;
    logStream.write(line + '\n');
    console.oldWarn('\x1b[33m' + line + '\x1b[0m'); // Yellow
  };

  // Override console.info
  console.info = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [INFO] ${args.join(' ')}`;
    logStream.write(line + '\n');
    console.oldInfo('\x1b[36m' + line + '\x1b[0m'); // Cyan
  };

  // Override console.debug
  console.debug = function(...args) {
    // Only log debug in development environment
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] [DEBUG] ${args.join(' ')}`;
      logStream.write(line + '\n');
      console.oldDebug('\x1b[90m' + line + '\x1b[0m'); // Grey
    }
  };

  // Add custom loggers
  console.success = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [SUCCESS] ${args.join(' ')}`;
    logStream.write(line + '\n');
    console.oldLog('\x1b[32m' + line + '\x1b[0m'); // Green
  };

  // Add trace with stack
  console.trace = function(...args) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [TRACE] ${args.join(' ')}`;
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