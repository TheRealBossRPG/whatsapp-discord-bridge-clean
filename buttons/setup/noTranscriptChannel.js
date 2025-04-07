const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');

class NoTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'no_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
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
        content: `Category: <#${setupParams.categoryId}>\nNo transcript channel selected\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("Error handling no transcript channel option:", error);
      
      // Use the tracker to safely send an error response
      await InteractionTracker.safeReply(interaction, {
        content: "Error: " + error.message,
        components: [],
        ephemeral: true
      });
    }
  }
}

module.exports = new NoTranscriptChannelButton();