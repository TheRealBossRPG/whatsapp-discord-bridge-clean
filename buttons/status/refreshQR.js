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
      // Defer update to prevent interaction timeout
      await interaction.deferUpdate();
      
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
        content: '🔄 Refreshing QR code...',
        components: [],
        embeds: [],
        files: []
      });
      
      // First, disconnect the client if connected
      if (instance.clients?.whatsAppClient) {
        try {
          await instance.disconnect(false);
          console.log(`Disconnected WhatsApp client for refresh`);
        } catch (disconnectError) {
          console.error(`Error disconnecting before refresh:`, disconnectError);
          // Continue anyway
        }
      }
      
      // Clean auth files to force new QR code
      try {
        const { cleanAuthFiles } = require('../../utils/qrCodeUtils');
        await cleanAuthFiles(instance);
      } catch (cleanError) {
        console.error(`Error cleaning auth files:`, cleanError);
        // Continue anyway
      }
      
      // Add a small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update UI
      await interaction.editReply({
        content: '🔄 Requesting new QR code from WhatsApp servers...'
      });
      
      // Get QR code
      try {
        // Get InstanceManager
        const InstanceManager = require('../../core/InstanceManager');
        
        // Force QR code display
        if (instance.clients?.whatsAppClient?.setShowQrCode) {
          instance.clients.whatsAppClient.setShowQrCode(true);
        }
        
        // Generate a new QR code
        const qrCode = await InstanceManager.generateQRCode({
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
        const { displayQRCode } = require('../../utils/qrCodeUtils');
        await displayQRCode(interaction, qrCode, interaction.guild.id);
        
        return;
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