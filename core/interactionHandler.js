// core/interactionHandler.js
const ModuleLoader = require('./ModuleLoader');
const InteractionTracker = require('../utils/InteractionTracker');

/**
 * Main Discord interaction handler (FIXED)
 * Resolves circular dependency issues and improves command handling
 */
class InteractionHandler {
  constructor() {
    // Cache handler modules
    this.moduleLoader = ModuleLoader;
    
    // Initialize direct access to handlers via customId
    this.buttonHandlers = new Map();
    this.regexButtonHandlers = [];
    this.modalHandlers = new Map();
    this.regexModalHandlers = [];
    
    // Initialize handlers for direct access
    this.initializeButtonHandlers();
    this.initializeModalHandlers();
    
    console.log('[InteractionHandler] Initialized with direct component access');
  }
  
  /**
   * Initialize button handlers for direct access to avoid circular dependencies
   */
  initializeButtonHandlers() {
    try {
      const { readdirSync, existsSync } = require('fs');
      const { join } = require('path');
      
      // Main buttons directory
      const buttonsDir = join(__dirname, '..', 'buttons');
      if (!existsSync(buttonsDir)) {
        console.warn('[InteractionHandler] Buttons directory not found.');
        return;
      }
      
      // Load button handlers from main directory
      const mainButtonFiles = readdirSync(buttonsDir, { withFileTypes: true });
      
      // Process files and directories
      for (const item of mainButtonFiles) {
        const itemPath = join(buttonsDir, item.name);
        
        if (item.isFile() && item.name.endsWith('.js')) {
          // Load button from file
          try {
            const button = require(itemPath);
            if (button && button.customId) {
              this.buttonHandlers.set(button.customId, button);
              console.log(`[InteractionHandler] Registered button handler: ${button.customId}`);
            } else if (button && (button.regex || typeof button.matches === 'function')) {
              this.regexButtonHandlers.push(button);
              console.log(`[InteractionHandler] Registered regex button handler from: ${item.name}`);
            }
          } catch (error) {
            console.error(`[InteractionHandler] Error loading button handler ${item.name}:`, error);
          }
        } else if (item.isDirectory()) {
          // Process subdirectory
          try {
            const subdirFiles = readdirSync(itemPath).filter(file => file.endsWith('.js'));
            
            for (const file of subdirFiles) {
              try {
                const buttonPath = join(itemPath, file);
                const button = require(buttonPath);
                
                if (button && button.customId) {
                  this.buttonHandlers.set(button.customId, button);
                  console.log(`[InteractionHandler] Registered button from subdirectory: ${button.customId}`);
                } else if (button && (button.regex || typeof button.matches === 'function')) {
                  this.regexButtonHandlers.push(button);
                  console.log(`[InteractionHandler] Registered regex button from subdirectory: ${item.name}/${file}`);
                }
              } catch (error) {
                console.error(`[InteractionHandler] Error loading button from subdirectory ${item.name}/${file}:`, error);
              }
            }
          } catch (subdirError) {
            console.error(`[InteractionHandler] Error processing subdirectory ${item.name}:`, subdirError);
          }
        }
      }
      
      console.log(`[InteractionHandler] Loaded ${this.buttonHandlers.size} direct buttons and ${this.regexButtonHandlers.length} regex buttons`);
    } catch (error) {
      console.error('[InteractionHandler] Error initializing button handlers:', error);
    }
  }
  
