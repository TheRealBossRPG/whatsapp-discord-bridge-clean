// buttons/ticket/editUser.js

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../../templates/Button');

class EditUserButton extends Button {
  constructor() {
    super({
      regex: /^edit-user-(.+)$/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit-user-');
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[EditUserButton] Processing edit button interaction: ${interaction.customId}`);
      
      // Extract phone number from button ID
      const phoneNumber = interaction.customId.replace('edit-user-', '');
      console.log(`[EditUserButton] Phone number from button: ${phoneNumber}`);
      
      // Get instance if not provided - FIXED: Avoid circular dependency completely
      if (!instance) {
        console.log(`[EditUserButton] Instance not provided, getting from route map`);
        
        // Look directly in route map without using InstanceManager
        if (interaction.client._instanceRoutes) {
          // First try by channel's parent category
          const categoryId = interaction.channel.parentId;
          console.log(`[EditUserButton] Channel parent ID: ${categoryId}`);
          
          if (categoryId && interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[EditUserButton] Found instance via category: ${instance?.instanceId || 'unknown'}`);
          } else {
            // If no direct match, look for any instance with this guild ID
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                console.log(`[EditUserButton] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
                break;
              }
            }
          }
        }
        
        if (!instance) {
          // As a last resort, try to read config file directly
          try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, '..', '..', 'instance_configs.json');
            
            if (fs.existsSync(configPath)) {
              const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              
              // Find config for this guild
              for (const [instanceId, config] of Object.entries(configs)) {
                if (config.guildId === interaction.guildId) {
                  // Create a minimal instance object
                  instance = {
                    instanceId,
                    guildId: interaction.guildId,
                    categoryId: config.categoryId,
                    transcriptChannelId: config.transcriptChannelId,
                    vouchChannelId: config.vouchChannelId,
                    customSettings: config.customSettings || {},
                    isTemporary: true
                  };
                  console.log(`[EditUserButton] Created instance from config: ${instanceId}`);
                  break;
                }
              }
            }
          } catch (configError) {
            console.error(`[EditUserButton] Error loading config:`, configError);
          }
        }
      }
      
      // Log instance details
      if (instance) {
        console.log(`[EditUserButton] Using instance with ID: ${instance.instanceId || 'unknown'}`);
        console.log(`[EditUserButton] Instance has userCardManager: ${!!instance.userCardManager}`);
        if (instance.managers) {
          console.log(`[EditUserButton] Instance has managers.userCardManager: ${!!instance.managers?.userCardManager}`);
        }
      } else {
        console.log(`[EditUserButton] No instance found, continuing with defaults`);
      }
      
      // Try to find user info through multiple paths
      let username = 'Unknown User';
      let userCardManager = null;
      
      // Find userCardManager from all possible paths
      if (instance) {
        if (instance.userCardManager) {
          userCardManager = instance.userCardManager;
          console.log(`[EditUserButton] Found userCardManager directly on instance`);
        } else if (instance.managers && instance.managers.userCardManager) {
          userCardManager = instance.managers.userCardManager;
          console.log(`[EditUserButton] Found userCardManager in instance.managers`);
        } else if (instance.handlers && instance.handlers.userCardHandler) {
          userCardManager = instance.handlers.userCardHandler;
          console.log(`[EditUserButton] Found userCardHandler in instance.handlers`);
        }
      }
      
      // Try to get user info if userCardManager is available
      if (userCardManager && typeof userCardManager.getUserInfo === 'function') {
        try {
          const userInfo = await userCardManager.getUserInfo(phoneNumber);
          if (userInfo) {
            if (typeof userInfo === 'string') {
              username = userInfo;
            } else if (userInfo.username) {
              username = userInfo.username;
            } else if (userInfo.name) {
              username = userInfo.name;
            }
            console.log(`[EditUserButton] Found username: ${username}`);
          }
        } catch (userInfoError) {
          console.error(`[EditUserButton] Error getting user info:`, userInfoError);
          // Continue with default username
        }
      } else {
        console.log(`[EditUserButton] No userCardManager available or missing getUserInfo method`);
      }
      
      // Find the ticket embed message for current notes
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
          console.log(`[EditUserButton] No pinned ticket embed found, checking recent messages`);
          
          // Look in recent messages as fallback
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
          } else {
            console.log(`[EditUserButton] No embed found with notes`);
          }
        }
      } catch (error) {
        console.error(`[EditUserButton] Error fetching messages:`, error);
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
      
      // Notes input - NOT required
      const notesInput = new TextInputBuilder()
        .setCustomId('ticket_notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentNotes)
        .setRequired(false)
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
        // FIXED: Use flags instead of ephemeral directly
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