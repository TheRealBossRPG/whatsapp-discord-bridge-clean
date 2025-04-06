// buttons/status/reconnectStatus.js - Enhanced for better reconnection
const Button = require('../../templates/Button');

/**
 * Button handler for reconnecting WhatsApp from the status command
 */
class ReconnectStatusButton extends Button {
  constructor() {
    super({
      customId: 'reconnect_status'
    });
  }
  
  /**
   * Execute button action
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    try {
      // CRITICAL FIX: Check if interaction can be deferred
      // This helps prevent the "Unknown interaction" errors
      if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      } else {
        console.log("Interaction already deferred or replied to, skipping deferUpdate");
      }
      
      // Get the instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Get the instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      // Check if instance exists
      if (!instance) {
        await interaction.editReply({
          content: '❌ No WhatsApp connection configured for this server. Please use `/setup` to configure.',
          components: []
        });
        return;
      }
      
      // Update UI to show progress
      await interaction.editReply({
        content: '🔄 Checking connection status...',
        components: [],
        embeds: []
      });
      
      try {
        // Get QRCodeUtils
        const { cleanAuthFiles } = require('../../utils/qrCodeUtils');
        
        // Update message
        await interaction.editReply({
          content: '🔄 Preparing for fresh connection...'
        });
        
        // Clean up authentication files first
        await cleanAuthFiles(instance);
        
        // Try to disconnect existing connection if any
        if (instance.disconnect) {
          try {
            await instance.disconnect(false);
          } catch (disconnectError) {
            console.error(`Error disconnecting current session:`, disconnectError);
            // Continue anyway
          }
        }
        
        // Add a short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Update message
        await interaction.editReply({
          content: '🔄 Requesting QR code from WhatsApp servers...'
        });
        
        // Generate a new QR code
        const { generateQRCode, displayQRCode } = require('../../utils/qrCodeUtils');
        
        const qrCode = await generateQRCode({
          guildId: interaction.guild.id,
          categoryId: instance.categoryId,
          transcriptChannelId: instance.transcriptChannelId,
          vouchChannelId: instance.vouchChannelId,
          customSettings: instance.customSettings || {},
          discordClient: interaction.client,
          qrTimeout: 120000 // 2 minutes
        });
        
        if (qrCode === null) {
          await interaction.editReply({
            content: "✅ WhatsApp is already connected! Loading current status..."
          });
          
          // Show status
          const statusCommand = require('../../commands/status');
          if (statusCommand && typeof statusCommand.execute === 'function') {
            await statusCommand.execute(interaction, instance);
          }
          return;
        }
        
        if (qrCode === "TIMEOUT") {
          await interaction.editReply({
            content: "⚠️ QR code generation timed out. Please try again later.",
            components: []
          });
          return;
        }
        
        // Show QR code
        await displayQRCode(interaction, qrCode, interaction.guild.id);
        
      } catch (qrError) {
        console.error(`Error during QR reconnect:`, qrError);
        
        // If QR code handling failed, show simplified message with buttons
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('reconnect_status')
            .setLabel('Try Reconnect')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('setup')
            .setLabel('Run Setup Again')
            .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
          content: `❌ Could not reconnect to WhatsApp: ${qrError.message}. You may need to run setup again.`,
          components: [row]
        });
      }
    } catch (error) {
      console.error(`Error executing reconnect button:`, error);
      
      try {
        // CRITICAL FIX: Check if we can still edit the reply
        if (interaction.isMessageComponent()) {
          await interaction.editReply({
            content: `❌ Error reconnecting: ${error.message}. Please try again.`
          });
        }
      } catch (replyError) {
        console.error(`Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new ReconnectStatusButton();