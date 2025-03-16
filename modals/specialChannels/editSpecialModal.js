const Modal = require('../../templates/Modal');

class EditSpecialModal extends Modal {
  constructor() {
    super({
      regex: /^edit_special_modal_\d+$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit_special_modal_');
  }
  
  async execute(interaction, instance) {
    try {
      // Get the channel ID from the modal ID
      const channelId = interaction.customId.replace('edit_special_modal_', '');
      const channel = interaction.guild.channels.cache.get(channelId);
      
      if (!channel) {
        await interaction.reply({
          content: '❌ Selected channel no longer exists.',
          ephemeral: true
        });
        return;
      }
      
      // Get the message from the modal
      const specialMessage = interaction.fields.getTextInputValue('special_message');
      
      // Get the instance
      if (!instance) {
        await interaction.reply({
          content: "❌ WhatsApp bridge is not set up for this server.",
          ephemeral: true
        });
        return;
      }
      
      // Get the bridge instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Check if specialChannels is already initialized
      if (!instance.customSettings) instance.customSettings = {};
      if (!instance.customSettings.specialChannels) instance.customSettings.specialChannels = {};
      
      // Update the special channel
      instance.customSettings.specialChannels[channelId] = {
        message: specialMessage
      };
      
      // Save the settings
      await InstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Confirm to the user
      await interaction.reply({
        content: `✅ Special message for <#${channelId}> updated! When mentioned, it will now show:\n\n${specialMessage}`,
        ephemeral: true
      });
    } catch (error) {
      console.error("Error handling edit special modal:", error);
      
      try {
        await interaction.reply({
          content: `❌ Error updating special channel: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditSpecialModal();