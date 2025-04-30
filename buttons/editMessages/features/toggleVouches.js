// buttons/editMessages/features/toggleVouches.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../../../templates/Button');

class ToggleVouchesButton extends Button {
  constructor() {
    super({
      customId: 'toggle_vouches'
    });
  }
  
  async execute(interaction, instance) {
    try {
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`Error deferring toggle vouches:`, err);
        });
      }
      
      console.log(`[ToggleVouches] Processing with instance: ${instance ? 'provided' : 'not provided'}`);
      
      // Get instance if not provided
      if (!instance) {
        // First try getting instance from client's route map via category
        if (interaction.channel?.parentId && interaction.client._instanceRoutes) {
          const categoryId = interaction.channel.parentId;
          console.log(`[ToggleVouches] Checking category ID: ${categoryId}`);
          
          if (interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[ToggleVouches] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          }
        }
        
        // If not found by category, try finding by guild ID
        if (!instance && interaction.client._instanceRoutes) {
          console.log(`[ToggleVouches] Searching all routes for guild match: ${interaction.guildId}`);
          
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[ToggleVouches] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[ToggleVouches] No instance found for guild ${interaction.guildId}`);
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
      const currentEnabled = instance.customSettings.vouchEnabled !== false;
      const newEnabled = !currentEnabled;
      
      console.log(`[ToggleVouches] Toggling vouches from ${currentEnabled} to ${newEnabled}`);
      
      // Update settings
      instance.customSettings.vouchEnabled = newEnabled;
      
      // Save settings directly without using InstanceManager to avoid circular dependencies
      // Try multiple approaches to accommodate different instance structures
      let saveSuccess = false;
      
      // Approach 1: Direct saveSettings method
      if (instance.saveSettings && typeof instance.saveSettings === 'function') {
        try {
          await instance.saveSettings({ vouchEnabled: newEnabled });
          console.log(`[ToggleVouches] Saved settings using instance.saveSettings`);
          saveSuccess = true;
        } catch (saveError) {
          console.error(`[ToggleVouches] Error using instance.saveSettings:`, saveError);
        }
      }
      
      // Approach 2: Use channelManager if available
      if (!saveSuccess) {
        try {
          const channelManager = instance.channelManager || (instance.managers && instance.managers.channelManager);
          if (channelManager && typeof channelManager.saveInstanceSettings === 'function') {
            await channelManager.saveInstanceSettings(
              instance.instanceId || interaction.guild.id,
              { vouchEnabled: newEnabled }
            );
            console.log(`[ToggleVouches] Saved settings using channelManager.saveInstanceSettings`);
            saveSuccess = true;
          }
        } catch (channelManagerError) {
          console.error(`[ToggleVouches] Error using channelManager.saveInstanceSettings:`, channelManagerError);
        }
      }
      
      // Apply settings to the vouch handler if available
      if (instance.vouchHandler) {
        instance.vouchHandler.isDisabled = !newEnabled;
        console.log(`[ToggleVouches] Set vouchHandler.isDisabled to ${!newEnabled}`);
      } else if (instance.handlers && instance.handlers.vouchHandler) {
        instance.handlers.vouchHandler.isDisabled = !newEnabled;
        console.log(`[ToggleVouches] Set handlers.vouchHandler.isDisabled to ${!newEnabled}`);
      }
      
      // Get message and current components
      const message = await interaction.fetchReply();
      const components = [...message.components];
      
      console.log(`[ToggleVouches] Updating UI components`);
      
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
          if (component.customId === 'toggle_vouches') {
            // Replace this button with updated state
            updatedRow.addComponents(
              new ButtonBuilder()
                .setCustomId('toggle_vouches')
                .setLabel(`Vouches: ${newEnabled ? 'Enabled' : 'Disabled'}`)
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
        console.log(`[ToggleVouches] Updated UI components successfully`);
        
        // Notify success
        await interaction.followUp({
          content: `✅ Vouches ${newEnabled ? 'enabled' : 'disabled'} successfully.`,
          ephemeral: true
        });
      } else {
        console.log(`[ToggleVouches] Could not find feature row in components`);
        
        // Couldn't find the feature row - just update settings
        await interaction.editReply({
          content: `Settings updated. Vouches: ${newEnabled ? 'Enabled' : 'Disabled'}`,
          components: []
        });
      }
    } catch (error) {
      console.error('Error handling toggle vouches:', error);
      
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

module.exports = new ToggleVouchesButton();