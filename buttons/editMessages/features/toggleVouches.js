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
      await interaction.deferUpdate();
      
      // Get instance
      if (!instance) {
        await interaction.editReply({
          content: '❌ Could not find WhatsApp configuration.',
          components: []
        });
        return;
      }
      
      // Initialize customSettings if needed
      if (!instance.customSettings) {
        instance.customSettings = {};
      }
      
      // Determine current state and toggle it
      const currentEnabled = instance.customSettings.vouchEnabled !== false;
      const newEnabled = !currentEnabled;
      
      // Update settings
      instance.customSettings.vouchEnabled = newEnabled;
      
      // Save settings
      const InstanceManager = require('../../../core/InstanceManager');
      await InstanceManager.saveInstanceSettings(
        instance.instanceId || interaction.guild.id,
        { vouchEnabled: newEnabled }
      );
      
      // Apply settings to the vouch handler if available
      if (instance.vouchHandler) {
        instance.vouchHandler.isDisabled = !newEnabled;
        console.log(`Set vouchHandler.isDisabled to ${!newEnabled}`);
      }
      
      // Get message and current components
      const message = await interaction.fetchReply();
      const components = [...message.components];
      
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
        
        // Notify success
        await interaction.followUp({
          content: `✅ Vouches ${newEnabled ? 'enabled' : 'disabled'} successfully.`,
          ephemeral: true
        });
      } else {
        // Couldn't find the feature row - just update settings
        await interaction.editReply({
          content: `Settings updated. Vouches: ${newEnabled ? 'Enabled' : 'Disabled'}`,
          components: []
        });
      }
    } catch (error) {
      console.error('Error handling toggle vouches:', error);
      await interaction.followUp({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  }
}

module.exports = new ToggleVouchesButton();