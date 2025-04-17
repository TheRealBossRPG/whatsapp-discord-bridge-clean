// utils/TicketUtil.js - Helper utilities for ticket operations
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Utility functions for ticket operations
 */
class TicketUtil {
  /**
   * Find the ticket info message in a channel
   * @param {Object} channel - Discord channel
   * @param {Object} instance - Server instance
   * @returns {Promise<Object|null>} - Message object or null if not found
   */
  static async findTicketInfoMessage(channel, instance) {
    try {
      let embedMessage = null;
      console.log(`[TicketUtil] Looking for ticket info message in channel ${channel.id}`);
      
      // Strategy 1: Check pinned messages (fastest and most reliable)
      try {
        const pinnedMessages = await channel.messages.fetchPinned();
        for (const [id, message] of pinnedMessages) {
          if (message.embeds && message.embeds.length > 0 && message.embeds[0].title === 'Ticket Tool') {
            console.log(`[TicketUtil] Found ticket info in pinned message: ${id}`);
            return message;
          }
        }
      } catch (pinnedError) {
        console.error(`[TicketUtil] Error fetching pinned messages:`, pinnedError);
      }
      
      // Strategy 2: Check if the message ID is stored in instance settings
      if (instance) {
        try {
          if (instance.customSettings && instance.customSettings.ticketInfoMessages) {
            const messageId = instance.customSettings.ticketInfoMessages[channel.id];
            
            if (messageId) {
              try {
                embedMessage = await channel.messages.fetch(messageId);
                if (embedMessage && embedMessage.embeds && embedMessage.embeds.length > 0) {
                  console.log(`[TicketUtil] Found ticket info using stored ID: ${messageId}`);
                  return embedMessage;
                }
              } catch (fetchError) {
                console.error(`[TicketUtil] Error fetching stored message ID:`, fetchError);
              }
            }
          }
        } catch (settingsError) {
          console.error(`[TicketUtil] Error checking instance settings:`, settingsError);
        }
      }
      
      // Strategy 3: Scan recent messages
      try {
        const messages = await channel.messages.fetch({ limit: 50 });
        for (const [id, message] of messages) {
          if (message.embeds && message.embeds.length > 0 && message.embeds[0].title === 'Ticket Tool') {
            console.log(`[TicketUtil] Found ticket info in recent messages: ${id}`);
            return message;
          }
        }
      } catch (messagesError) {
        console.error(`[TicketUtil] Error fetching recent messages:`, messagesError);
      }
      
      console.log(`[TicketUtil] No ticket info message found in channel ${channel.id}`);
      return null;
    } catch (error) {
      console.error(`[TicketUtil] Error finding ticket info message:`, error);
      return null;
    }
  }
  
  /**
   * Update ticket info embed message
   * @param {Object} message - Discord message to update
   * @param {string} username - User name
   * @param {string} phoneNumber - Phone number
   * @param {string} notes - Ticket notes
   * @returns {Promise<boolean>} - Success status
   */
  static async updateTicketInfoEmbed(message, username, phoneNumber, notes = '') {
    try {
      if (!message || !message.editable) {
        console.error(`[TicketUtil] Message is not editable or null`);
        return false;
      }
      
      // Format the notes with default if empty
      const displayNotes = notes && notes.trim() !== '' 
        ? notes.trim() 
        : 'No notes provided yet. Use the Edit button to add details.';
      
      // Create updated embed
      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('Ticket Tool')
        .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``)
        .addFields(
          {
            name: 'Opened Ticket',
            value: `${new Date(message.createdTimestamp).toLocaleString()}`,
            inline: false,
          },
          {
            name: 'Notes',
            value: `\`\`\`${displayNotes}\`\`\``,
            inline: false,
          }
        )
        .setTimestamp();
      
      // Preserve original timestamp if it exists
      if (message.embeds[0].timestamp) {
        embed.setTimestamp(message.embeds[0].timestamp);
      }
      
      // Ensure the edit button remains
      const existingComponents = message.components;
      let components = existingComponents;
      
      // If no components, create the default ones
      if (!existingComponents || existingComponents.length === 0) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`edit-user-${phoneNumber}`)
            .setLabel("Edit")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`close-ticket-${message.channel.id}`)
            .setLabel("Close")
            .setStyle(ButtonStyle.Danger)
        );
        components = [row];
      }
      
      // Update the message
      await message.edit({
        embeds: [embed],
        components: components
      });
      
      console.log(`[TicketUtil] Successfully updated ticket info embed`);
      return true;
    } catch (error) {
      console.error(`[TicketUtil] Error updating ticket info embed:`, error);
      return false;
    }
  }
  
  /**
   * Create new ticket info message if it doesn't exist
   * @param {Object} channel - Discord channel
   * @param {string} username - User name
   * @param {string} phoneNumber - Phone number
   * @param {Object} instance - Server instance (optional)
   * @returns {Promise<Object|null>} - Created message or null on failure
   */
  static async createTicketInfoMessage(channel, username, phoneNumber, instance = null) {
    try {
      // Format default notes
      const defaultNotes = 'No notes provided yet. Use the Edit button to add details.';
      
      // Create embed
      const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('Ticket Tool')
        .setDescription(`\`\`\`${username}\`\`\` \`\`\`${phoneNumber}\`\`\``)
        .addFields(
          {
            name: 'Opened Ticket',
            value: `${new Date().toLocaleString()}`,
            inline: false,
          },
          {
            name: 'Notes',
            value: `\`\`\`${defaultNotes}\`\`\``,
            inline: false,
          }
        )
        .setTimestamp();
      
      // Create button row
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit-user-${phoneNumber}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`close-ticket-${channel.id}`)
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
      );
      
      // Send the message
      const message = await channel.send({
        embeds: [embed],
        components: [row]
      });
      
      // Pin the message
      await message.pin();
      
      // Store message ID if instance is provided
      if (instance && message.id) {
        try {
          if (instance.channelManager && typeof instance.channelManager.saveInstanceSettings === 'function') {
            await instance.channelManager.saveInstanceSettings(instance.instanceId, {
              ticketInfoMessages: {
                ...(instance.customSettings?.ticketInfoMessages || {}),
                [channel.id]: message.id,
              },
            });
            console.log(`[TicketUtil] Saved message ID to instance settings`);
          }
        } catch (saveError) {
          console.error(`[TicketUtil] Error saving message ID to settings:`, saveError);
        }
      }
      
      console.log(`[TicketUtil] Created new ticket info message: ${message.id}`);
      return message;
    } catch (error) {
      console.error(`[TicketUtil] Error creating ticket info message:`, error);
      return null;
    }
  }
  
  /**
   * Get or create ticket info message
   * @param {Object} channel - Discord channel
   * @param {string} username - User name
   * @param {string} phoneNumber - Phone number
   * @param {Object} instance - Server instance (optional)
   * @returns {Promise<Object|null>} - Message object or null on failure
   */
  static async getOrCreateTicketInfoMessage(channel, username, phoneNumber, instance = null) {
    // First try to find existing message
    const existingMessage = await this.findTicketInfoMessage(channel, instance);
    
    if (existingMessage) {
      return existingMessage;
    }
    
    // If not found, create a new one
    return await this.createTicketInfoMessage(channel, username, phoneNumber, instance);
  }
}

module.exports = TicketUtil;