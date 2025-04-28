// modals/ticket/editTicketModal.js
const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');

/**
 * Modal handler for the ticket edit modal
 * FIXED: Removed InstanceManager dependency to prevent circular references
 */
class EditTicketModal extends Modal {
  constructor() {
    super({
      // This will match any edit_ticket_modal_* ID
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
      
      // Defer reply for longer processing
      await interaction.deferReply({ ephemeral: true });
      
      // Get values from the modal
      const username = interaction.fields.getTextInputValue('ticket_username');
      const notes = interaction.fields.getTextInputValue('ticket_notes') || '';
      
      console.log(`[EditTicketModal] New values - Username: ${username}, Notes length: ${notes.length}`);
      
      // Get instance if not provided
      if (!instance) {
        // Try to get instance from Discord client route map
        if (interaction.client._instanceRoutes) {
          const categoryId = interaction.channel.parentId;
          if (categoryId && interaction.client._instanceRoutes.has(categoryId)) {
            instance = interaction.client._instanceRoutes.get(categoryId).instance;
            console.log(`[EditTicketModal] Found instance from route map: ${instance?.instanceId || 'unknown'}`);
          } else {
            // Look through all routes to find matching guild
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                console.log(`[EditTicketModal] Found instance from guild ID match: ${instance?.instanceId || 'unknown'}`);
                break;
              }
            }
          }
        }
      }
      
      // Update user info if instance is available
      let userUpdateSuccess = false;
      if (instance) {
        // Try to find user card manager
        let userCardManager = null;
        
        // Try multiple paths to get userCardManager
        if (instance.userCardManager) {
          userCardManager = instance.userCardManager;
        } else if (instance.managers && instance.managers.userCardManager) {
          userCardManager = instance.managers.userCardManager;
        }
        
        // Update user info if userCardManager available
        if (userCardManager) {
          try {
            // Try using different method names since implementations vary
            if (typeof userCardManager.updateUserInfo === 'function') {
              await userCardManager.updateUserInfo(phoneNumber, username);
              userUpdateSuccess = true;
            } else if (typeof userCardManager.setUserInfo === 'function') {
              await userCardManager.setUserInfo(phoneNumber, username);
              userUpdateSuccess = true;
            } else {
              console.log(`[EditTicketModal] UserCardManager has no update methods available`);
            }
            
            if (userUpdateSuccess) {
              console.log(`[EditTicketModal] Updated user info for ${phoneNumber} to ${username}`);
            }
          } catch (updateError) {
            console.error(`[EditTicketModal] Error updating user info:`, updateError);
            // Continue anyway to update the embed
          }
        } else {
          console.log(`[EditTicketModal] No userCardManager available to update user info`);
        }
      }
      
      // Try to update the channel name if possible
      try {
        await this.updateChannelName(interaction, instance, phoneNumber, username);
      } catch (channelError) {
        console.error(`[EditTicketModal] Error updating channel name:`, channelError);
        // Continue anyway to update the embed
      }
      
      // Find the ticket embed message - try pinned messages first
      let embedMessage = null;
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
      let embedUpdateSuccess = false;
      if (embedMessage) {
        try {
          // Get current embed
          const currentEmbed = embedMessage.embeds[0];
          
          // Create updated embed with proper Discord.js v14 approach
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
            // We'll create a new embed as a last resort
          }
        }
      }
      
      // Create new embed message if update failed or no embed exists
      if (!embedMessage || !embedUpdateSuccess) {
        try {
          console.log(`[EditTicketModal] Creating new ticket embed message`);
          
          // FIXED: Use proper Discord.js v14 builder pattern
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
          
          // Save message ID to instance settings if possible
          if (instance) {
            try {
              // Try different approaches to save message ID
              if (instance.channelManager && typeof instance.channelManager.saveInstanceSettings === 'function') {
                await instance.channelManager.saveInstanceSettings(
                  instance.instanceId || interaction.guildId,
                  { 
                    ticketInfoMessages: {
                      ...(instance.customSettings?.ticketInfoMessages || {}),
                      [interaction.channelId]: message.id
                    }
                  }
                );
                console.log(`[EditTicketModal] Saved ticket info message ID to instance settings`);
              }
            } catch (saveError) {
              console.error(`[EditTicketModal] Error saving message ID:`, saveError);
            }
          }
        } catch (createError) {
          console.error(`[EditTicketModal] Error creating ticket info:`, createError);
          
          // Send an error message if we failed to update or create the embed
          if (!embedUpdateSuccess) {
            await interaction.editReply({ 
              content: `⚠️ Partially updated ticket information. User info was ${userUpdateSuccess ? 'updated' : 'not updated'}, but could not update ticket display.` 
            });
            return;
          }
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
  
  /**
   * Attempt to update the channel name with the new username
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} instance - Server instance
   * @param {string} phoneNumber - Phone number
   * @param {string} newUsername - New username
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