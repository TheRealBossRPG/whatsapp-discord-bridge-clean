// events/whatsapp/disconnected.js - Fixed with proper event handling
const EventHandler = require('../../templates/EventHandler');

/**
 * Handles WhatsApp disconnection events
 */
class DisconnectedEvent extends EventHandler {
  constructor() {
    super({
      event: 'disconnected'
    });
  }
  
  /**
   * Process disconnection event
   * @param {Object} instance - WhatsApp instance
   * @param {string} reason - Disconnection reason
   */
  async execute(instance, reason) {
    try {
      console.log(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] WhatsApp client disconnected: ${reason || 'Unknown reason'}`);
      
      // Update instance state
      if (instance) {
        instance.connected = false;
        
        // Emit events to instance-specific listeners
        if (instance.events) {
          instance.events.emit('disconnect', reason);
        }
        
        // Attempt auto-reconnect if not deliberately disconnected
        const intentionalReasons = ['user_disconnected', 'logout'];
        if (!intentionalReasons.includes(reason) && !instance.reconnecting) {
          console.log(`[WhatsAppEvent:${instance.instanceId}] Attempting auto-reconnect...`);
          
          // Use exponential backoff for reconnection attempts
          setTimeout(() => {
            if (typeof instance.attemptReconnect === 'function') {
              instance.attemptReconnect();
            } else {
              console.log(`[WhatsAppEvent:${instance.instanceId}] No reconnect method available`);
            }
          }, 5000); // 5-second initial delay
        }
      }
      
      // Notify users of disconnect via Discord if appropriate
      if (instance && instance.guildId && reason !== 'user_disconnected' && instance.instanceId) {
        try {
          // Get the Discord client
          const discordClient = instance.discordClient;
          
          if (discordClient && discordClient.guilds.cache.has(instance.guildId)) {
            const guild = discordClient.guilds.cache.get(instance.guildId);
            
            // Try to find a suitable channel to notify (system channel or first text channel)
            const channel = guild.systemChannel || 
                          guild.channels.cache.find(c => 
                            c.isTextBased() && // Fixed - Use isTextBased instead of type check
                            c.permissionsFor(guild.members.me).has('SendMessages')
                          );
            
            if (channel) {
              await channel.send({
                content: `⚠️ WhatsApp connection has been lost. Reason: ${reason || 'Unknown'}. The system will attempt to reconnect automatically.`,
                allowedMentions: { parse: [] } // Don't ping anyone
              });
            }
          }
        } catch (notifyError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error notifying Discord of disconnect:`, notifyError);
        }
      }
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp disconnected event:`, error);
    }
  }
}

module.exports = new DisconnectedEvent();