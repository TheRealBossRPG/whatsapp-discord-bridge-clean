const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const InteractionTracker = require('../../utils/InteractionTracker');
const InstanceManager = require('../../core/InstanceManager');

class EditUserButton extends Button {
  constructor() {
    super({
      customId: 'edit-user',
      regex: /^edit-user-(.+)$/
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Extract phone number from button ID
      const phoneNumber = interaction.customId.replace('edit-user-', '');
      
      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
        console.log(`[EditUserButton] Got instance from manager:`, instance?.instanceId || 'Not found');
      }
      
      // IMPROVED: More robust instance checking
      console.log(`[EditUserButton] Instance structure:`, 
        instance ? 
        Object.keys(instance).join(', ') : 
        'Instance is null or undefined');
      
      // Try multiple paths to find the user manager
      let userCardManager = null;
      
      if (instance) {
        // Try direct path
        if (instance.userCardManager) {
          userCardManager = instance.userCardManager;
          console.log(`[EditUserButton] Found userCardManager directly on instance`);
        }
        // Try managers path
        else if (instance.managers && instance.managers.userCardManager) {
          userCardManager = instance.managers.userCardManager;
          console.log(`[EditUserButton] Found userCardManager in instance.managers`);
        }
        // Try handlers path
        else if (instance.handlers && instance.handlers.userCardManager) {
          userCardManager = instance.handlers.userCardManager;
          console.log(`[EditUserButton] Found userCardManager in instance.handlers`);
        }
      }
      
      if (!userCardManager) {
        console.error(`[EditUserButton] UserCardManager not found in instance`);
        await InteractionTracker.safeReply(interaction, {
          content: "❌ System error: User manager not available. Please contact support.",
          ephemeral: true
        });
        
        // Try to continue with basic functionality without user info
        console.log(`[EditUserButton] Continuing with default values`);
      }
      
      // Get user info if possible
      let username = 'Unknown User';
      if (userCardManager && typeof userCardManager.getUserInfo === 'function') {
        const userInfo = userCardManager.getUserInfo(phoneNumber);
        if (userInfo && userInfo.username) {
          username = userInfo.username;
        }
      }
      
      // Find the embed message in pinned messages
      let currentNotes = 'No notes provided yet.';
      try {
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        const embedMessage = pinnedMessages.find(
          m => m.embeds.length > 0 && 
          m.embeds[0].title === 'Ticket Tool'
        );
        
        if (embedMessage && embedMessage.embeds[0]) {
          // Extract notes from fields
          const notesField = embedMessage.embeds[0].fields.find(field => field.name === 'Notes');
          if (notesField && notesField.value) {
            // Strip the code block markers from the notes
            currentNotes = notesField.value.replace(/```/g, '').trim();
            if (currentNotes === 'No notes provided yet. Use the Edit button to add details.') {
              currentNotes = '';
            }
          }
        }
      } catch (error) {
        console.error(`[EditUserButton] Error fetching pinned messages:`, error);
      }
      
      // Create modal      
      const modal = new ModalBuilder()
        .setCustomId(`edit_ticket_modal_${phoneNumber}`)
        .setTitle('Edit Ticket Information');
      
      // Username input
      const usernameInput = new TextInputBuilder()
        .setCustomId('ticket_username')
        .setLabel('Username')
        .setStyle(TextInputStyle.Short)
        .setValue(username)
        .setRequired(true);
      
      // Notes input
      const notesInput = new TextInputBuilder()
        .setCustomId('ticket_notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentNotes)
        .setPlaceholder('Add notes about this support ticket here');
      
      const firstRow = new ActionRowBuilder().addComponents(usernameInput);
      const secondRow = new ActionRowBuilder().addComponents(notesInput);
      
      modal.addComponents(firstRow, secondRow);
      
      // Show the modal
      await interaction.showModal(modal);
      return true;
    } catch (error) {
      console.error(`[EditUserButton] Error handling edit user button:`, error);
      
      try {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error(`[EditUserButton] Error replying with error:`, replyError);
      }
      
      return false;
    }
  }
}

module.exports = new EditUserButton();