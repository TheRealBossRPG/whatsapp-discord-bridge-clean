const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../templates/Button');
const InstanceManager = require('../../core/InstanceManager');
const InteractionTracker = require('../../utils/InteractionTracker');

class EditUserButton extends Button {
  constructor() {
    super({
      customId: 'edit-user',
      regex: /^edit-user-(.+)$/
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[EditUserButton] Processing edit button interaction: ${interaction.customId}`);
      
      // Extract phone number from button ID
      const phoneNumber = interaction.customId.replace('edit-user-', '');
      console.log(`[EditUserButton] Phone number from button: ${phoneNumber}`);
      
      // Get instance if not provided
      if (!instance) {
        console.log(`[EditUserButton] No instance provided, retrieving from InstanceManager`);
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
        
        if (!instance) {
          console.error(`[EditUserButton] Failed to retrieve instance for guild ${interaction.guild.id}`);
          await interaction.reply({
            content: '❌ System error: Could not find WhatsApp bridge instance for this server. Please try again or contact an administrator.',
            ephemeral: true
          });
          return false;
        }
      }
      
      // Log instance details
      console.log(`[EditUserButton] Using instance with ID: ${instance.instanceId || 'unknown'}`);
      console.log(`[EditUserButton] Instance has userCardManager: ${instance.userCardManager ? 'Yes' : 'No'}`);
      if (instance.managers) {
        console.log(`[EditUserButton] Instance has managers.userCardManager: ${instance.managers?.userCardManager ? 'Yes' : 'No'}`);
      }
      
      // Try to find user info through multiple paths
      let username = 'Unknown User';
      let userCardManager = null;
      
      // Try multiple paths to find userCardManager
      if (instance.userCardManager) {
        userCardManager = instance.userCardManager;
      } else if (instance.managers && instance.managers.userCardManager) {
        userCardManager = instance.managers.userCardManager;
      }
      
      // Try to get user info if userCardManager is available
      if (userCardManager && typeof userCardManager.getUserInfo === 'function') {
        try {
          const userInfo = userCardManager.getUserInfo(phoneNumber);
          if (userInfo && userInfo.username) {
            username = userInfo.username;
            console.log(`[EditUserButton] Found username: ${username}`);
          } else {
            console.log(`[EditUserButton] No username found for phone number: ${phoneNumber}`);
          }
        } catch (userInfoError) {
          console.error(`[EditUserButton] Error getting user info:`, userInfoError);
          // Continue with default username
        }
      } else {
        console.log(`[EditUserButton] UserCardManager not available or missing getUserInfo method`);
      }
      
      // Find the embed message for current notes - try pinned messages first
      let currentNotes = '';
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
          console.log(`[EditUserButton] Found existing notes from embed`);
        } else {
          console.log(`[EditUserButton] No pinned ticket embed found`);
          
          // Try looking in recent messages if pinned message not found
          try {
            console.log(`[EditUserButton] Looking for embed in recent messages`);
            const messages = await interaction.channel.messages.fetch({ limit: 20 });
            const recentEmbed = messages.find(
              m => m.embeds.length > 0 && 
              m.embeds[0].title === 'Ticket Tool'
            );
            
            if (recentEmbed && recentEmbed.embeds[0]) {
              const notesField = recentEmbed.embeds[0].fields.find(field => field.name === 'Notes');
              if (notesField && notesField.value) {
                currentNotes = notesField.value.replace(/```/g, '').trim();
                if (currentNotes === 'No notes provided yet. Use the Edit button to add details.') {
                  currentNotes = '';
                }
                console.log(`[EditUserButton] Found notes in recent message`);
              }
            }
          } catch (recentError) {
            console.error(`[EditUserButton] Error checking recent messages:`, recentError);
          }
        }
      } catch (error) {
        console.error(`[EditUserButton] Error fetching pinned messages:`, error);
        // Continue with empty notes
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
      
      // Notes input - IMPORTANT: Make this NOT required
      const notesInput = new TextInputBuilder()
        .setCustomId('ticket_notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentNotes)
        .setRequired(false) // Make notes optional
        .setPlaceholder('Add notes about this support ticket here (optional)');
      
      const firstRow = new ActionRowBuilder().addComponents(usernameInput);
      const secondRow = new ActionRowBuilder().addComponents(notesInput);
      
      modal.addComponents(firstRow, secondRow);
      
      // Show the modal
      console.log(`[EditUserButton] Showing edit modal for phone number: ${phoneNumber}`);
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