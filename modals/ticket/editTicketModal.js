const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');
const InstanceManager = require('../../core/InstanceManager');
const InteractionTracker = require('../../utils/InteractionTracker');

class EditTicketModal extends Modal {
  constructor() {
    super({
      customId: 'edit_ticket_modal',
      regex: /^edit_ticket_modal_(.+)$/
    });
  }
  
  async execute(interaction, instance) {
    try {
      // Always defer reply first
      await interaction.deferReply({ ephemeral: true });
      
      // Extract phone number from modal ID
      const phoneNumber = interaction.customId.replace('edit_ticket_modal_', '');
      console.log(`[EditTicketModal] Processing update for phone: ${phoneNumber}`);
      
      // Get updated data from the form with safety checks
      let newUsername = '';
      let newNotes = 'No notes provided.';
      
      try {
        newUsername = interaction.fields.getTextInputValue('ticket_username');
      } catch (error) {
        console.error(`[EditTicketModal] Error getting username:`, error);
        newUsername = 'Unknown User';
      }
      
      try {
        const notesValue = interaction.fields.getTextInputValue('ticket_notes');
        if (notesValue && notesValue.trim() !== '') {
          newNotes = notesValue.trim();
        }
      } catch (error) {
        console.log(`[EditTicketModal] No notes provided or error:`, error);
        // Keep default notes
      }

      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
      }
      
      // Log instance availability for debugging
      if (!instance) {
        console.error(`[EditTicketModal] No instance found for guild ${interaction.guild.id}`);
        await interaction.editReply({
          content: "❌ System error: Could not find WhatsApp bridge instance for this server. Please try again or contact an administrator."
        });
        return false;
      }
      
      console.log(`[EditTicketModal] Instance ID: ${instance.instanceId}`);
      
      // Handle username update if we can
      let usernameUpdated = false;
      
      try {
        // Find user manager through multiple paths
        let userCardManager = null;
        
        // Try multiple paths to find userCardManager
        if (instance.userCardManager) {
          userCardManager = instance.userCardManager;
        } else if (instance.managers && instance.managers.userCardManager) {
          userCardManager = instance.managers.userCardManager;
        }
        
        if (userCardManager && typeof userCardManager.setUserInfo === 'function') {
          await userCardManager.setUserInfo(phoneNumber, newUsername);
          usernameUpdated = true;
          console.log(`[EditTicketModal] Username updated to: ${newUsername}`);
        } else {
          console.warn(`[EditTicketModal] UserCardManager not available or missing setUserInfo method`);
        }
      } catch (userError) {
        console.error(`[EditTicketModal] Error updating user:`, userError);
        // Continue anyway - we'll try to update the embed even if username update fails
      }
      
      // Try to update the channel name
      try {
        await this.updateChannelName(interaction, instance, phoneNumber, newUsername);
      } catch (channelError) {
        console.error(`[EditTicketModal] Error updating channel name:`, channelError);
        // Continue anyway - updating the embed is more important
      }

      // MULTIPLE STRATEGIES TO FIND THE EMBED MESSAGE:
      // Strategy 1: Check pinned messages
      let embedMessage = null;
      
      try {
        console.log(`[EditTicketModal] Looking for pinned ticket embed message...`);
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        
        for (const [id, msg] of pinnedMessages) {
          if (msg.embeds && msg.embeds.length > 0 && msg.embeds[0].title === 'Ticket Tool') {
            embedMessage = msg;
            console.log(`[EditTicketModal] Found ticket embed in pinned messages: ${id}`);
            break;
          }
        }
      } catch (pinnedError) {
        console.error(`[EditTicketModal] Error fetching pinned messages:`, pinnedError);
      }
      
      // Strategy 2: Check settings for stored message ID
      if (!embedMessage) {
        try {
          console.log(`[EditTicketModal] Looking for ticket embed using stored message ID...`);
          
          if (instance.customSettings && instance.customSettings.ticketInfoMessages) {
            const messageId = instance.customSettings.ticketInfoMessages[interaction.channel.id];
            
            if (messageId) {
              try {
                embedMessage = await interaction.channel.messages.fetch(messageId);
                console.log(`[EditTicketModal] Found ticket embed using stored ID: ${messageId}`);
              } catch (fetchError) {
                console.error(`[EditTicketModal] Error fetching stored message:`, fetchError);
              }
            }
          }
        } catch (settingsError) {
          console.error(`[EditTicketModal] Error checking settings:`, settingsError);
        }
      }
      
      // Strategy 3: Check recent messages
      if (!embedMessage) {
        try {
          console.log(`[EditTicketModal] Looking for ticket embed in recent messages...`);
          const messages = await interaction.channel.messages.fetch({ limit: 50 });
          
          for (const [id, msg] of messages) {
            if (msg.embeds && msg.embeds.length > 0 && msg.embeds[0].title === 'Ticket Tool') {
              embedMessage = msg;
              console.log(`[EditTicketModal] Found ticket embed in recent messages: ${id}`);
              break;
            }
          }
        } catch (messagesError) {
          console.error(`[EditTicketModal] Error fetching recent messages:`, messagesError);
        }
      }
      
      // If we found the embed message, update it using the safer method
      if (embedMessage) {
        try {
          console.log(`[EditTicketModal] Using safer update method...`);
          
          // Store the components for reuse
          const components = embedMessage.components || [];
          
          // Try a simplified edit approach
          try {
            // Create a simplified embed object instead of using EmbedBuilder
            const simpleEmbed = {
              title: 'Ticket Tool',
              description: `\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``,
              color: 0x00AE86,
              fields: [
                {
                  name: 'Opened Ticket',
                  value: new Date(embedMessage.createdTimestamp).toLocaleString(),
                  inline: false
                },
                {
                  name: 'Notes',
                  value: `\`\`\`${newNotes}\`\`\``,
                  inline: false
                }
              ],
              timestamp: new Date().toISOString()
            };
            
            await embedMessage.edit({
              embeds: [simpleEmbed],
              components: components
            });
            
            console.log(`[EditTicketModal] Ticket embed updated successfully!`);
          } catch (updateError) {
            console.error(`[EditTicketModal] First update attempt failed:`, updateError);
            
            // Try even simpler approach
            try {
              console.log(`[EditTicketModal] Trying minimal embed approach...`);
              
              // Create a very minimal embed
              const minimalEmbed = {
                title: 'Ticket Tool',
                description: `\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``,
                color: 0x00AE86
              };
              
              await embedMessage.edit({
                embeds: [minimalEmbed], 
                components: components
              });
              
              console.log(`[EditTicketModal] Basic embed updated successfully!`);
              
              // Now try to add the fields
              try {
                const fieldsEmbed = {
                  title: 'Ticket Tool',
                  description: `\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``,
                  color: 0x00AE86,
                  fields: [
                    {
                      name: 'Opened Ticket',
                      value: new Date(embedMessage.createdTimestamp).toLocaleString(),
                      inline: false
                    },
                    {
                      name: 'Notes',
                      value: `\`\`\`${newNotes}\`\`\``,
                      inline: false
                    }
                  ]
                };
                
                await embedMessage.edit({
                  embeds: [fieldsEmbed], 
                  components: components
                });
                
                console.log(`[EditTicketModal] Fields added to embed successfully!`);
              } catch (fieldsError) {
                console.warn(`[EditTicketModal] Could not add fields to embed:`, fieldsError);
                // Continue anyway, at least the basic info is updated
              }
            } catch (fallbackError) {
              console.error(`[EditTicketModal] Fallback update failed:`, fallbackError);
              
              // Last resort - create new message
              try {
                console.log(`[EditTicketModal] Creating new ticket embed message...`);
                
                const newEmbed = new EmbedBuilder()
                  .setColor(0x00AE86)
                  .setTitle('Ticket Tool')
                  .setDescription(`\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``)
                  .addFields(
                    { 
                      name: 'Opened Ticket', 
                      value: new Date().toLocaleString(),
                      inline: false 
                    },
                    { 
                      name: 'Notes', 
                      value: `\`\`\`${newNotes}\`\`\``, 
                      inline: false 
                    }
                  )
                  .setTimestamp();
                
                const newMessage = await interaction.channel.send({
                  embeds: [newEmbed],
                  components: components
                });
                
                // Try to pin the new message
                try {
                  await newMessage.pin();
                  console.log(`[EditTicketModal] New ticket embed pinned successfully!`);
                  
                  // Try to unpin the old one
                  try {
                    await embedMessage.unpin();
                  } catch (unpinError) {
                    console.warn(`[EditTicketModal] Could not unpin old embed:`, unpinError);
                  }
                } catch (pinError) {
                  console.warn(`[EditTicketModal] Could not pin new embed:`, pinError);
                }
                
                // Try to store the new message ID
                try {
                  if (instance.channelManager && typeof instance.channelManager.saveInstanceSettings === 'function') {
                    await instance.channelManager.saveInstanceSettings(instance.instanceId, {
                      ticketInfoMessages: {
                        ...(instance.customSettings?.ticketInfoMessages || {}),
                        [interaction.channel.id]: newMessage.id,
                      },
                    });
                  }
                } catch (saveError) {
                  console.error(`[EditTicketModal] Error saving new message ID:`, saveError);
                }
                
                console.log(`[EditTicketModal] Created new ticket message successfully!`);
              } catch (newMessageError) {
                console.error(`[EditTicketModal] Failed to create new message:`, newMessageError);
                throw new Error(`Could not update or create ticket info: ${newMessageError.message}`);
              }
            }
          }
          
          // Success message
          let replyMessage = '✅ Ticket information updated successfully!';
          
          if (usernameUpdated) {
            replyMessage += '\n\nUsername has been updated. This may affect where conversation history is stored.';
          }
          
          await interaction.editReply({
            content: replyMessage,
            ephemeral: true
          });
          
          return true;
        } catch (embedError) {
          console.error(`[EditTicketModal] Error updating embed:`, embedError);
          throw new Error(`Could not update ticket info: ${embedError.message}`);
        }
      } else {
        // No embed found - create one from scratch
        try {
          console.log(`[EditTicketModal] No existing embed found, creating a new one...`);
          
          const newEmbed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('Ticket Tool')
            .setDescription(`\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``)
            .addFields(
              { 
                name: 'Opened Ticket', 
                value: new Date().toLocaleString(),
                inline: false 
              },
              { 
                name: 'Notes', 
                value: `\`\`\`${newNotes}\`\`\``, 
                inline: false 
              }
            )
            .setTimestamp();
          
          // Create button row with edit and close buttons
          const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`edit-user-${phoneNumber}`)
              .setLabel("Edit")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`close-ticket-${interaction.channel.id}`)
              .setLabel("Close")
              .setStyle(ButtonStyle.Danger)
          );
          
          // Send as a new message
          const sentMessage = await interaction.channel.send({
            embeds: [newEmbed],
            components: [row]
          });
          
          // Pin the message
          await sentMessage.pin();
          
          // Try to store the message ID in settings
          try {
            if (instance.channelManager && typeof instance.channelManager.saveInstanceSettings === 'function') {
              console.log(`[EditTicketModal] Saving new message ID to settings...`);
              
              await instance.channelManager.saveInstanceSettings(instance.instanceId, {
                ticketInfoMessages: {
                  ...(instance.customSettings?.ticketInfoMessages || {}),
                  [interaction.channel.id]: sentMessage.id,
                },
              });
            }
          } catch (saveError) {
            console.error(`[EditTicketModal] Error saving message ID:`, saveError);
          }
          
          await interaction.editReply({
            content: '✅ Created new ticket information message!',
            ephemeral: true
          });
          
          return true;
        } catch (createError) {
          console.error(`[EditTicketModal] Error creating new embed:`, createError);
          throw new Error(`Could not create new ticket info: ${createError.message}`);
        }
      }
    } catch (error) {
      console.error(`[EditTicketModal] Error in modal handler:`, error);
      
      // Always ensure we reply
      try {
        await interaction.editReply({
          content: `❌ Error: Could not update ticket info: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error(`[EditTicketModal] Could not send error reply:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Dedicated function to update channel name with better error handling and logging
   */
  async updateChannelName(interaction, instance, phoneNumber, newUsername) {
    try {
      console.log(`[UpdateChannelName] Starting channel rename attempt`);
      
      // Try current channel first (most reliable)
      const currentChannelId = interaction.channelId;
      console.log(`[UpdateChannelName] Current channel ID: ${currentChannelId}`);
      
      // Format new channel name
      const formattedUsername = newUsername
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .substring(0, 25);
      const newChannelName = `📋-${formattedUsername}`;
      console.log(`[UpdateChannelName] New channel name would be: ${newChannelName}`);
      
      // Get current channel
      let channel = interaction.channel;
      console.log(`[UpdateChannelName] Current channel name: ${channel.name}`);
      
      // Check if name actually needs to change
      if (channel.name === newChannelName) {
        console.log(`[UpdateChannelName] Channel name already matches, no update needed`);
        return;
      }
      
      // Check if we have permission to update the channel
      const botMember = interaction.guild.members.me;
      const hasPermission = channel.permissionsFor(botMember).has('ManageChannels');
      console.log(`[UpdateChannelName] Bot has ManageChannels permission: ${hasPermission}`);
      
      if (!hasPermission) {
        console.log(`[UpdateChannelName] Cannot update channel name - missing permission`);
        return;
      }
      
      // Try to rename the channel
      console.log(`[UpdateChannelName] Attempting to rename to: ${newChannelName}`);
      await channel.setName(newChannelName, "Updated username");
      console.log(`[UpdateChannelName] Channel renamed successfully`);
      
      // Also update the channelManager mapping if available
      try {
        // Find channel manager through different paths
        let channelManager = null;
        
        if (instance.channelManager) {
          channelManager = instance.channelManager;
        } else if (instance.managers && instance.managers.channelManager) {
          channelManager = instance.managers.channelManager;
        }
        
        // Check if channelMap exists and initialize if needed
        if (channelManager) {
          // Ensure channelMap exists
          if (!channelManager.channelMap) {
            channelManager.channelMap = new Map();
          }
          
          // Use a safe version of mapUserToChannel
          if (typeof channelManager.mapUserToChannel === 'function') {
            // Make sure channelMap is a Map before trying to set a value
            if (!(channelManager.channelMap instanceof Map)) {
              channelManager.channelMap = new Map();
            }
            
            await channelManager.mapUserToChannel(phoneNumber, currentChannelId, newUsername);
            console.log(`[UpdateChannelName] Updated channel mapping in channel manager`);
          } else {
            console.log(`[UpdateChannelName] Could not find mapUserToChannel method`);
            
            // Direct update if method not available
            try {
              if (channelManager.channelMap instanceof Map) {
                const cleanPhone = phoneNumber.replace(/@.*$/, '');
                channelManager.channelMap.set(cleanPhone, currentChannelId);
                console.log(`[UpdateChannelName] Directly updated channelMap`);
              }
            } catch (directUpdateError) {
              console.error(`[UpdateChannelName] Error directly updating channel map:`, directUpdateError);
            }
          }
        } else {
          console.log(`[UpdateChannelName] No channelManager found on instance`);
        }
      } catch (mappingError) {
        console.error(`[UpdateChannelName] Error updating channel mapping:`, mappingError);
      }
    } catch (error) {
      console.error(`[UpdateChannelName] Channel rename failed:`, error);
      // Just log the error, don't throw - allow the modal to continue processing
    }
  }
}

module.exports = new EditTicketModal();