// templates/Button.js - Base template for button handlers
/**
 * Base class for creating button handlers
 */
class Button {
  /**
   * Create a new button handler
   * @param {Object} options - Button options
   * @param {string} options.customId - Button custom ID
   * @param {RegExp} [options.regex] - Regex for matching custom IDs
   */
  constructor(options) {
    this.customId = options.customId;
    this.regex = options.regex || null;
  }
  
  /**
   * Check if this handler matches the button
   * @param {string} id - Button custom ID
   * @returns {boolean} - Whether this handler matches
   */
  matches(id) {
    if (this.customId === id) return true;
    if (this.regex && this.regex.test(id)) return true;
    return false;
  }
  
  /**
   * Create a button builder
   * @param {Object} options - Button options
   * @returns {ButtonBuilder} - Discord.js button builder
   */
  static createButton(options) {
    const { ButtonBuilder, ButtonStyle } = require('discord.js');
    
    const button = new ButtonBuilder()
      .setCustomId(options.customId)
      .setLabel(options.label)
      .setStyle(options.style || ButtonStyle.Primary);
    
    if (options.emoji) {
      button.setEmoji(options.emoji);
    }
    
    if (options.disabled) {
      button.setDisabled(true);
    }
    
    return button;
  }
  
  /**
   * Execute the button handler
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    throw new Error('Method not implemented');
  }
}

module.exports = Button;