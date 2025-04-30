// buttons/setup/editSettings.js
const Button = require('../../templates/Button');

/**
 * Button handler for editing settings
 */
class EditSettingsButton extends Button {
  constructor() {
    super({
      customId: 'edit_settings'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[EditSettings] Processing edit settings button`);
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[EditSettings] Error deferring update:`, err);
        });
      }
      
      // Get instance if not provided
      if (!instance) {
        // First try getting instance from client's route map via category
        if (interaction.channel?.parentId && interaction.client._instanceRoutes) {
          const categoryId = interaction.channel.parentId;
          console.log(`[EditSettings] Checking category ID: ${categoryId}`);
          
          if (interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[EditSettings] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          }
        }
        
        // If not found by category, try finding by guild ID
        if (!instance && interaction.client._instanceRoutes) {
          console.log(`[EditSettings] Searching all routes for guild match: ${interaction.guildId}`);
          
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[EditSettings] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[EditSettings] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
      }
      
      // Simply invoke the editMessages command to show the edit interface
      try {
        const editMessagesCommand = require('../../commands/editMessages');
        console.log(`[EditSettings] Running editMessages command`);
        await editMessagesCommand.execute(interaction, instance);
      } catch (commandError) {
        console.error(`[EditSettings] Error executing editMessages command:`, commandError);
        await interaction.editReply({
          content: `❌ Error loading settings editor: ${commandError.message}`,
          components: []
        });
      }
    } catch (error) {
      console.error(`[EditSettings] Error handling edit settings button:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: []
        });
      } catch (replyError) {
        console.error(`[EditSettings] Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new EditSettingsButton();