// buttons/specialChannels/addSpecialChannel.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class AddSpecialChannelButton extends Button {
  constructor() {
    super({
      customId: 'add_special_channel_btn'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // First defer the update to prevent timeout
      await interaction.deferUpdate().catch(err => {
        console.error(`Error deferring update:`, err);
      });
      
      // Get all text channels in the guild
      const textChannels = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildText
      );
      
      if (textChannels.size === 0) {
        await interaction.editReply({
          content: "❌ No text channels found in this server. Please create a text channel first.",
          components: []
        });
        return;
      }
      
      // Create options for select menu
      const channelOptions = textChannels
        .map(channel => ({
          label: channel.name,
          value: channel.id,
          description: `#${channel.name}`
        }))
        .slice(0, 25); // Discord limit
      
      // Create the select menu
      const row = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('special_channel_select')
            .setPlaceholder('Select a channel to make special')
            .addOptions(channelOptions)
        );
      
      // Send the select menu
      await interaction.editReply({
        content: "Select a channel to add special handling for when mentioned:",
        components: [row]
      });
    } catch (error) {
      console.error("Error handling add special channel button:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: []
        });
      } catch (replyError) {
        console.error("Error sending error response:", replyError);
      }
    }
  }
}

module.exports = new AddSpecialChannelButton();