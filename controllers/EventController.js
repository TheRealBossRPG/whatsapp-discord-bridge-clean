// controllers/EventController.js
const fs = require('fs');
const path = require('path');

/**
 * Controller for managing and registering event handlers
 */
class EventController {
  constructor() {
    this.discordEventPath = path.join(__dirname, '..', 'events', 'discord');
    this.whatsappEventPath = path.join(__dirname, '..', 'events', 'whatsapp');
    
    this.discordEvents = new Map();
    this.whatsappEvents = new Map();
    
    this.loadAllEvents();
    
    console.log(`[EventController] Initialized with ${this.discordEvents.size} Discord events and ${this.whatsappEvents.size} WhatsApp events`);
  }
  
  /**
   * Load all event handlers from directories
   */
  loadAllEvents() {
    // Load Discord events
    this.loadDiscordEvents();
    
    // Load WhatsApp events
    this.loadWhatsAppEvents();
  }
  
  /**
   * Load Discord event handlers
   */
  loadDiscordEvents() {
    if (!fs.existsSync(this.discordEventPath)) {
      console.warn(`[EventController] Discord events directory not found: ${this.discordEventPath}`);
      return;
    }
    
    try {
      const eventFiles = fs.readdirSync(this.discordEventPath)
        .filter(file => file.endsWith('.js'));
      
      for (const file of eventFiles) {
        try {
          const eventPath = path.join(this.discordEventPath, file);
          const event = require(eventPath);
          
          if (event && event.event) {
            this.discordEvents.set(event.event, event);
            console.log(`[EventController] Loaded Discord event: ${event.event} (${file})`);
          } else {
            console.warn(`[EventController] Invalid Discord event handler in file: ${file}`);
          }
        } catch (error) {
          console.error(`[EventController] Error loading Discord event ${file}:`, error);
        }
      }
    } catch (error) {
      console.error(`[EventController] Error loading Discord events:`, error);
    }
  }
  
  /**
   * Load WhatsApp event handlers
   */
  loadWhatsAppEvents() {
    if (!fs.existsSync(this.whatsappEventPath)) {
      console.warn(`[EventController] WhatsApp events directory not found: ${this.whatsappEventPath}`);
      return;
    }
    
    try {
      const eventFiles = fs.readdirSync(this.whatsappEventPath)
        .filter(file => file.endsWith('.js'));
      
      for (const file of eventFiles) {
        try {
          const eventPath = path.join(this.whatsappEventPath, file);
          const event = require(eventPath);
          
          if (event && event.event) {
            this.whatsappEvents.set(event.event, event);
            console.log(`[EventController] Loaded WhatsApp event: ${event.event} (${file})`);
          } else {
            console.warn(`[EventController] Invalid WhatsApp event handler in file: ${file}`);
          }
        } catch (error) {
          console.error(`[EventController] Error loading WhatsApp event ${file}:`, error);
        }
      }
    } catch (error) {
      console.error(`[EventController] Error loading WhatsApp events:`, error);
    }
  }
  
  /**
   * Register Discord events with client
   * @param {Object} client - Discord client
   */
  registerDiscordEvents(client) {
    if (!client) {
      console.error(`[EventController] Cannot register Discord events: client is null`);
      return;
    }
    
    for (const [eventName, handler] of this.discordEvents.entries()) {
      try {
        if (handler.once) {
          console.log(`[EventController] Registering one-time Discord event: ${eventName}`);
          client.once(eventName, (...args) => handler.execute(...args));
        } else {
          console.log(`[EventController] Registering Discord event: ${eventName}`);
          client.on(eventName, (...args) => handler.execute(...args));
        }
      } catch (error) {
        console.error(`[EventController] Error registering Discord event ${eventName}:`, error);
      }
    }
  }
  
  /**
   * Register WhatsApp events with instance
   * @param {Object} instance - Server instance
   */
  registerWhatsAppEvents(instance) {
    if (!instance || !instance.clients || !instance.clients.whatsAppClient) {
      console.error(`[EventController] Cannot register WhatsApp events: invalid instance or client`);
      return;
    }
    
    const whatsAppClient = instance.clients.whatsAppClient;
    
    for (const [eventName, handler] of this.whatsappEvents.entries()) {
      try {
        console.log(`[EventController] Registering WhatsApp event: ${eventName} for instance ${instance.instanceId}`);
        
        // This is a critical fix: Bind the handler to include the instance as first parameter
        whatsAppClient.on(eventName, (...args) => handler.execute(instance, ...args));
      } catch (error) {
        console.error(`[EventController] Error registering WhatsApp event ${eventName}:`, error);
      }
    }
  }
  
  /**
   * Register all instance events - both Discord and WhatsApp
   * @param {Object} instance - Server instance
   * @param {Object} discordClient - Discord client
   */
  registerInstanceEvents(instance, discordClient) {
    if (!instance) {
      console.error(`[EventController] Cannot register instance events: instance is null`);
      return;
    }
    
    // Register WhatsApp events if client is available
    if (instance.clients && instance.clients.whatsAppClient) {
      this.registerWhatsAppEvents(instance);
    } else {
      console.log(`[EventController] Skipping WhatsApp event registration for instance ${instance.instanceId}: no client available`);
    }
    
    // Note: Discord events are usually registered globally, not per-instance
  }
}

// Export a singleton instance
module.exports = new EventController();