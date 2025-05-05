// modals/specialChannels/editSpecialModal.js
const Modal = require('../../templates/Modal');
const fs = require('fs');
const path = require('path');

class EditSpecialModal extends Modal {
  constructor() {
    super({
      regex: /^edit_special_modal_\d+/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit_special_modal_');
  }
  
  async execute(interaction, instance) {
    try {
      // Defer the reply to prevent timeout
      await interaction.deferReply({ ephemeral: true });
      
      // Extract channel ID from the custom ID
      const channelId = interaction.customId.replace('edit_special_modal_', '');
      
      // Get the updated message from the modal input
      const specialMessage = interaction.fields.getTextInputValue('special_message');
      
      // Get the channel
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!channel) {
        await interaction.editReply({
          content: '❌ Channel not found. It may have been deleted.',
        });
        return;
      }
      
      // Save to instance settings
      if (!instance) {
        await interaction.editReply({
          content: '❌ WhatsApp bridge configuration not found. Please use `/setup` first.',
        });
        return;
      }
      
      // Initialize specialChannels if it doesn't exist
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      if (!instance.customSettings.specialChannels) {
        instance.customSettings.specialChannels = {};
      }
      
      // Update the special channel message
      instance.customSettings.specialChannels[channelId] = {
        message: specialMessage,
        channelName: channel.name
      };
      
      // Save settings to file
      try {
        // Try instance method first
        if (typeof instance.saveSettings === 'function') {
          await instance.saveSettings({
            specialChannels: instance.customSettings.specialChannels
          });
        } else {
          // Direct file update
          const instanceId = instance.instanceId || interaction.guildId;
          const settingsPath = path.join(__dirname, '..', '..', 'instances', instanceId, 'settings.json');
          
          let settings = {};
          if (fs.existsSync(settingsPath)) {
            try {
              settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            } catch (readError) {
              console.error(`Error reading settings:`, readError);
            }
          }
          
          // Update settings
          if (!settings.specialChannels) {
            settings.specialChannels = {};
          }
          
          settings.specialChannels[channelId] = {
            message: specialMessage,
            channelName: channel.name
          };
          
          // Ensure directory exists
          const dir = path.dirname(settingsPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          // Write updated settings
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
          
          console.log(`Updated special channel settings in file: ${settingsPath}`);
        }
      } catch (saveError) {
        console.error(`Error saving special channel settings:`, saveError);
        await interaction.editReply({
          content: `❌ Error saving settings: ${saveError.message}`,
        });
        return;
      }
      
      await interaction.editReply({
        content: `✅ Successfully updated special message for channel #${channel.name}!\n\nNew message: "${specialMessage}"`,
      });
    } catch (error) {
      console.error("Error handling edit special modal:", error);
      
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: `❌ Error: ${error.message}`
          });
        } else if (!interaction.replied) {
          await interaction.reply({
            content: `❌ Error: ${error.message}`,
            ephemeral: true
          });
        }
      } catch (replyError) {
        console.error("Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new EditSpecialModal();