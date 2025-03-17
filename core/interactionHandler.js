// core/interactionHandler.js - Updated with better error handling and message processing

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
      const InstanceManager = require('./InstanceManager');
      
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
        // Try to find command in module loader
        const command = this.moduleLoader.commands.get(interaction.commandName);
        if (command && typeof command.execute === 'function') {
          try {
            await command.execute(interaction, instance);
            handled = true;
          } catch (commandError) {
            console.error(`Error executing command ${interaction.commandName}:`, commandError);
            
            // Try to reply with error if not already handled
            try {
              const errorMessage = `Error executing command: ${commandError.message}`;
              if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: errorMessage });
              } else if (!interaction.replied) {
                await interaction.reply({ content: errorMessage, ephemeral: true });
              }
            } catch (replyError) {
              console.error('Error sending command error reply:', replyError);
            }
          }
        } else {
          // Legacy command handler
          try {
            const discordCommands = require('../modules/discordCommands');
            handled = await discordCommands.handleCommand(interaction);
          } catch (legacyError) {
            console.error('Error in legacy command handler:', legacyError);
          }
        }
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
        
        // Log details for debugging
        console.log(`Message in channel ${message.channel.name} (${message.channel.id}) belongs to instance ${routeInfo.instanceId || 'unknown'}`);
        
        const { handler, instance: routeInstance } = routeInfo;
        
        // First try using the handler directly
        if (handler && typeof handler.handleDiscordMessage === 'function') {
          try {
            await handler.handleDiscordMessage(message);
            return true;
          } catch (handlerError) {
            console.error(`Error in direct handler for ${routeInfo.instanceId}: ${handlerError.message}`);
          }
        }
        
        // If direct handler failed, try the instance's handler
        if (routeInstance?.discordHandler?.handleDiscordMessage) {
          try {
            await routeInstance.discordHandler.handleDiscordMessage(message);
            return true;
          } catch (instanceError) {
            console.error(`Error in instance handler for ${routeInfo.instanceId}: ${instanceError.message}`);
          }
        }
        
        // Final fallback - check all instances for this guild
        const guildId = message.guild.id;
        const InstanceManager = require('./InstanceManager');
        const fallbackInstance = InstanceManager.getInstanceByGuildId(guildId);
        
        if (fallbackInstance?.discordHandler?.handleDiscordMessage) {
          try {
            await fallbackInstance.discordHandler.handleDiscordMessage(message);
            return true;
          } catch (fallbackError) {
            console.error(`Error in fallback handler for ${guildId}: ${fallbackError.message}`);
          }
        }
        
        console.error(`No working handler found for message in channel ${message.channel.name}`);
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