const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');

class RemoveSpecialChannelButton extends Button {
  constructor() {
    super({
      regex: /^remove_special_\d+$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('remove_special_');
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the channel ID from the button ID
      const channelId = interaction.customId.replace('remove_special_', '');
      const channel = interaction.guild.channels.cache.get(channelId);
      
      // Get the instance
      if (!instance) {
        await interaction.editReply({
          content: "❌ WhatsApp bridge is not set up for this server.",
          components: [],
          embeds: []
        });
        return;
      }
      
      // Check if specialChannels is initialized
      if (!instance.customSettings?.specialChannels) {
        await interaction.editReply({
          content: "❌ No special channels configured.",
          components: [],
          embeds: []
        });
        return;
      }
      
      // Create a confirmation button
      const confirmRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_remove_special_${channelId}`)
            .setLabel(`Yes, Remove ${channel ? '#'+channel.name : 'this channel'}`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cancel_remove_special')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Send confirmation message
      await interaction.editReply({
        content: `Are you sure you want to remove the special handling for ${channel ? `<#${channelId}>` : 'this channel'}?`,
        components: [confirmRow],
        embeds: []
      });
    } catch (error) {
      console.error("Error handling remove special channel:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error removing special channel: ${error.message}`,
          components: [],
          embeds: []
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new RemoveSpecialChannelButton();