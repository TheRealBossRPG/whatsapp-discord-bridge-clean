// buttons/setup/changeVouchChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

/**
 * Button handler for changing the vouch channel
 */
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
      
      // Create options for the buttons
      const buttonOptions = [];
      
      // Check if there's a transcript channel - offer to use the same channel
      if (instance.transcriptChannelId) {
        const transcriptChannel = interaction.guild.channels.cache.get(instance.transcriptChannelId);
        if (transcriptChannel) {
          // Create the row with options specific to vouch setup
          const vouchOptionsRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId("vouch_select")
              .setPlaceholder("Select a channel for vouches")
              .addOptions([
                {
                  label: "No Vouches",
                  value: "no_vouches",
                  description: "Disable vouch system"
                },
                {
                  label: `Use Transcript Channel (${transcriptChannel.name})`,
                  value: "same_as_transcript",
                  description: "Use the same channel as transcripts"
                },
                ...textChannels.map(channel => ({
                  label: channel.name,
                  value: channel.id,
                  description: instance.vouchChannelId === channel.id ? 
                    "Current vouch channel" : "Channel for posting vouches"
                })).slice(0, 23) // Leave room for the two options above
              ])
          );
          
          await interaction.editReply({
            content: `Select a channel for vouch messages, or choose to use the same channel as transcripts:`,
            components: [vouchOptionsRow],
            embeds: []
          });
          return;
        }
      }
      
      // If no transcript channel or couldn't find it, just show channel select
      const channelOptions = [
        {
          label: "No Vouches",
          value: "no_vouches",
          description: "Disable vouch system"
        },
        ...textChannels.map(channel => ({
          label: channel.name,
          value: channel.id,
          description: instance.vouchChannelId === channel.id ? 
            "Current vouch channel" : "Channel for posting vouches"
        })).slice(0, 24) // Leave room for the "No Vouches" option
      ];
      
      // Create select menu
      const vouchSelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("vouch_select")
          .setPlaceholder("Select a channel for vouches")
          .addOptions(channelOptions)
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