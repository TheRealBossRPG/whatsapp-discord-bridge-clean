const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const SelectMenu = require('../templates/SelectMenu');
const InteractionTracker = require('../utils/InteractionTracker');

class TranscriptSelectMenu extends SelectMenu {
  constructor() {
    super({
      customId: 'transcript_select'
    });
  }
  
  async execute(interaction, instance) {
    try {
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
        await InteractionTracker.safeReply(interaction, {
          content: "❌ Selected channel not found. Please try again.",
          components: [],
          ephemeral: true
        });
        return;
      }
      
      // CHANGED: Ask if they want a vouch channel
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
      
      // Use the tracker to safely update the reply
      await InteractionTracker.safeEdit(interaction, {
        content: `Category: <#${setupParams.categoryId}>\nTranscript channel: <#${transcriptChannelId}>\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("Error in transcript channel selection:", error);
      
      // Use the tracker to safely send an error response
      await InteractionTracker.safeReply(interaction, {
        content: "Channel selection failed: " + error.message,
        components: [],
        ephemeral: true
      });
    }
  }
}

module.exports = new TranscriptSelectMenu();