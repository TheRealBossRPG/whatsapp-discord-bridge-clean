// commands/help.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Command = require('../templates/Command');

class HelpCommand extends Command {
  constructor() {
    super({
      name: 'help',
      description: 'Show WhatsApp bridge help and commands'
    });
  }

  async execute(interaction, instance) {
    // Create help embed
    const embed = new EmbedBuilder()
      .setColor(0x4287f5)
      .setTitle("WhatsApp Bridge Commands")
      .setDescription(
        "Here are the available commands for the WhatsApp-Discord Bridge:"
      )
      .addFields(
        {
          name: "/setup",
          value: "Set up a new WhatsApp connection for this server",
        },
        { name: "/status", value: "Check the status of your WhatsApp bridge" },
        {
          name: "/disconnect",
          value: "Disconnect and remove the WhatsApp bridge for this server",
        },
        { name: "/help", value: "Show this help message" },
        {
          name: "/edit-messages",
          value: "Edit all message templates used by the bot",
        },
        {
          name: "/add-special-channel",
          value: "Add a channel with a custom message when mentioned",
        },
        {
          name: "/manage-special-channels",
          value: "List, edit or remove special channels",
        },
        {
          name: "!vouch",
          value:
            "Send vouch instructions to the WhatsApp user (in support tickets)",
        },
        {
          name: "!close",
          value:
            "Close a support ticket and save transcript (in support tickets)",
        }
      )
      .setFooter({
        text: "Admin permissions are required for setup and disconnect commands",
      });

    await interaction.reply({ embeds: [embed] });
  }
}

module.exports = new HelpCommand();