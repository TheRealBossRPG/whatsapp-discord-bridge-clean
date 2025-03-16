// core/interactionHandler.js - Updated for new structure

/**
 * Main Discord interaction handler
 * Routes interactions to appropriate handlers based on type
 */
class InteractionHandler {
  constructor() {
    // Load handler modules
    this.buttonLoader = require('./ButtonLoader');
    this.modalLoader = require('./ModalLoader');
    this.selectMenuLoader = require('./SelectMenuLoader');
    this.moduleLoader = require('./ModuleLoader');
    
    // Make sure the module loader loads all modules
    this.moduleLoader.loadAll();
    
    console.log('InteractionHandler initialized with all loaders');
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
      // Access InstanceManager
      const InstanceManager = require('../core/InstanceManager');
      
      // Check channel parent ID first for more specific matching
      if (interaction.channel && interaction.channel.parentId) {
        const categoryId = interaction.channel.parentId;
        
        // Check if Discord client has instance routes
        if (interaction.client._instanceRoutes && interaction.client._instanceRoutes.has(categoryId)) {
          const routeInfo = interaction.client._instanceRoutes.get(categoryId);
          return routeInfo.instance || InstanceManager.getInstanceByGuildId(interaction.guildId);
        }
      }
      
      // Fall back to guild ID matching
      return InstanceManager.getInstanceByGuildId(interaction.guildId);
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
      console.log(`Processing interaction: ${interaction.customId || interaction.commandName || 'No ID'} (Type: ${interaction.type})`);
      
      // Get the server instance for this interaction
      const instance = this.getInstanceForInteraction(interaction);
      
      // First try the module loader since it has all the new-style handlers
      const handler = this.moduleLoader.findHandler(interaction);
      if (handler) {
        try {
          await handler.execute(interaction, instance);
          return true;
        } catch (handlerError) {
          console.error(`Error in module handler for ${interaction.customId || interaction.commandName}:`, handlerError);
          // Continue to try other loaders as fallback
        }
      }
      
      // Route to the appropriate loader based on interaction type
      let handled = false;
      
      // Check interaction type
      if (interaction.isButton()) {
        handled = await this.buttonLoader.handleInteraction(interaction, instance);
      } else if (interaction.isModalSubmit()) {
        handled = await this.modalLoader.handleInteraction(interaction, instance);
      } else if (interaction.isStringSelectMenu()) {
        handled = await this.selectMenuLoader.handleInteraction(interaction, instance);
      } else if (interaction.isCommand()) {
        // Legacy command handler
        const discordCommands = require('../modules/discordCommands');
        handled = await discordCommands.handleCommand(interaction);
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
        console.log(`Interaction not handled: ${interaction.customId || interaction.commandName || 'No ID'}`);
      }
      
      return handled;
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
      
      return false;
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