// events/whatsapp/auth_failure.js - Fixed with permission checks
const EventHandler = require('../../templates/EventHandler');
const { PermissionFlagsBits } = require('discord.js');

/**
 * Handles WhatsApp authentication failure events
 */
class AuthFailureEvent extends EventHandler {
  constructor() {
    super({
      event: 'auth_failure'
    });
    
    // Track notification times to avoid spam
    this.notificationsSent = new Map();
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
        
        // Check if we should send a notification or if we've already sent one recently
        const shouldNotify = this.shouldSendNotification(instance.guildId);
        
        // Clean auth files to force new QR code on next connection
        try {
          const { cleanAuthFiles } = require('../../utils/qrCodeUtils');
          await cleanAuthFiles(instance);
          console.log(`[WhatsAppEvent:${instance.instanceId}] Cleaned auth files after authentication failure`);
        } catch (cleanError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error cleaning auth files:`, cleanError);
        }
        
        // Notify Discord of authentication failure if appropriate
        if (shouldNotify && instance.guildId && instance.instanceId) {
          await this.sendAuthFailureNotification(instance, error);
        }
      }
    } catch (execError) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp auth failure event:`, execError);
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
    
    // Only notify once per 30 minutes for auth failures
    if (now - lastNotification < 30 * 60 * 1000) {
      return false;
    }
    
    // Update last notification time
    this.notificationsSent.set(guildId, now);
    return true;
  }
  
  /**
   * Send authentication failure notification to Discord
   * @param {Object} instance - WhatsApp instance
   * @param {Error} error - Authentication error
   */
  async sendAuthFailureNotification(instance, error) {
    try {
      // Get the Discord client
      const discordClient = instance.discordClient;
      
      if (!discordClient || !discordClient.guilds.cache.has(instance.guildId)) {
        return;
      }
      
      const guild = discordClient.guilds.cache.get(instance.guildId);
      
      // FIXED: Check if we can get bot member
      if (!guild.members?.me) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] Cannot get bot member in guild`);
        return;
      }
      
      // Try to find a suitable channel to notify (system channel or first text channel)
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
      
      // Make sure we have a channel with send permissions
      if (!channel) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] No suitable channel found with send permissions`);
        return;
      }
      
      // Send notification
      await channel.send({
        content: `⚠️ WhatsApp authentication failed. You may need to re-scan the QR code to reconnect. Please use the \`/setup\` command to generate a new QR code.`,
        allowedMentions: { parse: [] } // Don't ping anyone
      });
    } catch (error) {
      // Just log error but don't crash
      console.error(`[WhatsAppEvent:${instance.instanceId}] Error notifying Discord of auth failure:`, error);
    }
  }
}

module.exports = new AuthFailureEvent();