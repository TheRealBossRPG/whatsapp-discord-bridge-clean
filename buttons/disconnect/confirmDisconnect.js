// buttons/disconnect/confirmDisconnect.js
const fs = require('fs');
const path = require('path');
const Button = require('../../templates/Button');
const bridgeInstanceManager = require('../../modules/BridgeInstanceManager');

class ConfirmDisconnectButton extends Button {
  constructor() {
    super({
      customId: 'confirm_disconnect'
    });
  }
  
  async execute(interaction, instance) {
    try {
      const guildId = interaction.guild.id;

      // Update message to show process is starting
      await interaction.update({
        content: "🔄 Disconnecting WhatsApp bridge and removing authentication data...",
        components: [],
      });

      // Get the instance first if not provided
      if (!instance) {
        instance = bridgeInstanceManager.getInstanceByGuildId(guildId);
      }
      
      if (!instance || !instance.instanceId) {
        await interaction.editReply({
          content: "❌ Could not locate instance data. Cannot complete disconnection properly.",
          components: [],
        });
        return;
      }

      const instanceId = instance.instanceId;
      console.log(`Performing full cleanup for instance ${instanceId}`);

      // Call disconnect with full cleanup
      const disconnected = await bridgeInstanceManager.disconnectInstance(guildId, true);
      
      if (!disconnected) {
        await interaction.editReply({
          content: "⚠️ Basic disconnection completed but some cleanup steps may have failed.",
          components: [],
        });
        return;
      }

      // Additional cleanup: manually delete auth directories and files
      const instanceDir = path.join(__dirname, '../..', 'instances', instanceId);
      const authDirs = [
        path.join(instanceDir, 'auth'),
        path.join(instanceDir, 'baileys_auth')
      ];

      // Delete auth directories and their contents
      authDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
          try {
            // Delete all files in directory
            const files = fs.readdirSync(dir);
            for (const file of files) {
              fs.unlinkSync(path.join(dir, file));
              console.log(`Deleted auth file: ${path.join(dir, file)}`);
            }
            
            // Remove directory itself
            fs.rmdirSync(dir);
            console.log(`Removed auth directory: ${dir}`);
          } catch (e) {
            console.error(`Error cleaning up ${dir}:`, e);
          }
        }
      });

      // Delete specific auth files that might exist
      const credsFile = path.join(instanceDir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        fs.unlinkSync(credsFile);
        console.log(`Deleted creds file: ${credsFile}`);
      }

      // Clear instance configs to ensure it's fully reset
      if (bridgeInstanceManager.configs && bridgeInstanceManager.configs[instanceId]) {
        delete bridgeInstanceManager.configs[instanceId];
        bridgeInstanceManager.saveConfigurations();
        console.log(`Removed instance ${instanceId} from configs`);
      }

      // Force remove from instances map
      if (bridgeInstanceManager.instances && bridgeInstanceManager.instances.has(instanceId)) {
        bridgeInstanceManager.instances.delete(instanceId);
        console.log(`Removed instance ${instanceId} from instances map`);
      }

      await interaction.editReply({
        content: "✅ WhatsApp bridge has been completely disconnected and all authentication data removed. Use `/setup` to reconnect with a new QR code scan.",
        components: [],
      });
    } catch (error) {
      console.error("Error disconnecting server:", error);
      await interaction.update({
        content: `❌ Error disconnecting WhatsApp bridge: ${error.message}`,
        components: [],
      });
    }
  }
}

module.exports = new ConfirmDisconnectButton();