// modals/ticket/editTicketModal.js
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
      
      // Find instance managers
      let userCardManager = null;
      let transcriptManager = null;
      let channelManager = null;
      
      if (instance) {
        if (instance.managers) {
          userCardManager = instance.managers.userCardManager;
          transcriptManager = instance.managers.transcriptManager;
          channelManager = instance.managers.channelManager;
        } else {
          userCardManager = instance.userCardManager;
          transcriptManager = instance.transcriptManager;
          channelManager = instance.channelManager;
        }
      }
      
      // Get old username first
      let oldUsername = 'Unknown User';
      if (userCardManager) {
        const userInfo = await userCardManager.getUserInfo(phoneNumber);
        if (userInfo) {
          if (typeof userInfo === 'string') {
            oldUsername = userInfo;
          } else if (userInfo.username) {
            oldUsername = userInfo.username;
          } else if (userInfo.name) {
            oldUsername = userInfo.name;
          }
        }
      }
      
      console.log(`[EditTicketModal] Old username: ${oldUsername}`);
      
      // Update user info in multiple places to ensure persistence
      let userUpdateSuccess = false;
      
      // 1. Update in UserCardManager first
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
        } catch (userManagerError) {
          console.error(`[EditTicketModal] Error using UserCardManager:`, userManagerError);
        }
      }
      
      // 2. Direct file update as backup (ensures persistence)
      if (!userUpdateSuccess) {
        try {
          // Determine the instance directory
          const instanceId = instance?.instanceId || interaction.guildId;
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
          
          // Update user info with current timestamp
          userCards[cleanPhone] = {
            ...(userCards[cleanPhone] || {}),
            username: username,
            lastUpdated: new Date().toISOString(),
            lastSeen: Date.now()
          };
          
          // Write back to file
          fs.writeFileSync(userCardsPath, JSON.stringify(userCards, null, 2), 'utf8');
          
          userUpdateSuccess = true;
          console.log(`[EditTicketModal] Updated user info directly in file: ${userCardsPath}`);
        } catch (fileError) {
          console.error(`[EditTicketModal] Error updating user info directly in file:`, fileError);
        }
      }
      
      // 3. Update WhatsApp client contacts if available
      try {
        if (instance.clients && instance.clients.whatsAppClient) {
          const client = instance.clients.whatsAppClient;
          
          // Different clients store contacts differently, try multiple approaches
          
          // Try updateContact method if available
          if (typeof client.updateContact === 'function') {
            await client.updateContact(phoneNumber, username);
            console.log(`[EditTicketModal] Updated contact using updateContact`);
          }
          
          // Try using sock.updateProfileName (for @whiskeysockets/baileys)
          if (client.sock && typeof client.sock.updateProfileName === 'function') {
            await client.sock.updateProfileName(phoneNumber, username);
            console.log(`[EditTicketModal] Updated name using sock.updateProfileName`);
          }
          
          // Try direct contacts object update (most common)
          if (client.contacts) {
            const jid = `${phoneNumber}@s.whatsapp.net`;
            if (client.contacts[jid]) {
              client.contacts[jid].name = username;
              client.contacts[jid].notify = username;
              console.log(`[EditTicketModal] Updated name in WhatsApp contacts`);
            }
          }
        }
      } catch (whatsappError) {
        console.error(`[EditTicketModal] Error updating WhatsApp client:`, whatsappError);
      }
      
      // 4. Update channel name to match the new username
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
      
      // 5. Update transcript folders if needed - IMPORTANT: Check if folders exist first
      if (transcriptManager && oldUsername !== username) {
        try {
          // Try direct method if available
          if (typeof transcriptManager.updateUsername === 'function') {
            await transcriptManager.updateUsername(phoneNumber, oldUsername, username);
          } else {
            // Determine folder paths manually
            const baseDir = transcriptManager.baseDir || 
                           path.join(__dirname, '..', '..', 'instances', instance?.instanceId || interaction.guildId, 'transcripts');
            
            // Try different possible folder name formats
            const possibleOldPaths = [
              path.join(baseDir, `${oldUsername} (${phoneNumber})`),
              path.join(baseDir, `${oldUsername}(${phoneNumber})`),
              path.join(baseDir, `${oldUsername}-${phoneNumber}`),
              path.join(baseDir, phoneNumber, oldUsername),
              path.join(baseDir, phoneNumber)
            ];
            
            const newPath = path.join(baseDir, `${username} (${phoneNumber})`);
            
            let foundPath = null;
            for (const oldPath of possibleOldPaths) {
              if (fs.existsSync(oldPath)) {
                foundPath = oldPath;
                console.log(`[EditTicketModal] Found existing transcript folder at ${oldPath}`);
                break;
              }
            }
            
            // Only try to rename if a folder was found
            if (foundPath) {
              // Create parent directory for new path if needed
              const parentDir = path.dirname(newPath);
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
              }
              
              // Rename the directory
              fs.renameSync(foundPath, newPath);
              console.log(`[EditTicketModal] Renamed directory from ${foundPath} to ${newPath}`);
            } else {
              console.log(`[EditTicketModal] No transcript folder found to rename for ${phoneNumber}`);
            }
          }
        } catch (transcriptError) {
          console.error(`[EditTicketModal] Error updating transcript folders:`, transcriptError);
        }
      }
      
      // 6. Update ticket embed message
      let embedUpdateSuccess = false;
      
      try {
        // Find pinned message with 'Ticket Tool' title
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        const ticketEmbed = pinnedMessages.find(m => 
          m.embeds.length > 0 && m.embeds[0].title === 'Ticket Tool'
        );
        
        if (ticketEmbed) {
          // Create new embed
          const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('Ticket Tool')
            .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``)
            .addFields([
              {
                name: 'Opened Ticket',
                value: ticketEmbed.embeds[0].fields.find(f => f.name === 'Opened Ticket')?.value || new Date().toLocaleString(),
                inline: false
              },
              {
                name: 'Notes',
                value: `\`\`\`${notes || 'No notes provided.'}\`\`\``,
                inline: false
              }
            ])
            .setTimestamp();
            
          // Update the message
          await ticketEmbed.edit({ 
            embeds: [embed],
            components: ticketEmbed.components
          });
          
          embedUpdateSuccess = true;
          console.log(`[EditTicketModal] Updated ticket embed message`);
        } else {
          // Try looking in recent messages as fallback
          const recentMessages = await interaction.channel.messages.fetch({ limit: 20 });
          const embedMessage = recentMessages.find(
            m => m.embeds.length > 0 && 
            m.embeds[0].title === 'Ticket Tool'
          );
          
          if (embedMessage) {
            // Create new embed
            const embed = new EmbedBuilder()
              .setColor(0x00AE86)
              .setTitle('Ticket Tool')
              .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``)
              .addFields([
                {
                  name: 'Opened Ticket',
                  value: embedMessage.embeds[0].fields.find(f => f.name === 'Opened Ticket')?.value || new Date().toLocaleString(),
                  inline: false
                },
                {
                  name: 'Notes',
                  value: `\`\`\`${notes || 'No notes provided.'}\`\`\``,
                  inline: false
                }
              ])
              .setTimestamp();
              
            // Update the message
            await embedMessage.edit({ 
              embeds: [embed],
              components: embedMessage.components
            });
            
            embedUpdateSuccess = true;
            console.log(`[EditTicketModal] Updated ticket embed message from recent messages`);
          } else {
            // Create new embed if not found anywhere
            const embed = new EmbedBuilder()
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
            
            // Send and pin the message
            const message = await interaction.channel.send({ 
              embeds: [embed],
              components: [row]
            });
            
            try {
              await message.pin();
            } catch (pinError) {
              console.error(`[EditTicketModal] Error pinning message:`, pinError);
            }
            
            embedUpdateSuccess = true;
            console.log(`[EditTicketModal] Created new ticket embed message`);
          }
        }
      } catch (embedError) {
        console.error(`[EditTicketModal] Error updating ticket embed:`, embedError);
      }
      
      // 7. Additional direct file update to enhance persistence
      try {
        // Try to update channel mapping file directly
        if (channelManager && typeof channelManager.getChannelMappingPath === 'function') {
          const mappingPath = channelManager.getChannelMappingPath();
          
          if (fs.existsSync(mappingPath)) {
            let channelMappings = {};
            try {
              channelMappings = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
              
              // Find the mapping for this phone number
              for (const [phone, channelInfo] of Object.entries(channelMappings)) {
                if (phone === phoneNumber || phone.includes(phoneNumber)) {
                  // Update username in the mapping
                  if (typeof channelInfo === 'object') {
                    channelInfo.username = username;
                  } else if (typeof channelInfo === 'string') {
                    // If it's just a string (channelId), convert to object with username
                    channelMappings[phone] = {
                      channelId: channelInfo,
                      username: username
                    };
                  }
                }
              }
              
              // Write back to file
              fs.writeFileSync(mappingPath, JSON.stringify(channelMappings, null, 2), 'utf8');
              console.log(`[EditTicketModal] Updated username in channel mapping file`);
            } catch (mappingError) {
              console.error(`[EditTicketModal] Error updating channel mapping:`, mappingError);
            }
          }
        }
      } catch (additionalError) {
        console.error(`[EditTicketModal] Error with additional file updates:`, additionalError);
      }
      
      // Send success message
      await interaction.editReply({ 
        content: `✅ Ticket information updated successfully!` +
                 `${userUpdateSuccess ? '' : '\n\n⚠️ Warning: User info might not be fully updated.'}` +
                 `${embedUpdateSuccess ? '' : '\n\n⚠️ Warning: Ticket display might not be fully updated.'}`
      });
      
      return true;
    } catch (error) {
      console.error(`[EditTicketModal] Error:`, error);
      
      try {
        await interaction.editReply({ 
          content: `❌ Error updating ticket information: ${error.message}` 
        });
      } catch (replyError) {
        console.error(`[EditTicketModal] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }
}

module.exports = new EditTicketModal();