  /**
   * Initialize modal handlers for direct access (similar to button handlers)
   */
  initializeModalHandlers() {
    try {
      const { readdirSync, existsSync } = require('fs');
      const { join } = require('path');
      
      // Main modals directory
      const modalsDir = join(__dirname, '..', 'modals');
      if (!existsSync(modalsDir)) {
        console.warn('[InteractionHandler] Modals directory not found.');
        return;
      }
      
      // Function to process a directory of modal handlers
      const processDirectory = (directory, subpath = '') => {
        try {
          const items = readdirSync(directory, { withFileTypes: true });
          
          for (const item of items) {
            const itemPath = join(directory, item.name);
            
            if (item.isFile() && item.name.endsWith('.js')) {
              // Load modal from file
              try {
                const modal = require(itemPath);
                
                if (modal && modal.customId) {
                  this.modalHandlers.set(modal.customId, modal);
                  console.log(`[InteractionHandler] Registered modal handler: ${subpath}${item.name} with ID ${modal.customId}`);
                } else if (modal && (modal.regex || typeof modal.matches === 'function')) {
                  this.regexModalHandlers.push(modal);
                  console.log(`[InteractionHandler] Registered regex modal handler from: ${subpath}${item.name}`);
                }
              } catch (error) {
                console.error(`[InteractionHandler] Error loading modal handler ${subpath}${item.name}:`, error);
              }
            } else if (item.isDirectory()) {
              // Process subdirectory recursively
              processDirectory(itemPath, `${subpath}${item.name}/`);
            }
          }
        } catch (error) {
          console.error(`[InteractionHandler] Error processing modals in ${directory}:`, error);
        }
      };
      
      // Start processing from root modals directory
      processDirectory(modalsDir);
      
      console.log(`[InteractionHandler] Loaded ${this.modalHandlers.size} direct modals and ${this.regexModalHandlers.length} regex modals`);
    } catch (error) {
      console.error('[InteractionHandler] Error initializing modal handlers:', error);
    }
  }
  
  getInstanceForInteraction(interaction) {
    if (!interaction.guildId) return null;
    
    try {
      console.log(`[InteractionHandler] Finding instance for guild ${interaction.guildId}`);
      
      // Special case for customize_messages_modal
      if (interaction.isModalSubmit() && interaction.customId === "customize_messages_modal") {
        console.log("[InteractionHandler] Using temporary instance for customize_messages_modal");
        return { 
          customSettings: {}, 
          isTemporary: true,
          instanceId: interaction.guildId
        };
      }
      
      // IMPORTANT: Try to get instance directly to avoid circular dependency
      // First check if we have a local function to get instance
      try {
        const path = require('path');
        const fs = require('fs');
        
        // Try to get instance without causing circular dependency
        const instanceConfigPath = path.join(__dirname, '..', 'instance_configs.json');
        
        if (fs.existsSync(instanceConfigPath)) {
          const configs = JSON.parse(fs.readFileSync(instanceConfigPath, 'utf8'));
          
          // Find matching config by guild ID
          for (const [instanceId, config] of Object.entries(configs)) {
            if (config.guildId === interaction.guildId) {
              console.log(`[InteractionHandler] Found instance config with ID: ${instanceId}`);
              
              // Return a temporary instance with config data
              return {
                instanceId: instanceId,
                guildId: interaction.guildId,
                categoryId: config.categoryId,
                transcriptChannelId: config.transcriptChannelId || null,
                vouchChannelId: config.vouchChannelId || null,
                customSettings: config.customSettings || {},
                isTemporary: true
              };
            }
          }
        }
      } catch (configError) {
        console.error(`[InteractionHandler] Error reading instance config:`, configError);
      }
      
      // If we reach here, create a minimal temporary instance
      return {
        instanceId: interaction.guildId,
        guildId: interaction.guildId,
        customSettings: {},
        isTemporary: true
      };
    } catch (error) {
      console.error("[InteractionHandler] Error getting instance for interaction:", error);
      
      // Return minimal temporary instance on error
      return {
        instanceId: interaction.guildId,
        guildId: interaction.guildId,
        customSettings: {},
        isTemporary: true
      };
    }
  }
  
  /**
   * Find button handler with direct access to avoid circular dependencies
   * @param {string} customId - Button customId
   * @returns {Object|null} - Button handler or null
   */
  findButtonHandler(customId) {
    // First check for direct match
    if (this.buttonHandlers.has(customId)) {
      return this.buttonHandlers.get(customId);
    }
    
    // Then check regex handlers
    for (const handler of this.regexButtonHandlers) {
      if ((handler.regex && handler.regex.test(customId)) ||
          (typeof handler.matches === 'function' && handler.matches(customId))) {
        return handler;
      }
    }
    
    return null;
  }
  
