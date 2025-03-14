const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../templates/Button');

class UseVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'use_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
      if (setupParams.transcriptChannelId) {
        // Ask if they want to use the same channel as transcript
        const sameChannelRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("same_vouch_channel")
            .setLabel("Use Same Channel for Vouches")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("different_vouch_channel")
            .setLabel("Select Different Channel")
            .setStyle(ButtonStyle.Secondary)
        );
        
        await interaction.editReply({
          content: `Category: <#${setupParams.categoryId}>\nTranscript channel: <#${setupParams.transcriptChannelId}>\n\nDo you want to use the same channel for vouches, or select a different one?`,
          components: [sameChannelRow],
        });
      } else {
        // No transcript channel but wants vouches, select a vouch channel
        const textChannels = interaction.guild.channels.cache.filter(
          (c) => c.type === ChannelType.GuildText
        );
        
        const channelOptions = textChannels
          .map((channel) => ({
            label: channel.name,
            value: channel.id,
            description: "Channel for posting vouches",
          }))
          .slice(0, 25);
        
        const vouchSelectRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("vouch_select")
            .setPlaceholder("Select a channel for vouches")
            .addOptions(channelOptions)
        );
        
        await interaction.editReply({
          content: `Category: <#${setupParams.categoryId}>\nNo transcript channel selected\nNow select a channel for vouches:`,
          components: [vouchSelectRow],
        });
      }
    } catch (error) {
      console.error("Error handling vouch channel option:", error);
      await interaction.editReply({
        content: "Error: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new UseVouchChannelButton();