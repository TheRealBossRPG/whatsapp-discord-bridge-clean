const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const Command = require('../templates/Command');
const InstanceManager = require("../core/InstanceManager");
const InteractionTracker = require('../utils/InteractionTracker');

class DisconnectWhatsAppCommand extends Command {
  constructor() {
    super({
      name: 'disconnect-whatsapp',
      description: 'Disconnect the WhatsApp connection and wipe authentication data',
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
      
      try {
        // Check instance object first
        if (instance.serviceActive === false || 
            (instance.customSettings && instance.customSettings.status === 'inactive')) {
          isInactive = true;
        } else {
          // Check settings file directly
          const instanceId = instance.instanceId || guildId;
          const settingsPath = path.join(__dirname, '..', 'instances', instanceId, 'settings.json');
          
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
      
      // If service is inactive, show reconnect option
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
          content: "ℹ️ The WhatsApp bridge service is currently inactive.\n\n" +
                  "You need to reconnect the service before you can disconnect WhatsApp.",
          components: [row],
        });
        
        return;
      }

      // Confirm disconnection with buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_disconnect_whatsapp")
          .setLabel("Yes, disconnect WhatsApp")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("cancel_disconnect_whatsapp")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await InteractionTracker.safeEdit(interaction, {
        content:
          "⚠️ Are you sure you want to disconnect WhatsApp?\n\n" +
          "You will need to scan a QR code again to reconnect.",
        components: [row],
      });
    } catch (error) {
      console.error("Error in disconnect-whatsapp command:", error);
      await InteractionTracker.safeEdit(interaction, {
        content: `❌ Error: ${error.message}`
      });
    }
  }
}

module.exports = new DisconnectWhatsAppCommand();