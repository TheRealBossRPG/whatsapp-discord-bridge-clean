const { EmbedBuilder } = require('discord.js');
const Modal = require('../../templates/Modal');
const InteractionTracker = require('../../utils/InteractionTracker');
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
      await InteractionTracker.safeDefer(interaction, { ephemeral: true });
      
      // Extract phone number from modal ID
      const phoneNumber = interaction.customId.replace('edit_ticket_modal_', '');
      
      // Get updated data
      const newUsername = interaction.fields.getTextInputValue('ticket_username');
      const newNotes = interaction.fields.getTextInputValue('ticket_notes') || 'No notes provided.';
      
      // Get instance if not provided
      if (!instance) {
        instance = InstanceManager.getInstanceByGuildId(interaction.guild.id);
        console.log(`[EditTicketModal] Got instance from manager:`, instance?.instanceId || 'Not found');
      }
      
      // IMPROVED: More robust instance checking
      console.log(`[EditTicketModal] Instance structure:`, 
        instance ? 
        Object.keys(instance).join(', ') : 
        'Instance is null or undefined');
      
      if (!instance) {
        await InteractionTracker.safeEdit(interaction, {
          content: "❌ System error: Instance not available.",
        });
        return false;
      }
      
      // Try multiple paths to find the necessary managers
      let userCardManager = null;
      let channelManager = null;
      
      if (instance) {
        // Try direct paths
        if (instance.userCardManager) {
          userCardManager = instance.userCardManager;
          console.log(`[EditTicketModal] Found userCardManager directly on instance`);
        } 
        else if (instance.managers && instance.managers.userCardManager) {
          userCardManager = instance.managers.userCardManager;
          console.log(`[EditTicketModal] Found userCardManager in instance.managers`);
        }
        
        if (instance.channelManager) {
          channelManager = instance.channelManager;
          console.log(`[EditTicketModal] Found channelManager directly on instance`);
        }
        else if (instance.managers && instance.managers.channelManager) {
          channelManager = instance.managers.channelManager;
          console.log(`[EditTicketModal] Found channelManager in instance.managers`);
        }
      }
      
      // Handle username change
      let usernameUpdated = false;
      if (newUsername && phoneNumber && userCardManager && typeof userCardManager.setUserInfo === 'function') {
        // Get old username
        let oldUsername = 'Unknown User';
        if (typeof userCardManager.getUserInfo === 'function') {
          const oldUserInfo = userCardManager.getUserInfo(phoneNumber);
          if (oldUserInfo && oldUserInfo.username) {
            oldUsername = oldUserInfo.username;
          }
        }
        
        if (oldUsername !== newUsername) {
          console.log(`[EditTicketModal] Updating username from "${oldUsername}" to "${newUsername}"`);
          await userCardManager.setUserInfo(phoneNumber, newUsername);
          usernameUpdated = true;
          
          // Update channel name if we have channelManager
          if (channelManager && typeof channelManager.getChannelId === 'function') {
            const channelId = channelManager.getChannelId(phoneNumber);
            if (channelId) {
              const channel = interaction.client.channels.cache.get(channelId);
              if (channel) {
                // Format new channel name
                const formattedUsername = newUsername.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 25);
                const newChannelName = `📋-${formattedUsername}`;
                
                if (channel.name !== newChannelName) {
                  console.log(`[EditTicketModal] Updating channel name to: ${newChannelName}`);
                  await channel.setName(newChannelName, 'Updated username');
                }
              }
            }
          }
        }
      } else {
        console.log(`[EditTicketModal] Unable to update username: UserCardManager not available or missing setUserInfo method`);
      }
      
      // Find the embed message using multiple strategies
      let embedMessage = null;
      const channelId = interaction.channelId;
      
      // First try: Load pinned messages (most efficient as ticket info is pinned)
      const pinnedMessages = await interaction.channel.messages.fetchPinned();
      embedMessage = pinnedMessages.find(m => 
        m.embeds.length > 0 && 
        m.embeds[0].title === 'Ticket Tool'
      );
      
      if (embedMessage) {
        console.log(`[EditTicketModal] Found ticket embed in pinned messages`);
      }
      
      // Second try: Check if we have stored the message ID in settings
      if (!embedMessage && instance.customSettings?.ticketInfoMessages) {
        const messageId = instance.customSettings.ticketInfoMessages[channelId];
        if (messageId) {
          try {
            embedMessage = await interaction.channel.messages.fetch(messageId);
            console.log(`[EditTicketModal] Found ticket embed using stored message ID`);
          } catch (fetchError) {
            console.error(`[EditTicketModal] Error fetching stored message:`, fetchError);
          }
        }
      }
      
      // Third try: Load more messages (fallback)
      if (!embedMessage) {
        console.log(`[EditTicketModal] Searching for ticket embed in channel history`);
        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        embedMessage = messages.find(
          m => m.embeds.length > 0 && 
          m.embeds[0].title === 'Ticket Tool'
        );
        
        if (embedMessage) {
          console.log(`[EditTicketModal] Found ticket embed in channel history`);
        }
      }
      
      // Update the embed if found
      if (embedMessage) {
        const originalEmbed = embedMessage.embeds[0];
        
        // Create updated embed with the exact format specified
        const updatedEmbed = new EmbedBuilder()
          .setColor(0x00AE86)
          .setTitle('Ticket Tool')
          .setDescription(`\`\`\`${newUsername}\`\`\` \`\`\`${phoneNumber}\`\`\``)
          .addFields(
            { name: 'Opened Ticket', value: `${new Date(embedMessage.createdTimestamp).toLocaleString()}`, inline: false },
            { 
              name: 'Notes',
              value: `\`\`\`${newNotes}\`\`\``,
              inline: false
            }
          )
          .setTimestamp(originalEmbed.timestamp);
        
        console.log(`[EditTicketModal] Updating embed with new information`);
        
        // Preserve the original button components
        await embedMessage.edit({
          embeds: [updatedEmbed],
          components: embedMessage.components
        });
        
        // Update the reply message
        let replyMessage = '✅ Ticket information updated successfully!';
        if (usernameUpdated) {
          replyMessage += '\n\nUsername has been updated, which might affect where conversation history is stored. If needed, staff can search both old and new usernames for transcripts.';
        }
        
        await InteractionTracker.safeEdit(interaction, {
          content: replyMessage,
        });
      } else {
        console.error(`[EditTicketModal] Could not find the ticket embed message`);
        await InteractionTracker.safeEdit(interaction, {
          content: '❌ Could not find ticket information message to update. Please try the following:\n' +
                   '1. Check if the ticket information message was deleted or unpinned\n' +
                   '2. Try closing this ticket and creating a new one\n' +
                   '3. Contact support if the issue persists',
        });
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`[EditTicketModal] Error handling edit ticket modal:`, error);
      
      await InteractionTracker.safeReply(interaction, {
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
      
      return false;
    }
  }
}

module.exports = new EditTicketModal();