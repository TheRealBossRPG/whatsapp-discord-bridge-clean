// buttons/setup/changeVouchChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class ChangeVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'change_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[ChangeVouchChannel] Processing button`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[ChangeVouchChannel] Error deferring update:`, err);
        });
      }
      
      // Get instance if not provided
      if (!instance) {
        // Try finding by route map
        if (interaction.client._instanceRoutes) {
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[ChangeVouchChannel] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[ChangeVouchChannel] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
      }
      
      // Get setup info
      const guildId = interaction.guild.id;
      
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
      
      // Create options for the select menu
      const channelOptions = [];
      
      // Add 'No Vouches' option
      channelOptions.push({
        label: "No Vouches",
        value: "no_vouches",
        description: "Disable vouch system"
      });
      
      // Check if there's a transcript channel - offer to use the same channel
      if (instance.transcriptChannelId) {
        const transcriptChannel = interaction.guild.channels.cache.get(instance.transcriptChannelId);
        if (transcriptChannel) {
          channelOptions.push({
            label: `Use Transcript Channel (${transcriptChannel.name})`,
            value: "same_as_transcript",
            description: "Use the same channel as transcripts"
          });
        }
      }
      
      // Add all text channels
      textChannels.forEach((channel) => {
        // Highlight the current vouch channel if set
        const isCurrent = instance.vouchChannelId === channel.id;
        channelOptions.push({
          label: `${isCurrent ? '✓ ' : ''}${channel.name}`,
          value: channel.id,
          description: isCurrent ? "Current vouch channel" : "Channel for posting vouches"
        });
      });
      
      // Create select menu for vouch channel
      const vouchSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("edit_vouch_select")
          .setPlaceholder("Select a channel for vouches")
          .addOptions(channelOptions.slice(0, 25)) // Discord limit
      );
      
      // Update with message and select menu
      await interaction.editReply({
        content: `Please select a channel to use for vouch messages:`,
        components: [vouchSelectRow],
        embeds: [] // Clear embeds
      });
    } catch (error) {
      console.error(`[ChangeVouchChannel] Error:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: [],
          embeds: []
        });
      } catch (replyError) {
        console.error(`[ChangeVouchChannel] Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new ChangeVouchChannelButton();