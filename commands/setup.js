const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Command = require('../templates/Command');
const { PermissionFlagsBits } = require('discord.js');
const InteractionTracker = require('../utils/InteractionTracker');

class SetupCommand extends Command {
  constructor() {
    super({
      name: 'setup',
      description: 'Set up a WhatsApp connection for this server',
      permissions: PermissionFlagsBits.Administrator
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Check if interaction has a valid guild
      if (!interaction.guild) {
        await InteractionTracker.safeReply(interaction, {
          content: "❌ This command can only be used in a server, not in DMs.",
          ephemeral: true
        });
        return;
      }

      const guildId = interaction.guild.id;

      // Get the bridge instance manager
      const InstanceManager = require('../core/InstanceManager');

      // Check if an instance already exists
      const existingInstance = InstanceManager.getInstanceByGuildId(guildId);

      if (existingInstance) {
        // Option to reconnect
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("reconnect")
            .setLabel("Reconnect WhatsApp")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("edit_settings")
            .setLabel("Edit Settings")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
        );

        await InteractionTracker.safeEdit(interaction, {
          content: "WhatsApp is already configured for this server. What would you like to do?",
          components: [row],
        });

        return; // Let the button handlers take over from here
      }

      // New setup process
      // Step 1: Select ticket category
      const categories = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory
      );

      if (categories.size === 0) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ No categories found in this server. Please create a category first.",
          components: [],
        });
        return;
      }

      // Create options for select menu - limit to first 25 categories
      const options = categories
        .map((category) => ({
          label: category.name,
          value: category.id,
          description: `Category with ${
            category.children?.cache.size || 0
          } channels`,
        }))
        .slice(0, 25); // Discord limit

      // Create select menu
      const categorySelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("category_select")
          .setPlaceholder("Select a category for tickets")
          .addOptions(options)
      );

      // Use the tracker for safe editing
      await InteractionTracker.safeEdit(interaction, {
        content: "Please select a category for WhatsApp support tickets:",
        components: [categorySelectRow],
      });
    } catch (error) {
      console.error("Error in setup command:", error);
      
      // Use the tracker for error responses
      await InteractionTracker.safeReply(interaction, {
        content: `❌ Error setting up WhatsApp bridge: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new SetupCommand();