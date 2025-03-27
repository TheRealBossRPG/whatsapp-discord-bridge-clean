const EventHandler = require('../../templates/EventHandler');

/**
 * Handles WhatsApp authentication failure events
 */
class AuthFailureEvent extends EventHandler {
  constructor() {
    super({
      event: 'auth_failure'
    });
  }
  
  /**
   * Process authentication failure event
   * @param {Object} instance - WhatsApp instance
   * @param {Error} error - Authentication error
   */
  async execute(instance, error) {
    try {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] WhatsApp authentication failed:`, error);
      
      // Update instance state
      if (instance) {
        instance.connected = false;
        instance.reconnectAttempts++;
        
        // Emit events to instance-specific listeners
        if (instance.events) {
          instance.events.emit('auth_failure', error);
        }
        
        // Clean auth files to force new QR code on next connection
        try {
          const { cleanAuthFiles } = require('../../utils/qrCodeUtils');
          await cleanAuthFiles(instance);
          console.log(`[WhatsAppEvent:${instance.instanceId}] Cleaned auth files after authentication failure`);
        } catch (cleanError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error cleaning auth files:`, cleanError);
        }
      }
      
      // Notify Discord of authentication failure
      if (instance && instance.guildId && instance.instanceId) {
        try {
          // Get the Discord client
          const discordClient = instance.discordClient;
          
          if (discordClient && discordClient.guilds.cache.has(instance.guildId)) {
            const guild = discordClient.guilds.cache.get(instance.guildId);
            
            // Try to find a suitable channel to notify (system channel or first text channel)
            const channel = guild.systemChannel || 
                          guild.channels.cache.find(c => c.type === 'GUILD_TEXT' && c.permissionsFor(guild.me).has('SEND_MESSAGES'));
            
            if (channel) {
              await channel.send({
                content: `⚠️ WhatsApp authentication failed. You may need to re-scan the QR code to reconnect. Please use the \`/setup\` command to generate a new QR code.`,
                allowedMentions: { parse: [] } // Don't ping anyone
              });
            }
          }
        } catch (notifyError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error notifying Discord of auth failure:`, notifyError);
        }
      }
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp auth failure event:`, error);
    }
  }
}

module.exports = new AuthFailureEvent();