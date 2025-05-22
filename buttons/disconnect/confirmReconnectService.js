// buttons/disconnect/confirmReconnectService.js
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const InteractionTracker = require('../../utils/InteractionTracker');
const fs = require('fs');
const path = require('path');

class ConfirmReconnectServiceButton extends Button {
  constructor() {
    super({
      customId: 'confirm_reconnect_service'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction);
      
      // Get guild ID
      const guildId = interaction.guild.id;
      
      // Check if instance exists
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(guildId);
      }
      
      if (!instance) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ No WhatsApp bridge configuration found for this server."
        });
        return;
      }
      
      // Mark the instance as active in settings
      const instanceId = instance.instanceId || guildId;
      const instanceDir = path.join(__dirname, '..', '..', 'instances', instanceId);
      const settingsPath = path.join(instanceDir, 'settings.json');
      
      // Update settings file to mark as active
      try {
        let settings = {};
        if (fs.existsSync(settingsPath)) {
          try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          } catch (e) {
            console.error(`Error reading existing settings:`, e);
          }
        }
        
        // Mark as active
        settings.status = 'active';
        settings.reactivatedAt = new Date().toISOString();
        
        // Save changes
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`Marked instance ${instanceId} as active in settings`);
        
        // Update instance object if possible
        if (instance.customSettings) {
          instance.customSettings.status = 'active';
          instance.customSettings.reactivatedAt = new Date().toISOString();
        }
        
        // Start connection timer if method exists
        if (typeof instance.startConnectionRefreshTimer === 'function') {
          instance.startConnectionRefreshTimer();
        }
      } catch (updateError) {
        console.error("Error updating settings:", updateError);
        await InteractionTracker.safeEdit(interaction, {
          content: `❌ Error updating service settings: ${updateError.message}`
        });
        return;
      }
      
      // Generate QR code
      await InteractionTracker.safeEdit(interaction, {
        content: "⏳ Reconnecting WhatsApp service and generating QR code..."
      });
      
      try {
        // Clean any old auth files first to ensure fresh QR code
        if (instance.paths) {
          const qrUtils = require('../../utils/qrCodeUtils');
          await qrUtils.cleanAuthFiles(instance);
        }
        
        // Initialize WhatsApp connection
        let qrGenerated = false;
        
        if (typeof instance.connect === 'function') {
          // Use Instance.connect with showQrCode=true
          await instance.connect(true);
          qrGenerated = true;
        } else if (instance.clients && instance.clients.whatsAppClient) {
          // Directly use the WhatsApp client
          if (typeof instance.clients.whatsAppClient.initialize === 'function') {
            await instance.clients.whatsAppClient.initialize(true);
            qrGenerated = true;
          }
        }
        
        if (qrGenerated) {
          await InteractionTracker.safeEdit(interaction, {
            content: "✅ WhatsApp bridge service has been reactivated!\n\n" +
                    "Please scan the QR code that appears to connect your WhatsApp account."
          });
        } else {
          // If we couldn't initialize directly, use the setup command
          const { ApplicationCommandType } = require('discord.js');
          await interaction.editReply({
            content: "✅ WhatsApp bridge service has been reactivated!\n\n" + 
                    "Now please use the `/setup` command to complete the connection process and scan a QR code.",
            components: []
          });
        }
      } catch (reconnectError) {
        console.error("Error reconnecting WhatsApp:", reconnectError);
        await InteractionTracker.safeEdit(interaction, {
          content: `⚠️ Service marked as active, but there was an error generating the QR code: ${reconnectError.message}\n\n` +
                  "Please use the `/setup` command to complete the WhatsApp connection."
        });
      }
    } catch (error) {
      console.error("Error in confirmReconnectService button:", error);
      
      try {
        await InteractionTracker.safeEdit(interaction, {
          content: `❌ Error: ${error.message}`
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new ConfirmReconnectServiceButton();