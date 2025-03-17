// buttons/status/refreshQR.js - Fixed QR Code Handler
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
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
      console.log(`Disconnect existing instance for guild ${instance.guildId} to generate fresh QR code`);
      await instance.disconnect();
      
      // Generate a new QR code with explicit showQR flag set to true
      instance.whatsAppClient?.setShowQrCode(true);
      
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
        
        // Generate QR code image
        console.log(`Generating QR code image for guild ${instance.guildId}, QR data length: ${qrCode.length}`);
        
        // Create directory if it doesn't exist
        const qrImagePath = path.join(instance.paths.temp, 'qrcode.png');
        
        // Generate QR code image using canvas
        const canvas = createCanvas(512, 512);
        await qrcode.toCanvas(canvas, qrCode, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
        
        // Save QR code image
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(qrImagePath, buffer);
        console.log(`QR code image saved to ${qrImagePath}`);
        
        // Create attachment
        const attachment = new AttachmentBuilder(qrImagePath, { name: 'qrcode.png' });
        
        // Create refresh button
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
          content: '',
          embeds: [
            new EmbedBuilder()
              .setColor('#3498db')
              .setTitle('WhatsApp QR Code')
              .setDescription('Scan this QR code with WhatsApp on your phone to connect.\n\n**Note:** QR codes expire in 45 seconds. Click "Refresh QR Code" if it expires.')
              .setImage('attachment://qrcode.png')
              .setFooter({ text: 'Scan with your phone to connect' })
          ],
          files: [attachment],
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
          content: '',
          embeds: [
            new EmbedBuilder()
              .setColor('#e74c3c')
              .setTitle('WhatsApp QR Code')
              .setDescription(`❌ Failed to generate QR code: ${qrError.message}\n\nPlease try again.`)
              .setFooter({ text: 'Click "Try Again" to retry' })
          ],
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
          content: '',
          embeds: [
            new EmbedBuilder()
              .setColor('#e74c3c')
              .setTitle('Error')
              .setDescription(`Failed to refresh QR code: ${error.message}`)
              .setFooter({ text: 'Click "Try Again" to retry' })
          ],
          components: [row]
        });
      } catch (replyError) {
        console.error(`Error sending error message: ${replyError.message}`);
      }
    }
  }
};