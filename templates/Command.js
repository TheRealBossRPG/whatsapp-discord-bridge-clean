const { SlashCommandBuilder } = require('discord.js');

/**
 * Base class for creating slash commands
 */
class Command {
  /**
   * Create a new command
   * @param {Object} options - Command options
   * @param {string} options.name - Command name
   * @param {string} options.description - Command description
   * @param {Array} [options.options] - Command options
   * @param {Object} [options.permissions] - Command permissions
   */
  constructor(options) {
    this.name = options.name;
    this.description = options.description;
    this.options = options.options || [];
    this.permissions = options.permissions || null;
    
    // Build command data
    this.data = new SlashCommandBuilder()
      .setName(this.name)
      .setDescription(this.description);
    
    // Add options if any
    if (this.options && Array.isArray(this.options)) {
      for (const option of this.options) {
        this.addOption(option);
      }
    }
    
    // Set permissions if any
    if (this.permissions) {
      this.data.setDefaultMemberPermissions(this.permissions);
    }
  }
  
  /**
   * Add an option to the command
   * @param {Object} option - Option data
   */
  addOption(option) {
    switch (option.type) {
      case 'string':
        this.data.addStringOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'integer':
        this.data.addIntegerOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'number':
        this.data.addNumberOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'boolean':
        this.data.addBooleanOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'user':
        this.data.addUserOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'channel':
        this.data.addChannelOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'role':
        this.data.addRoleOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'mentionable':
        this.data.addMentionableOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      case 'attachment':
        this.data.addAttachmentOption(opt => 
          this.configureOption(opt, option)
        );
        break;
      // Add more option types as needed
      default:
        console.warn(`Unknown option type: ${option.type}`);
        break;
    }
  }
  
  /**
   * Configure common option properties
   * @param {Object} opt - Option builder
   * @param {Object} option - Option data
   * @returns {Object} - Configured option
   */
  configureOption(opt, option) {
    opt.setName(option.name)
       .setDescription(option.description)
       .setRequired(option.required || false);
    
    // Add choices if any (only for string/integer/number options)
    if (option.choices && Array.isArray(option.choices) && 
        ['string', 'integer', 'number'].includes(option.type)) {
      opt.addChoices(...option.choices);
    }
    
    // Add channel types if any (only for channel options)
    if (option.channelTypes && Array.isArray(option.channelTypes) && option.type === 'channel') {
      opt.addChannelTypes(...option.channelTypes);
    }
    
    // Add min/max values for number/integer options
    if (option.type === 'integer' || option.type === 'number') {
      if (typeof option.minValue === 'number') {
        opt.setMinValue(option.minValue);
      }
      if (typeof option.maxValue === 'number') {
        opt.setMaxValue(option.maxValue);
      }
    }
    
    // Add min/max length for string options
    if (option.type === 'string') {
      if (typeof option.minLength === 'number') {
        opt.setMinLength(option.minLength);
      }
      if (typeof option.maxLength === 'number') {
        opt.setMaxLength(option.maxLength);
      }
    }
    
    return opt;
  }
  
  /**
   * Execute the command
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    throw new Error('Method not implemented');
  }
}

module.exports = Command;