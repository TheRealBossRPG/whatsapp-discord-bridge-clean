// modals/ticket/editTicketModal.js - Complete rewrite for proper username persistence

const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');
const fs = require('fs');
const path = require('path');

class EditTicketModal extends Modal {
  constructor() {
    super({
      regex: /^edit_ticket_modal_\d+/
    });
  }
  
  matches(customId) {
    return customId.startsWith('edit_ticket_modal_');
  }
  
  async execute(interaction, instance) {
    try {
      // Extract phone number from the custom ID
      const phoneNumber = interaction.customId.replace('edit_ticket_modal_', '');
      console.log(`[EditTicketModal] Processing edit for phone number: ${phoneNumber}`);
      
      // Defer reply to give us time to process
      await interaction.deferReply({ ephemeral: true });
      
      // Get values from the modal
      const username = interaction.fields.getTextInputValue('ticket_username');
      const notes = interaction.fields.getTextInputValue('ticket_notes') || '';
      
      console.log(`[EditTicketModal] New values - Username: ${username}, Notes length: ${notes.length}`);
      
      // Get instance if not provided (from interactionHandler)
      if (!instance) {
        // We'll try to work with minimal info even without a proper instance
        console.log(`[EditTicketModal] No instance provided, creating minimal instance context`);
        instance = {
          instanceId: interaction.guildId,
          guildId: interaction.guildId,
          isTemporary: true
        };
      }
      
      // Update user info - CRITICAL FOR PERSISTENCE
      let userUpdateSuccess = false;
      
      // APPROACH 1: Try to update through UserCardManager if available
      let userCardManager = null;
      if (instance.userCardManager) {
        userCardManager = instance.userCardManager;
      } else if (instance.managers && instance.managers.userCardManager) {
        userCardManager = instance.managers.userCardManager;
      }
      
      if (userCardManager) {
        try {
          // Try both methods for compatibility
          if (typeof userCardManager.updateUserInfo === 'function') {
            await userCardManager.updateUserInfo(phoneNumber, username);
            userUpdateSuccess = true;
            console.log(`[EditTicketModal] Updated user info using updateUserInfo`);
          } else if (typeof userCardManager.setUserInfo === 'function') {
            await userCardManager.setUserInfo(phoneNumber, username);
            userUpdateSuccess = true;
            console.log(`[EditTicketModal] Updated user info using setUserInfo`);
          }
          
          // Force saving if method exists
          if (typeof userCardManager.saveUserCards === 'function') {
            await userCardManager.saveUserCards();
            console.log(`[EditTicketModal] Explicitly saved user cards`);
          }
        } catch (userManagerError) {
          console.error(`[EditTicketModal] Error using UserCardManager:`, userManagerError);
        }
      }
      
      // APPROACH 2: Direct file update as backup (ensures persistence)
      if (!userUpdateSuccess) {
        try {
          // Determine the instance directory
          const instanceId = instance.instanceId || interaction.guildId;
          const instanceDir = path.join(__dirname, '..', '..', 'instances', instanceId);
          
          // Create user data directory if it doesn't exist
          const userDataDir = path.join(instanceDir, 'user_data');
          if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
          }
          
          // Path to user cards file
          const userCardsPath = path.join(userDataDir, 'user_cards.json');
          
          // Read existing user cards if available
          let userCards = {};
          if (fs.existsSync(userCardsPath)) {
            try {
              userCards = JSON.parse(fs.readFileSync(userCardsPath, 'utf8'));
            } catch (readError) {
              console.error(`[EditTicketModal] Error reading user cards file:`, readError);
            }
          }
          
          // Clean the phone number
          const cleanPhone = phoneNumber.replace(/\D/g, '');
          
          // Update user info
          userCards[cleanPhone] = {
            ...(userCards[cleanPhone] || {}),
            username: username,
            lastUpdated: new Date().toISOString()
          };
          
          // Write back to file
          fs.writeFileSync(userCardsPath, JSON.stringify(userCards, null, 2), 'utf8');
          
          userUpdateSuccess = true;
          console.log(`[EditTicketModal] Updated user info directly in file: ${userCardsPath}`);
        } catch (fileError) {
          console.error(`[EditTicketModal] Error updating user info directly in file:`, fileError);
        }
      }
      
      // APPROACH 3: If WhatsApp client available, update contacts there too
      try {
        if (instance.clients && instance.clients.whatsAppClient) {
          const client = instance.clients.whatsAppClient;
          
          // Different clients store contacts differently, try multiple approaches
          // 1. Direct contacts object (most common)
          if (client.contacts) {
            const jid = `${phoneNumber}@s.whatsapp.net`;
            if (client.contacts[jid]) {
              client.contacts[jid].name = username;
              client.contacts[jid].notify = username;
              console.log(`[EditTicketModal] Updated name in WhatsApp contacts`);
            }
          }
          
          // 2. Using sock.updateProfileName (for @whiskeysockets/baileys)
          if (client.sock && typeof client.sock.updateProfileName === 'function') {
            client.sock.updateProfileName(phoneNumber, username);
            console.log(`[EditTicketModal] Updated name using sock.updateProfileName`);
          }
          
          // 3. Using client's updateContact method if available
          if (typeof client.updateContact === 'function') {
            await client.updateContact(phoneNumber, username);
            console.log(`[EditTicketModal] Updated contact using updateContact`);
          }
        }
      } catch (whatsappError) {
        console.error(`[EditTicketModal] Error updating WhatsApp client:`, whatsappError);
      }
      
      // Update channel name to match the new username
      try {
        // Format new channel name
        const formattedUsername = username
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .substring(0, 25);
        
        const newChannelName = `📋-${formattedUsername}`;
        
        // Get current channel
        const channel = interaction.channel;
        
        // Check if name needs to change
        if (channel.name !== newChannelName) {
          // Check permissions
          const botMember = interaction.guild.members.me;
          if (channel.permissionsFor(botMember).has('ManageChannels')) {
            await channel.setName(newChannelName, "Updated username");
            console.log(`[EditTicketModal] Updated channel name to ${newChannelName}`);
          }
        }
      } catch (channelError) {
        console.error(`[EditTicketModal] Error updating channel name:`, channelError);
      }
      
      // Find the ticket embed message - try pinned messages first
      let embedMessage = null;
      let embedUpdateSuccess = false;
      
      try {
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        embedMessage = pinnedMessages.find(
          m => m.embeds.length > 0 && 
          m.embeds[0].title === 'Ticket Tool'
        );
        
        if (embedMessage) {
          console.log(`[EditTicketModal] Found embed in pinned messages`);
        } else {
          // Try recent messages if not found in pinned
          const recentMessages = await interaction.channel.messages.fetch({ limit: 50 });
          embedMessage = recentMessages.find(
            m => m.embeds.length > 0 && 
            m.embeds[0].title === 'Ticket Tool'
          );
          
          if (embedMessage) {
            console.log(`[EditTicketModal] Found embed in recent messages`);
          }
        }
      } catch (error) {
        console.error(`[EditTicketModal] Error finding embed message:`, error);
      }
      
      // Update or create embed message
      if (embedMessage) {
        try {
          // Get current embed
          const currentEmbed = embedMessage.embeds[0];
          
          // Create updated embed
          const updatedEmbed = new EmbedBuilder()
            .setColor(currentEmbed.color || 0x00AE86)
            .setTitle(currentEmbed.title || 'Ticket Tool')
            .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``);
          
          // Add opened ticket field
          let openedTicketValue = new Date().toLocaleString();
          
          // Try to preserve the original opened date if available
          if (currentEmbed.fields && currentEmbed.fields.length > 0) {
            const openedField = currentEmbed.fields.find(f => f.name === 'Opened Ticket');
            if (openedField) {
              openedTicketValue = openedField.value;
            }
          }
          
          updatedEmbed.addFields([
            {
              name: 'Opened Ticket',
              value: openedTicketValue,
              inline: false
            },
            {
              name: 'Notes',
              value: `\`\`\`${notes || 'No notes provided.'}\`\`\``,
              inline: false
            }
          ]);
          
          // Set timestamp
          updatedEmbed.setTimestamp();
          
          // Store components to reuse
          const components = embedMessage.components || [];
          
          // Update the message
          await embedMessage.edit({ 
            embeds: [updatedEmbed],
            components: components
          });
          
          console.log(`[EditTicketModal] Updated ticket embed message`);
          embedUpdateSuccess = true;
        } catch (editError) {
          console.error(`[EditTicketModal] Error updating embed:`, editError);
          
          // Try a simpler approach if the first attempt failed
          try {
            console.log(`[EditTicketModal] Trying simplified embed update approach`);
            
            // Simple embed object approach
            const simpleEmbed = {
              color: 0x00AE86,
              title: 'Ticket Tool',
              description: `\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``,
              fields: [
                {
                  name: 'Opened Ticket',
                  value: new Date().toLocaleString(),
                  inline: false
                },
                {
                  name: 'Notes',
                  value: `\`\`\`${notes || 'No notes provided.'}\`\`\``,
                  inline: false
                }
              ],
              timestamp: new Date().toISOString()
            };
            
            await embedMessage.edit({ 
              embeds: [simpleEmbed],
              components: embedMessage.components || []
            });
            
            console.log(`[EditTicketModal] Updated ticket embed with simplified approach`);
            embedUpdateSuccess = true;
          } catch (simplifiedError) {
            console.error(`[EditTicketModal] Error with simplified embed update:`, simplifiedError);
          }
        }
      }
      
      // Create new embed message if update failed or no embed exists
      if (!embedMessage || !embedUpdateSuccess) {
        try {
          console.log(`[EditTicketModal] Creating new ticket embed message`);
          
          const newEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('Ticket Tool')
            .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``)
            .addFields([
              {
                name: 'Opened Ticket',
                value: new Date().toLocaleString(),
                inline: false
              },
              {
                name: 'Notes',
                value: `\`\`\`${notes || 'No notes provided.'}\`\`\``,
                inline: false
              }
            ])
            .setTimestamp();
          
          // Create edit and close buttons
          const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`edit-user-${phoneNumber}`)
              .setLabel("Edit")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`close`)
              .setLabel("Close")
              .setStyle(ButtonStyle.Danger)
          );
          
          const message = await interaction.channel.send({ 
            embeds: [newEmbed],
            components: [row]
          });
          
          await message.pin().catch(pinError => {
            console.error(`[EditTicketModal] Error pinning message:`, pinError);
          });
          
          console.log(`[EditTicketModal] Created new ticket embed message`);
          embedUpdateSuccess = true;
        } catch (createError) {
          console.error(`[EditTicketModal] Error creating ticket info:`, createError);
        }
      }
      
      // Send success message
      await interaction.editReply({ 
        content: `✅ Ticket information updated successfully!${userUpdateSuccess ? '' : '\n\n⚠️ Note: User info could not be updated in the system, but the ticket display has been updated.'}` 
      });
      
      return true;
    } catch (error) {
      console.error(`[EditTicketModal] Unhandled error:`, error);
      
      try {
        if (interaction.deferred) {
          await interaction.editReply({ 
            content: `❌ Error updating ticket information: ${error.message}` 
          });
        } else if (!interaction.replied) {
          await interaction.reply({ 
            content: `❌ Error updating ticket information: ${error.message}`, 
            ephemeral: true 
          });
        }
      } catch (replyError) {
        console.error(`[EditTicketModal] Error sending error reply:`, replyError);
      }
      
      return false;
    }
  }
}

module.exports = new EditTicketModal();