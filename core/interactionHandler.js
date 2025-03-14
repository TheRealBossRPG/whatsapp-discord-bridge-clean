// core/interactionHandler.js - Streamlined interaction handler

/**
 * Main Discord interaction handler
 * Routes interactions to appropriate handlers based on type
 */
class InteractionHandler {
  constructor() {
    // Load handler modules
    this.buttonLoader = require('./ButtonLoader');
    this.modalLoader = require('./ModalLoader');
    
    // We'll add a selectMenuLoader when needed
    // this.selectMenuLoader = require('./selectMenuLoader');
    
    // Legacy command handler for slash commands
    this.discordCommands = require('../modules/discordCommands');
    
    console.log('InteractionHandler initialized');
  }
  
  /**
   * Get instance for an interaction
   * @param {Interaction} interaction - Discord interaction 
   * @returns {Object} - Server instance
   */
  getInstanceForInteraction(interaction) {
    if (!interaction.guildId) return null;
    
    // IMPORTANT: Skip instance check for customize_messages_modal
    // This needs to be processed even without an instance
    if (interaction.isModalSubmit() && interaction.customId === "customize_messages_modal") {
      console.log("Skipping instance check for customize_messages_modal");
      return { customSettings: {}, isTemporary: true };
    }
    
    try {
      // Access bridgeInstanceManager
      const bridgeInstanceManager = require('../modules/BridgeInstanceManager');
      
      // Check channel parent ID first for more specific matching
      if (interaction.channel && interaction.channel.parentId) {
        const categoryId = interaction.channel.parentId;
        
        // Check if Discord client has instance routes
        if (interaction.client._instanceRoutes && interaction.client._instanceRoutes.has(categoryId)) {
          const routeInfo = interaction.client._instanceRoutes.get(categoryId);
          return routeInfo.instance || bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
        }
      }
      
      // Fall back to guild ID matching
      return bridgeInstanceManager.getInstanceByGuildId(interaction.guildId);
    } catch (error) {
      console.error("Error getting instance for interaction:", error);
      return null;
    }
  }
  
  /**
   * Handle an interaction
   * @param {Interaction} interaction - Discord interaction
   */
  async handleInteraction(interaction) {
    try {
      // Log basic interaction info
      console.log(`Processing interaction: ${interaction.customId || 'No custom ID'} (Type: ${interaction.type})`);
      
      // Get the server instance for this interaction
      const instance = this.getInstanceForInteraction(interaction);
      
      // Route to the appropriate handler based on interaction type
      let handled = false;
      
      // Check interaction type
      if (interaction.isButton()) {
        handled = await this.buttonLoader.handleInteraction(interaction, instance);
      } else if (interaction.isModalSubmit()) {
        handled = await this.modalLoader.handleInteraction(interaction, instance);
      } else if (interaction.isStringSelectMenu()) {
        // We'll implement this when needed
        // handled = await this.selectMenuLoader.handleInteraction(interaction, instance);
        
        // For now, pass to legacy command handler
        handled = await this.discordCommands.handleCommand(interaction);
      } else if (interaction.isCommand()) {
        // Slash commands
        handled = await this.discordCommands.handleCommand(interaction);
      }
      
      // Fallback handler if needed
      if (!handled && instance && instance.discordHandler) {
        try {
          await instance.discordHandler.handleInteraction(interaction);
          handled = true;
        } catch (handlerError) {
          console.error('Error in instance discordHandler:', handlerError);
        }
      }
      
      // Log if not handled
      if (!handled) {
        console.log(`Interaction not handled: ${interaction.customId || 'No custom ID'}`);
      }
    } catch (error) {
      console.error("Error in interaction handler:", error);
      console.error(error.stack);
      
      // Try to send an error message if we can
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: `An error occurred processing your request: ${error.message}`,
            ephemeral: true
          });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({
            content: `An error occurred processing your request: ${error.message}`
          });
        } else {
          await interaction.followUp({
            content: `An error occurred processing your request: ${error.message}`,
            ephemeral: true
          });
        }
      } catch (responseError) {
        console.error("Error sending error response:", responseError);
      }
    }
  }
  
  /**
   * Safely reply to an interaction
   * @param {Interaction} interaction - Discord interaction
   * @param {string|Object} content - Content to send
   * @param {boolean} ephemeral - Whether the reply should be ephemeral
   */
  async safeReply(interaction, content, ephemeral = false) {
    try {
      const options = typeof content === 'string' 
        ? { content, ephemeral } 
        : { ...content, ephemeral: content.ephemeral ?? ephemeral };
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(options);
      } else if (interaction.deferred && !interaction.replied) {
        // Can't set ephemeral after deferring
        const { ephemeral, ...rest } = options;
        await interaction.editReply(rest);
      } else {
        await interaction.followUp(options);
      }
    } catch (error) {
      console.error("Error sending safe reply:", error);
    }
  }
}

module.exports = new InteractionHandler();