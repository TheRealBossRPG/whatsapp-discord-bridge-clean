// buttons/status/reconnectStatus.js
const fs = require('fs');
const path = require('path');
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const { displayQRCode } = require('../../utils/qrCodeUtils');

class ReconnectStatusButton extends Button {
  constructor() {
    super({
      customId: 'reconnect_status'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // CRITICAL: Immediately respond to the interaction to prevent timeout
      await interaction.deferUpdate();
      
      await interaction.editReply({
        content: "🔄 Attempting to reconnect WhatsApp...",
        embeds: [],
        components: [],
      });

      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance) {
        await interaction.editReply({
          content: "❌ No WhatsApp configuration found. Please use `/setup` to configure.",
          embeds: [],
          components: [],
        });
        return;
      }

      // FIRST: Try to reconnect WITHOUT deleting auth data
      await interaction.editReply("🔄 Trying to reconnect with existing session...");
      
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
          await interaction.editReply("✅ Successfully reconnected to WhatsApp!");
          
          // Reload the status command to show updated status
          const statusCommand = require('../../commands/status');
          if (statusCommand && typeof statusCommand.execute === 'function') {
            await statusCommand.execute(interaction, instance);
          }
          return;
        }
      } catch (reconnectError) {
        console.error(`[Instance:${instance.instanceId}] Error in initial reconnect attempt: ${reconnectError.message}`);
        // Continue to QR code generation if reconnect failed
      }
      
      // ONLY IF RECONNECT FAILED: Now try with new QR code
      await interaction.editReply("⚠️ Could not reconnect with existing session. Preparing new QR code...");

      // Update status message about deleting auth files
      await interaction.editReply("🗑️ Deleting authentication data...");

      // Delete auth files manually to ensure clean reconnect
      try {
        const instanceDir = path.join(__dirname, '../..', 'instances', instance.instanceId);
        
        // Make sure directories exist
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
          try {
            fs.unlinkSync(credsFile);
            console.log(`Deleted creds file: ${credsFile}`);
          } catch (e) {
            console.error(`Error deleting creds file:`, e);
          }
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

      // Update status message about generating QR code
      await interaction.editReply("📱 Generating new QR code for WhatsApp connection...");

      // Add a short delay before reconnection to avoid server throttling
      await interaction.editReply("⏳ Waiting a moment before connecting to WhatsApp...");
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
      
      // Generate new QR code
      try {
        await interaction.editReply("🔄 Requesting QR code from WhatsApp servers...");
        
        // Modify instance settings to increase QR code timeout
        if (instance.clients && instance.clients.whatsAppClient) {
          // Try to increase timeout if the method exists
          if (typeof instance.clients.whatsAppClient.setQrTimeout === 'function') {
            instance.clients.whatsAppClient.setQrTimeout(90000); // 90 seconds timeout
          }
        }
        
        const qrCode = await InstanceManager.generateQRCode({
          guildId: interaction.guild.id,
          categoryId: instance.categoryId,
          transcriptChannelId: instance.transcriptChannelId,
          vouchChannelId: instance.vouchChannelId,
          customSettings: instance.customSettings || {},
          discordClient: interaction.client,
          qrTimeout: 90000 // 90 seconds timeout (pass to InstanceManager too)
        });

        if (qrCode === null) {
          await interaction.editReply({
            content: "⚠️ Unexpected result: WhatsApp is already connected despite clearing auth data.",
            embeds: [],
            components: [],
          });
          return;
        }

        if (qrCode === "TIMEOUT") {
          await interaction.editReply({
            content: "⚠️ QR code generation timed out after waiting 90 seconds. Please try again later or use /setup instead.",
            embeds: [],
            components: [],
          });
          return;
        }

        // Display the QR code
        await displayQRCode(interaction, qrCode, interaction.guild.id);
      } catch (qrError) {
        console.error("Error generating QR code:", qrError);
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try running /setup again.`,
          embeds: [],
          components: [],
        });
      }
    } catch (error) {
      console.error("Error reconnecting:", error);
      
      try {
        if (!interaction.deferred) {
          await interaction.deferUpdate();
        }
        
        await interaction.editReply({
          content: `❌ Error reconnecting: ${error.message}. Please try the /setup command instead.`,
          embeds: [],
          components: [],
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new ReconnectStatusButton();