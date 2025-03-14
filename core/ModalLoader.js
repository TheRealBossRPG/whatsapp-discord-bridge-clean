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
    
    // Read all files in the directory
    const modalFiles = fs.readdirSync(modalsDir)
      .filter(file => file.endsWith('.js'));
    
    // Import and register each modal handler
    for (const file of modalFiles) {
      try {
        const modalHandler = require(path.join(modalsDir, file));
        
        // Verify it's a valid modal handler
        if (modalHandler && modalHandler.customId) {
          this.modals.set(modalHandler.customId, modalHandler);
          console.log(`Registered modal handler: ${modalHandler.customId}`);
        } else if (modalHandler && typeof modalHandler.matches === 'function') {
          // For regex-based handlers, use special "regex" key
          this.modals.set(`regex:${file}`, modalHandler);
          console.log(`Registered regex modal handler from: ${file}`);
        } else {
          console.warn(`Invalid modal handler in file: ${file}`);
        }
      } catch (error) {
        console.error(`Error loading modal handler ${file}:`, error);
      }
    }
    
    console.log(`Loaded ${this.modals.size} modal handlers`);
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
      return false;
    }
    
    try {
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