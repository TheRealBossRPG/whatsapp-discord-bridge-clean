// buttons/reconnect.js
const fs = require('fs');
const path = require('path');
const Button = require('../templates/Button');
const InstanceManager = require('../core/InstanceManager');
const { displayQRCode } = require('../utils/qrCodeUtils');

class ReconnectButton extends Button {
  constructor() {
    super({
      customId: 'reconnect'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // CRITICAL: Immediately respond to the interaction to prevent timeout
      await interaction.deferUpdate();
      
      await interaction.editReply({
        content: "🔄 Disconnecting current session and preparing new QR code...",
        components: [],
      });

      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance) {
        await interaction.editReply({
          content: "❌ No WhatsApp configuration found. Please use `/setup` to configure."
        });
        return;
      }

      // Show that we're clearing files
      await interaction.editReply("🗑️ Clearing previous authentication data...");

      // Delete auth files manually to ensure clean reconnect
      try {
        const instanceDir = path.join(__dirname, '..', 'instances', instance.instanceId);
        
        // Create the directory if it doesn't exist
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        // Create auth directories if they don't exist
        const authDir = path.join(instanceDir, 'baileys_auth');
        if (!fs.existsSync(authDir)) {
          fs.mkdirSync(authDir, { recursive: true });
        }
        
        const authDir2 = path.join(instanceDir, 'auth');
        if (!fs.existsSync(authDir2)) {
          fs.mkdirSync(authDir2, { recursive: true });
        }
        
        // Clean baileys_auth directory
        if (fs.existsSync(authDir)) {
          const files = fs.readdirSync(authDir);
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(authDir, file));
            } catch (e) {
              console.error(`Error deleting file ${file}:`, e);
            }
          }
          console.log(`Deleted baileys_auth files for instance ${instance.instanceId}`);
        }
        
        // Clean auth directory
        if (fs.existsSync(authDir2)) {
          const files = fs.readdirSync(authDir2);
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(authDir2, file));
            } catch (e) {
              console.error(`Error deleting file ${file}:`, e);
            }
          }
          console.log(`Deleted auth files for instance ${instance.instanceId}`);
        }
        
        // Delete specific auth files that might exist
        const credsFile = path.join(instanceDir, 'creds.json');
        if (fs.existsSync(credsFile)) {
          fs.unlinkSync(credsFile);
          console.log(`Deleted creds file: ${credsFile}`);
        }
      } catch (error) {
        console.error(`Error removing auth files: ${error.message}`);
      }

      // Disconnect the instance - this won't cause errors even if already disconnected
      try {
        await instance.disconnect();
      } catch (error) {
        console.error(`Error disconnecting instance: ${error.message}`);
        // Continue anyway
      }

      await interaction.editReply("📱 Generating new QR code for WhatsApp connection...");

      // IMPORTANT: Generate fresh QR code with existing configuration
      try {
        const qrCode = await InstanceManager.generateQRCode({
          guildId: interaction.guild.id,
          categoryId: instance.categoryId,
          transcriptChannelId: instance.transcriptChannelId,
          vouchChannelId: instance.vouchChannelId || instance.transcriptChannelId,
          customSettings: instance.customSettings || {},
          discordClient: interaction.client,
        });

        if (qrCode === null) {
          await interaction.editReply({
            content: "⚠️ Unexpected result: WhatsApp is already connected despite clearing auth data. Please try again or use the /disconnect command followed by /setup.",
          });
          return;
        }

        if (qrCode === "TIMEOUT") {
          await interaction.editReply({
            content: "⚠️ QR code generation timed out. Please try again.",
          });
          return;
        }

        // Display the QR code
        await displayQRCode(interaction, qrCode, interaction.guild.id);
      } catch (qrError) {
        console.error("Error generating QR code:", qrError);
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try running /setup again.`,
        });
      }
    } catch (error) {
      console.error("Error handling reconnect button:", error);
      
      // Make sure we still respond to the interaction
      try {
        if (!interaction.deferred) {
          await interaction.deferUpdate();
        }
        
        await interaction.editReply({
          content: `❌ Error reconnecting: ${error.message}. Please try again or use /setup command.`
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new ReconnectButton();