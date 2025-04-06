// core/ModalLoader.js - Fixed for modal handling
const fs = require('fs');
const path = require('path');

/**
 * Modal handler registry
 */
class ModalLoader {
  constructor() {
    this.modals = new Map();
    this.loadModalHandlers();
  }
  
  /**
   * Load all modal handlers from the modals directory
   */
  loadModalHandlers() {
    const modalsDir = path.join(__dirname, '..', 'modals');
    
    // Verify the modals directory exists
    if (!fs.existsSync(modalsDir)) {
      console.error('Modals directory not found:', modalsDir);
      return;
    }
    
    // Load modal handlers recursively with filesystem traversal
    this.loadModalsRecursively(modalsDir);
    
    console.log(`Loaded ${this.modals.size} modal handlers`);
  }
  
  /**
   * Recursively load modal handlers from a directory and its subdirectories
   * @param {string} directory - Directory to load from
   * @param {string} prefix - Prefix for the modal ID (based on subdirectory)
   */
  loadModalsRecursively(directory, prefix = '') {
    try {
      // Get all items in the directory
      const items = fs.readdirSync(directory, { withFileTypes: true });
      
      // Process each item
      for (const item of items) {
        const itemPath = path.join(directory, item.name);
        
        if (item.isDirectory()) {
          // Recursively load from subdirectory with updated prefix
          const newPrefix = prefix ? `${prefix}/${item.name}` : item.name;
          this.loadModalsRecursively(itemPath, newPrefix);
        } else if (item.isFile() && item.name.endsWith('.js')) {
          // Load modal handler from file
          try {
            const modalHandler = require(itemPath);
            
            // Verify it's a valid modal handler
            if (modalHandler && modalHandler.customId) {
              this.modals.set(modalHandler.customId, modalHandler);
              console.log(`Registered modal handler: ${modalHandler.customId}`);
            } else if (modalHandler && typeof modalHandler.matches === 'function') {
              // For regex-based handlers, use special "regex" key
              const regexKey = prefix 
                ? `regex:${prefix}/${item.name}` 
                : `regex:${item.name}`;
              
              this.modals.set(regexKey, modalHandler);
              console.log(`Registered regex modal handler from: ${regexKey}`);
            } else {
              console.warn(`Invalid modal handler in file: ${itemPath}`);
            }
          } catch (error) {
            console.error(`Error loading modal handler ${itemPath}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error loading modal handlers from ${directory}:`, error);
    }
  }
  
  /**
   * Find the appropriate handler for a modal interaction
   * @param {string} customId - Modal's customId
   * @returns {Object} - Modal handler or null if not found
   */
  getHandler(customId) {
    // First try direct match
    if (this.modals.has(customId)) {
      return this.modals.get(customId);
    }
    
    // Then try regex handlers
    for (const [key, handler] of this.modals.entries()) {
      if (key.startsWith('regex:') && typeof handler.matches === 'function') {
        if (handler.matches(customId)) {
          return handler;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Handle a modal interaction
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @returns {Promise<boolean>} - Whether the interaction was handled
   */
  async handleInteraction(interaction, instance) {
    if (!interaction.isModalSubmit()) return false;
    
    const handler = this.getHandler(interaction.customId);
    
    if (!handler) {
      console.log(`No handler found for modal: ${interaction.customId}`);
      
      // IMPROVED: Handle unrecognized modals gracefully
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "This form submission couldn't be processed. The application may need to be updated.",
          ephemeral: true
        }).catch(err => console.error("Error replying to unhandled modal:", err));
      }
      
      return false;
    }
    
    try {
      // IMPROVED: For modals, we don't defer automatically since they often need to access field values
      // and sometimes send an immediate reply. The individual modal handlers should handle deferring if needed.
      
      // Verify handler has execute method
      if (typeof handler.execute !== 'function') {
        console.error(`Modal handler for ${interaction.customId} has no execute method`);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Error processing form: Invalid handler configuration.",
            ephemeral: true
          });
        }
        
        return false;
      }
      
      await handler.execute(interaction, instance);
      return true;
    } catch (error) {
      console.error(`Error executing modal handler for ${interaction.customId}:`, error);
      
      // Try to reply with error
      try {
        const content = `Error processing form: ${error.message}`;
        
        if (interaction.replied) {
          await interaction.followUp({ content, ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.editReply({ content });
        } else {
          await interaction.reply({ content, ephemeral: true });
        }
      } catch (replyError) {
        console.error('Error sending error message:', replyError);
      }
      
      return false;
    }
  }
}

module.exports = new ModalLoader();