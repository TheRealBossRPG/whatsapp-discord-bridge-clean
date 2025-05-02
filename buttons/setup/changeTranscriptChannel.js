// buttons/setup/changeTranscriptChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

/**
 * Button handler for changing the transcript channel
 */
class ChangeTranscriptChannelButton extends Button {
  constructor() {
    super({
      customId: 'change_transcript_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[ChangeTranscriptChannel] Processing button`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[ChangeTranscriptChannel] Error deferring update:`, err);
        });
      }
      
      // Get instance if not provided
      if (!instance) {
        // Try finding by route map
        if (interaction.client._instanceRoutes) {
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[ChangeTranscriptChannel] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[ChangeTranscriptChannel] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
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
      const channelOptions = [];
      
      // Add 'No Transcripts' option at the top
      channelOptions.push({
        label: "No Transcripts",
        value: "no_transcripts",
        description: "Disable transcript saving"
      });
      
      // Add all text channels
      textChannels.forEach((channel) => {
        // Highlight the current transcript channel if set
        const isCurrent = instance.transcriptChannelId === channel.id;
        channelOptions.push({
          label: `${isCurrent ? '✓ ' : ''}${channel.name}`,
          value: channel.id,
          description: isCurrent ? "Current transcript channel" : "Channel for saving transcripts"
        });
      });
      
      // Create select menu for transcript channel
      const transcriptSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("transcript_select")
          .setPlaceholder("Select a channel for transcripts")
          .addOptions(channelOptions.slice(0, 25)) // Discord limit
      );
      
      // Update with message and select menu
      await interaction.editReply({
        content: `Please select a channel to use for saving ticket transcripts:`,
        components: [transcriptSelectRow],
        embeds: [] // Clear embeds
      });
    } catch (error) {
      console.error(`[ChangeTranscriptChannel] Error:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: [],
          embeds: []
        });
      } catch (replyError) {
        console.error(`[ChangeTranscriptChannel] Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new ChangeTranscriptChannelButton();