const Modal = require('../../templates/Modal');

class SpecialChannelModal extends Modal {
  constructor() {
    super({
      regex: /^special_channel_modal_\d+$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('special_channel_modal_');
  }
  
  async execute(interaction, instance) {
    try {
      // Get the channel ID from the modal ID
      const channelId = interaction.customId.replace('special_channel_modal_', '');
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
          content: "❌ WhatsApp bridge is not set up for this server. Please use `/setup` first.",
          ephemeral: true
        });
        return;
      }
      
      // Get the bridge instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Initialize customSettings.specialChannels if needed
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      if (!instance.customSettings.specialChannels) {
        instance.customSettings.specialChannels = {};
      }
      
      // Add the special channel
      instance.customSettings.specialChannels[channelId] = {
        message: specialMessage
      };
      
      // Save the settings to persist this change
      await InstanceManager.saveInstanceSettings(
        instance.instanceId,
        instance.customSettings
      );
      
      // Confirm to the user
      await interaction.reply({
        content: `✅ Special channel added! When <#${channelId}> is mentioned in messages, it will show:\n\n${specialMessage}`,
        ephemeral: true
      });
    } catch (error) {
      console.error("Error handling special channel modal:", error);
      
      try {
        await interaction.reply({
          content: `❌ Error adding special channel: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new SpecialChannelModal();