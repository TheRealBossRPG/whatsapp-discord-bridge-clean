const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');
const InstanceManager = require('../../core/InstanceManager');

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
      console.log(`[EditTicketModal] Instance available: ${instance ? "Yes" : "No"}`);
      if (instance) {
        console.log(`[EditTicketModal] Instance ID: ${instance.instanceId}`);
        console.log(`[EditTicketModal] Has channelManager: ${instance.channelManager ? "Yes" : "No"}`);
        if (instance.managers) {
          console.log(`[EditTicketModal] Has managers.channelManager: ${instance.managers.channelManager ? "Yes" : "No"}`);
        }
      }
      
      // Handle username update if we can
      let usernameUpdated = false;
      if (instance && newUsername) {
        try {
          // Find user manager
          let userCardManager = null;
          if (instance.userCardManager) {
            userCardManager = instance.userCardManager;
          } else if (instance.managers && instance.managers.userCardManager) {
            userCardManager = instance.managers.userCardManager;
          }
          
          if (userCardManager && typeof userCardManager.setUserInfo === 'function') {
            await userCardManager.setUserInfo(phoneNumber, newUsername);
            usernameUpdated = true;
            console.log(`[EditTicketModal] Username updated to: ${newUsername}`);
          }
        } catch (userError) {
          console.error(`[EditTicketModal] Error updating user:`, userError);
          // Continue anyway
        }
        
        // Now try to update the channel name - more robust approach
        await this.updateChannelName(interaction, instance, phoneNumber, newUsername);
      }
      
      // Look for pinned ticket embed
      let embedMessage = null;
      try {
        const pinnedMessages = await interaction.channel.messages.fetchPinned();
        for (const [id, message] of pinnedMessages) {
          if (message.embeds && message.embeds.length > 0 && 
              message.embeds[0].title === 'Ticket Tool') {
            embedMessage = message;
            break;
          }
        }
      } catch (pinnedError) {
        console.error(`[EditTicketModal] Error fetching pinned messages:`, pinnedError);
      }
      
      // If not found, try last 50 messages
      if (!embedMessage) {
        try {
          const messages = await interaction.channel.messages.fetch({ limit: 50 });
          for (const [id, message] of messages) {
            if (message.embeds && message.embeds.length > 0 && 
                message.embeds[0].title === 'Ticket Tool') {
              embedMessage = message;
              break;
            }
          }
        } catch (messagesError) {
          console.error(`[EditTicketModal] Error fetching messages:`, messagesError);
        }
      }
      
      // Update the embed if found using a more direct approach
      if (embedMessage) {
        try {
          // Build completely new, simplified embed
          const embed = new EmbedBuilder()
            .setColor(0x00AE86)
            .setTitle('Ticket Tool')
            .setDescription(`\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``)
            .addFields(
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
            )
            .setTimestamp(embedMessage.embeds[0].timestamp);
          
          // Update message with the new embed, preserving components
          await embedMessage.edit({ 
            embeds: [embed],
            components: embedMessage.components
          });
          
          // Success!
          await interaction.editReply({
            content: `✅ Ticket information updated successfully!`,
            ephemeral: true
          });
          
          return true;
        } catch (embedError) {
          console.error(`[EditTicketModal] Error updating embed:`, embedError);
          throw new Error(`Could not update ticket info: ${embedError.message}`);
        }
      } else {
        // No embed found
        throw new Error('Could not find the ticket information message to update');
      }
    } catch (error) {
      console.error(`[EditTicketModal] Error in modal handler:`, error);
      
      // Always ensure we reply
      try {
        if (interaction.deferred) {
          await interaction.editReply({
            content: `❌ Error: ${error.message}`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: `❌ Error: ${error.message}`,
            ephemeral: true
          });
        }
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
        let channelManager = null;
        if (instance.channelManager) {
          channelManager = instance.channelManager;
        } else if (instance.managers && instance.managers.channelManager) {
          channelManager = instance.managers.channelManager;
        }
        
        if (channelManager && typeof channelManager.mapUserToChannel === 'function') {
          await channelManager.mapUserToChannel(phoneNumber, currentChannelId, newUsername);
          console.log(`[UpdateChannelName] Updated channel mapping in channel manager`);
        }
      } catch (mappingError) {
        console.error(`[UpdateChannelName] Error updating channel mapping:`, mappingError);
      }
    } catch (error) {
      console.error(`[UpdateChannelName] Channel rename failed:`, error);
    }
  }
}

module.exports = new EditTicketModal();