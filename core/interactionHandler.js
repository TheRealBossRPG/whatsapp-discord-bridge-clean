// core/interactionHandler.js - Streamlined with new structure
const ModuleLoader = require('./ModuleLoader');
const InstanceManager = require('./InstanceManager');

/**
 * Main Discord interaction handler
 */
class InteractionHandler {
  constructor() {
    // Cache handler modules
    this.moduleLoader = ModuleLoader;
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
      // Get the server instance for this interaction
      const instance = this.getInstanceForInteraction(interaction);
      
      // Try to find a handler using the module loader
      const handler = this.moduleLoader.findHandler(interaction);
      
      if (handler && typeof handler.execute === 'function') {
        // Execute the handler
        try {
          await handler.execute(interaction, instance);
          return true;
        } catch (handlerError) {
          console.error(`Error in handler for ${interaction.customId || interaction.commandName}:`, handlerError);
          
          // Try to reply with error
          await this.safeReply(interaction, {
            content: `Error processing your request: ${handlerError.message}`,
            ephemeral: true
          });
          
          return false;
        }
      }
      
      // If no handler found through module system, try fallback to instance handler
      if (instance && instance.handlers && instance.handlers.discordHandler) {
        try {
          await instance.handlers.discordHandler.handleInteraction(interaction);
          return true;
        } catch (instanceError) {
          console.error('Error in instance discordHandler:', instanceError);
          
          // Try to reply with error
          await this.safeReply(interaction, {
            content: `Error processing your request: ${instanceError.message}`,
            ephemeral: true
          });
          
          return false;
        }
      }
      
      // No handler found
      console.log(`No handler found for interaction: ${interaction.customId || interaction.commandName || 'unknown'}`);
      return false;
    } catch (error) {
      console.error("Error in interaction handler:", error);
      
      // Try to send an error message
      try {
        await this.safeReply(interaction, {
          content: `An error occurred processing your request: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("Error sending error response:", replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Handle Discord message
   * @param {Message} message - Discord message
   */
  async handleMessage(message) {
    try {
      // Skip bot messages and DMs
      if (message.author.bot || !message.guild) return false;
      
      // Get category ID for this channel
      const categoryId = message.channel.parentId;
      if (!categoryId) return false;
      
      // Check if this category belongs to an instance
      if (message.client._instanceRoutes && message.client._instanceRoutes.has(categoryId)) {
        const routeInfo = message.client._instanceRoutes.get(categoryId);
        const { handler, instance } = routeInfo;
        
        // Try using handler directly
        if (handler && typeof handler.handleDiscordMessage === 'function') {
          try {
            await handler.handleDiscordMessage(message);
            return true;
          } catch (handlerError) {
            console.error(`Error in message handler for ${routeInfo.instanceId}:`, handlerError);
          }
        }
        
        // Try instance handler
        if (instance?.handlers?.discordHandler?.handleDiscordMessage) {
          try {
            await instance.handlers.discordHandler.handleDiscordMessage(message);
            return true;
          } catch (instanceError) {
            console.error(`Error in instance message handler for ${instance.instanceId}:`, instanceError);
          }
        }
      }
      
      // Fall back to guild-based instance
      const guildId = message.guild.id;
      const instance = InstanceManager.getInstanceByGuildId(guildId);
      
      if (instance?.handlers?.discordHandler?.handleDiscordMessage) {
        try {
          await instance.handlers.discordHandler.handleDiscordMessage(message);
          return true;
        } catch (fallbackError) {
          console.error(`Error in fallback message handler for ${guildId}:`, fallbackError);
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error handling Discord message:', error);
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