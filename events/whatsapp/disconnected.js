// events/whatsapp/disconnected.js - Fixed with proper permission checking
const EventHandler = require('../../templates/EventHandler');
const { PermissionFlagsBits } = require('discord.js');

/**
 * Handles WhatsApp disconnection events
 */
class DisconnectedEvent extends EventHandler {
  constructor() {
    super({
      event: 'disconnected'
    });
    
    // Track disconnection to avoid spam
    this.notificationsSent = new Map();
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
        
        // Limit notifications to once per 15 minutes per guild
        const shouldNotify = this.shouldSendNotification(instance.guildId);
        
        // Only attempt auto-reconnect if reason is network-related and not a deliberate logout
        const intentionalReasons = ['user_disconnected', 'logout'];
        if (!intentionalReasons.includes(reason) && !instance.reconnecting && shouldNotify) {
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
        
        // Notify users of disconnect via Discord if appropriate and not a regular reconnect
        if (shouldNotify && instance.guildId && reason !== 'user_disconnected' && 
            reason !== 'logout' && instance.instanceId && reason !== 'Reconnecting') {
          await this.sendDisconnectNotification(instance, reason);
        }
      }
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp disconnected event:`, error);
    }
  }
  
  /**
   * Check if we should send a notification or if we've sent one recently
   * @param {string} guildId - Discord guild ID
   * @returns {boolean} - Whether to send notification
   */
  shouldSendNotification(guildId) {
    if (!guildId) return false;
    
    const now = Date.now();
    const lastNotification = this.notificationsSent.get(guildId) || 0;
    
    // Only notify once per 15 minutes
    if (now - lastNotification < 15 * 60 * 1000) {
      return false;
    }
    
    // Update last notification time
    this.notificationsSent.set(guildId, now);
    return true;
  }
  
  /**
   * Send disconnection notification to Discord
   * @param {Object} instance - WhatsApp instance
   * @param {string} reason - Disconnection reason
   */
  async sendDisconnectNotification(instance, reason) {
    try {
      // Get the Discord client
      const discordClient = instance.discordClient;
      
      if (!discordClient || !discordClient.guilds.cache.has(instance.guildId)) {
        return;
      }
      
      const guild = discordClient.guilds.cache.get(instance.guildId);
      
      // FIXED: Check for proper permissions first
      if (!guild.members.me) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] Cannot get bot member in guild`);
        return;
      }
      
      // Try to find a suitable channel to notify (system channel or first text channel with permissions)
      let channel = null;
      
      // Check system channel first if we have permissions
      if (guild.systemChannel && 
          guild.systemChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        channel = guild.systemChannel;
      } 
      
      // If no system channel or missing permissions, find a suitable text channel
      if (!channel) {
        channel = guild.channels.cache.find(c => 
          c.isTextBased() && 
          !c.isVoiceBased() &&
          c.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages)
        );
      }
      
      if (channel) {
        await channel.send({
          content: `⚠️ WhatsApp connection has been lost. Reason: ${reason || 'Unknown'}. The system will attempt to reconnect automatically.`,
          allowedMentions: { parse: [] } // Don't ping anyone
        });
      }
    } catch (error) {
      // Just log error but don't crash
      console.error(`[WhatsAppEvent:${instance.instanceId}] Error notifying Discord of disconnect:`, error);
    }
  }
}

module.exports = new DisconnectedEvent();