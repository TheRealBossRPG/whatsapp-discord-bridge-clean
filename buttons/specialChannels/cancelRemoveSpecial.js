const Button = require('../../templates/Button');

class CancelRemoveSpecialButton extends Button {
  constructor() {
    super({
      customId: 'cancel_remove_special'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Import and use the manageSpecialChannels command to refresh the view
      const manageSpecialChannelsCommand = require('../commands/manageSpecialChannels');
      await manageSpecialChannelsCommand.execute(interaction, instance);
    } catch (error) {
      console.error("Error cancelling removal of special channel:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: []
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new CancelRemoveSpecialButton();