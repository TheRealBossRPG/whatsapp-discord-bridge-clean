// controllers/EventController.js - Controls event registration
const EventLoader = require('../core/EventLoader');

/**
 * Controls event registration and management
 */
class EventController {
  constructor() {
    this.eventLoader = EventLoader;
  }
  
  /**
   * Initialize the event system
   */
  initialize() {
    // Load all event handlers
    this.eventLoader.loadAllEvents();
    console.log('Event system initialized');
  }
  
  /**
   * Register Discord events with a client
   * @param {Client} client - Discord client
   */
  registerDiscordEvents(client) {
    this.eventLoader.registerDiscordEvents(client);
  }
  
  /**
   * Register WhatsApp events with an instance
   * @param {Object} instance - WhatsApp instance
   */
  registerWhatsAppEvents(instance) {
    this.eventLoader.registerWhatsAppEvents(instance);
  }
  
  /**
   * Register instance events
   * This registers both Discord and WhatsApp events with the proper routing
   * @param {Object} instance - WhatsApp instance
   * @param {Client} client - Discord client
   */
  registerInstanceEvents(instance, client) {
    // First register WhatsApp-specific events
    this.registerWhatsAppEvents(instance);
    
    // Then set up Discord event routing for this instance
    this.setupDiscordRouting(instance, client);
  }
  
  /**
   * Set up Discord event routing for a specific instance
   * @param {Object} instance - WhatsApp instance
   * @param {Client} client - Discord client
   */
  setupDiscordRouting(instance, client) {
    if (!instance || !instance.categoryId || !client) {
      console.error('Invalid instance or client for Discord routing setup');
      return;
    }
    
    console.log(`Setting up Discord routing for instance ${instance.instanceId}, category ${instance.categoryId}`);
    
    // Initialize the routes map if it doesn't exist
    if (!client._instanceRoutes) {
      client._instanceRoutes = new Map();
    }
    
    // Register this instance's category for routing
    client._instanceRoutes.set(instance.categoryId, {
      instanceId: instance.instanceId,
      handler: instance.handlers?.discordHandler,
      instance: instance
    });
    
    console.log(`Discord routing set up for category ${instance.categoryId} -> instance ${instance.instanceId}`);
  }
  
  /**
   * Unregister instance from Discord routing
   * @param {Object} instance - WhatsApp instance
   * @param {Client} client - Discord client
   */
  unregisterInstanceRouting(instance, client) {
    if (!instance || !client || !client._instanceRoutes) {
      return;
    }
    
    // Remove the instance's routing
    if (instance.categoryId && client._instanceRoutes.has(instance.categoryId)) {
      client._instanceRoutes.delete(instance.categoryId);
      console.log(`Removed Discord routing for category ${instance.categoryId}`);
    }
  }
}

module.exports = new EventController();