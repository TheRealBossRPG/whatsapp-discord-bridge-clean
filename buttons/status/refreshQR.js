// buttons/status/refreshQR.js - Simplified QR Code Handler
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

/**
 * Button handler for refreshing QR code
 */
module.exports = {
  customId: 'refresh_qr',
  
  /**
   * Execute button action
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} instance - Server instance
   */
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      if (!instance) {
        await interaction.editReply({
          content: 'Error: Could not find instance configuration.',
          components: []
        });
        return;
      }
      
      // First, disconnect existing client to ensure clean state
      console.log(`Generating QR code for guild ${instance.guildId}...`);
      await instance.disconnect();
      
      // Set up event listeners BEFORE connecting
      // Create a promise that will resolve when we get a QR code
      const qrPromise = new Promise((resolve, reject) => {
        // Set timeout to fail if we don't get a QR code in 30 seconds
        const timeout = setTimeout(() => {
          reject(new Error('QR code generation timed out'));
        }, 30000);
        
        // Listen for QR code events
        instance.onQRCode(async (qrCode) => {
          try {
            clearTimeout(timeout);
            console.log(`Got QR code for guild ${instance.guildId} (${qrCode.length} chars)`);
            resolve(qrCode);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      // Connect WhatsApp with explicit QR code request
      await instance.connect(true);
      
      // Show "generating QR code" message
      await interaction.editReply({
        content: '',
        embeds: [
          new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('WhatsApp QR Code')
            .setDescription('🔄 Requesting QR code from WhatsApp servers...')
            .setFooter({ text: 'Scan with your phone to connect' })
        ],
        components: []
      });
      
      try {
        // Wait for QR code or timeout
        const qrCode = await qrPromise;
        
        // Ensure we have a temp directory
        const tempDir = instance.paths?.temp || path.join(__dirname, '..', '..', 'instances', instance.instanceId, 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Generate QR code image file
        const qrImagePath = path.join(tempDir, 'qrcode.png');
        await qrcode.toFile(qrImagePath, qrCode, {
          scale: 8,
          margin: 4
        });
        
        // Create buttons
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('refresh_qr')
              .setLabel('Refresh QR Code')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('reconnect_status')
              .setLabel('Back to Status')
              .setStyle(ButtonStyle.Secondary)
          );
        
        // Update message with QR code
        await interaction.editReply({
          content: '📱 **Scan this QR code with WhatsApp on your phone to connect.**\n\nOpen WhatsApp > Menu (⋮) > Linked Devices > Link a Device',
          files: [qrImagePath],
          components: [row]
        });
      } catch (qrError) {
        console.error(`Error getting QR code: ${qrError.message}`);
        
        // Create retry button
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('refresh_qr')
              .setLabel('Try Again')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('reconnect_status')
              .setLabel('Back to Status')
              .setStyle(ButtonStyle.Secondary)
          );
        
        // Update message with error
        await interaction.editReply({
          content: `⚠️ Failed to generate QR code: ${qrError.message}\n\nPlease try again.`,
          embeds: [],
          components: [row]
        });
      }
    } catch (error) {
      console.error(`Error in refresh_qr button: ${error.message}`);
      
      // Create retry button
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_qr')
            .setLabel('Try Again')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('reconnect_status')
            .setLabel('Back to Status')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Send error message
      try {
        await interaction.editReply({
          content: `⚠️ Failed to refresh QR code: ${error.message}`,
          embeds: [],
          components: [row]
        });
      } catch (replyError) {
        console.error(`Error sending error message: ${replyError.message}`);
      }
    }
  }
};