/**
 * Base class for creating select menu handlers
 */
class SelectMenu {
  /**
   * Create a new select menu handler
   * @param {Object} options - Select menu options
   * @param {string} options.customId - Select menu custom ID
   * @param {RegExp} [options.regex] - Regex for matching custom IDs
   */
  constructor(options) {
    this.customId = options.customId;
    this.regex = options.regex || null;
  }
  
  /**
   * Check if this handler matches the select menu
   * @param {string} id - Select menu custom ID
   * @returns {boolean} - Whether this handler matches
   */
  matches(id) {
    if (this.customId === id) return true;
    if (this.regex && this.regex.test(id)) return true;
    return false;
  }
  
  /**
   * Execute the select menu handler
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    throw new Error('Method not implemented');
  }
}

module.exports = SelectMenu;