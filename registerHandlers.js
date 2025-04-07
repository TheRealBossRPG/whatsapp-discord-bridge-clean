// registerHandlers.js - Updated with InteractionTracker
const fs = require('fs');
const path = require('path');
const InteractionTracker = require('./utils/InteractionTracker');

/**
 * Register all handlers with the Discord client
 * @param {Client} client - Discord.js client
 * @returns {Object} - Handlers object
 */
function registerHandlers(client) {
  console.log('Registering all handlers with Discord client...');
  
  try {
    // Load all modules
    const ModuleLoader = require('./core/ModuleLoader');
    ModuleLoader.loadAll();
    
    // Load component handlers
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
    
    // Let the event system handle interaction events
    // We don't need to add extra event listeners here
    // as the InteractionCreateEvent will use the centralized InteractionTracker
    
    console.log('Event system and handlers initialized successfully');
    
    // Return handler objects for external use
    return {
      eventController: EventController,
      eventLoader: EventLoader,
      moduleLoader: ModuleLoader,
      buttonLoader: ButtonLoader, 
      modalLoader: ModalLoader,
      selectMenuLoader: SelectMenuLoader,
      interactionHandler: InteractionHandler,
      interactionTracker: InteractionTracker
    };
  } catch (error) {
    console.error('Error registering handlers:', error);
    throw error;
  }
}

module.exports = registerHandlers;