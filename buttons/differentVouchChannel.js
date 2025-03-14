const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../templates/Button');

class DifferentVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'different_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
      // Get all text channels for vouch selection
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
        content: `Category: <#${setupParams.categoryId}>\nTranscript channel: <#${setupParams.transcriptChannelId}>\nNow select a channel for vouches:`,
        components: [vouchSelectRow],
      });
    } catch (error) {
      console.error("Error handling different vouch channel option:", error);
      await interaction.editReply({
        content: "Error: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new DifferentVouchChannelButton();