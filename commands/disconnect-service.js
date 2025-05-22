const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const Command = require('../templates/Command');
const InstanceManager = require("../core/InstanceManager");
const InteractionTracker = require('../utils/InteractionTracker');
const fs = require('fs');
const path = require('path');

class DisconnectServiceCommand extends Command {
  constructor() {
    super({
      name: 'disconnect-service',
      description: 'Disconnect the WhatsApp bridge service subscription',
      permissions: PermissionFlagsBits.Administrator
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction);

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
      
      // Check if service is already inactive
      let isInactive = false;
      const instanceId = instance.instanceId || guildId;
      const settingsPath = path.join(__dirname, '..', 'instances', instanceId, 'settings.json');
      
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
      
      // If service is already inactive, prevent duplicate disconnection
      if (isInactive) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("reconnect_service")
            .setLabel("Reconnect Service")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        );

        await InteractionTracker.safeEdit(interaction, {
          content: "ℹ️ The WhatsApp bridge service is already inactive.\n\n" +
                   "You can reconnect the service to resume using it.",
          components: [row],
        });
        
        return;
      }

      // Confirm disconnection with buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_disconnect_service")
          .setLabel("Yes, disconnect service")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("cancel_disconnect_service")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await InteractionTracker.safeEdit(interaction, {
        content:
          "⚠️ Are you sure you want to disconnect the WhatsApp bridge service?\n\n" +
          "This will mark your service as inactive and stop all WhatsApp functionality.\n\n" +
          "Your data will be preserved and you can reconnect later.",
        components: [row],
      });
    } catch (error) {
      console.error("Error in disconnect-service command:", error);
      await InteractionTracker.safeEdit(interaction, {
        content: `❌ Error: ${error.message}`
      });
    }
  }
}

module.exports = new DisconnectServiceCommand();