const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');

class NoTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'no_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // FIXED: Properly defer the interaction to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      
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
      
      // Update directly without using the tracker
      await interaction.editReply({
        content: `Category: <#${setupParams.categoryId}>\nNo transcript channel selected\n\nDo you want to enable the vouching system?`,
        components: [vouchOptionsRow],
      });
    } catch (error) {
      console.error("Error handling no transcript channel option:", error);
      
      // Try different error handling approaches
      try {
        await interaction.editReply({
          content: "Error: " + error.message,
          components: [],
        });
      } catch (replyError) {
        console.error("Error sending error response:", replyError);
        try {
          await interaction.followUp({
            content: "Error: " + error.message,
            ephemeral: true
          });
        } catch (finalError) {
          console.error("Final error attempt failed:", finalError);
        }
      }
    }
  }
}

module.exports = new NoTranscriptChannelButton();