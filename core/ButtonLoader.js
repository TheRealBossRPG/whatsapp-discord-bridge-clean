// core/ButtonLoader.js - Fixed for integration with tracker
const fs = require('fs');
const path = require('path');
const InteractionTracker = require('../utils/InteractionTracker');

/**
 * Button handler registry
 */
class ButtonLoader {
  constructor() {
    this.buttons = new Map();
    this.loadButtonHandlers();
  }
  
  /**
   * Load all button handlers from the buttons directory
   */
  loadButtonHandlers() {
    const buttonsDir = path.join(__dirname, '..', 'buttons');
    
    // Verify the button directory exists
    if (!fs.existsSync(buttonsDir)) {
      console.error('Button directory not found:', buttonsDir);
      return;
    }
    
    // Load button handlers recursively with filesystem traversal
    this.loadButtonsRecursively(buttonsDir);
    
    console.log(`Loaded ${this.buttons.size} button handlers`);
  }
  
  /**
   * Recursively load button handlers from a directory and its subdirectories
   * @param {string} directory - Directory to load from
   * @param {string} prefix - Prefix for the button ID (based on subdirectory)
   */
  loadButtonsRecursively(directory, prefix = '') {
    try {
      // Get all items in the directory
      const items = fs.readdirSync(directory, { withFileTypes: true });
      
      // Process each item
      for (const item of items) {
        const itemPath = path.join(directory, item.name);
        
        if (item.isDirectory()) {
          // Recursively load from subdirectory with updated prefix
          const newPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          this.loadButtonsRecursively(itemPath, newPrefix);
        } else if (item.isFile() && item.name.endsWith('.js')) {
          // Load button handler from file
          try {
            const buttonHandler = require(itemPath);
            
            // Verify it's a valid button handler
            if (buttonHandler && buttonHandler.customId) {
              this.buttons.set(buttonHandler.customId, buttonHandler);
              console.log(`Registered button handler: ${buttonHandler.customId}`);
            } else if (buttonHandler && typeof buttonHandler.matches === 'function') {
              // For regex-based handlers, use special "regex" key
              const regexKey = prefix 
                ? `regex:${prefix}/${item.name}` 
                : `regex:${item.name}`;
              
              this.buttons.set(regexKey, buttonHandler);
              console.log(`Registered regex button handler from: ${regexKey}`);
            } else {
              console.warn(`Invalid button handler in file: ${itemPath}`);
            }
          } catch (error) {
            console.error(`Error loading button handler ${itemPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error loading button handlers from ${directory}:`, error);
    }
  }
  
  /**
   * Find the appropriate handler for a button interaction
   * @param {string} customId - Button's customId
   * @returns {Object} - Button handler or null if not found
   */
  getHandler(customId) {
    // First try direct match
    if (this.buttons.has(customId)) {
      return this.buttons.get(customId);
    }
    
    // Then try regex handlers
    for (const [key, handler] of this.buttons.entries()) {
      if (key.startsWith('regex:') && typeof handler.matches === 'function') {
        if (handler.matches(customId)) {
          return handler;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Handle a button interaction
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @returns {Promise<boolean>} - Whether the interaction was handled
   */
  async handleInteraction(interaction, instance) {
    if (!interaction.isButton()) return false;
    
    const handler = this.getHandler(interaction.customId);
    
    if (!handler) {
      console.log(`No handler found for button: ${interaction.customId}`);
      return false;
    }
    
    try {
      // IMPROVED: No need to defer update - the tracker handles this
      
      // IMPROVED: Better error handling for interactions
      if (typeof handler.execute !== 'function') {
        console.error(`Button handler for ${interaction.customId} has no execute method`);
        await InteractionTracker.safeReply(interaction, { 
          content: `Internal error: Button handler is misconfigured.`,
          ephemeral: true
        });
        return false;
      }
      
      await handler.execute(interaction, instance);
      return true;
    } catch (error) {
      console.error(`Error executing button handler for ${interaction.customId}:`, error);
      
      // Try to reply with error using the tracker
      try {
        await InteractionTracker.safeReply(interaction, {
          content: `Error processing button: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
      
      return false;
    }
  }
}

module.exports = new ButtonLoader();