  /**
   * Find modal handler with direct access
   * @param {string} customId - Modal customId
   * @returns {Object|null} - Modal handler or null
   */
  findModalHandler(customId) {
    // First check for direct match
    if (this.modalHandlers.has(customId)) {
      return this.modalHandlers.get(customId);
    }
    
    // Then check regex handlers
    for (const handler of this.regexModalHandlers) {
      if ((handler.regex && handler.regex.test(customId)) ||
          (typeof handler.matches === 'function' && handler.matches(customId))) {
        return handler;
      }
    }
    
    return null;
  }
  
  /**
   * Handle an interaction
   * @param {Interaction} interaction - Discord interaction
   */
  async handleInteraction(interaction) {
    try {
      // Get the instance now, but handle cases where we need to delay getting it
      let instance = null;
      
      // Handle buttons - get instance only after finding a valid handler
      if (interaction.isButton()) {
        console.log(`[InteractionHandler] Processing button: ${interaction.customId}`);
        
        // Look for handler using our direct registry first
        const handler = this.findButtonHandler(interaction.customId);
        
        if (handler && typeof handler.execute === 'function') {
          // Now that we have a handler, we can safely get the instance
          instance = this.getInstanceForInteraction(interaction);
          
          console.log(`[InteractionHandler] Found handler for button ${interaction.customId}, executing...`);
          try {
            await handler.execute(interaction, instance);
            return true;
          } catch (buttonError) {
            console.error(`[InteractionHandler] Error in button handler for ${interaction.customId}:`, buttonError);
            
            // Try to reply with error
            await InteractionTracker.safeReply(interaction, {
              content: `Error processing button: ${buttonError.message}`,
              ephemeral: true
            });
            
            return false;
          }
        } else {
          console.log(`[InteractionHandler] No handler found for button: ${interaction.customId}`);
          
          // Try using ButtonLoader for backwards compatibility
          try {
            const ButtonLoader = require('./ButtonLoader');
            if (ButtonLoader && typeof ButtonLoader.handleInteraction === 'function') {
              instance = this.getInstanceForInteraction(interaction);
              const handled = await ButtonLoader.handleInteraction(interaction, instance);
              if (handled) return true;
            }
          } catch (buttonLoaderError) {
            console.error(`[InteractionHandler] Error using ButtonLoader fallback:`, buttonLoaderError);
          }
        }
      }
      
      // Handle modal submissions - same pattern as buttons
      if (interaction.isModalSubmit()) {
        console.log(`[InteractionHandler] Processing modal submission: ${interaction.customId}`);
        
        // Look for handler using our direct registry first
        const handler = this.findModalHandler(interaction.customId);
        
        if (handler && typeof handler.execute === 'function') {
          // Special case for customize_messages_modal
          if (interaction.customId === "customize_messages_modal") {
            instance = { customSettings: {}, isTemporary: true };
            console.log(`[InteractionHandler] Using temporary instance for customize_messages_modal`);
          } else {
            // Now that we have a handler, we can safely get the instance
            instance = this.getInstanceForInteraction(interaction);
          }
          
          try {
            await handler.execute(interaction, instance);
            return true;
          } catch (modalError) {
            console.error(`[InteractionHandler] Error in modal handler for ${interaction.customId}:`, modalError);
            
            // Try to reply with error
            await InteractionTracker.safeReply(interaction, {
              content: `Error processing form: ${modalError.message}`,
              ephemeral: true
            });
            
            return false;
          }
        } else {
          console.log(`[InteractionHandler] No direct handler found for modal: ${interaction.customId}`);
          
          // Fallback to ModalLoader for backward compatibility
          try {
            const ModalLoader = require('./ModalLoader');
            if (ModalLoader && typeof ModalLoader.handleInteraction === 'function') {
              instance = this.getInstanceForInteraction(interaction);
              const handled = await ModalLoader.handleInteraction(interaction, instance);
              if (handled) return true;
            }
          } catch (modalLoaderError) {
            console.error(`[InteractionHandler] Error using ModalLoader fallback:`, modalLoaderError);
          }
        }
      }
      
      // Handle commands
      if (interaction.isCommand()) {
        console.log(`[InteractionHandler] Processing command: ${interaction.commandName}`);
        
        // Look for command in client.commands first (from registerHandlers.js)
        const clientCommand = interaction.client.commands?.get(interaction.commandName);
        if (clientCommand && typeof clientCommand.execute === 'function') {
          instance = this.getInstanceForInteraction(interaction);
          try {
            await clientCommand.execute(interaction, instance);
            return true;
          } catch (commandError) {
            console.error(`[InteractionHandler] Error in command handler for ${interaction.commandName}:`, commandError);
            
            // Try to reply with error
            await InteractionTracker.safeReply(interaction, {
              content: `Error processing command: ${commandError.message}`,
              ephemeral: true
            });
            
            return false;
          }
        } else {
          console.log(`[InteractionHandler] Command not found in client.commands: ${interaction.commandName}`);
        }
        
        // Try ModuleLoader as fallback
        const moduleCommand = this.moduleLoader.getCommand(interaction.commandName);
        if (moduleCommand && typeof moduleCommand.execute === 'function') {
          instance = this.getInstanceForInteraction(interaction);
          try {
            await moduleCommand.execute(interaction, instance);
            return true;
          } catch (moduleCommandError) {
            console.error(`[InteractionHandler] Error in module command for ${interaction.commandName}:`, moduleCommandError);
            
            // Try to reply with error
            await InteractionTracker.safeReply(interaction, {
              content: `Error processing command: ${moduleCommandError.message}`,
              ephemeral: true
            });
            
            return false;
          }
        } else {
          console.log(`[InteractionHandler] Command not found in ModuleLoader: ${interaction.commandName}`);
        }
      }
      
      // Handle select menus
      if (interaction.isStringSelectMenu()) {
        console.log(`[InteractionHandler] Processing select menu: ${interaction.customId}`);
        
        // Use select menu loader if available
        try {
          const SelectMenuLoader = require('./SelectMenuLoader');
          if (SelectMenuLoader && typeof SelectMenuLoader.handleInteraction === 'function') {
            instance = this.getInstanceForInteraction(interaction);
            const handled = await SelectMenuLoader.handleInteraction(interaction, instance);
            if (handled) return true;
          }
        } catch (selectMenuError) {
          console.error(`[InteractionHandler] Error with select menu loader:`, selectMenuError);
        }
      }
      
      // If we get here, no handler has successfully processed the interaction
      console.log(`[InteractionHandler] No handler found for interaction type ${interaction.type} (${interaction.customId || interaction.commandName || 'unknown'})`);
      
      // For commands, send a polite response
      if (interaction.isCommand() && !interaction.replied && !interaction.deferred) {
        await InteractionTracker.safeReply(interaction, {
          content: `Command '${interaction.commandName}' is still in development.`
        });
        return false;
      }
      
      return false;
    } catch (error) {
      console.error("[InteractionHandler] Error in interaction handler:", error);
      
      // Try to send an error message
      try {
        await InteractionTracker.safeReply(interaction, {
          content: `An error occurred processing your request: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("[InteractionHandler] Error sending error response:", replyError);
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
            console.error(`[InteractionHandler] Error in message handler for ${routeInfo.instanceId}:`, handlerError);
          }
        }
        
        // Try instance handler
        if (instance?.handlers?.discordHandler?.handleDiscordMessage) {
          try {
            await instance.handlers.discordHandler.handleDiscordMessage(message);
            return true;
          } catch (instanceError) {
            console.error(`[InteractionHandler] Error in instance message handler for ${instance.instanceId}:`, instanceError);
          }
        }
      }
      
      // Look for any instance with matching guild ID as fallback
      if (message.client._instanceRoutes) {
        for (const [_, routeInfo] of message.client._instanceRoutes.entries()) {
          if (routeInfo.instance && routeInfo.instance.guildId === message.guild.id) {
            const instance = routeInfo.instance;
            if (instance?.handlers?.discordHandler?.handleDiscordMessage) {
              try {
                await instance.handlers.discordHandler.handleDiscordMessage(message);
                return true;
              } catch (fallbackError) {
                console.error(`[InteractionHandler] Error in fallback message handler for ${instance.instanceId}:`, fallbackError);
              }
            }
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error('[InteractionHandler] Error handling Discord message:', error);
      return false;
    }
  }
}

module.exports = new InteractionHandler();