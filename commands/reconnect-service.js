const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const Command = require('../templates/Command');
const InstanceManager = require("../core/InstanceManager");
const InteractionTracker = require('../utils/InteractionTracker');
const fs = require('fs');
const path = require('path');

class ReconnectServiceCommand extends Command {
  constructor() {
    super({
      name: 'reconnect-service',
      description: 'Reconnect a previously disconnected WhatsApp bridge service',
      permissions: PermissionFlagsBits.Administrator
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use InteractionTracker for more reliable handling
      await InteractionTracker.safeDefer(interaction);

      const guildId = interaction.guild.id;

      // Get instance - handle multiple possible formats
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(guildId);
      }

      // If no instance found or instance not inactive, this isn't a reconnection scenario
      if (!instance) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ No WhatsApp bridge configuration found for this server. Please use `/setup` to set up a new WhatsApp bridge."
        });
        return;
      }
      
      // Check if instance is actually marked as inactive
      let isInactive = false;
      let settingsPath = null;
      
      try {
        // Check instance object first
        if (instance.customSettings && instance.customSettings.status === 'inactive') {
          isInactive = true;
        } else {
          // Check settings file directly
          const instanceId = instance.instanceId || guildId;
          settingsPath = path.join(__dirname, '..', 'instances', instanceId, 'settings.json');
          
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.status === 'inactive') {
              isInactive = true;
            }
          }
        }
      } catch (checkError) {
        console.error("Error checking instance status:", checkError);
      }
      
      if (!isInactive) {
        await InteractionTracker.safeEdit(interaction, {
          content: "ℹ️ The WhatsApp bridge service for this server is already active. No need to reconnect.\n\n" +
                  "If you're experiencing connection issues, you can use `/disconnect-whatsapp` followed by `/setup` to rescan the QR code."
        });
        return;
      }

      // Confirm reconnection with buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_reconnect_service")
          .setLabel("Yes, reconnect service")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("cancel_reconnect_service")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await InteractionTracker.safeEdit(interaction, {
        content:
          "🔄 **Reconnect WhatsApp Bridge Service**\n\n" +
          "This will reactivate your WhatsApp bridge service using your existing settings.\n\n" +
          "You'll need to scan a QR code to reconnect your WhatsApp account.\n\n" +
          "Would you like to proceed?",
        components: [row],
      });
    } catch (error) {
      console.error("Error in reconnect-service command:", error);
      await InteractionTracker.safeEdit(interaction, {
        content: `❌ Error: ${error.message}`
      });
    }
  }
}

module.exports = new ReconnectServiceCommand();