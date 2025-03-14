const fs = require('fs');
const path = require('path');

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
    
    // Read all files in the directory
    const buttonFiles = fs.readdirSync(buttonsDir)
      .filter(file => file.endsWith('.js'));
    
    // Import and register each button handler
    for (const file of buttonFiles) {
      try {
        const buttonHandler = require(path.join(buttonsDir, file));
        
        // Verify it's a valid button handler
        if (buttonHandler && buttonHandler.customId) {
          this.buttons.set(buttonHandler.customId, buttonHandler);
          console.log(`Registered button handler: ${buttonHandler.customId}`);
        } else if (buttonHandler && typeof buttonHandler.matches === 'function') {
          // For regex-based handlers, use special "regex" key
          this.buttons.set(`regex:${file}`, buttonHandler);
          console.log(`Registered regex button handler from: ${file}`);
        } else {
          console.warn(`Invalid button handler in file: ${file}`);
        }
      } catch (error) {
        console.error(`Error loading button handler ${file}:`, error);
      }
    }
    
    console.log(`Loaded ${this.buttons.size} button handlers`);
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
      await handler.execute(interaction, instance);
      return true;
    } catch (error) {
      console.error(`Error executing button handler for ${interaction.customId}:`, error);
      
      // Try to reply with error
      try {
        const content = `Error processing button: ${error.message}`;
        
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

module.exports = new ButtonLoader();