const EventHandler = require('../../templates/EventHandler');

/**
 * Handles WhatsApp ready events
 */
class ReadyEvent extends EventHandler {
  constructor() {
    super({
      event: 'ready'
    });
  }
  
  /**
   * Process ready event
   * @param {Object} instance - WhatsApp instance
   */
  async execute(instance) {
    try {
      console.log(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] WhatsApp client is ready`);
      
      // Update instance state
      if (instance) {
        instance.connected = true;
        instance.reconnectAttempts = 0;
        instance.reconnecting = false;
        
        // Clear QR code data
        instance.lastQrCode = null;
        if (instance.qrCodeTimer) {
          clearTimeout(instance.qrCodeTimer);
          instance.qrCodeTimer = null;
        }
        
        // Emit events to instance-specific listeners
        if (instance.events) {
          instance.events.emit('ready');
        }
      }
      
      // Update QR code message if we have stored data
      if (global.qrCodeMessages && global.qrCodeMessages.has(instance.guildId)) {
        const { interaction, embedData } = global.qrCodeMessages.get(instance.guildId);
        
        try {
          if (interaction && interaction.editReply) {
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
            // Create success embed
            const successEmbed = new EmbedBuilder()
              .setColor(0x57f287) // Discord green for success
              .setTitle("📱 WhatsApp Connected Successfully!")
              .setDescription(
                "**Your WhatsApp account is now connected to this Discord server!**"
              )
              .addFields(
                {
                  name: "🔄 Connection Status",
                  value:
                    "`✅ Connected and ready!`\nYour WhatsApp messages will now appear in channels within the configured category.",
                }
              )
              .setFooter({ text: `WhatsApp-Discord Bridge • Guild: ${instance.guildId}` })
              .setTimestamp();
            
            // Update the interaction reply
            await interaction.editReply({
              content: "",
              embeds: [successEmbed],
              files: [], // Remove QR code
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId("check_status")
                    .setLabel("Check Status")
                    .setStyle(ButtonStyle.Success)
                )
              ],
            });
            
            // Clean up stored data
            global.qrCodeMessages.delete(instance.guildId);
            
            console.log(`[WhatsAppEvent:${instance.instanceId}] QR code message updated to show successful connection`);
          }
        } catch (updateError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error updating QR code message on ready:`, updateError);
        }
      }
      
      // Load user data if available
      try {
        if (instance.clients && instance.clients.whatsAppClient && instance.managers.userCardManager) {
          // Connect any loaded channel data to the WhatsApp handler
          if (instance.managers.channelManager) {
            instance.managers.channelManager.syncWithWhatsApp();
          }
          
          console.log(`[WhatsAppEvent:${instance.instanceId}] Synchronized client data with managers`);
        }
      } catch (syncError) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] Error syncing client data:`, syncError);
      }
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error handling WhatsApp ready event:`, error);
    }
  }
}

module.exports = new ReadyEvent();