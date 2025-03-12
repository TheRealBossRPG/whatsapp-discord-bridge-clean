// templates/Modal.js - Base template for modal handlers
/**
 * Base class for creating modal handlers
 */
class Modal {
  /**
   * Create a new modal handler
   * @param {Object} options - Modal options
   * @param {string} options.customId - Modal custom ID
   * @param {RegExp} [options.regex] - Regex for matching custom IDs
   */
  constructor(options) {
    this.customId = options.customId;
    this.regex = options.regex || null;
  }
  
  /**
   * Check if this handler matches the modal
   * @param {string} id - Modal custom ID
   * @returns {boolean} - Whether this handler matches
   */
  matches(id) {
    if (this.customId === id) return true;
    if (this.regex && this.regex.test(id)) return true;
    return false;
  }
  
  /**
   * Create a modal builder
   * @param {Object} options - Modal options
   * @param {Array} options.inputs - Text inputs for the modal
   * @returns {ModalBuilder} - Discord.js modal builder
   */
  static createModal(options) {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    
    const modal = new ModalBuilder()
      .setCustomId(options.customId)
      .setTitle(options.title);
    
    // Add inputs
    if (options.inputs && Array.isArray(options.inputs)) {
      for (const input of options.inputs) {
        const textInput = new TextInputBuilder()
          .setCustomId(input.customId)
          .setLabel(input.label)
          .setStyle(input.style || TextInputStyle.Short)
          .setRequired(input.required !== false);
        
        if (input.placeholder) {
          textInput.setPlaceholder(input.placeholder);
        }
        
        if (input.value) {
          textInput.setValue(input.value);
        }
        
        if (input.minLength) {
          textInput.setMinLength(input.minLength);
        }
        
        if (input.maxLength) {
          textInput.setMaxLength(input.maxLength);
        }
        
        const row = new ActionRowBuilder().addComponents(textInput);
        modal.addComponents(row);
      }
    }
    
    return modal;
  }
  
  /**
   * Execute the modal handler
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    throw new Error('Method not implemented');
  }
}

module.exports = Modal;