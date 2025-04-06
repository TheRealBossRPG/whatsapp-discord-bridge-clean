// buttons/status/refreshQR.js - Enhanced for better QR code handling
const Button = require('../../templates/Button');

/**
 * Button handler for refreshing the WhatsApp QR code
 */
class RefreshQRButton extends Button {
  constructor() {
    super({
      customId: 'refresh_qr'
    });
  }
  
  /**
   * Execute button action
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    try {
      // CRITICAL FIX: Check if interaction is still valid before deferring
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferUpdate();
      } else {
        console.log("Interaction already responded to, continuing without deferring");
      }
      
      // Get the instance if not provided
      if (!instance) {
        const InstanceManager = require('../../core/InstanceManager');
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
      
      // Update message to show progress
      await interaction.editReply({
        content: '🧹 Cleaning up authentication data...',
        components: [],
        embeds: [],
        files: []
      });
      
      // Clean auth files first
      try {
        const { cleanAuthFiles } = require('../../utils/qrCodeUtils');
        await cleanAuthFiles(instance);
        console.log(`Authentication files cleaned for ${instance.instanceId}`);
      } catch (cleanError) {
        console.error(`Error cleaning auth files:`, cleanError);
        // Continue anyway
      }
      
      // Disconnect first to ensure clean state
      try {
        if (instance.clients?.whatsAppClient) {
          await instance.disconnect(false);
          console.log(`WhatsApp client disconnected for refresh`);
        }
      } catch (disconnectError) {
        console.error(`Error disconnecting:`, disconnectError);
        // Continue anyway
      }
      
      // Add a small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update UI
      await interaction.editReply({
        content: '🔄 Requesting new QR code from WhatsApp servers...'
      });
      
      // Get QR code
      try {
        const { generateQRCode, displayQRCode } = require('../../utils/qrCodeUtils');
        
        // Important: Set the show QR code flag explicitly to true
        if (instance.clients?.whatsAppClient?.setShowQrCode) {
          instance.clients.whatsAppClient.setShowQrCode(true);
        }
        
        // Generate a new QR code
        const qrCode = await generateQRCode({
          guildId: interaction.guild.id,
          categoryId: instance.categoryId,
          transcriptChannelId: instance.transcriptChannelId,
          vouchChannelId: instance.vouchChannelId || instance.transcriptChannelId,
          customSettings: instance.customSettings || {},
          discordClient: interaction.client,
          qrTimeout: 120000 // 2 minutes
        });
        
        if (qrCode === null) {
          await interaction.editReply({
            content: '⚠️ WhatsApp is already connected! This is unexpected since we cleared auth data.',
            components: []
          });
          return;
        }
        
        if (qrCode === "TIMEOUT") {
          await interaction.editReply({
            content: '⚠️ QR code generation timed out. Please try again later.',
            components: []
          });
          return;
        }
        
        // Display the QR code
        await displayQRCode(interaction, qrCode, interaction.guild.id);
      } catch (qrError) {
        console.error(`Error generating QR code:`, qrError);
        
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_qr')
            .setLabel('Try Again')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('setup')
            .setLabel('Run Setup Again')
            .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try again.`,
          components: [row]
        });
      }
    } catch (error) {
      console.error(`Error executing refresh QR button:`, error);
      
      try {
        // Create retry button
        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_qr')
            .setLabel('Try Again')
            .setStyle(ButtonStyle.Primary)
        );
        
        await interaction.editReply({
          content: `❌ Error refreshing QR code: ${error.message}. Please try again.`,
          components: [row]
        });
      } catch (replyError) {
        console.error(`Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new RefreshQRButton();