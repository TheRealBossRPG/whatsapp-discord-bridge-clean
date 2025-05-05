// modals/ticket/editTicketModal.js
const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');

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
      
      // Get instance without using InstanceManager
      if (!instance) {
        console.log(`[EditTicketModal] Finding instance for guild ${interaction.guildId}`);
        
        // First check client route map
        if (interaction.client._instanceRoutes) {
          // Try by category ID
          if (interaction.channel && interaction.channel.parentId) {
            const categoryId = interaction.channel.parentId;
            if (interaction.client._instanceRoutes.has(categoryId)) {
              instance = interaction.client._instanceRoutes.get(categoryId).instance;
              console.log(`[EditTicketModal] Found instance by category: ${instance?.instanceId || 'unknown'}`);
            }
          }
          
          // If not found by category, try guild ID
          if (!instance) {
            for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
              if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
                instance = routeInfo.instance;
                console.log(`[EditTicketModal] Found instance by guild: ${instance?.instanceId || 'unknown'}`);
                break;
              }
            }
          }
        }
        
        // If still no instance, try reading config directly
        if (!instance) {
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
                  console.log(`[EditTicketModal] Created instance from config: ${instanceId}`);
                  break;
                }
              }
            }
          } catch (configError) {
            console.error(`[EditTicketModal] Error loading config:`, configError);
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
        // Continue anyway
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
            // We'll create a new embed as a last resort
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
}

module.exports = new EditTicketModal();