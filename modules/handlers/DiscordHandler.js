// modules/handlers/DiscordHandler.js
const { PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

/**
 * Handles Discord events and interactions
 */
class DiscordHandler {
  /**
   * Create Discord handler
   * @param {Object} discordClient - Discord client
   * @param {string} categoryId - Category ID
   * @param {Object} channelManager - Channel manager
   * @param {Object} userCardManager - User card manager
   * @param {Object} ticketManager - Ticket manager
   * @param {Object} transcriptManager - Transcript manager
   * @param {Object} whatsAppClient - WhatsApp client
   * @param {Object} options - Options
   */
  constructor(discordClient, categoryId, channelManager, userCardManager, ticketManager, transcriptManager, whatsAppClient, options = {}) {
    this.discordClient = discordClient;
    this.categoryId = categoryId;
    this.channelManager = channelManager;
    this.userCardManager = userCardManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.whatsAppClient = whatsAppClient;
    this.vouchHandler = null; // Set externally
    this.customCloseMessage = null;
    
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', '..', 'assets');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    console.log(`[DiscordHandler:${this.instanceId}] Initialized for category ${this.categoryId}`);
  }
  
  /**
   * Handle Discord message
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleDiscordMessage(message) {
    try {
      // Ignore bot messages
      if (message.author.bot) return false;
      
      // Check if this is in a category we're monitoring
      const categoryId = message.channel.parentId;
      if (!categoryId || categoryId !== this.categoryId) {
        return false;
      }
      
      // Check for commands first
      if (message.content.startsWith('!')) {
        return await this.handleCommand(message);
      }
      
      // Get phone number for this channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(message.channel.id);
      
      if (!phoneNumber) {
        console.log(`[DiscordHandler:${this.instanceId}] No phone number found for channel ${message.channel.id}`);
        await message.react('❌');
        return false;
      }
      
      // Format the message content
      let content = message.content || "";
      
      // Add agent prefix
      const agentName = message.member?.nickname || message.author.username;
      content = `*${agentName}*: ${content}`;
      
      // Send text message first if there's content
      if (content.trim().length > 0) {
        try {
          await this.whatsAppClient.sendTextMessage(phoneNumber, content);
        } catch (textError) {
          console.error(`[DiscordHandler:${this.instanceId}] Error sending text message:`, textError);
          await message.react('⚠️');
          // Continue to try sending attachments even if text fails
        }
      }
      
      // Process attachments
      if (message.attachments.size > 0) {
        let successCount = 0;
        const totalAttachments = message.attachments.size;
        
        for (const [attachmentId, attachment] of message.attachments) {
          try {
            console.log(`[DiscordHandler:${this.instanceId}] Processing attachment: ${attachment.name} (${attachment.contentType})`);
            
            // Determine the attachment type
            const isImage = attachment.contentType?.startsWith('image/');
            const isVideo = attachment.contentType?.startsWith('video/');
            const isAudio = attachment.contentType?.startsWith('audio/');
            const isGif = attachment.contentType === 'image/gif' || attachment.name?.endsWith('.gif');
            const isDocument = !isImage && !isVideo && !isAudio;
            
            let result = false;
            
            // Handle different attachment types
            if (isGif) {
              result = await this.whatsAppClient.sendGif(phoneNumber, attachment.url, attachment.name);
            } else if (isImage) {
              result = await this.whatsAppClient.sendMediaFromUrl(phoneNumber, attachment.url, "Image", attachment.name);
            } else if (isVideo) {
              result = await this.whatsAppClient.sendMediaFromUrl(phoneNumber, attachment.url, "Video", attachment.name);
            } else if (isAudio) {
              result = await this.whatsAppClient.sendMediaFromUrl(phoneNumber, attachment.url, "Audio", attachment.name);
            } else if (isDocument) {
              result = await this.whatsAppClient.sendMediaFromUrl(phoneNumber, attachment.url, "Document", attachment.name);
            }
            
            if (result) {
              successCount++;
            } else {
              console.error(`[DiscordHandler:${this.instanceId}] Failed to send attachment: ${attachment.name}`);
            }
          } catch (attachmentError) {
            console.error(`[DiscordHandler:${this.instanceId}] Error sending attachment:`, attachmentError);
          }
        }
        
        // React based on success ratio
        if (successCount === totalAttachments) {
          await message.react('✅');
        } else if (successCount > 0) {
          await message.react('⚠️'); // Some attachments failed
        } else {
          await message.react('❌'); // All attachments failed
          await message.reply('❌ Failed to send media attachments to WhatsApp. Please try again or use a different format.');
          return false;
        }
      } else {
        // No attachments, just react with success for text message
        await message.react('✅');
      }
      
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling Discord message:`, error);
      
      // Try to react with error emoji
      try {
        await message.react('❌');
      } catch (reactError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error reacting to message:`, reactError);
      }
      
      return false;
    }
  }
  
  /**
   * Handle Discord command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleCommand(message) {
    const command = message.content.split(' ')[0].toLowerCase();
    
    switch (command) {
      case '!close':
        return await this.handleCloseCommand(message);
      case '!vouch':
        return await this.handleVouchCommand(message);
      case '!help':
        return await this.handleHelpCommand(message);
      default:
        return false;
    }
  }
  
  /**
   * Handle close command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleCloseCommand(message) {
    try {
      // Get channel ID
      const channelId = message.channel.id;
      
      // Try to close the ticket
      const success = await this.ticketManager.closeTicket(channelId, this.customCloseMessage !== false);
      
      if (!success) {
        await message.reply('❌ Failed to close ticket. Please try again or check logs.');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling close command:`, error);
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle vouch command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleVouchCommand(message) {
    try {
      // Check if vouch handler is available
      if (!this.vouchHandler) {
        await message.reply('❌ Vouch system is not available.');
        return false;
      }
      
      if (this.vouchHandler.isDisabled) {
        await message.reply('❌ Vouch system is disabled.');
        return false;
      }
      
      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(message.channel.id);
      if (!phoneNumber) {
        await message.reply('❌ Could not find phone number for this channel.');
        return false;
      }
      
      // Get user info
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      if (!userCard) {
        await message.reply('❌ Could not find user information.');
        return false;
      }
      
      // Send vouch instructions
      const success = await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard.name);
      
      if (success) {
        await message.reply('✅ Vouch instructions sent successfully!');
        return true;
      } else {
        await message.reply('❌ Failed to send vouch instructions.');
        return false;
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling vouch command:`, error);
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle help command
   * @param {Object} message - Discord message
   * @returns {Promise<boolean>} - Success
   */
  async handleHelpCommand(message) {
    try {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Help: Available Commands')
        .setDescription('Here are the commands you can use in this channel:')
        .addFields(
          { name: '!close', value: 'Close this ticket and save a transcript', inline: false },
          { name: '!vouch', value: 'Send vouch instructions to the customer', inline: false },
          { name: '!help', value: 'Show this help message', inline: false }
        )
        .setFooter({ text: `WhatsApp Bridge | ${this.instanceId}` });
      
      await message.reply({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling help command:`, error);
      await message.reply(`❌ Error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle interaction create event
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleInteraction(interaction) {
    try {
      // Handle button interactions
      if (interaction.isButton()) {
        switch (interaction.customId) {
          case 'close_ticket':
            return await this.handleCloseTicketButton(interaction);
          case 'send_vouch_instructions':
            return await this.handleVouchInstructionsButton(interaction);
          default:
            if (interaction.customId.startsWith('edit_ticket_info_')) {
              return await this.handleEditTicketButton(interaction);
            }
            break;
        }
      }
      
      // Handle modal submissions
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('edit_ticket_modal_')) {
          return await this.handleEditTicketModal(interaction);
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling interaction:`, error);
      
      try {
        if (!interaction.replied) {
          await interaction.reply({ 
            content: `❌ Error: ${error.message}`, 
            ephemeral: true 
          });
        } else {
          await interaction.followUp({ 
            content: `❌ Error: ${error.message}`, 
            ephemeral: true 
          });
        }
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error sending error message:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Handle close ticket button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleCloseTicketButton(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      // Get channel ID
      const channelId = interaction.channel.id;
      
      // Try to close the ticket
      const success = await this.ticketManager.closeTicket(channelId, this.customCloseMessage !== false);
      
      if (!success) {
        await interaction.editReply('❌ Failed to close ticket. Please try again or check logs.');
        return false;
      }
      
      await interaction.editReply('✅ Ticket closed successfully!');
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling close ticket button:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle vouch instructions button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleVouchInstructionsButton(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      // Check if vouch handler is available
      if (!this.vouchHandler) {
        await interaction.editReply('❌ Vouch system is not available.');
        return false;
      }
      
      if (this.vouchHandler.isDisabled) {
        await interaction.editReply('❌ Vouch system is disabled.');
        return false;
      }
      
      // Get phone number from channel
      const phoneNumber = this.channelManager.getPhoneNumberByChannelId(interaction.channel.id);
      if (!phoneNumber) {
        await interaction.editReply('❌ Could not find phone number for this channel.');
        return false;
      }
      
      // Get user info
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      if (!userCard) {
        await interaction.editReply('❌ Could not find user information.');
        return false;
      }
      
      // Send vouch instructions
      const success = await this.vouchHandler.sendVouchInstructions(phoneNumber, userCard.name);
      
      if (success) {
        await interaction.editReply('✅ Vouch instructions sent successfully!');
        return true;
      } else {
        await interaction.editReply('❌ Failed to send vouch instructions.');
        return false;
      }
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling vouch instructions button:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Handle edit ticket button
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleEditTicketButton(interaction) {
    try {
      // Get phone number from button ID
      const phoneNumber = interaction.customId.replace('edit_ticket_info_', '');
      
      // Get user info
      const userCard = await this.userCardManager.getUserCard(phoneNumber);
      const username = userCard ? userCard.name : 'Unknown User';
      
      // Find the embed message to get current info
      const messages = await interaction.channel.messages.fetch({ limit: 10 });
      const embedMessage = messages.find(
        m => m.embeds.length > 0 && 
        m.embeds[0].title === 'Ticket Information'
      );
      
      let currentNotes = 'No notes provided yet.';
      if (embedMessage && embedMessage.embeds[0]) {
        const description = embedMessage.embeds[0].description;
        if (description) {
          // Extract notes from the code block
          const notesMatch = description.match(/Notes\n(.*?)(\n|$)/);
          if (notesMatch && notesMatch[1]) {
            currentNotes = notesMatch[1];
            if (currentNotes === 'No notes provided yet. Use the Edit button to add details.') {
              currentNotes = '';
            }
          }
        }
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
      
      // Notes input
      const notesInput = new TextInputBuilder()
        .setCustomId('ticket_notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(currentNotes)
        .setPlaceholder('Add notes about this support ticket here');
      
      const firstRow = new ActionRowBuilder().addComponents(usernameInput);
      const secondRow = new ActionRowBuilder().addComponents(notesInput);
      
      modal.addComponents(firstRow, secondRow);
      
      await interaction.showModal(modal);
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling edit ticket button:`, error);
      
      try {
        await interaction.reply({
          content: `❌ Error: ${error.message}`,
          ephemeral: true
        });
      } catch (replyError) {
        console.error(`[DiscordHandler:${this.instanceId}] Error replying with error:`, replyError);
      }
      
      return false;
    }
  }
  
  /**
   * Handle edit ticket modal
   * @param {Object} interaction - Discord interaction
   * @returns {Promise<boolean>} - Success
   */
  async handleEditTicketModal(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });
      
      // Get phoneNumber from modal ID
      const phoneNumber = interaction.customId.replace('edit_ticket_modal_', '');
      
      // Get updated data
      const newUsername = interaction.fields.getTextInputValue('ticket_username');
      const newNotes = interaction.fields.getTextInputValue('ticket_notes') || 'No notes provided.';
      
      // Handle username change
      if (newUsername && phoneNumber) {
        // Update user card
        if (this.userCardManager) {
          const oldUserCard = await this.userCardManager.getUserCard(phoneNumber);
          const oldUsername = oldUserCard ? oldUserCard.name : '';
          
          if (oldUsername !== newUsername) {
            await this.userCardManager.updateUserCard(phoneNumber, { name: newUsername });
            
            // Update channel name
            const channelId = this.channelManager.getChannelId(phoneNumber);
            if (channelId) {
              const channel = this.discordClient.channels.cache.get(channelId);
              if (channel) {
                // Format new channel name
                const formattedUsername = newUsername.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').substring(0, 25);
                const newChannelName = `📋-${formattedUsername}`;
                
                if (channel.name !== newChannelName) {
                  await channel.setName(newChannelName, 'Updated username');
                }
              }
            }
          }
        }
      }
      
      // Update the embed
      const messages = await interaction.channel.messages.fetch({ limit: 10 });
      const embedMessage = messages.find(
        m => m.embeds.length > 0 && 
        m.embeds[0].title === 'Ticket Information'
      );
      
      if (embedMessage) {
        const originalEmbed = embedMessage.embeds[0];
        
        // Create a new description with updated information
        const formattedTime = new Date().toLocaleTimeString();
        const newDescription = '```\nUsername        Phone Number\n' + 
                          `${newUsername.padEnd(15)} ${phoneNumber.replace(/@.*$/, '')}\n\n` +
                          'Notes\n' +
                          `${newNotes}\n` +
                          `Opened Ticket • Today at ${formattedTime}\n` +
                          '```';
        
        // Create updated embed
        const updatedEmbed = EmbedBuilder.from(originalEmbed)
          .setDescription(newDescription);
        
        // Update the embed message
        await embedMessage.edit({
          embeds: [updatedEmbed],
          components: embedMessage.components
        });
        
        await interaction.editReply('✅ Ticket information updated successfully!');
      } else {
        await interaction.editReply('❌ Could not find ticket information message to update.');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`[DiscordHandler:${this.instanceId}] Error handling edit ticket modal:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
      return false;
    }
  }
}

module.exports = DiscordHandler;