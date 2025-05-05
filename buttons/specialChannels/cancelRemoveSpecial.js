// buttons/specialChannels/cancelRemoveSpecial.js
const Button = require('../../templates/Button');

class CancelRemoveSpecialButton extends Button {
  constructor() {
    super({
      customId: 'cancel_remove_special'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.update({
        content: '❌ Removal cancelled. The special channel handling will be kept.',
        components: []
      });
    } catch (error) {
      console.error("Error handling cancel remove special:", error);
      
      try {
        await interaction.update({
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