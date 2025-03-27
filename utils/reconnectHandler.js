// utils/reconnectHandler.js - Unified reconnect functionality
const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const qrcode = require('qrcode');

/**
 * Handles WhatsApp reconnection with improved error handling and QR code display
 * Can be used by both status and general reconnect buttons
 */
class ReconnectHandler {
  /**
   * Handle the reconnection process
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @param {Object} options - Additional options
   * @returns {Promise<boolean>} - Success status
   */
  static async handleReconnect(interaction, instance, options = {}) {
    try {
      // Set default options
      const defaultOptions = {
        ephemeral: false,
        fromStatus: false, // If called from status command
        preserveComponents: false, // Whether to keep original components
        timeoutDuration: 120000, // 2 minute timeout for QR code
      };
      
      options = { ...defaultOptions, ...options };
      
      // Immediately respond to the interaction to prevent timeout
      if (!interaction.deferred) {
        await interaction.deferUpdate();
      }
      
      // Update message to show process is starting
      let messageContent = "🔄 Attempting to reconnect WhatsApp...";
      if (!options.preserveComponents) {
        await interaction.editReply({
          content: messageContent,
          components: [],
          embeds: options.fromStatus ? [] : undefined
        });
      } else {
        await interaction.editReply({
          content: messageContent
        });
      }

      // Get the instance if not provided
      if (!instance) {
        const InstanceManager = require('../core/InstanceManager');
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance) {
        await interaction.editReply({
          content: "❌ No WhatsApp configuration found. Please use `/setup` to configure.",
          components: []
        });
        return false;
      }

      // FIRST ATTEMPT: Try to reconnect WITHOUT deleting auth data
      await interaction.editReply({
        content: "🔄 Trying to reconnect with existing session..."
      });
      
      let reconnected = false;
      try {
        // Temporarily disconnect but don't log out
        if (instance.clients && instance.clients.whatsAppClient) {
          await instance.clients.whatsAppClient.disconnect(false);
        }
        
        // Attempt to reconnect with existing auth
        reconnected = await instance.connect(false);
        
        // Check if reconnect was successful
        if (reconnected && instance.isConnected()) {
          await interaction.editReply({
            content: "✅ Successfully reconnected to WhatsApp!"
          });
          
          // Reload the status command if we're coming from status
          if (options.fromStatus) {
            const statusCommand = require('../commands/status');
            if (statusCommand && typeof statusCommand.execute === 'function') {
              await statusCommand.execute(interaction, instance);
            }
          }
          return true;
        }
      } catch (reconnectError) {
        console.error(`[Instance:${instance.instanceId}] Error in initial reconnect attempt: ${reconnectError.message}`);
        // Continue to QR code generation if reconnect failed
      }
      
      // SECOND ATTEMPT: Generate new QR code
      await interaction.editReply({
        content: "⚠️ Could not reconnect with existing session. Preparing new QR code..."
      });

      // Show that we're clearing files
      await interaction.editReply({
        content: "🗑️ Clearing authentication data..."
      });

      // Delete auth files with improved error handling
      await this.cleanAuthFiles(instance);

      // Disconnect the instance - this won't cause errors even if already disconnected
      try {
        await instance.disconnect();
      } catch (error) {
        console.error(`[Instance:${instance.instanceId}] Error disconnecting instance: ${error.message}`);
        // Continue anyway
      }

      // Add a short delay before reconnection to avoid server throttling
      await interaction.editReply({
        content: "⏳ Preparing to connect to WhatsApp..."
      });
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      
      // Generate fresh QR code
      try {
        await interaction.editReply({
          content: "🔄 Requesting QR code from WhatsApp servers..."
        });
        
        // Modify instance settings to increase QR code timeout if possible
        if (instance.clients && instance.clients.whatsAppClient) {
          if (typeof instance.clients.whatsAppClient.setQrTimeout === 'function') {
            instance.clients.whatsAppClient.setQrTimeout(options.timeoutDuration);
          }
        }
        
        // Get InstanceManager
        const InstanceManager = require('../core/InstanceManager');
        
        // Generate a new QR code
        const qrCode = await InstanceManager.generateQRCode({
          guildId: interaction.guild.id,
          categoryId: instance.categoryId,
          transcriptChannelId: instance.transcriptChannelId,
          vouchChannelId: instance.vouchChannelId || instance.transcriptChannelId,
          customSettings: instance.customSettings || {},
          discordClient: interaction.client,
          qrTimeout: options.timeoutDuration
        });

        if (qrCode === null) {
          await interaction.editReply({
            content: "⚠️ WhatsApp is already connected! This is unexpected since we cleared auth data. Please try again with `/setup` instead.",
            components: []
          });
          return false;
        }

        if (qrCode === "TIMEOUT") {
          await interaction.editReply({
            content: "⚠️ QR code generation timed out. Please try again later or use `/setup` command.",
            components: []
          });
          return false;
        }

        // Display the QR code properly
        return await this.displayEnhancedQRCode(interaction, qrCode, instance);
      } catch (qrError) {
        console.error(`[Instance:${instance.instanceId}] Error generating QR code:`, qrError);
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try running /setup again.`,
          components: []
        });
        return false;
      }
    } catch (error) {
      console.error(`[ReconnectHandler] Error handling reconnect:`, error);
      
      try {
        if (!interaction.deferred) {
          await interaction.deferUpdate();
        }
        
        await interaction.editReply({
          content: `❌ Error reconnecting: ${error.message}. Please try again or use /setup command.`,
          components: []
        });
      } catch (replyError) {
        console.error(`[ReconnectHandler] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }

  /**
   * Clean auth files with improved error handling
   * @param {Object} instance - Server instance
   */
  static async cleanAuthFiles(instance) {
    try {
      console.log(`[Instance:${instance.instanceId}] Cleaning authentication files`);
      
      const instanceDir = instance.baseDir || path.join(__dirname, '../..', 'instances', instance.instanceId);
      
      // Make sure directories exist
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }
      
      // Define auth directories and files
      const authStructure = {
        directories: [
          path.join(instanceDir, 'auth'),
          path.join(instanceDir, 'auth', 'baileys_auth'), 
          path.join(instanceDir, 'baileys_auth')
        ],
        files: [
          path.join(instanceDir, 'creds.json'),
          path.join(instanceDir, 'auth', 'creds.json'),
          path.join(instanceDir, 'auth', 'baileys_auth', 'creds.json'),
          path.join(instanceDir, 'baileys_auth', 'creds.json')
        ]
      };
      
      // Create directories if they don't exist (needed for proper cleanup)
      for (const dir of authStructure.directories) {
        if (!fs.existsSync(dir)) {
          try {
            fs.mkdirSync(dir, { recursive: true });
          } catch (mkdirError) {
            console.warn(`[Instance:${instance.instanceId}] Warning: Could not create directory ${dir}: ${mkdirError.message}`);
          }
        }
      }
      
      // Delete specific auth files first
      for (const file of authStructure.files) {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
            console.log(`[Instance:${instance.instanceId}] Deleted auth file: ${file}`);
          } catch (unlinkError) {
            console.warn(`[Instance:${instance.instanceId}] Warning: Could not delete ${file}: ${unlinkError.message}`);
            // Try to truncate the file if we can't delete it
            try {
              fs.truncateSync(file, 0);
              console.log(`[Instance:${instance.instanceId}] Truncated auth file: ${file}`);
            } catch (truncateError) {
              console.warn(`[Instance:${instance.instanceId}] Warning: Could not truncate ${file}: ${truncateError.message}`);
            }
          }
        }
      }
      
      // Clean content of directories
      for (const dir of authStructure.directories) {
        if (fs.existsSync(dir)) {
          try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              // Skip the entire directory itself
              if (file === '.' || file === '..') continue;
              
              const filePath = path.join(dir, file);
              try {
                // Only delete files, not subdirectories
                if (fs.statSync(filePath).isFile()) {
                  fs.unlinkSync(filePath);
                  console.log(`[Instance:${instance.instanceId}] Deleted auth file: ${filePath}`);
                }
              } catch (unlinkError) {
                console.warn(`[Instance:${instance.instanceId}] Warning: Could not delete ${filePath}: ${unlinkError.message}`);
              }
            }
          } catch (readError) {
            console.warn(`[Instance:${instance.instanceId}] Warning: Could not read directory ${dir}: ${readError.message}`);
          }
        }
      }
      
      console.log(`[Instance:${instance.instanceId}] Authentication files cleaned`);
    } catch (error) {
      console.error(`[Instance:${instance.instanceId}] Error cleaning auth files: ${error.message}`);
    }
  }

  /**
   * Display an enhanced QR code with better visual design and error handling
   * @param {Object} interaction - Discord interaction
   * @param {string} qrCode - QR code data
   * @param {Object} instance - Server instance
   * @returns {Promise<boolean>} - Success status
   */
  static async displayEnhancedQRCode(interaction, qrCode, instance) {
    try {
      const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      
      // 1. Generate a higher quality QR code image
      await interaction.editReply({
        content: "📱 Generating high-quality QR code..."
      });
      
      // Create temp directory if needed
      const tempDir = instance.paths?.temp || path.join(__dirname, '../..', 'instances', instance.instanceId, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Generate a higher quality QR code image with better margin and error correction
      const qrImagePath = path.join(tempDir, 'qrcode.png');
      await qrcode.toFile(qrImagePath, qrCode, {
        type: 'png',
        errorCorrectionLevel: 'H', // Highest error correction
        margin: 4,
        scale: 16, // Larger scale for better quality
        color: {
          dark: '#000000',  // Black dots
          light: '#FFFFFF'  // White background
        }
      });
      
      // 2. Create a more visually appealing embed
      const embed = new EmbedBuilder()
        .setColor(0x25D366) // WhatsApp green
        .setTitle('📱 Scan this QR code with WhatsApp')
        .setDescription('**Instructions:**\n1. Open WhatsApp on your phone\n2. Tap **Menu** (⋮) or **Settings** (⚙️)\n3. Select **WhatsApp Web/Desktop**\n4. Tap **Link a device**\n5. Point your camera at this QR code\n\n*QR code will expire in 2 minutes*')
        .setFooter({ text: `WhatsApp Bridge • ${instance.instanceId}` })
        .setTimestamp();

      // Create attachment from QR code image
      const attachment = new AttachmentBuilder(qrImagePath, { name: 'qrcode.png' });
      embed.setImage('attachment://qrcode.png');
      
      // 3. Create action buttons
      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_qr')
            .setLabel('Refresh QR Code')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
          new ButtonBuilder()
            .setCustomId('reconnect_status')
            .setLabel('Check Status')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // 4. Update the message with QR code, embed, and buttons
      await interaction.editReply({
        content: '',
        embeds: [embed],
        files: [attachment],
        components: [buttons]
      });
      
      // 5. Set up QR code listener to automatically update when connected
      if (instance && typeof instance.onReady === 'function') {
        // This will automatically update the message when connected
        instance.onReady(async () => {
          try {
            const successEmbed = new EmbedBuilder()
              .setColor(0x00FF00) // Green for success
              .setTitle('✅ WhatsApp Connected Successfully')
              .setDescription('Your WhatsApp account is now connected to this Discord server. Messages will now be forwarded between WhatsApp and Discord.')
              .setFooter({ text: `WhatsApp Bridge • ${instance.instanceId}` })
              .setTimestamp();
            
            await interaction.editReply({
              content: '',
              embeds: [successEmbed],
              files: [],
              components: []
            });
          } catch (updateError) {
            console.error(`[Instance:${instance.instanceId}] Error updating QR code message after connection: ${updateError.message}`);
          }
        });
      }
      
      return true;
    } catch (error) {
      console.error(`[Instance:${instance.instanceId}] Error displaying QR code: ${error.message}`);
      
      // Try a simplified display as fallback
      try {
        await interaction.editReply({
          content: "❌ Error displaying enhanced QR code. Please try generating a new QR code or use the `/setup` command.",
          components: [
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('refresh_qr')
                  .setLabel('Try Again')
                  .setStyle(ButtonStyle.Primary)
              )
          ]
        });
      } catch (fallbackError) {
        console.error(`[Instance:${instance.instanceId}] Error displaying fallback message: ${fallbackError.message}`);
      }
      
      return false;
    }
  }
}

module.exports = ReconnectHandler;