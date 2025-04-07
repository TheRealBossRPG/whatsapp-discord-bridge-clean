// core/SelectMenuLoader.js - Fixed to use only isStringSelectMenu()
const fs = require('fs');
const path = require('path');
const InteractionTracker = require('../utils/InteractionTracker');

/**
 * Select menu handler registry
 */
class SelectMenuLoader {
  constructor() {
    this.selectMenus = new Map();
    this.loadSelectMenuHandlers();
  }
  
  /**
   * Load all select menu handlers from the selectMenus directory
   */
  loadSelectMenuHandlers() {
    const selectMenusDir = path.join(__dirname, '..', 'selectMenus');
    
    // Verify the selectMenus directory exists
    if (!fs.existsSync(selectMenusDir)) {
      console.error('SelectMenus directory not found:', selectMenusDir);
      return;
    }
    
    // Read all files in the directory
    const selectMenuFiles = fs.readdirSync(selectMenusDir)
      .filter(file => file.endsWith('.js'));
    
    // Import and register each select menu handler
    for (const file of selectMenuFiles) {
      try {
        const selectMenuHandler = require(path.join(selectMenusDir, file));
        
        // Verify it's a valid select menu handler
        if (selectMenuHandler && selectMenuHandler.customId) {
          this.selectMenus.set(selectMenuHandler.customId, selectMenuHandler);
          console.log(`Registered select menu handler: ${selectMenuHandler.customId}`);
        } else if (selectMenuHandler && typeof selectMenuHandler.matches === 'function') {
          // For regex-based handlers, use special "regex" key
          this.selectMenus.set(`regex:${file}`, selectMenuHandler);
          console.log(`Registered regex select menu handler from: ${file}`);
        } else {
          console.warn(`Invalid select menu handler in file: ${file}`);
        }
      } catch (error) {
        console.error(`Error loading select menu handler ${file}:`, error);
      }
    }
    
    console.log(`Loaded ${this.selectMenus.size} select menu handlers`);
  }
  
  /**
   * Find the appropriate handler for a select menu interaction
   * @param {string} customId - Select menu's customId
   * @returns {Object} - Select menu handler or null if not found
   */
  getHandler(customId) {
    // First try direct match
    if (this.selectMenus.has(customId)) {
      return this.selectMenus.get(customId);
    }
    
    // Then try regex handlers
    for (const [key, handler] of this.selectMenus.entries()) {
      if (key.startsWith('regex:') && typeof handler.matches === 'function') {
        if (handler.matches(customId)) {
          return handler;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Handle a select menu interaction
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @returns {Promise<boolean>} - Whether the interaction was handled
   */
  async handleInteraction(interaction, instance) {
    // FIXED: Only use isStringSelectMenu (non-deprecated method)
    if (!interaction.isStringSelectMenu()) return false;
    
    const handler = this.getHandler(interaction.customId);
    
    if (!handler) {
      console.log(`No handler found for select menu: ${interaction.customId}`);
      return false;
    }
    
    try {
      await handler.execute(interaction, instance);
      return true;
    } catch (error) {
      console.error(`Error executing select menu handler for ${interaction.customId}:`, error);
      
      // Try to reply with error using the tracker
      try {
        await InteractionTracker.safeReply(interaction, {
          content: `Error processing selection: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
      
      return false;
    }
  }
}

module.exports = new SelectMenuLoader();