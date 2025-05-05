// buttons/specialChannels/removeSpecialChannel.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../templates/Button');

class RemoveSpecialChannelButton extends Button {
  constructor() {
    super({
      regex: /^remove_special_\d+/
    });
  }
  
  matches(customId) {
    return customId.startsWith('remove_special_');
  }
  
  async execute(interaction, instance) {
    try {
      // Extract channel ID from the custom ID
      const channelId = interaction.customId.replace('remove_special_', '');
      
      // Get the channel
      const channel = interaction.guild.channels.cache.get(channelId);
      const channelName = channel ? channel.name : 'Unknown Channel';
      
      // Create confirmation buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_remove_special_${channelId}`)
            .setLabel('Yes, Remove')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('cancel_remove_special')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );
      
      // Show confirmation message
      await interaction.reply({
        content: `Are you sure you want to remove the special handling for channel #${channelName}?`,
        components: [row],
        ephemeral: true
      });
    } catch (error) {
      console.error("Error handling remove special channel button:", error);
      
      try {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new RemoveSpecialChannelButton();