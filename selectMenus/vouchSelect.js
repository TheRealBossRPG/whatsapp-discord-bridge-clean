const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');

class VouchSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'vouch_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the selected channel ID
      const vouchChannelId = interaction.values[0];
      
      // Update setup params
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId) || {};
      setupParams.vouchChannelId = vouchChannelId;
      global.setupStorage.saveSetupParams(guildId, setupParams);
      
      console.log(`[Setup] Saved vouch channel ID ${vouchChannelId} for guild ${guildId}`);
      
      // Verify channel exists
      const selectedChannel = interaction.guild.channels.cache.get(vouchChannelId);
      if (!selectedChannel) {
        await interaction.editReply({
          content: "❌ Selected channel not found. Please try again.",
          components: [],
        });
        return;
      }
      
      // Summarize selections
      let statusText = `Category: <#${setupParams.categoryId}>\n`;
      if (setupParams.transcriptChannelId) {
        statusText += `Transcript channel: <#${setupParams.transcriptChannelId}>\n`;
      } else {
        statusText += `Transcript channel: None (disabled)\n`;
      }
      
      statusText += `Vouch channel: <#${vouchChannelId}>\n`;
      
      // Create customize options buttons
      const customizeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("customize_messages")
          .setLabel("Customize Messages")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("continue_default")
          .setLabel("Continue with Defaults")
          .setStyle(ButtonStyle.Secondary)
      );
      
      await interaction.editReply({
        content: `${statusText}\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });
    } catch (error) {
      console.error("Error in vouch channel selection:", error);
      await interaction.editReply({
        content: "Channel selection failed: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new VouchSelectMenu();