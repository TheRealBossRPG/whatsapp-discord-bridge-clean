const SelectMenu = require('../templates/SelectMenu');

class TranscriptSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'transcript_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the selected channel ID
      const transcriptChannelId = interaction.values[0];
      
      // Update setup params
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId) || {};
      setupParams.transcriptChannelId = transcriptChannelId;
      global.setupStorage.saveSetupParams(guildId, setupParams);
      
      console.log(`[Setup] Saved transcript channel ID ${transcriptChannelId} for guild ${guildId}`);
      
      // Verify channel exists
      const selectedChannel = interaction.guild.channels.cache.get(transcriptChannelId);
      if (!selectedChannel) {
        await interaction.editReply({
          content: "❌ Selected channel not found. Please try again.",
          components: [],
        });
        return;
      }
      
      // CHANGED: Ask if they want a vouch channel
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const vouchOptionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("use_vouch_channel")
          .setLabel("Yes, Enable Vouches")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("no_vouch_channel")
          .setLabel("No Vouches")
          .setStyle(ButtonStyle.Secondary)
      );
      
      await interaction.editReply({
        content: `Category: <#${setupParams.categoryId}>\nTranscript channel: <#${transcriptChannelId}>\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("Error in transcript channel selection:", error);
      await interaction.editReply({
        content: "Channel selection failed: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new TranscriptSelectMenu();