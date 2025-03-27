// core/EventLoader.js - Loads and registers all event handlers
const fs = require('fs');
const path = require('path');

/**
 * EventLoader class for registering Discord.js event handlers
 */
class EventLoader {
  constructor() {
    this.events = new Map();
    this.discordEventPath = path.join(__dirname, '..', 'events', 'discord');
    this.whatsappEventPath = path.join(__dirname, '..', 'events', 'whatsapp');
  }
  
  /**
   * Load all event handlers
   */
  loadAllEvents() {
    // Load Discord events
    if (fs.existsSync(this.discordEventPath)) {
      this.loadDiscordEvents();
    } else {
      console.warn(`Discord events directory not found: ${this.discordEventPath}`);
    }
    
    // Load WhatsApp events
    if (fs.existsSync(this.whatsappEventPath)) {
      this.loadWhatsAppEvents();
    } else {
      console.warn(`WhatsApp events directory not found: ${this.whatsappEventPath}`);
    }
    
    console.log(`Loaded ${this.events.size} total event handlers`);
  }
  
  /**
   * Load Discord event handlers
   */
  loadDiscordEvents() {
    console.log('Loading Discord event handlers...');
    
    try {
      const eventFiles = fs.readdirSync(this.discordEventPath)
        .filter(file => file.endsWith('.js'));
      
      for (const file of eventFiles) {
        const eventPath = path.join(this.discordEventPath, file);
        
        try {
          // Require the event handler
          const eventHandler = require(eventPath);
          
          // Skip if not a valid event handler
          if (!eventHandler || !eventHandler.event) {
            console.warn(`Invalid event handler in file: ${file}`);
            continue;
          }
          
          // Add to the events map
          this.events.set(`discord:${eventHandler.event}`, eventHandler);
          console.log(`Loaded Discord event handler: ${eventHandler.event} (${file})`);
        } catch (error) {
          console.error(`Error loading Discord event handler ${file}:`, error);
        }
      }
      
      // Count Discord events
      const discordEventCount = [...this.events.keys()]
        .filter(key => key.startsWith('discord:'))
        .length;
      
      console.log(`Loaded ${discordEventCount} Discord event handlers`);
    } catch (error) {
      console.error('Error loading Discord event handlers:', error);
    }
  }
  
  /**
   * Load WhatsApp event handlers
   */
  loadWhatsAppEvents() {
    console.log('Loading WhatsApp event handlers...');
    
    try {
      const eventFiles = fs.readdirSync(this.whatsappEventPath)
        .filter(file => file.endsWith('.js'));
      
      for (const file of eventFiles) {
        const eventPath = path.join(this.whatsappEventPath, file);
        
        try {
          // Require the event handler
          const eventHandler = require(eventPath);
          
          // Skip if not a valid event handler
          if (!eventHandler || !eventHandler.event) {
            console.warn(`Invalid event handler in file: ${file}`);
            continue;
          }
          
          // Add to the events map
          this.events.set(`whatsapp:${eventHandler.event}`, eventHandler);
          console.log(`Loaded WhatsApp event handler: ${eventHandler.event} (${file})`);
        } catch (error) {
          console.error(`Error loading WhatsApp event handler ${file}:`, error);
        }
      }
      
      // Count WhatsApp events
      const whatsappEventCount = [...this.events.keys()]
        .filter(key => key.startsWith('whatsapp:'))
        .length;
      
      console.log(`Loaded ${whatsappEventCount} WhatsApp event handlers`);
    } catch (error) {
      console.error('Error loading WhatsApp event handlers:', error);
    }
  }
  
  /**
   * Register all Discord events with a client
   * @param {Client} client - Discord.js client
   */
  registerDiscordEvents(client) {
    console.log('Registering Discord event handlers...');
    
    try {
      for (const [key, handler] of this.events.entries()) {
        if (!key.startsWith('discord:')) continue;
        
        const eventName = handler.event;
        
        if (handler.once) {
          client.once(eventName, (...args) => handler.execute(...args));
          console.log(`Registered one-time Discord event handler: ${eventName}`);
        } else {
          client.on(eventName, (...args) => handler.execute(...args));
          console.log(`Registered Discord event handler: ${eventName}`);
        }
      }
    } catch (error) {
      console.error('Error registering Discord event handlers:', error);
    }
  }
  
  /**
   * Register all WhatsApp events with an instance
   * @param {Object} instance - WhatsApp instance
   */
  registerWhatsAppEvents(instance) {
    if (!instance || !instance.clients || !instance.clients.whatsAppClient) {
      console.error('Invalid WhatsApp instance for event registration');
      return;
    }
    
    console.log(`Registering WhatsApp event handlers for instance ${instance.instanceId}...`);
    
    try {
      const client = instance.clients.whatsAppClient;
      
      for (const [key, handler] of this.events.entries()) {
        if (!key.startsWith('whatsapp:')) continue;
        
        const eventName = handler.event;
        
        client.on(eventName, (...args) => handler.execute(instance, ...args));
        console.log(`Registered WhatsApp event handler: ${eventName} for instance ${instance.instanceId}`);
      }
    } catch (error) {
      console.error(`Error registering WhatsApp event handlers for instance ${instance.instanceId}:`, error);
    }
  }
  
  /**
   * Get an event handler
   * @param {string} type - Event type (discord/whatsapp)
   * @param {string} eventName - Event name
   * @returns {Object} Event handler
   */
  getEventHandler(type, eventName) {
    return this.events.get(`${type}:${eventName}`);
  }
}

module.exports = new EventLoader();