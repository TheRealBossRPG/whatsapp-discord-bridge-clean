// buttons/disconnect/confirmDisconnectService.js
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const InteractionTracker = require('../../utils/InteractionTracker');
const fs = require('fs');
const path = require('path');

class ConfirmDisconnectServiceButton extends Button {
  constructor() {
    super({
      customId: 'confirm_disconnect_service'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });
      
      // Get guild ID
      const guildId = interaction.guild.id;
      
      // Check if instance exists
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(guildId);
      }
      
      if (!instance) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ No WhatsApp bridge is configured for this server."
        });
        return;
      }
      
      // Double-check if already inactive
      const instanceId = instance.instanceId || guildId;
      const settingsPath = path.join(__dirname, '..', '..', 'instances', instanceId, 'settings.json');
      let alreadyInactive = false;
      
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          if (settings.status === 'inactive') {
            alreadyInactive = true;
          }
        } catch (error) {
          console.error("Error reading settings:", error);
        }
      }
      
      if (alreadyInactive) {
        await InteractionTracker.safeEdit(interaction, {
          content: "ℹ️ Service is already inactive. No action needed."
        });
        return;
      }
      
      // Disconnect WhatsApp but don't clean data
      await InteractionTracker.safeEdit(interaction, {
        content: "⏳ Disconnecting WhatsApp service..."
      });
      
      // First properly disconnect the WhatsApp client
      let disconnected = false;
      
      try {
        if (instance.disconnect) {
          await instance.disconnect(false); // Don't log out, just disconnect
          disconnected = true;
        } else if (instance.clients && instance.clients.whatsAppClient) {
          await instance.clients.whatsAppClient.disconnect(false);
          disconnected = true;
        }
      } catch (disconnectError) {
        console.error("Error disconnecting WhatsApp client:", disconnectError);
      }
      
      // Mark the instance as inactive in settings
      try {
        let settings = {};
        if (fs.existsSync(settingsPath)) {
          try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          } catch (e) {
            console.error(`Error reading existing settings:`, e);
          }
        }
        
        // Mark as inactive
        settings.status = 'inactive';
        settings.deactivatedAt = new Date().toISOString();
        
        // Save changes
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`Marked instance ${instanceId} as inactive in settings`);
        
        // Update instance object if possible
        if (instance.customSettings) {
          instance.customSettings.status = 'inactive';
          instance.customSettings.deactivatedAt = new Date().toISOString();
        }
        
        // Set service flag directly
        if (typeof instance.serviceActive !== 'undefined') {
          instance.serviceActive = false;
        }
        
        // Explicitly call methods to stop reconnection
        try {
          // Stop connection refresh timer if it exists
          if (typeof instance.stopConnectionRefreshTimer === 'function') {
            instance.stopConnectionRefreshTimer();
          }
          
          // Reset reconnect attempts
          instance.reconnectAttempts = 0;
          instance.reconnecting = false;
          
          // Directly modify any scheduled timers if possible
          if (instance.qrCodeTimer) {
            clearTimeout(instance.qrCodeTimer);
            instance.qrCodeTimer = null;
          }
        } catch (stopError) {
          console.error("Error stopping timers:", stopError);
        }
        
        await InteractionTracker.safeEdit(interaction, {
          content: "✅ WhatsApp bridge service has been disconnected and marked as inactive.\n\n" +
                  "Your settings and data have been preserved. " +
                  "You can reconnect the service later using the `/reconnect-service` command."
        });
        
        // Update the original message to remove buttons
        try {
          const originalMessage = await interaction.message.fetch();
          await originalMessage.edit({
            content: "✅ **Service Disconnected**\n\nThe WhatsApp bridge service has been marked as inactive. Use `/reconnect-service` to reactivate it later.",
            components: []
          });
        } catch (editError) {
          console.error("Error updating original message:", editError);
        }
      } catch (markError) {
        console.error("Error marking instance as inactive:", markError);
        
        await InteractionTracker.safeEdit(interaction, {
          content: disconnected ?
            "⚠️ WhatsApp connection was disconnected but there was an error marking the service as inactive. Some functionality may still work." :
            "❌ There was an error disconnecting the service. Please try again later."
        });
      }
    } catch (error) {
      console.error("Error in confirmDisconnectService button:", error);
      
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

module.exports = new ConfirmDisconnectServiceButton();