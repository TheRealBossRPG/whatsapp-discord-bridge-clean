const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class UseTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'use_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // FIXED: Properly defer the interaction to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      
      // Get all text channels in the guild
      const textChannels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText
      );
      
      if (textChannels.size === 0) {
        await interaction.editReply({
          content: "❌ No text channels found in this server. Please create a text channel first.",
          components: [],
        });
        return;
      }
      
      // Create options for select menu
      const channelOptions = textChannels
        .map((channel) => ({
          label: channel.name,
          value: channel.id,
          description: "Channel for saving ticket transcripts",
        }))
        .slice(0, 25); // Discord limit
      
      // Create select menu for transcript channel
      const transcriptSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("transcript_select")
          .setPlaceholder("Select a channel for transcripts")
          .addOptions(channelOptions)
      );
      
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
      // Update the reply directly without using the tracker
      await interaction.editReply({
        content: `Category selected: <#${setupParams.categoryId}>\nNow select a channel for ticket transcripts:`,
        components: [transcriptSelectRow],
      });
    } catch (error) {
      console.error("Error handling transcript channel option:", error);
      
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

module.exports = new UseTranscriptChannelButton();