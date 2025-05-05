// buttons/specialChannels/confirmRemoveSpecial.js
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class ConfirmRemoveSpecialButton extends Button {
  constructor() {
    super({
      regex: /^confirm_remove_special_\d+/
    });
  }
  
  matches(customId) {
    return customId.startsWith('confirm_remove_special_');
  }
  
  async execute(interaction, instance) {
    try {
      // Defer the reply to prevent timeout
      await interaction.deferUpdate();
      
      // Extract channel ID from the custom ID
      const channelId = interaction.customId.replace('confirm_remove_special_', '');
      
      // Get the channel
      const channel = interaction.guild.channels.cache.get(channelId);
      const channelName = channel ? channel.name : 'Unknown Channel';
      
      // Remove from instance settings
      if (!instance) {
        await interaction.editReply({
          content: '❌ WhatsApp bridge configuration not found. Please use `/setup` first.',
          components: []
        });
        return;
      }
      
      // Check if specialChannels exists
      if (!instance.customSettings || !instance.customSettings.specialChannels) {
        await interaction.editReply({
          content: '❌ No special channels configuration found.',
          components: []
        });
        return;
      }
      
      // Remove the special channel
      if (instance.customSettings.specialChannels[channelId]) {
        delete instance.customSettings.specialChannels[channelId];
      } else {
        await interaction.editReply({
          content: '❌ This channel was not configured as a special channel.',
          components: []
        });
        return;
      }
      
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
          if (settings.specialChannels && settings.specialChannels[channelId]) {
            delete settings.specialChannels[channelId];
          }
          
          // Write updated settings
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
          
          console.log(`Removed special channel ${channelId} from settings file: ${settingsPath}`);
        }
      } catch (saveError) {
        console.error(`Error saving settings:`, saveError);
        await interaction.editReply({
          content: `❌ Error saving settings: ${saveError.message}`,
          components: []
        });
        return;
      }
      
      await interaction.editReply({
        content: `✅ Special handling for channel #${channelName} has been removed.`,
        components: []
      });
      
      // Trigger a refresh of the manage special channels command if possible
      // This requires additional code in manageSpecialChannels.js
    } catch (error) {
      console.error("Error handling confirm remove special:", error);
      
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

module.exports = new ConfirmRemoveSpecialButton();