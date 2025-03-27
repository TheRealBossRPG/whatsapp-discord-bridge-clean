// registerHandlers.js - Fixed for proper dependency loading
const fs = require('fs');
const path = require('path');

/**
 * Register all handlers with the Discord client
 * @param {Client} client - Discord.js client
 * @returns {Object} - Handlers object
 */
function registerHandlers(client) {
  console.log('Registering all handlers with Discord client...');
  
  // Load all modules
  const ModuleLoader = require('./core/ModuleLoader');
  const EventLoader = require('./core/EventLoader');
  const ButtonLoader = require('./core/ButtonLoader');
  const ModalLoader = require('./core/ModalLoader');
  const SelectMenuLoader = require('./core/SelectMenuLoader');
  const InteractionHandler = require('./core/interactionHandler');
  
  // Load event controller
  const EventController = require('./controllers/EventController');
  
  // Load all event handlers
  EventLoader.loadAllEvents();
  
  // Register Discord events with client
  EventLoader.registerDiscordEvents(client);
  
  // Set up event listeners for interactions
  client.on('interactionCreate', async (interaction) => {
    try {
      // Use the centralized interaction handler
      await InteractionHandler.handleInteraction(interaction);
    } catch (error) {
      console.error(`Error handling interaction:`, error);
    }
  });
  
  // Set up event listener for messages
  client.on('messageCreate', async (message) => {
    try {
      // Skip bot messages and DMs
      if (message.author.bot || !message.guild) return;
      
      // Use the centralized message handler
      await InteractionHandler.handleMessage(message);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  console.log('Event system and handlers initialized successfully');
  
  // Return handler objects for external use
  return {
    eventController: EventController,
    eventLoader: EventLoader,
    moduleLoader: ModuleLoader,
    buttonLoader: ButtonLoader,
    modalLoader: ModalLoader,
    selectMenuLoader: SelectMenuLoader,
    interactionHandler: InteractionHandler
  };
}

module.exports = registerHandlers;