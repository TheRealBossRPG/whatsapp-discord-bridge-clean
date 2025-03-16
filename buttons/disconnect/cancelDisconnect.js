// buttons/disconnect/cancelDisconnect.js
const Button = require('../../templates/Button');

class CancelDisconnectButton extends Button {
  constructor() {
    super({
      customId: 'cancel_disconnect'
    });
  }
  
  async execute(interaction) {
    try {
      // Simply update the message to indicate cancellation
      await interaction.update({
        content: "Disconnection cancelled.",
        components: [],
      });
    } catch (error) {
      console.error("Error handling cancel disconnect:", error);
      
      try {
        await interaction.update({
          content: `Error: ${error.message}`,
          components: [],
        });
      } catch (updateError) {
        console.error("Error updating message:", updateError);
      }
    }
  }
}

module.exports = new CancelDisconnectButton();