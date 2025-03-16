const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const Command = require('../templates/Command');
const InstanceManager = require("../core/InstanceManager");

class DisconnectCommand extends Command {
  constructor() {
    super({
      name: 'disconnect',
      description: 'Disconnect the WhatsApp connection',
      permissions: PermissionFlagsBits.Administrator
    });
  }
  
  async execute(interaction, instance) {
    await interaction.deferReply();

    try {
      const guildId = interaction.guild.id;

      // Check if instance exists
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(guildId);
      }

      if (!instance) {
        await interaction.editReply(
          "❌ No WhatsApp bridge is configured for this server."
        );
        return;
      }

      // Confirm disconnection with buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_disconnect")
          .setLabel("Yes, disconnect")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("cancel_disconnect")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content:
          "⚠️ Are you sure you want to disconnect the WhatsApp bridge? This will remove all configuration, delete authentication data, and require re-scanning the QR code to reconnect.",
        components: [row],
      });
    } catch (error) {
      console.error("Error in disconnect command:", error);
      await interaction.editReply(`❌ Error disconnecting: ${error.message}`);
    }
  }
}

module.exports = new DisconnectCommand();