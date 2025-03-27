const EventHandler = require('../../templates/EventHandler');

/**
 * Handles Discord client error events
 */
class ErrorEvent extends EventHandler {
  constructor() {
    super({
      event: 'error'
    });
  }
  
  /**
   * Process error event
   * @param {Error} error - The error
   */
  async execute(error) {
    console.error('Discord client error:', error);
    
    // Log detailed error information
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    
    if (error.httpStatus) {
      console.error(`HTTP status: ${error.httpStatus}`);
    }
    
    if (error.path) {
      console.error(`API path: ${error.path}`);
    }
    
    if (error.method) {
      console.error(`Method: ${error.method}`);
    }
    
    // Log stack trace if available
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    
    // For serious errors, we could implement additional error reporting here
    // such as sending a notification to a monitoring system or Discord channel
  }
}

module.exports = new ErrorEvent();