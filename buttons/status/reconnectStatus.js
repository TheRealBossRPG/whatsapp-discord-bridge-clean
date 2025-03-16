// buttons/status/reconnectStatus.js
const fs = require('fs');
const path = require('path');
const Button = require('../../templates/Button');
const bridgeInstanceManager = require('../../modules/BridgeInstanceManager');

class ReconnectStatusButton extends Button {
  constructor() {
    super({
      customId: 'reconnect_status'
    });
  }
  
  async execute(interaction, instance) {
    await interaction.deferUpdate();
    await interaction.editReply({
      content: "🔄 Attempting to reconnect WhatsApp using saved credentials...",
      embeds: [],
      components: [],
    });

    try {
      // Get instance if not provided
      if (!instance) {
        instance = bridgeInstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      if (!instance) {
        await interaction.editReply(
          "❌ No WhatsApp configuration found. Please use `/setup` to configure."
        );
        return;
      }

      // Try to reconnect
      const connected = await instance.connect();

      if (connected) {
        await interaction.editReply(
          "✅ Successfully reconnected to WhatsApp!"
        );
      } else {
        // Check if auth exists
        const authExists = fs.existsSync(
          path.join(
            __dirname,
            "../..",
            "instances",
            instance.instanceId,
            "baileys_auth",
            "creds.json"
          )
        );

        if (authExists) {
          await interaction.editReply(
            "⚠️ Connection attempt failed with existing credentials. Try using `/setup` and selecting 'Reconnect'."
          );
        } else {
          await interaction.editReply(
            "❌ No existing credentials found. Please use `/setup` to create a new connection."
          );
        }
      }
    } catch (error) {
      console.error("Error reconnecting:", error);
      await interaction.editReply(
        `❌ Error reconnecting: ${error.message}`
      );
    }
  }
}

module.exports = new ReconnectStatusButton();