const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Command = require('../templates/Command');
const InstanceManager = require("../core/InstanceManager");

class StatusCommand extends Command {
  constructor() {
    super({
      name: 'status',
      description: 'Check the status of the WhatsApp connection'
    });
  }

  async execute(interaction, instance) {
    await interaction.deferReply();

    try {
      // If no instance was provided, get it from the instance manager
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }

      if (!instance) {
        await interaction.editReply(
          "❌ No WhatsApp bridge is configured for this server. Use `/setup` to set one up."
        );
        return;
      }

      // Get instance status
      const status = instance.getStatus();

      // Create status embed
      const embed = new EmbedBuilder()
        .setColor(status.isConnected ? 0x00ff00 : 0xff0000)
        .setTitle("WhatsApp Bridge Status")
        .addFields(
          {
            name: "Status",
            value: status.isConnected ? "🟢 Connected" : "🔴 Disconnected",
          },
          { name: "Server", value: interaction.guild.name, inline: true },
          { name: "Instance ID", value: status.instanceId, inline: true },
          {
            name: "Category",
            value:
              interaction.guild.channels.cache.get(status.categoryId)?.name ||
              "Unknown Category",
          },
          {
            name: "Transcript Channel",
            value: status.transcriptChannel
              ? `<#${status.transcriptChannel}>`
              : "Not set",
          },
          {
            name: "Vouch Channel",
            value: status.vouchChannel ? `<#${status.vouchChannel}>` : "Not set",
          },
          { name: "Active Tickets", value: status.activeTickets.toString() },
          { name: "Registered Users", value: status.registeredUsers.toString() }
        )
        .setFooter({ text: "Last updated" })
        .setTimestamp();

      // Add reconnect button if disconnected
      const components = [];
      if (!status.isConnected) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("reconnect_status")
            .setLabel("Reconnect WhatsApp")
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row);
      } else {
        // Add refresh QR code option for connected instance
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("refresh_qr")
            .setLabel("Refresh QR Code")
            .setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components: components,
      });
    } catch (error) {
      console.error("Error in status command:", error);
      await interaction.editReply(`❌ Error checking status: ${error.message}`);
    }
  }
}

module.exports = new StatusCommand();