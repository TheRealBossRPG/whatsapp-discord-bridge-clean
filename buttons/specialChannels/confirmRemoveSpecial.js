const Button = require('../templates/Button');

class ConfirmRemoveSpecialButton extends Button {
  constructor() {
    super({
      regex: /^confirm_remove_special_\d+$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('confirm_remove_special_');
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get the channel ID from the button ID
      const channelId = interaction.customId.replace('confirm_remove_special_', '');
      
      // Get the bridge instance manager
      const bridgeInstanceManager = require('../core/InstanceManager');
      
      // Get the instance
      if (!instance || !instance.customSettings?.specialChannels) {
        await interaction.editReply({
          content: "❌ Cannot remove special channel: Configuration not found.",
          components: []
        });
        return;
      }
      
      // Remove the special channel
      delete instance.customSettings.specialChannels[channelId];
      
      // Save the settings
      await bridgeInstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Import the manageSpecialChannels command and execute it to refresh the view
      const manageSpecialChannelsCommand = require('../commands/manageSpecialChannels');
      await manageSpecialChannelsCommand.execute(interaction, instance);
    } catch (error) {
      console.error("Error confirming removal of special channel:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error removing special channel: ${error.message}`,
          components: []
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new ConfirmRemoveSpecialButton();