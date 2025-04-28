// core/ModalLoader.js
const fs = require('fs');
const path = require('path');

/**
 * Modal handler registry - Improved with better regex handling and debugging
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
    
    // Log regex-based handlers specifically
    const regexHandlers = Array.from(this.modals.keys())
      .filter(key => key.startsWith('regex:'))
      .map(key => {
        const handler = this.modals.get(key);
        return { 
          key, 
          regex: handler.regex ? String(handler.regex) : 'N/A',
          hasMatchFunction: typeof handler.matches === 'function'
        };
      });
    
    if (regexHandlers.length > 0) {
      console.log(`Loaded ${regexHandlers.length} regex-based modal handlers:`);
      for (const handler of regexHandlers) {
        console.log(`- ${handler.key}: regex = ${handler.regex}, hasMatchFunction = ${handler.hasMatchFunction}`);
      }
    }
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
            } else if (modalHandler && (modalHandler.regex || typeof modalHandler.matches === 'function')) {
              // For regex-based handlers, use special "regex" key with path for better identification
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
      if (key.startsWith('regex:') && handler) {
        // First try using matches function if it exists
        if (typeof handler.matches === 'function') {
          try {
            if (handler.matches(customId)) {
              console.log(`Matched modal handler using matches() function: ${key} for ${customId}`);
              return handler;
            }
          } catch (matchError) {
            console.error(`Error in matches() function for ${key}:`, matchError);
          }
        }
        
        // Then try using regex directly
        if (handler.regex && handler.regex instanceof RegExp) {
          try {
            if (handler.regex.test(customId)) {
              console.log(`Matched modal handler using regex: ${key} with pattern ${handler.regex} for ${customId}`);
              return handler;
            }
          } catch (regexError) {
            console.error(`Error testing regex for ${key}:`, regexError);
          }
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
    
    const customId = interaction.customId;
    console.log(`[ModalLoader] Processing modal submission: ${customId}`);
    
    const handler = this.getHandler(customId);
    
    if (!handler) {
      console.log(`[ModalLoader] No handler found for modal: ${customId}`);
      console.log(`[ModalLoader] Available handlers: ${Array.from(this.modals.keys()).join(', ')}`);
      
      // Provide information about what might be wrong
      if (customId.includes('edit_ticket_modal_')) {
        console.log(`[ModalLoader] This appears to be an edit ticket modal, checking for matching regex handlers...`);
        
        // Look for potential matches by manually checking regex
        for (const [key, regexHandler] of this.modals.entries()) {
          if (key.startsWith('regex:') && regexHandler) {
            if (regexHandler.regex) {
              console.log(`[ModalLoader] Checking regex handler ${key} with pattern ${regexHandler.regex}`);
              try {
                if (String(customId).match(regexHandler.regex)) {
                  console.log(`[ModalLoader] FOUND MATCHING PATTERN but match() failed to return it!`);
                }
              } catch (err) {
                console.error(`[ModalLoader] Error manually testing regex:`, err);
              }
            }
          }
        }
      }
      
      // Respond to the user
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "This form submission couldn't be processed. The application may need to be updated.",
          ephemeral: true
        }).catch(err => console.error("[ModalLoader] Error replying to unhandled modal:", err));
      }
      
      return false;
    }
    
    try {
      console.log(`[ModalLoader] Found handler for modal: ${customId}`);
      
      // Verify handler has execute method
      if (typeof handler.execute !== 'function') {
        console.error(`[ModalLoader] Modal handler for ${customId} has no execute method`);
        
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: "Error processing form: Invalid handler configuration.",
            ephemeral: true
          });
        }
        
        return false;
      }
      
      // Execute the handler
      await handler.execute(interaction, instance);
      return true;
    } catch (error) {
      console.error(`[ModalLoader] Error executing modal handler for ${customId}:`, error);
      
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
        console.error('[ModalLoader] Error sending error message:', replyError);
      }
      
      return false;
    }
  }
}

module.exports = new ModalLoader();