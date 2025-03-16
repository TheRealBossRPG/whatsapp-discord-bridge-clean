// modules/baileysVouchHandler.js - Updated with better instance isolation and error handling
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

class BaileysVouchHandler {
  constructor(baileysClient, discordClient, guildId, vouchChannelId, userCardManager, options = {}) {
    this.baileysClient = baileysClient;
    this.discordClient = discordClient;
    this.guildId = guildId;
    this.vouchChannelId = vouchChannelId;
    this.userCardManager = userCardManager;
    this.channelManager = null; // Will be set later by bridge
    
    // Set instance ID from options or from userCardManager
    this.instanceId = options.instanceId || userCardManager?.instanceId || 'default';
    
    // Set FFmpeg path
    ffmpeg.setFfmpegPath(ffmpegPath);
    
    // Create instance-specific directories
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', 'instances', this.instanceId, 'assets');
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }

    // Create instance-specific temp directory
    this.tempDir = options.tempDir || path.join(__dirname, '..', 'instances', this.instanceId, 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Get MediaManager class for proper instance isolation
    try {
      const MediaManager = require('./managers/MediaManager');
      this.mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: path.join(__dirname, '..', 'instances', this.instanceId, 'transcripts')
      });
    } catch (e) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error creating MediaManager instance: ${e.message}`);
      // Fallback to simplifiedMediaManager
      const mediaManager = require('./simplifiedMediaManager');
      if (typeof mediaManager.setInstanceId === 'function') {
        mediaManager.setInstanceId(this.instanceId);
      }
      this.mediaManager = mediaManager;
    }

    if (!this.discordClient) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Discord client is null or undefined!`);
    } else if (!this.discordClient.user) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Discord client user is null or undefined!`);
    } else {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Using Discord client logged in as ${this.discordClient.user.tag}`);
    }
    
    console.log(`[BaileysVouchHandler:${this.instanceId}] Initialized`);
  }
  
  // Set channel manager reference
  setChannelManager(channelManager) {
    this.channelManager = channelManager;
    console.log(`[BaileysVouchHandler:${this.instanceId}] Channel manager set: ${channelManager ? 'Available' : 'Missing'}`);
  }
  
  /**
   * Save a vouch media file in the user's media directory
   * @param {string} filepath - Path to media file
   * @param {string} username - Username
   * @param {string} mediaType - Type of media
   * @param {string} phoneNumber - WhatsApp phone number
   * @returns {Object} - Result object with path info
   */
  async saveVouchMedia(filepath, username, mediaType, phoneNumber = null) {
    try {
      // Make sure we have a valid file
      if (!fs.existsSync(filepath)) {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Cannot save vouch media, file doesn't exist: ${filepath}`);
        return { success: false, error: 'File not found' };
      }
      
      // Use proper instance-specific media manager
      if (this.mediaManager && typeof this.mediaManager.saveMedia === 'function') {
        // Make sure we're using the proper mapping for consistent folders
        if (typeof this.mediaManager.setPhoneToUsername === 'function') {
          this.mediaManager.setPhoneToUsername(phoneNumber, username);
        }
        
        // Save the media
        const result = this.mediaManager.saveMedia(filepath, username, mediaType, phoneNumber);
        
        if (result.success) {
          console.log(`[BaileysVouchHandler:${this.instanceId}] Vouch media saved: ${result.path}`);
          return result;
        } else {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Failed to save vouch media: ${result.error}`);
          return { success: false, error: result.error };
        }
      } else {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Media manager not available or missing saveMedia method`);
        
        // Create a temp copy as a fallback
        const ext = path.extname(filepath);
        const tempFilePath = path.join(this.tempDir, `vouch_${Date.now()}${ext}`);
        fs.copyFileSync(filepath, tempFilePath);
        
        return { 
          success: true, 
          path: tempFilePath,
          isTemporary: true
        };
      }
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error saving vouch media:`, error);
      return { success: false, error: error.message };
    }
  }
  
  // Helper function to force cleanup a file
  forceCleanupFile(filePath) {
    if (!filePath) return false;
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[BaileysVouchHandler:${this.instanceId}] 🗑️ DELETED: ${filePath}`);
        
        // Double-check it's really gone
        if (fs.existsSync(filePath)) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] ⚠️ File still exists after deletion attempt: ${filePath}`);
          // Try one more time
          fs.unlinkSync(filePath);
          console.log(`[BaileysVouchHandler:${this.instanceId}] 🗑️ Second deletion attempt for: ${filePath}`);
          return !fs.existsSync(filePath);
        }
        return true;
      } else {
        return true; // Consider it a success if the file doesn't exist
      }
    } catch (e) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error deleting ${filePath}: ${e.message}`);
      return false;
    }
  }
  
  async handleVouchCommand(msg, sender, senderName, messageBody) {
    if (this.isDisabled) {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Vouch system is disabled, ignoring vouch command`);
      return false;
    }

    // Check if message starts with Vouch!
    if (!messageBody || !messageBody.toLowerCase().startsWith('vouch!')) {
      return false; // Not a vouch command
    }
    
    try {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Processing vouch command from ${sender}`);
      
      // Extract the vouch message (everything after Vouch!)
      const vouchText = messageBody.substring(6).trim();
      
      // Check if there's actual content in the vouch
      if (!vouchText && !msg.hasMedia) {
        await this.baileysClient.sendMessage(
          sender, 
          '❌ Please include a message with your vouch or attach an image. Example: *Vouch! Great service, very fast!*'
        );
        return true; // Handled as vouch (with error)
      }
      
      // NEW CHECK: Verify if there's an active ticket for this user
      if (this.channelManager && typeof this.channelManager.getChannelIdByPhoneNumber === 'function') {
        const channelId = this.channelManager.getChannelIdByPhoneNumber(sender);
        
        if (!channelId) {
          await this.baileysClient.sendMessage(
            sender, 
            '❌ You need an active support ticket to leave a vouch. Please contact support first.'
          );
          return true; // Handled as vouch (with error)
        }
        
        // Also check if ticket is closed (if we have a way to check)
        if (this.ticketManager && typeof this.ticketManager.isTicketClosed === 'function') {
          const isClosed = this.ticketManager.isTicketClosed(channelId);
          if (isClosed) {
            await this.baileysClient.sendMessage(
              sender, 
              '❌ Your support ticket is closed. Please open a new ticket before leaving a vouch.'
            );
            return true; // Handled as vouch (with error)
          }
        }
      }
      
      // Check if vouch channel is configured
      if (!this.vouchChannelId) {
        console.error(`[BaileysVouchHandler:${this.instanceId}] VOUCH_CHANNEL_ID is not configured`);
        await this.baileysClient.sendMessage(sender, '❌ Sorry, vouches are not configured on this system.');
        return true;
      }
      
      // Get the guild
      const guild = this.discordClient.guilds.cache.get(this.guildId);
      if (!guild) {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Guild not found for vouch: ${this.guildId}`);
        await this.baileysClient.sendMessage(sender, '❌ Sorry, there was an error processing your vouch. Please try again later.');
        return true;
      }
      
      // Find the vouch channel with error handling
      let vouchChannel;
      try {
        vouchChannel = await guild.channels.fetch(this.vouchChannelId);
        if (!vouchChannel) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Vouch channel not found: ${this.vouchChannelId}`);
          await this.baileysClient.sendMessage(sender, '❌ Sorry, the vouch channel is not available. Please contact an administrator.');
          return true;
        }
        
        // Check permissions before proceeding
        const botMember = await guild.members.fetchMe();
        const permissions = vouchChannel.permissionsFor(botMember);
        
        if (!permissions.has('ViewChannel')) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Bot doesn't have VIEW_CHANNEL permission in vouch channel`);
          await this.baileysClient.sendMessage(
            sender, 
            "❌ Sorry, I don't have permission to see the vouch channel. Your vouch has been saved and an administrator has been notified."
          );
          // Try to notify server admin via system channel if available
          this.notifyAdminOfPermissionIssue(guild, "view the vouch channel");
          return true;
        }
        
        if (!permissions.has('SendMessages')) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Bot doesn't have SEND_MESSAGES permission in vouch channel`);
          await this.baileysClient.sendMessage(
            sender, 
            "❌ Sorry, I don't have permission to send messages in the vouch channel. Your vouch has been saved and an administrator has been notified."
          );
          // Try to notify server admin
          this.notifyAdminOfPermissionIssue(guild, "send messages in the vouch channel");
          return true;
        }
        
        if (!permissions.has('AttachFiles') && msg.hasMedia) {
          console.warn(`[BaileysVouchHandler:${this.instanceId}] Bot doesn't have ATTACH_FILES permission in vouch channel - will send text only`);
          await this.baileysClient.sendMessage(
            sender, 
            "⚠️ I can't attach files to the vouch channel, so your vouch will be posted without the image/video. An administrator has been notified."
          );
          // Try to notify server admin
          this.notifyAdminOfPermissionIssue(guild, "attach files to the vouch channel");
          // Continue with text-only vouch
        }
        
        if (!permissions.has('EmbedLinks')) {
          console.warn(`[BaileysVouchHandler:${this.instanceId}] Bot doesn't have EMBED_LINKS permission in vouch channel - will use plain text`);
          // Continue with plain text instead of embeds
        }
      } catch (channelError) {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Error accessing vouch channel:`, channelError);
        await this.baileysClient.sendMessage(sender, '❌ Sorry, there was an error accessing the vouch channel. Please try again later.');
        return true;
      }
  
      // Use name from user card if available for consistency
      let displayName = senderName;
      if (this.userCardManager && typeof this.userCardManager.getUserCard === 'function') {
        const userCard = this.userCardManager.getUserCard(sender);
        if (userCard && userCard.name) {
          displayName = userCard.name;
        }
      }
      
      // Get the channel for this user
      let channelId = null;
      if (this.channelManager && typeof this.channelManager.getChannelIdByPhoneNumber === 'function') {
        channelId = this.channelManager.getChannelIdByPhoneNumber(sender);
      }
      
      let helpers = [];
      
      if (channelId) {
        // Get channel from Discord
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (channel) {
          try {
            // Improved helper finding logic
            const participantArray = await this.getTicketParticipants(sender);
            helpers = participantArray;
          } catch (error) {
            console.error(`[BaileysVouchHandler:${this.instanceId}] Error finding helpers:`, error);
          }
        }
      }
      
      // Format title based on who helped
      let titleText = `📣 Vouch from ${displayName}`;
      if (helpers.length > 0) {
        titleText = `📣 Vouch from ${displayName} to ${helpers.join(', ')}`;
      }
      
      // Try to use embeds if we have permissions
      let messageContent = null;
      let embeds = null;
      let files = null;
      
      // Check if we can use embeds
      const botMember = await guild.members.fetchMe();
      const permissions = vouchChannel.permissionsFor(botMember);
      const canUseEmbeds = permissions.has('EmbedLinks');
      
      if (canUseEmbeds) {
        // Create a fancy embed for the vouch - REMOVED INSTANCE ID
        const embed = new EmbedBuilder()
          .setColor(0x00FFFF) // Cyan color
          .setTitle(titleText)
          .setDescription(`# ${vouchText || 'No message provided'}`) // Using # for bigger text
          .setTimestamp()
          .setFooter({ text: `Sent via WhatsApp` }); // Removed instance ID reference
        
        embeds = [embed];
      } else {
        // Use plain text instead - REMOVED INSTANCE ID
        messageContent = `**${titleText}**\n\n${vouchText || 'No message provided'}\n\n*Sent via WhatsApp*`;
      }
      
      // Handle media if present
      if (msg.hasMedia && permissions.has('AttachFiles')) {
        try {
          console.log(`[BaileysVouchHandler:${this.instanceId}] Downloading media for vouch...`);
          
          // Download media
          const mediaBuffer = await msg.downloadMedia();
          
          if (!mediaBuffer || (Buffer.isBuffer(mediaBuffer) && mediaBuffer.length === 0)) {
            throw new Error('Downloaded media is empty or invalid');
          }
          
          // Convert to buffer if needed
          let buffer;
          if (Buffer.isBuffer(mediaBuffer)) {
            buffer = mediaBuffer;
          } else if (mediaBuffer.data) {
            buffer = Buffer.from(mediaBuffer.data, 'base64');
          } else {
            throw new Error('Unsupported media format');
          }
          
          // Determine file extension and type
          const mediaType = msg.type || 'image';
          let ext = '.jpg';
          
          if (mediaType === 'image') {
            ext = '.jpg';
          } else if (mediaType === 'video') {
            ext = '.mp4';
          } else if (mediaType === 'gif') {
            ext = '.gif';
          } else if (mediaType === 'sticker') {
            ext = '.webp';
          } else if (mediaType === 'audio') {
            ext = '.mp3';
          } else if (mediaType === 'document') {
            ext = '.pdf';
          }
          
          // Create a unique temporary file path
          const tempFilePath = path.join(this.tempDir, `vouch_media_${Date.now()}${ext}`);
          
          // Ensure the temp directory exists
          if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
          }
          
          // Write the media to the temporary file
          fs.writeFileSync(tempFilePath, buffer);
          console.log(`[BaileysVouchHandler:${this.instanceId}] Saved media to temp file: ${tempFilePath}`);
          
          // Add the file to our message
          files = [{
            attachment: tempFilePath,
            name: `vouch${ext}`
          }];
          
          // Send the vouch with media
          try {
            await vouchChannel.send({ 
              content: messageContent,
              embeds: embeds,
              files: files
            });
            
            console.log(`[BaileysVouchHandler:${this.instanceId}] Vouch with ${mediaType} sent successfully`);
            
            // Clean up temp file AFTER sending
            this.forceCleanupFile(tempFilePath);
            
            // Get custom success message or use default
            let successMessage = this.customSettings?.vouchSuccessMessage || 
                                "✅ Thank you for your vouch with {mediaType}! It has been posted to our community channel.";
            
            // Replace any variables
            successMessage = successMessage
              .replace(/{mediaType}/g, mediaType)
              .replace(/{type}/g, mediaType);
            
            // Confirm to the user with media type
            await this.baileysClient.sendMessage(sender, successMessage);
            
            return true;
          } catch (sendError) {
            // If we get a permissions error
            if (sendError.code === 50013) { // Missing Permissions
              console.error(`[BaileysVouchHandler:${this.instanceId}] Missing permissions to send to channel: ${sendError.message}`);
              
              // Try to notify server admin
              this.notifyAdminOfPermissionIssue(guild, "send messages with files to the vouch channel");
              
              // Inform the user
              await this.baileysClient.sendMessage(
                sender,
                `⚠️ Sorry, I don't have permission to post your vouch with media. An administrator has been notified. Would you like to try sending just the text?`
              );
              return true;
            }
            
            console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending media vouch:`, sendError);
            
            // Clean up temp file on error
            this.forceCleanupFile(tempFilePath);
            
            // Try to send text-only as fallback
            try {
              await vouchChannel.send({ 
                content: messageContent,
                embeds: embeds 
              });
              
              await this.baileysClient.sendMessage(
                sender,
                `✅ Thank you for your vouch! We couldn't include your media due to a technical issue, but your message was posted.`
              );
              
              return true;
            } catch (textError) {
              console.error(`[BaileysVouchHandler:${this.instanceId}] Also failed to send text-only vouch:`, textError);
              
              await this.baileysClient.sendMessage(
                sender,
                `❌ Sorry, there was an error posting your vouch. Please try again later or contact an administrator.`
              );
              
              return true;
            }
          }
        } catch (mediaError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error processing media for vouch:`, mediaError);
          console.log(`[BaileysVouchHandler:${this.instanceId}] Proceeding with text-only vouch due to media error`);
          
          // Try to send text-only fallback
          try {
            // Post text-only vouch as fallback
            await vouchChannel.send({ 
              content: messageContent,
              embeds: embeds 
            });
            
            await this.baileysClient.sendMessage(
              sender,
              `✅ Thank you for your vouch! We couldn't include your media due to a technical issue, but your message was posted.`
            );
            
            return true;
          } catch (textFallbackError) {
            console.error(`[BaileysVouchHandler:${this.instanceId}] Failed to send text fallback:`, textFallbackError);
            
            await this.baileysClient.sendMessage(
              sender,
              `❌ Sorry, there was an error posting your vouch. Please try again later or contact an administrator.`
            );
            
            return true;
          }
        }
      } else {
        // Text-only vouch (either by choice or lack of media permission)
        try {
          // Send the text-only vouch
          await vouchChannel.send({ 
            content: messageContent,
            embeds: embeds 
          });
          
          console.log(`[BaileysVouchHandler:${this.instanceId}] Text vouch posted successfully`);
          
          // Get custom success message or use default
          let successMessage = this.customSettings?.vouchSuccessMessage || 
                             "✅ Thank you for your vouch! It has been posted to our community channel.";
          
          // Confirm to the user
          await this.baileysClient.sendMessage(sender, successMessage);
          return true;
        } catch (textError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending text vouch:`, textError);
          
          // If we get a permissions error
          if (textError.code === 50013) { // Missing Permissions
            // Try to notify server admin
            this.notifyAdminOfPermissionIssue(guild, "send messages to the vouch channel");
            
            // Inform the user
            await this.baileysClient.sendMessage(
              sender,
              `❌ Sorry, I don't have permission to post your vouch. An administrator has been notified.`
            );
            return true;
          }
          
          await this.baileysClient.sendMessage(
            sender,
            `❌ Sorry, there was an error posting your vouch. Please try again later or contact an administrator.`
          );
          return true;
        }
      }
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error processing vouch command:`, error);
      try {
        await this.baileysClient.sendMessage(sender, '❌ Sorry, there was an error processing your vouch. Please try again later.');
      } catch (messageError) {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending error message:`, messageError);
      }
      return true; // Still mark as handled
    }
  }

  async notifyAdminOfPermissionIssue(guild, permissionType) {
    try {
      // Try to use the system channel first
      let notificationChannel = guild.systemChannel;
      
      // If no system channel, try to find a channel where we can send messages
      if (!notificationChannel) {
        // Try to find a channel where we have permission to send messages
        const channels = Array.from(guild.channels.cache.values())
          .filter(c => c.type === 0); // Text channels only
          
        for (const channel of channels) {
          const permissions = channel.permissionsFor(guild.members.me);
          if (permissions && permissions.has('SendMessages') && permissions.has('ViewChannel')) {
            notificationChannel = channel;
            break;
          }
        }
      }
      
      if (notificationChannel) {
        await notificationChannel.send({
          content: `⚠️ **Permission Error**: I don't have permission to ${permissionType}. Please update my permissions to allow me to properly handle vouches.`,
          allowedMentions: { parse: ['everyone'] }
        });
        console.log(`[BaileysVouchHandler:${this.instanceId}] Sent permission issue notification to channel ${notificationChannel.name}`);
      } else {
        console.error(`[BaileysVouchHandler:${this.instanceId}] Could not find any channel to notify admins about permission issues`);
      }
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error notifying admins:`, error);
    }
  }

  // Handle Discord !vouch command
  async handleDiscordVouchCommand(message) {
    // Make sure this is a !vouch command
    if (this.isDisabled) {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Vouch system is disabled, ignoring vouch command`);
      return false;
    }
    
    if (!message.content.toLowerCase().startsWith('!vouch')) {
      return false;
    }
    
    try {
      // Get the WhatsApp number for this channel
      if (!this.channelManager || typeof this.channelManager.getWhatsAppNumberByChannelId !== 'function') {
        await message.reply('Error: Channel manager not initialized properly.');
        return true;
      }
      
      const whatsappNumber = this.channelManager.getWhatsAppNumberByChannelId(message.channel.id);
      if (!whatsappNumber) {
        await message.reply('No WhatsApp contact associated with this channel.');
        return true;
      }
      
      // Get user info from UserCardManager for consistent naming
      let displayName = 'customer';
      if (this.userCardManager && typeof this.userCardManager.getUserCard === 'function') {
        const userCard = this.userCardManager.getUserCard(whatsappNumber);
        if (userCard && userCard.name) {
          displayName = userCard.name;
        }
      } else {
        console.warn(`[BaileysVouchHandler:${this.instanceId}] userCardManager is not available for getting user name`);
      }
      
      // Get custom vouch message if available
      let vouchMessage = null;
      
      // Try to get custom message from instance if available
      if (this.customVouchMessage) {
        vouchMessage = this.customVouchMessage;
      }
      
      // If we don't have a custom message, use default
      if (!vouchMessage) {
        vouchMessage = `Hey ${displayName}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.`;
      } else {
        // Replace template variables
        vouchMessage = vouchMessage
          .replace(/{name}/g, displayName)
          .replace(/{phoneNumber}/g, whatsappNumber);
      }
      
      // Send vouch instructions to the user with the custom or default message
      await this.baileysClient.sendMessage(whatsappNumber, vouchMessage);
      
      // Try to send the instruction video
      const videoSent = await this.sendInstructionVideo(whatsappNumber);
      
      // Get participants from the ticket (if getTicketParticipants method exists)
      let participants = [];
      if (typeof this.getTicketParticipants === 'function') {
        participants = await this.getTicketParticipants(whatsappNumber) || [];
      }
      
      let participantsText = '';
      if (participants.length > 0) {
        participantsText = `\n\nSupport team members who helped: ${participants.join(', ')}`;
      }
      
      await message.reply(`Vouch instructions sent to ${displayName}!${participantsText}${videoSent ? ' (with visual instructions)' : ''}`);
      return true;
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error processing Discord vouch command:`, error);
      await message.reply('Error sending vouch instructions: ' + error.message);
      return true;
    }
  }

  setCustomVouchMessage(message) {
    this.customVouchMessage = message;
    console.log(`[BaileysVouchHandler:${this.instanceId}] Set custom vouch message: ${message.substring(0, 30)}...`);
  }

  /**
   * Send instruction video to WhatsApp user
   * @param {string} phoneNumber - Phone number
   * @returns {Promise<boolean>} - Success status
   */
  async sendInstructionVideo(phoneNumber) {
    try {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Attempting to send instruction video to ${phoneNumber}`);
      
      // Look in instance-specific assets directory first
      const vouchVideoPath = path.join(this.assetsDir, 'vouch-instructions.mp4');
      
      // Check if video exists
      if (fs.existsSync(vouchVideoPath)) {
        console.log(`[BaileysVouchHandler:${this.instanceId}] Found video instruction file. Sending...`);
        try {
          await this.baileysClient.sendVideo(
            phoneNumber, 
            vouchVideoPath, 
            "How to leave a vouch 👆"
          );
          console.log(`[BaileysVouchHandler:${this.instanceId}] Video instructions sent successfully!`);
          return true;
        } catch (videoError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending video:`, videoError);
        }
      }
      
      // Fallback to GIF if video doesn't exist or failed to send
      const vouchGifPath = path.join(this.assetsDir, 'vouch-instructions.gif');
      
      if (fs.existsSync(vouchGifPath)) {
        console.log(`[BaileysVouchHandler:${this.instanceId}] Using GIF instruction file as fallback...`);
        try {
          await this.baileysClient.sendGif(
            phoneNumber, 
            vouchGifPath,
            "How to leave a vouch 👆"
          );
          console.log(`[BaileysVouchHandler:${this.instanceId}] GIF instructions sent successfully!`);
          return true;
        } catch (gifError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending GIF:`, gifError);
          return false;
        }
      }
      
      // If instance-specific assets not found, check shared assets as a fallback
      const sharedVideoPath = path.join(__dirname, '..', 'assets', 'vouch-instructions.mp4');
      if (fs.existsSync(sharedVideoPath)) {
        try {
          await this.baileysClient.sendVideo(
            phoneNumber, 
            sharedVideoPath, 
            "How to leave a vouch 👆"
          );
          console.log(`[BaileysVouchHandler:${this.instanceId}] Video instructions sent from shared assets!`);
          return true;
        } catch (sharedVideoError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending shared video:`, sharedVideoError);
        }
      }
      
      // Last resort: check shared GIF
      const sharedGifPath = path.join(__dirname, '..', 'assets', 'vouch-instructions.gif');
      if (fs.existsSync(sharedGifPath)) {
        try {
          await this.baileysClient.sendGif(
            phoneNumber, 
            sharedGifPath,
            "How to leave a vouch 👆"
          );
          console.log(`[BaileysVouchHandler:${this.instanceId}] GIF instructions sent from shared assets!`);
          return true;
        } catch (sharedGifError) {
          console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending shared GIF:`, sharedGifError);
        }
      }
      
      console.log(`[BaileysVouchHandler:${this.instanceId}] No instruction media files found`);
      return false;
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error sending instructions:`, error);
      return false;
    }
  }
  
  /**
   * Get participants from a ticket for vouches
   * @param {string} phoneNumber - WhatsApp number
   * @returns {Promise<string[]>} - Array of participant names
   */
  async getTicketParticipants(phoneNumber) {
    console.log(`[BaileysVouchHandler:${this.instanceId}] Getting ticket participants for ${phoneNumber}`);
    
    // Get the channel for this user
    if (!this.channelManager || typeof this.channelManager.getChannelIdByPhoneNumber !== 'function') {
      console.error(`[BaileysVouchHandler:${this.instanceId}] channelManager is not available for getting channel ID`);
      return [];
    }
    
    const channelId = this.channelManager.getChannelIdByPhoneNumber(phoneNumber);
    if (!channelId) {
      console.log(`[BaileysVouchHandler:${this.instanceId}] No channel found for ${phoneNumber}`);
      return [];
    }
    
    if (!this.discordClient) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] discordClient is not available for getting guild`);
      return [];
    }
    
    const guild = this.discordClient.guilds.cache.get(this.guildId);
    if (!guild) {
      console.log(`[BaileysVouchHandler:${this.instanceId}] Guild ${this.guildId} not found`);
      return [];
    }
    
    try {
      const channel = await guild.channels.fetch(channelId).catch(e => null);
      if (!channel) {
        console.log(`[BaileysVouchHandler:${this.instanceId}] Channel ${channelId} not found`);
        return [];
      }
      
      // Get username from UserCardManager for consistent user identification
      let username = null;
      let usernameVariants = [];
      
      if (this.userCardManager && typeof this.userCardManager.getUserCard === 'function') {
        const userCard = this.userCardManager.getUserCard(phoneNumber);
        if (userCard && userCard.name) {
          username = userCard.name;
          
          // Create variants of the username for better matching
          usernameVariants.push(username);
          usernameVariants.push(username.toLowerCase());
          
          // Strip any special characters for additional matching
          const strippedName = username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (strippedName && strippedName.length > 2) {
            usernameVariants.push(strippedName);
          }
        }
      }
      
      // If username is still null, try to extract from channel name
      if (!username) {
        username = channel.name.replace(/^(✓|📋\s*-\s*)/, '').replace(/-/g, ' ');
        usernameVariants.push(username);
        usernameVariants.push(username.toLowerCase());
      }
      
      console.log(`[BaileysVouchHandler:${this.instanceId}] Looking for messages not from ${username}`);
      
      // Fetch all messages to ensure we get all participants
      console.log(`[BaileysVouchHandler:${this.instanceId}] Fetching channel messages...`);
      const allMessages = await this.fetchAllMessages(channel);
      
      // Sort messages by timestamp
      allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      // Get unique users who sent messages, excluding bots and the command issuer
      const participants = new Set();
      
      // List of known bot names and patterns to exclude
      const botNames = ['Support Bot', 'Support', 'Dyno', 'MEE6', 'Bot', 'Ticket Tool', 'Auto', 'System'];
      const systemPatterns = [
        '[---NewTicket---]',
        'Transcript saved',
        'Closing ticket',
        'End of previous conversation',
        'Previous conversation',
        '📄 Transcript',
        '📋 New Support Ticket'
      ];
      
      // Match patterns for user messages like "**Username:** message content"
      const userMessageRegex = /^\*\*([^:]+):\*\*/;
      
      for (const msg of allMessages) {
        // Skip bot messages
        if (msg.author?.bot) continue;
        
        // Skip system messages
        let isSystemMessage = false;
        for (const pattern of systemPatterns) {
          if (msg.content.includes(pattern)) {
            isSystemMessage = true;
            break;
          }
        }
        if (isSystemMessage) continue;
        
        // Check if message is FROM the WhatsApp user
        const messageMatch = msg.content.match(userMessageRegex);
        let isFromWhatsAppUser = false;
        
        if (messageMatch && messageMatch[1]) {
          const nameInMessage = messageMatch[1].trim().toLowerCase();
          // Check against all variants of the username
          for (const variant of usernameVariants) {
            if (nameInMessage === variant.toLowerCase() || 
               (nameInMessage.length > 3 && variant.toLowerCase().includes(nameInMessage)) ||
               (variant.length > 3 && nameInMessage.includes(variant.toLowerCase()))) {
              isFromWhatsAppUser = true;
              break;
            }
          }
        }
        
        // Skip messages from the WhatsApp user
        if (isFromWhatsAppUser) continue;
        
        // Skip messages from known bots
        const authorName = msg.author?.username || '';
        let isBot = false;
        for (const botName of botNames) {
          if (authorName.toLowerCase().includes(botName.toLowerCase())) {
            isBot = true;
            break;
          }
        }
        if (isBot) continue;
        
        // Add the sender to participants
        const participantName = msg.member?.displayName || msg.author?.username;
        if (participantName) {
          participants.add(participantName);
        }
      }
      
      // Convert Set to Array
      const participantArray = Array.from(participants);
      console.log(`[BaileysVouchHandler:${this.instanceId}] Found ${participantArray.length} participants: ${participantArray.join(', ')}`);
      
      return participantArray;
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error getting ticket participants:`, error);
      return [];
    }
  }
  
  /**
   * Find the [---NewTicket---] marker message
   * @param {object} channel - Discord channel
   * @returns {Promise<object|null>} - Message or null
   */
  async findNewTicketMarker(channel) {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      for (const [, message] of messages) {
        if (message.content.includes('[---NewTicket---]')) {
          return message;
        }
      }
    } catch (error) {
      console.error(`[BaileysVouchHandler:${this.instanceId}] Error finding new ticket marker:`, error);
    }
    return null;
  }
  
  /**
   * Fetch all messages from a channel
   * @param {object} channel - Discord channel
   * @returns {Promise<Array>} - Array of messages
   */
  async fetchAllMessages(channel) {
    let allMessages = [];
    let lastId = null;
    let fetchedMessages;
    
    // Loop to fetch messages in batches
    do {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      
      fetchedMessages = await channel.messages.fetch(options);
      if (fetchedMessages.size === 0) break;
      
      allMessages = [...allMessages, ...fetchedMessages.values()];
      lastId = fetchedMessages.last().id;
      
      // Add a small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Set a reasonable limit to prevent excessive fetching
      if (allMessages.length >= 500) break;
      
    } while (fetchedMessages.size === 100);
    
    return allMessages;
  }
}

module.exports = BaileysVouchHandler;