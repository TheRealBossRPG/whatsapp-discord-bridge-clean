const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Command = require('../templates/Command');
const { PermissionFlagsBits } = require('discord.js');

class SetupCommand extends Command {
  constructor() {
    super({
      name: 'setup',
      description: 'Set up a WhatsApp connection for this server',
      permissions: PermissionFlagsBits.Administrator
    });
  }
  
  async execute(interaction, instance) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Check if interaction has a valid guild
      if (!interaction.guild) {
        await interaction.editReply({
          content: "❌ This command can only be used in a server, not in DMs.",
          components: [],
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

        const response = await interaction.editReply({
          content:
            "WhatsApp is already configured for this server. What would you like to do?",
          components: [row],
        });

        // Wait for button press
        try {
          const confirmation = await response.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id,
            time: 60000,
          });

          if (confirmation.customId === "cancel") {
            await confirmation.update({
              content: "Setup cancelled.",
              components: [],
            });
            return;
          }

          if (confirmation.customId === "edit_settings") {
            await confirmation.update({
              content: "Loading current settings...",
              components: [],
            });
            // Import and call editSettings
            const editSettingsCommand = require('./editSettings');
            return await editSettingsCommand.execute(interaction, existingInstance);
          }

          if (confirmation.customId === "reconnect") {
            await confirmation.update({
              content: "Reconnecting WhatsApp...",
              components: [],
            });

            // Use existing configuration to generate a new QR code
            const refreshedQR = await InstanceManager.generateQRCode({
              guildId,
              categoryId: existingInstance.categoryId,
              transcriptChannelId: existingInstance.transcriptChannelId,
              vouchChannelId:
                existingInstance.vouchChannelId ||
                existingInstance.transcriptChannelId,
              customSettings: existingInstance.customSettings || {},
              discordClient: interaction.client,
            });

            if (refreshedQR === null) {
              await interaction.editReply({
                content: "✅ WhatsApp is already connected!",
              });
              return;
            }

            if (refreshedQR === "TIMEOUT") {
              await interaction.editReply({
                content: "⚠️ QR code generation timed out. Please try again.",
              });
              return;
            }

            // Import and use the QR code display function
            const { displayQRCode } = require('../utils/qrCodeUtils');
            await displayQRCode(interaction, refreshedQR, guildId);
            return;
          }
        } catch (e) {
          await interaction.editReply({
            content: "Confirmation timed out.",
            components: [],
          });
          return;
        }
      }

      // New setup process
      // Step 1: Select ticket category
      const categories = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory
      );

      if (categories.size === 0) {
        await interaction.editReply({
          content:
            "❌ No categories found in this server. Please create a category first.",
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

      await interaction.editReply({
        content: "Please select a category for WhatsApp support tickets:",
        components: [categorySelectRow],
      });
    } catch (error) {
      console.error("Error in setup command:", error);
      await interaction.editReply({
        content: `❌ Error setting up WhatsApp bridge: ${error.message}`,
        components: [],
      });
    }
  }
}

module.exports = new SetupCommand();