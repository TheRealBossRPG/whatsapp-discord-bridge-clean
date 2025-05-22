// buttons/disconnect/confirmDisconnectWhatsApp.js
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const InteractionTracker = require('../../utils/InteractionTracker');
const fs = require('fs');
const path = require('path');

class ConfirmDisconnectWhatsAppButton extends Button {
  constructor() {
    super({
      customId: 'confirm_disconnect_whatsapp'
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
      
      // Check if service is inactive
      let isInactive = false;
      const instanceId = instance.instanceId || guildId;
      const settingsPath = path.join(__dirname, '..', '..', 'instances', instanceId, 'settings.json');
      
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          if (settings.status === 'inactive') {
            isInactive = true;
          }
        } catch (error) {
          console.error("Error reading settings:", error);
        }
      }
      
      if (isInactive) {
        await InteractionTracker.safeEdit(interaction, {
          content: "⚠️ Cannot disconnect WhatsApp - service is currently inactive.\n\n" +
                   "The service must be activated first before you can disconnect WhatsApp."
        });
        return;
      }
      
      // Check if already disconnected
      const isConnected = instance.isConnected?.() || false;
      if (!isConnected) {
        await InteractionTracker.safeEdit(interaction, {
          content: "ℹ️ WhatsApp is already disconnected. No action needed."
        });
        
        // Update the original message to remove buttons
        try {
          const originalMessage = await interaction.message.fetch();
          await originalMessage.edit({
            content: "ℹ️ WhatsApp is already disconnected. No action was needed.",
            components: []
          });
        } catch (editError) {
          console.error("Error updating original message:", editError);
        }
        
        return;
      }
      
      // Disconnect WhatsApp with full cleanup
      await InteractionTracker.safeEdit(interaction, {
        content: "⏳ Disconnecting WhatsApp and cleaning up authentication data..."
      });
      
      // Stop connection and clean auth files but don't remove instance
      const success = await InstanceManager.disconnectInstance(guildId, false);
      
      if (success) {
        // Clean auth files more thoroughly
        try {
          if (instance.paths && instance.paths.auth) {
            // Clean Baileys auth files
            if (instance.paths.baileys_auth && fs.existsSync(instance.paths.baileys_auth)) {
              const files = fs.readdirSync(instance.paths.baileys_auth);
              for (const file of files) {
                fs.unlinkSync(path.join(instance.paths.baileys_auth, file));
              }
              console.log(`Cleaned Baileys auth directory: ${instance.paths.baileys_auth}`);
            }
            
            // Clean legacy auth files
            if (fs.existsSync(instance.paths.auth)) {
              const files = fs.readdirSync(instance.paths.auth);
              for (const file of files) {
                fs.unlinkSync(path.join(instance.paths.auth, file));
              }
              console.log(`Cleaned auth directory: ${instance.paths.auth}`);
            }
          }
        } catch (cleanupError) {
          console.error("Error during additional cleanup:", cleanupError);
        }
        
        await InteractionTracker.safeEdit(interaction, {
          content: "✅ WhatsApp successfully disconnected and authentication data removed.\n\nYou can reconnect by using the `/setup` command and scanning a new QR code."
        });
        
        // Update original message
        try {
          const originalMessage = await interaction.message.fetch();
          await originalMessage.edit({
            content: "✅ **WhatsApp Disconnected**\n\nWhatsApp has been disconnected and authentication data removed. You'll need to scan a QR code to reconnect.",
            components: []
          });
        } catch (editError) {
          console.error("Error updating original message:", editError);
        }
      } else {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ There was an error disconnecting WhatsApp. Please try again later."
        });
      }
    } catch (error) {
      console.error("Error in confirmDisconnectWhatsApp button:", error);
      
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

module.exports = new ConfirmDisconnectWhatsAppButton();