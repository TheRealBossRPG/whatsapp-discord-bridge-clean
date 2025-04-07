const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');

class UseTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'use_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Use the tracker to mark the interaction (no need to defer update)
      
      // Get all text channels in the guild
      const textChannels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText
      );
      
      if (textChannels.size === 0) {
        await InteractionTracker.safeReply(interaction, {
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
      
      // Use the tracker to safely update the reply
      await InteractionTracker.safeEdit(interaction, {
        content: `Category selected: <#${setupParams.categoryId}>\nNow select a channel for ticket transcripts:`,
        components: [transcriptSelectRow],
      });
    } catch (error) {
      console.error("Error handling transcript channel option:", error);
      
      // Use the tracker to safely send an error response
      await InteractionTracker.safeReply(interaction, {
        content: "Error: " + error.message,
        components: [],
        ephemeral: true
      });
    }
  }
}

module.exports = new UseTranscriptChannelButton();