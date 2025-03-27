// utils/qrCodeUtils.js
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Comprehensive QR code utility functions for WhatsApp connection
 * Handles QR code generation, display, and reconnection
 */
class QRCodeUtils {
  /**
   * Generate and display QR code for WhatsApp connection
   * @param {Object} interaction - Discord interaction
   * @param {string} qrCode - QR code string data
   * @param {string} guildId - Guild ID
   * @returns {Promise<boolean>} - Success status
   */
  static async displayQRCode(interaction, qrCode, guildId) {
    try {
      // Validate inputs
      if (!interaction || typeof interaction.editReply !== "function") {
        throw new Error("Invalid interaction object");
      }

      if (!qrCode || typeof qrCode !== "string" || qrCode.trim() === "") {
        throw new Error("Invalid or empty QR code");
      }

      if (!guildId) {
        throw new Error("Missing guild ID");
      }

      // Let user know we're generating the QR code
      await interaction.editReply({
        content: "⌛ Generating QR code for WhatsApp connection...",
        components: [],
        embeds: []
      });

      // Create directory for QR code if it doesn't exist
      const instancesDir = path.join(__dirname, "..", "instances");
      const guildDir = path.join(instancesDir, guildId);

      if (!fs.existsSync(guildDir)) {
        fs.mkdirSync(guildDir, { recursive: true });
      }

      const qrCodePath = path.join(guildDir, "qrcode.png");

      console.log(`Generating QR code image for guild ${guildId}, QR data length: ${qrCode.length}`);

      // Generate high quality QR code image
      await qrcode.toFile(qrCodePath, qrCode, {
        type: 'png',
        errorCorrectionLevel: 'H', // Highest error correction
        margin: 4,
        scale: 16, // Larger scale for better quality
        color: {
          dark: '#000000',  // Black dots
          light: '#FFFFFF'  // White background
        }
      });

      console.log(`QR code image saved to ${qrCodePath}`);

      // Verify file was created
      if (!fs.existsSync(qrCodePath)) {
        throw new Error("QR code file was not created");
      }

      // Create modern embed with clearer instructions
      const embed = new EmbedBuilder()
        .setColor(0x25D366) // WhatsApp green
        .setTitle("📱 Connect WhatsApp")
        .setDescription(
          "**Scan this QR code with your WhatsApp to connect to your Discord server.**"
        )
        .addFields(
          {
            name: "📋 How to Connect",
            value:
              '1️⃣ Open WhatsApp on your phone\n2️⃣ Tap Menu (⋮) or Settings (⚙️)\n3️⃣ Select "WhatsApp Web/Desktop"\n4️⃣ Tap "Link a device"\n5️⃣ Point your camera at this QR code',
          },
          {
            name: "🔄 Connection Status",
            value:
              "`⌛ Waiting for scan...`\nThis message will update when your device connects.",
          },
          {
            name: "⏰ QR Code Expiration",
            value:
              'This QR code will expire after a few minutes. If it expires, use the "Refresh QR Code" button below to generate a fresh one.',
          }
        )
        .setFooter({ text: `WhatsApp-Discord Bridge • Guild: ${guildId}` })
        .setTimestamp();

      // Create attachment from QR code image
      const attachment = new AttachmentBuilder(qrCodePath, {
        name: "qrcode.png",
      });
      embed.setImage("attachment://qrcode.png");

      // Create buttons for refreshing and checking status
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("refresh_qr")
          .setLabel("Refresh QR Code")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🔄"),
        new ButtonBuilder()
          .setCustomId("reconnect_status")
          .setLabel("Check Status")
          .setStyle(ButtonStyle.Secondary)
      );

      // Update the reply with QR code and instructions
      const message = await interaction.editReply({
        content: "",
        embeds: [embed],
        files: [attachment],
        components: [row],
      });

      // Init global storage for QR code messages if needed
      if (!global.qrCodeMessages) {
        global.qrCodeMessages = new Map();
      }

      // Store the interaction data for updates when connection status changes
      global.qrCodeMessages.set(guildId, {
        interaction,
        message,
        embedData: embed.toJSON(),
      });

      // Set up connection status updates
      this.startConnectionStatusUpdates(guildId, interaction, embed);

      return true;
    } catch (error) {
      console.error("Error displaying QR code in Discord:", error);
      try {
        await interaction.editReply({
          content: `⚠️ Error displaying QR code: ${error.message}. Please try again.`,
          embeds: [],
          files: [],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("refresh_qr")
                .setLabel("Try Again")
                .setStyle(ButtonStyle.Primary)
            )
          ]
        });
      } catch (replyError) {
        console.error("Additional error trying to send error message:", replyError);
      }
      return false;
    }
  }

  /**
   * Set up connection status updates for the QR code message
   * @param {string} guildId - Guild ID
   * @param {Object} interaction - Discord interaction
   * @param {Object} embed - Original embed
   */
  static startConnectionStatusUpdates(guildId, interaction, embed) {
    const InstanceManager = require('../core/InstanceManager');
    
    // Set up a connection status updater for this instance
    const instance = InstanceManager.getInstanceByGuildId(guildId);
    if (instance) {
      // Set up onReady handler to update message
      instance.onReady(async () => {
        try {
          console.log(`WhatsApp connected for guild ${guildId}, updating QR code message`);

          // Get stored data
          const storedData = global.qrCodeMessages.get(guildId);
          if (!storedData) {
            console.log(`No stored QR code message data found for guild ${guildId}`);
            return;
          }

          // Create a success embed based on the original
          const successEmbed = new EmbedBuilder(storedData.embedData)
            .setColor(0x57f287) // Discord green for success
            .setTitle("📱 WhatsApp Connected Successfully!")
            .setDescription(
              "**Your WhatsApp account is now connected to this Discord server!**"
            )
            .spliceFields(1, 1, {
              name: "🔄 Connection Status",
              value:
                "`✅ Connected and ready!`\nYour WhatsApp messages will now appear in channels within the configured category.",
            });

          // Update the interaction reply
          await interaction.editReply({
            content: "",
            embeds: [successEmbed],
            files: [], // Remove QR code
            components: [], // Remove buttons
          });

          // Clean up the stored data
          global.qrCodeMessages.delete(guildId);

          console.log(`QR code message updated to show successful connection for guild ${guildId}`);
        } catch (updateError) {
          console.error(`Error updating QR code message on connection: ${updateError.message}`);
        }
      });
    }
  }

  /**
   * Clean up auth files to force new QR code generation
   * @param {Object} instance - WhatsApp instance
   * @returns {Promise<boolean>} - Success status
   */
  static async cleanAuthFiles(instance) {
    try {
      console.log(`[Instance:${instance.instanceId}] Cleaning authentication files`);
      
      const instanceDir = instance.baseDir || path.join(__dirname, '..', 'instances', instance.instanceId);
      
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
      return true;
    } catch (error) {
      console.error(`[Instance:${instance.instanceId}] Error cleaning auth files: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle WhatsApp reconnection with improved error handling and QR code display
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

      // Delete auth files to force new QR code
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

        // Display the QR code
        return await this.displayQRCode(interaction, qrCode, interaction.guild.id);
      } catch (qrError) {
        console.error(`[Instance:${instance.instanceId}] Error generating QR code:`, qrError);
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try running /setup again.`,
          components: []
        });
        return false;
      }
    } catch (error) {
      console.error(`[QRCodeUtils] Error handling reconnect:`, error);
      
      try {
        if (!interaction.deferred) {
          await interaction.deferUpdate();
        }
        
        await interaction.editReply({
          content: `❌ Error reconnecting: ${error.message}. Please try again or use /setup command.`,
          components: []
        });
      } catch (replyError) {
        console.error(`[QRCodeUtils] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }

  /**
   * Refresh QR code for existing instance
   * @param {Object} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @returns {Promise<boolean>} - Success status
   */
  static async refreshQRCode(interaction, instance) {
    try {
      if (!interaction.deferred) {
        await interaction.deferUpdate();
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
      
      // First clean auth files to force new QR code generation
      await this.cleanAuthFiles(instance);
      
      // Disconnect the instance if connected
      try {
        await instance.disconnect();
      } catch (error) {
        console.error(`[Instance:${instance.instanceId}] Error disconnecting instance: ${error.message}`);
        // Continue anyway
      }
      
      // Update message to show progress
      await interaction.editReply({
        content: "🔄 Requesting new QR code from WhatsApp servers...",
        embeds: [],
        files: [],
        components: []
      });
      
      // Get a new QR code
      const InstanceManager = require('../core/InstanceManager');
      const qrCode = await InstanceManager.generateQRCode({
        guildId: interaction.guild.id,
        categoryId: instance.categoryId,
        transcriptChannelId: instance.transcriptChannelId,
        vouchChannelId: instance.vouchChannelId || instance.transcriptChannelId,
        customSettings: instance.customSettings || {},
        discordClient: interaction.client,
        qrTimeout: 120000 // 2 minute timeout
      });
      
      if (qrCode === null) {
        await interaction.editReply({
          content: "⚠️ WhatsApp is already connected! This is unexpected. Try using the `/disconnect` command first.",
          components: []
        });
        return false;
      }
      
      if (qrCode === "TIMEOUT") {
        await interaction.editReply({
          content: "⚠️ QR code generation timed out after waiting. Please try again later.",
          components: []
        });
        return false;
      }
      
      // Display the QR code
      return await this.displayQRCode(interaction, qrCode, interaction.guild.id);
    } catch (error) {
      console.error(`[QRCodeUtils] Error refreshing QR code:`, error);
      
      // Create a retry button
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('refresh_qr')
            .setLabel('Try Again')
            .setStyle(ButtonStyle.Primary)
        );
      
      // Send error message
      await interaction.editReply({
        content: `❌ Error refreshing QR code: ${error.message}. Please try again.`,
        components: [row],
        embeds: []
      });
      
      return false;
    }
  }
}

// Export functions individually for backward compatibility
module.exports = {
  displayQRCode: QRCodeUtils.displayQRCode.bind(QRCodeUtils),
  handleReconnect: QRCodeUtils.handleReconnect.bind(QRCodeUtils),
  refreshQRCode: QRCodeUtils.refreshQRCode.bind(QRCodeUtils),
  cleanAuthFiles: QRCodeUtils.cleanAuthFiles.bind(QRCodeUtils),
  startConnectionStatusUpdates: QRCodeUtils.startConnectionStatusUpdates.bind(QRCodeUtils),
  
  // Add the class itself for those who want the full class
  QRCodeUtils
};