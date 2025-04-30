// buttons/editMessages/features/toggleTranscripts.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../../templates/Button');

class ToggleTranscriptsButton extends Button {
  constructor() {
    super({
      customId: 'toggle_transcripts'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`Error deferring toggle transcripts:`, err);
        });
      }
      
      console.log(`[ToggleTranscripts] Processing with instance: ${instance ? 'provided' : 'not provided'}`);
      
      // Get instance if not provided
      if (!instance) {
        // First try getting instance from client's route map via category
        if (interaction.channel?.parentId && interaction.client._instanceRoutes) {
          const categoryId = interaction.channel.parentId;
          console.log(`[ToggleTranscripts] Checking category ID: ${categoryId}`);
          
          if (interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[ToggleTranscripts] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          }
        }
        
        // If not found by category, try finding by guild ID
        if (!instance && interaction.client._instanceRoutes) {
          console.log(`[ToggleTranscripts] Searching all routes for guild match: ${interaction.guildId}`);
          
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[ToggleTranscripts] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[ToggleTranscripts] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
      }
      
      // Initialize customSettings if needed
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      // Determine current state and toggle it
      const currentEnabled = instance.customSettings.transcriptsEnabled !== false;
      const newEnabled = !currentEnabled;
      
      console.log(`[ToggleTranscripts] Toggling transcripts from ${currentEnabled} to ${newEnabled}`);
      
      // Update settings
      instance.customSettings.transcriptsEnabled = newEnabled;
      
      // Save settings directly without using InstanceManager to avoid circular dependencies
      // Try multiple approaches to accommodate different instance structures
      let saveSuccess = false;
      
      // Approach 1: Direct saveSettings method
      if (instance.saveSettings && typeof instance.saveSettings === 'function') {
        try {
          await instance.saveSettings({ transcriptsEnabled: newEnabled });
          console.log(`[ToggleTranscripts] Saved settings using instance.saveSettings`);
          saveSuccess = true;
        } catch (saveError) {
          console.error(`[ToggleTranscripts] Error using instance.saveSettings:`, saveError);
        }
      }
      
      // Approach 2: Use channelManager if available
      if (!saveSuccess) {
        try {
          const channelManager = instance.channelManager || (instance.managers && instance.managers.channelManager);
          if (channelManager && typeof channelManager.saveInstanceSettings === 'function') {
            await channelManager.saveInstanceSettings(
              instance.instanceId || interaction.guild.id,
              { transcriptsEnabled: newEnabled }
            );
            console.log(`[ToggleTranscripts] Saved settings using channelManager.saveInstanceSettings`);
            saveSuccess = true;
          }
        } catch (channelManagerError) {
          console.error(`[ToggleTranscripts] Error using channelManager.saveInstanceSettings:`, channelManagerError);
        }
      }
      
      // Apply settings to the transcript manager if available
      if (instance.transcriptManager) {
        instance.transcriptManager.isDisabled = !newEnabled;
        console.log(`[ToggleTranscripts] Set transcriptManager.isDisabled to ${!newEnabled}`);
      } else if (instance.managers && instance.managers.transcriptManager) {
        instance.managers.transcriptManager.isDisabled = !newEnabled;
        console.log(`[ToggleTranscripts] Set managers.transcriptManager.isDisabled to ${!newEnabled}`);
      }
      
      // Get message and current components
      const message = await interaction.fetchReply();
      const components = [...message.components];
      
      console.log(`[ToggleTranscripts] Updating UI components`);
      
      // Find the feature row
      const featureRowIndex = components.findIndex(row => 
        row.components.some(component => 
          component.customId === 'toggle_transcripts' || 
          component.customId === 'toggle_vouches' || 
          component.customId === 'toggle_closing_messages'
        )
      );
      
      if (featureRowIndex !== -1) {
        // Recreate the row with updated button
        const updatedRow = new ActionRowBuilder();
        
        // Add each component from the original row
        for (const component of components[featureRowIndex].components) {
          if (component.customId === 'toggle_transcripts') {
            // Replace this button with updated state
            updatedRow.addComponents(
              new ButtonBuilder()
                .setCustomId('toggle_transcripts')
                .setLabel(`Transcripts: ${newEnabled ? 'Enabled' : 'Disabled'}`)
                .setStyle(newEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
            );
          } else {
            // Copy the other buttons as they are
            updatedRow.addComponents(
              new ButtonBuilder()
                .setCustomId(component.customId)
                .setLabel(component.label)
                .setStyle(component.style)
            );
          }
        }
        
        // Replace the row in the components array
        components[featureRowIndex] = updatedRow;
        
        // Update the message with new components
        await interaction.editReply({ components });
        console.log(`[ToggleTranscripts] Updated UI components successfully`);
        
        // Notify success
        await interaction.followUp({
          content: `✅ Transcripts ${newEnabled ? 'enabled' : 'disabled'} successfully.`,
          ephemeral: true
        });
      } else {
        console.log(`[ToggleTranscripts] Could not find feature row in components`);
        
        // Couldn't find the feature row - just update settings
        await interaction.editReply({
          content: `Settings updated. Transcripts: ${newEnabled ? 'Enabled' : 'Disabled'}`,
          components: []
        });
      }
    } catch (error) {
      console.error('Error handling toggle transcripts:', error);
      
      try {
        await interaction.followUp({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      } catch (followUpError) {
        console.error(`Error sending error message:`, followUpError);
        
        // Try edit reply as a last resort
        try {
          if (!interaction.replied) {
            await interaction.editReply({
              content: `❌ Error: ${error.message}`
            });
          }
        } catch (finalError) {
          console.error(`Final error attempt failed:`, finalError);
        }
      }
    }
  }
}

module.exports = new ToggleTranscriptsButton();