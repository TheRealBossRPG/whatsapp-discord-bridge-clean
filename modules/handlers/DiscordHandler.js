// modules/baileysDiscordHandler.js - FIXED FOR USERNAME HANDLING
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const MediaManager = require('../../utils/MediaManager');
const { formatDisplayName, formatDirectoryName, cleanPhoneNumber } = MediaManager.formatFunctions;

class BaileysDiscordHandler {
  constructor(discordClient, categoryId, channelManager, userCardManager, ticketManager, transcriptManager, baileysClient, options = {}) {
    this.discordClient = discordClient;
    this.categoryId = categoryId;
    this.channelManager = channelManager;
    this.userCardManager = userCardManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.baileysClient = baileysClient;
    
    // Set instance ID from options or from one of the managers
    this.instanceId = options.instanceId || 
                     channelManager?.instanceId || 
                     userCardManager?.instanceId || 
                     'default';
    
    // Set FFmpeg path
    ffmpeg.setFfmpegPath(ffmpegPath);
    
    // Create instance-specific directories
    this.tempDir = options.tempDir || path.join(__dirname, '..', 'instances', this.instanceId, 'temp');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    this.assetsDir = options.assetsDir || path.join(__dirname, '..', 'instances', this.instanceId, 'assets');
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }
    
    // Create a MediaManager instance
    try {
      this.mediaManager = new MediaManager({
        instanceId: this.instanceId,
        baseDir: path.join(__dirname, '..', 'instances', this.instanceId, 'transcripts')
      });
    } catch (e) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error creating MediaManager: ${e.message}`);
      // Fallback to simplifiedMediaManager
      try {
        const mediaManager = require('./simplifiedMediaManager');
        if (typeof mediaManager.setInstanceId === 'function') {
          mediaManager.setInstanceId(this.instanceId);
        }
        this.mediaManager = mediaManager;
      } catch (fallbackError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error using fallback mediaManager: ${fallbackError.message}`);
      }
    }
    
    // Vouch handler reference - will be set by bridge
    this.vouchHandler = null;
    
    // Track what bot messages we've seen to filter duplicates
    this.processedBotMessages = new Set();

    //Check if message handler is already registered
    this._hasRegisteredMessageHandler = false;
    
    // Track processed media to avoid duplicates
    this.processedMedia = new Set();
  
    console.log(`[BaileysDiscordHandler:${this.instanceId}] Initialized with category ${categoryId}`);
    
    // Validate client immediately
    this.validateDiscordClient();
  }

  setupMessageHandler() {
    // Skip if already registered
    if (this._hasRegisteredMessageHandler) {
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Message handler already registered, skipping`);
      return;
    }
    
    // Register message handler
    this.discordClient.on('messageCreate', this.handleDiscordMessage.bind(this));
    this._hasRegisteredMessageHandler = true;
    
    console.log(`[BaileysDiscordHandler:${this.instanceId}] Discord message handler registered`);
  }
  
  // Validate Discord client reference
  validateDiscordClient() {
    try {
      if (!this.discordClient) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] CRITICAL ERROR: discordClient is null`);
        return false;
      }
      
      if (typeof this.discordClient.guilds?.cache?.get !== 'function') {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] CRITICAL ERROR: discordClient.guilds.cache.get is not a function`);
        return false;
      }
      
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Discord client reference validated`);
      return true;
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error validating Discord client:`, error);
      return false;
    }
  }
  
  // Helper function to get clean username without phone number
  getCleanUsername(username) {
    return formatDisplayName(username);
  }
  
  // Helper function to force cleanup a file
  forceCleanupFile(filePath) {
    if (!filePath) return false;
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[BaileysDiscordHandler:${this.instanceId}] 🗑️ DELETED: ${filePath}`);
        
        // Double-check it's really gone
        if (fs.existsSync(filePath)) {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] ⚠️ File still exists after deletion attempt: ${filePath}`);
          // Try one more time
          fs.unlinkSync(filePath);
          console.log(`[BaileysDiscordHandler:${this.instanceId}] 🗑️ Second deletion attempt for: ${filePath}`);
          return !fs.existsSync(filePath);
        }
        return true;
      } else {
        return true; // Consider it a success if the file doesn't exist
      }
    } catch (e) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error deleting ${filePath}: ${e.message}`);
      return false;
    }
  }

  async sendSpecialChannelFollowUps(mentionedSpecialChannels, whatsappNumber) {
    if (!whatsappNumber || mentionedSpecialChannels.length === 0) return;
    
    // Send each special channel message as a separate follow-up
    for (const channelInfo of mentionedSpecialChannels) {
      try {
        // Wait a short time to ensure messages arrive in order
        await new Promise(resolve => setTimeout(resolve, 250));
        
        // Send the special message
        await this.baileysClient.sendMessage(whatsappNumber, channelInfo.message);
        console.log(`[BaileysDiscordHandler:${this.instanceId}] Sent special channel follow-up for #${channelInfo.name}`);
      } catch (error) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending special channel follow-up:`, error);
      }
    }
  }
  
  // Then modify the formatMentionsForWhatsApp function
  formatMentionsForWhatsApp(content, guild, whatsappNumber) {
    // Get instance settings
    const InstanceManager = require("../../core/InstanceManager");
    const instance = InstanceManager.getInstanceByGuildId(guild.id);
    const specialChannels = instance?.customSettings?.specialChannels || {};
    
    // Track mentioned special channels for follow-up messages
    const mentionedSpecialChannels = [];
    
    // Format user mentions to show nicknames
    let formattedContent = content.replace(/<@!?(\d+)>/g, (match, userId) => {
      const member = guild.members.cache.get(userId);
      if (member) {
        return `@${member.displayName}`;
      }
      return match;
    });
    
    // Format channel mentions - now we keep the channel name and track for follow-ups
    formattedContent = formattedContent.replace(/<#(\d+)>/g, (match, channelId) => {
      const channel = guild.channels.cache.get(channelId);
      
      // Check if this is a special channel
      if (specialChannels[channelId]) {
        // Keep track of it for follow-up messages
        if (channel) {
          mentionedSpecialChannels.push({
            id: channelId,
            name: channel.name,
            message: specialChannels[channelId].message
          });
        }
      }
      
      // Return just the channel name with # prefix
      if (channel) {
        return `#${channel.name}`;
      }
      return match;
    });
    
    // Schedule follow-up messages if needed and if we have the receiver's number
    if (mentionedSpecialChannels.length > 0 && whatsappNumber) {
      // Use setTimeout to ensure this happens after the main message is sent
      setTimeout(() => {
        this.sendSpecialChannelFollowUps(mentionedSpecialChannels, whatsappNumber);
      }, 500);
    }
    
    return formattedContent;
  }

  // Discord Message Handler with filtering
  async handleDiscordMessage(message) {
    if (message.author.bot) return;
    
    // Skip processing if channel is not in the right category
    if (message.channel.parentId !== this.categoryId) {
      return;
    }
    
    // Check if it's a command
    if (message.content.startsWith('!')) {
      const handled = await this.handleDiscordCommand(message);
      if (handled) {
        return; // Skip further processing if it was a command
      }
    }
    
    // Filter unwanted messages
    if (this.shouldFilterMessage(message.content)) {
      console.log(`[BaileysDiscordHandler:${this.instanceId}] 🚫 Filtering Discord message: ${message.content.substring(0, 50)}...`);
      return;
    }
    
    console.log(`[BaileysDiscordHandler:${this.instanceId}] Processing Discord message in ${message.channel.name}: ${message.content}`);
  
    // Find associated WhatsApp number using properly isolated channelManager
    let whatsappNumber = null;
    if (this.channelManager && typeof this.channelManager.getWhatsAppNumberByChannelId === 'function') {
      whatsappNumber = this.channelManager.getWhatsAppNumberByChannelId(message.channel.id);
    } else {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] channelManager is missing or getWhatsAppNumberByChannelId method is not available`);
      await message.reply('Internal error: Channel manager is not properly initialized. This message will not be forwarded to WhatsApp.');
      return;
    }
    
    if (!whatsappNumber) {
      // No WhatsApp user found
      await message.reply('Could not find associated WhatsApp contact for this channel. This ticket may be closed or misconfigured.');
      console.error(`[BaileysDiscordHandler:${this.instanceId}] No WhatsApp number found for channel ID: ${message.channel.id}`);
      return;
    }
    
    // Check if the channel name starts with ✓ (closed ticket)
    if (message.channel.name.startsWith('✓')) {
      await message.reply('This ticket is closed. Messages will not be forwarded to the user.');
      return;
    }
  
    // Format the message for WhatsApp with server nickname
    const member = message.member;
    const displayName = member ? member.displayName : message.author.username;
    
    // Store the phone-username mapping for consistency
    if (this.userCardManager && typeof this.userCardManager.getUserCard === 'function') {
      const userCard = this.userCardManager.getUserCard(whatsappNumber);
      if (userCard && userCard.name && this.mediaManager && typeof this.mediaManager.setPhoneToUsername === 'function') {
        // CRITICAL FIX: Use clean username when setting phone mapping
        const cleanUsername = this.getCleanUsername(userCard.name);
        this.mediaManager.setPhoneToUsername(whatsappNumber, cleanUsername);
      }
    }
    
    // Handle media if present
    if (message.attachments.size > 0) {
      const mediaHandled = await this.handleMediaMessage(message, whatsappNumber, displayName);
      if (mediaHandled) {
        return; // Media was handled and sent with caption
      }
    }
    
    // Send text message if there's content and no media was handled
    if (message.content) {
      // Format the message
      const formattedMessage = `*${displayName}:* ${this.formatMentionsForWhatsApp(message.content, message.guild,whatsappNumber)}`;
      
      try {
        if (!this.baileysClient || typeof this.baileysClient.sendMessage !== 'function') {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] baileysClient is missing or sendMessage method is not available`);
          await message.reply('Internal error: WhatsApp client is not properly initialized. This message was not forwarded.');
          return;
        }
        
        await this.baileysClient.sendMessage(whatsappNumber, formattedMessage);
        await message.react('✅');
        console.log(`[BaileysDiscordHandler:${this.instanceId}] Message successfully forwarded to WhatsApp`);
      } catch (error) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending WhatsApp message:`, error);
        await message.react('❌');
        await message.reply(`Failed to send message: ${error.message}`);
      }
    }
  }
  
  // Check if a message should be filtered
  shouldFilterMessage(content) {
    if (!content) return false;
    
    // Filter bot-related messages
    if (content.includes('Whats-app-bot: [Message contained')) {
      return true;
    }
    
    // Filter out other bot messages that duplicate content
    if (content.includes('Whats-app-bot sent')) {
      return true;
    }
    
    // Filter out "Attachment failed to download" messages
    if (content.includes('Attachment failed to download:')) {
      return true;
    }
    
    // Filter out system messages
    if (content.includes('[---NewTicket---]') ||
        content.includes('Previous conversation:') ||
        content.includes('End of previous conversation') ||
        content.includes('Transcript saved:') ||
        content.includes('media files were saved')) {
      return true;
    }
    
    return false;
  }

  // Media handling with improved deduplication and error handling
  async handleMediaMessage(message, whatsappNumber, displayName) {
    // Check if we've already processed this media
    const mediaId = message.id + '-' + message.attachments.first().id;
    if (this.processedMedia.has(mediaId)) {
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Skipping already processed media: ${mediaId}`);
      return true;
    }
    
    // Get the first attachment
    const attachment = message.attachments.first();
    
    try {
      // Add to processed set immediately
      this.processedMedia.add(mediaId);
      
      // Show processing message
      const processingMsg = await message.channel.send(
        `⏳ Processing ${attachment.contentType?.includes('gif') ? 'GIF' : 'media'}... Converting for WhatsApp compatibility.`
      );
      
      // Download the media
      let mediaBuffer;
      try {
        mediaBuffer = await this.downloadDiscordImage(attachment);
      } catch (downloadError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error downloading media:`, downloadError);
        await processingMsg.edit(`❌ Error downloading media: ${downloadError.message}`);
        await message.react('❌');
        return true;
      }
      
      // Create a temp file to process
      const tempFilePath = path.join(this.tempDir, `discord_media_${Date.now()}${path.extname(attachment.name || 'file')}`);
      fs.writeFileSync(tempFilePath, mediaBuffer);
      
      // Determine media type
      const mediaType = attachment.contentType?.includes('gif') ? 'gif' : 
                       attachment.contentType?.startsWith('image/') ? 'image' :
                       attachment.contentType?.startsWith('video/') ? 'video' :
                       attachment.contentType?.startsWith('audio/') ? 'audio' :
                       'document';
      
      // Create caption
      const caption = message.content 
        ? `*${displayName}:* ${message.content}` 
        : `*${displayName}* sent you media`;
          
      // Handle based on media type
      if (mediaType === 'gif') {
        await this.handleGifMedia(processingMsg, tempFilePath, whatsappNumber, caption, message);
      } else if (mediaType === 'video') {
        await this.handleVideoMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment);
      } else if (mediaType === 'image') {
        await this.handleImageMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment);
      } else {
        // Document or other media
        await this.handleDocumentMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment);
      }
      
      return true;
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error handling media: ${error.message}`);
      
      // Try to cleanup any temp files that might have been created
      try {
        // Attempt to find and clean up temp files
        const tempFiles = fs.readdirSync(this.tempDir).filter(f => f.includes(`discord_media_${Date.now().toString().substring(0, 8)}`));
        for (const file of tempFiles) {
          this.forceCleanupFile(path.join(this.tempDir, file));
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      
      await message.reply(`Error processing media: ${error.message}`);
      await message.react('❌');
      return false;
    }
  }
  
  // Handle GIF media with optimized sending
  async handleGifMedia(processingMsg, tempFilePath, whatsappNumber, caption, message) {
    await processingMsg.edit(`⏳ Processing GIF using Baileys...`);
    
    try {
      // Send using Baileys
      await this.baileysClient.sendGif(whatsappNumber, tempFilePath, caption);
      
      // Clean up
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ GIF sent successfully!`);
      await message.react('✅');
      return true;
    } catch (gifError) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending GIF:`, gifError);
      
      // As a last resort, send caption and URL
      await processingMsg.edit(`⚠️ GIF conversion failed. Sending as URL...`);
      
      // Send caption
      await this.baileysClient.sendMessage(whatsappNumber, caption);
      
      // Get attachment from original message
      const attachment = message.attachments.first();
      
      // Send GIF URL directly
      await this.baileysClient.sendMessage(whatsappNumber, attachment.url);
      
      // Cleanup temp file
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ GIF link sent as fallback.`);
      await message.react('⚠️');
      return true;
    }
  }
  
  // Handle video media with optimized compression
  async handleVideoMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment) {
    await processingMsg.edit(`⏳ Converting video for WhatsApp...`);
    
    try {
      try {
        await processingMsg.edit(`⏳ Sending video with Baileys...`);
        await this.baileysClient.sendVideo(whatsappNumber, tempFilePath, caption);
        
        this.forceCleanupFile(tempFilePath);
        
        await processingMsg.edit(`✅ Video sent successfully!`);
        await message.react('✅');
        return true;
      } catch (videoSendError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Video send failed:`, videoSendError);
        await processingMsg.edit(`⚠️ Direct video send failed. Trying to optimize...`);
        
        // Get mediaConverter module
        const mediaConverter = require('./mediaConverter');
        
        // Convert video to WhatsApp compatible format
        const mp4Path = await mediaConverter.convertVideo(tempFilePath, { maxSize: 15 });
        
        // Clean up the temp file
        this.forceCleanupFile(tempFilePath);
        
        // Get file size
        const fileSize = (fs.statSync(mp4Path).size / (1024 * 1024)).toFixed(2);
        
        if (parseFloat(fileSize) < 16) {
          // Size is good for WhatsApp (under 16MB)
          await this.baileysClient.sendVideo(whatsappNumber, mp4Path, caption);
          
          await processingMsg.edit(`✅ Optimized video sent to WhatsApp (${fileSize}MB)!`);
          await message.react('✅');
        } else {
          // Video is still too large, use URL method
          await processingMsg.edit(`⚠️ Video is ${fileSize}MB, which exceeds WhatsApp's limit. Using URL method...`);
          
          // Send caption
          await this.baileysClient.sendMessage(whatsappNumber, caption);
          
          // Send video URL directly
          await this.baileysClient.sendMessage(whatsappNumber, attachment.url);
          
          await processingMsg.edit(`✅ Video link sent due to size limits (${fileSize}MB).`);
          await message.react('⚠️');
        }
        
        // Clean up
        mediaConverter.cleanup(mp4Path);
        return true;
      }
    } catch (videoError) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error converting video:`, videoError);
      
      // Fall back to URL method
      await processingMsg.edit(`⚠️ Error converting video. Using URL method...`);
      
      // Send caption
      await this.baileysClient.sendMessage(whatsappNumber, caption);
      
      // Send video URL directly
      await this.baileysClient.sendMessage(whatsappNumber, attachment.url);
      
      // Cleanup temp file
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ Video link sent as fallback.`);
      await message.react('⚠️');
      return true;
    }
  }
  
  // Handle image media
  async handleImageMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment) {
    await processingMsg.edit(`⏳ Sending image to WhatsApp...`);
    
    try {
      // Create a media object for Baileys
      const mimetype = attachment.contentType || 'image/jpeg';
      const mediaBuffer = fs.readFileSync(tempFilePath);
      
      // Send the image with caption
      const media = this.baileysClient.createMediaFromBuffer(mediaBuffer, mimetype, 'image.jpg');
      await this.baileysClient.sendMessage(
        whatsappNumber, 
        media,
        { caption }
      );
      
      // Clean up
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ Image sent to WhatsApp!`);
      await message.react('✅');
      return true;
    } catch (imageError) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending image:`, imageError);
      
      // Try sending as document
      await processingMsg.edit(`⚠️ Error sending as image. Trying as document...`);
      
      try {
        // Send as document
        await this.baileysClient.sendDocument(
          whatsappNumber, 
          tempFilePath,
          attachment.name || 'image.jpg',
          caption
        );
        
        // Clean up
        this.forceCleanupFile(tempFilePath);
        
        await processingMsg.edit(`✅ Image sent as document to WhatsApp!`);
        await message.react('✅');
        return true;
      } catch (docError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending as document:`, docError);
        
        // Fall back to URL
        await processingMsg.edit(`⚠️ All sending methods failed. Using URL...`);
        
        // Send caption
        await this.baileysClient.sendMessage(whatsappNumber, caption);
        
        // Send image URL directly
        await this.baileysClient.sendMessage(whatsappNumber, attachment.url);
        
        // Cleanup temp file
        this.forceCleanupFile(tempFilePath);
        
        await processingMsg.edit(`✅ Image link sent as fallback.`);
        await message.react('⚠️');
        return true;
      }
    }
  }
  
  // Handle document media
  async handleDocumentMedia(processingMsg, tempFilePath, whatsappNumber, caption, message, attachment) {
    await processingMsg.edit(`⏳ Processing file as document...`);
    
    try {
      // Send as document
      await this.baileysClient.sendDocument(
        whatsappNumber,
        tempFilePath,
        attachment.name || 'file',
        caption
      );
      
      // Clean up
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ File sent as document to WhatsApp!`);
      await message.react('✅');
      return true;
    } catch (docError) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending document:`, docError);
      
      // Fall back to URL with description
      await processingMsg.edit(`⚠️ Error sending document. Using URL...`);
      
      // Send description with URL
      await this.baileysClient.sendMessage(
        whatsappNumber, 
        `${caption}\n\nView it here: ${attachment.url}`
      );
      
      // Cleanup temp file
      this.forceCleanupFile(tempFilePath);
      
      await processingMsg.edit(`✅ Document link sent as fallback.`);
      await message.react('⚠️');
      return true;
    }
  }
  
  // Download an image from a Discord message
  async downloadDiscordImage(attachment) {
    try {
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Downloading attachment from: ${attachment.url}`);
      const response = await axios({
        method: 'GET',
        url: attachment.url,
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'WhatsApp-Discord-Bridge'
        }
      });
      
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Download successful, content length: ${response.data.length} bytes`);
      return Buffer.from(response.data);
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error downloading media: ${error.message}`);
      throw new Error(`Failed to download media: ${error.message}`);
    }
  }
  
  // Handle Discord commands
  async handleDiscordCommand(message) {
    const command = message.content.split(' ')[0].toLowerCase();
    
    // Handle vouch command
    if (command === '!vouch') {
      try {
        // Check if vouchHandler is available
        if (this.vouchHandler && typeof this.vouchHandler.handleDiscordVouchCommand === 'function') {
          if (this.vouchHandler.isDisabled) {
            await message.reply('The vouch system is currently disabled.');
            return true; // Command was handled (even though it was rejected)
          }

          return await this.vouchHandler.handleDiscordVouchCommand(message);
        } else {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] vouchHandler is missing or handleDiscordVouchCommand method is not available`);
          await message.reply('The vouch command is not available. Please contact an administrator.');
          return true;
        }
      } catch (error) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error processing vouch command:`, error);
        await message.reply(`Error processing vouch command: ${error.message}`);
        return true;
      }
    }
    
    // Handle close command
    if (command === '!close') {
      try {
        if (this.ticketManager && typeof this.ticketManager.handleCloseTicket === 'function') {
          await this.ticketManager.handleCloseTicket(message);
          return true;
        } else {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] ticketManager is missing or handleCloseTicket method is not available`);
          await message.reply('The close command is not available. Please contact an administrator.');
          return true;
        }
      } catch (error) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error closing ticket:`, error);
        await message.reply(`Error closing ticket: ${error.message}`);
        return true;
      }
    }
    
    return false; // Not a recognized command
  }
  
  createUserEditModal(phoneNumber) {
    try {
      // Validate userCardManager
      if (!this.userCardManager || typeof this.userCardManager.getUserCard !== 'function') {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] userCardManager is missing or getUserCard method is not available`);
        return null;
      }
      
      // Get user card for this phone number
      const userCard = this.userCardManager.getUserCard(phoneNumber);
      
      // Use MediaManager for consistent name formatting
      const MediaManager = require('../../utils/MediaManager');
      const { formatDisplayName } = MediaManager.formatFunctions;
      
      // FIXED: Simple custom ID format that won't get parsed incorrectly
      const modal = new ModalBuilder()
        .setCustomId(`user-edit-modal-${phoneNumber}`)
        .setTitle('Edit User Information');
      
      // CRITICAL FIX: Get clean username without phone
      const cleanName = userCard?.name ? formatDisplayName(userCard.name) : '';
      
      // Add input fields for each editable property
      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Name')
        .setStyle(TextInputStyle.Short)
        .setValue(cleanName)
        .setRequired(true);
      
      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph) // Use Paragraph for multiline text
        .setValue(userCard?.notes || '')
        .setRequired(false);
      
      // Add components to the modal
      const nameRow = new ActionRowBuilder().addComponents(nameInput);
      const notesRow = new ActionRowBuilder().addComponents(notesInput);
      
      modal.addComponents(nameRow, notesRow);
      
      return modal;
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error creating user edit modal:`, error);
      return null;
    }
  }

  // Create a modal for editing user information with simplified fields
  createUserEditModal(phoneNumber) {
    if (!this.userCardManager || typeof this.userCardManager.getUserCard !== 'function') {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] userCardManager is missing or getUserCard method is not available`);
      return null;
    }
    
    try {
      const userCard = this.userCardManager.getUserCard(phoneNumber);
      
      // FIXED: Simple custom ID format without hyphens in the phone part to avoid parsing errors
      const modal = new ModalBuilder()
        .setCustomId(`user-edit-modal-${phoneNumber}`)
        .setTitle('Edit User Information');
      
      // CRITICAL FIX: Get clean username without phone
      const cleanName = userCard?.name ? this.getCleanUsername(userCard.name) : '';
      
      // Add input fields for each editable property
      const nameInput = new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Name')
        .setStyle(TextInputStyle.Short)
        .setValue(cleanName)
        .setRequired(true);
      
      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph) // Use Paragraph for multiline text
        .setValue(userCard?.notes || '')
        .setRequired(false);
      
      // Add components to the modal
      const nameRow = new ActionRowBuilder().addComponents(nameInput);
      const notesRow = new ActionRowBuilder().addComponents(notesInput);
      
      modal.addComponents(nameRow, notesRow);
      
      return modal;
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error creating user edit modal:`, error);
      return null;
    }
  }
  
  // Handle interactions (buttons, modals) with improved handling
  async handleInteraction(interaction) {
    try {
      // Log the interaction for debugging
      console.log(`[BaileysDiscordHandler:${this.instanceId}] Handling interaction: ${interaction.customId}`);
  
      // Handle modal submissions first
      if (interaction.isModalSubmit() && interaction.customId.startsWith('user-edit-modal-')) {
        try {
          // Extract phone number correctly from modal ID
          const phoneNumber = interaction.customId.substring('user-edit-modal-'.length);
          
          if (!phoneNumber) {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] Error: Invalid phone number in modal ID: ${interaction.customId}`);
            await interaction.reply({ content: 'Error: Invalid phone number in modal ID', ephemeral: true });
            return;
          }
          
          console.log(`[BaileysDiscordHandler:${this.instanceId}] Processing modal submission for phone: ${phoneNumber}`);
          
          // Get values from the modal
          const name = interaction.fields.getTextInputValue('name');
          const notes = interaction.fields.getTextInputValue('notes') || '';
          
          console.log(`[BaileysDiscordHandler:${this.instanceId}] Processing modal submission: Name: ${name}, Notes: ${notes?.substring(0, 50)}...`);
          
          // Immediately acknowledge the interaction
          await interaction.deferReply({ ephemeral: true });
          
          // Validate userCardManager
          if (!this.userCardManager || typeof this.userCardManager.getUserCard !== 'function') {
            await interaction.editReply({ content: 'Error: User manager not available', ephemeral: true });
            return;
          }
          
          // Store the old name for channel renaming
          const userCard = this.userCardManager.getUserCard(phoneNumber);
          const oldName = userCard?.name || '';
          
          // Use MediaManager's format functions for consistent formatting
          const MediaManager = require('../../utils/MediaManager');
          const { formatDisplayName } = MediaManager.formatFunctions;
          
          // CRITICAL FIX: Use clean names for everything
          const cleanOldName = formatDisplayName(oldName);
          const cleanNewName = formatDisplayName(name);
          
          console.log(`[BaileysDiscordHandler:${this.instanceId}] Updating user info - Name: ${cleanNewName}, Old Name: ${cleanOldName}`);
          
          // IMPORTANT: Force immediate directory renaming with consistent naming
          try {
            if (oldName && cleanOldName !== cleanNewName) {
              console.log(`[BaileysDiscordHandler:${this.instanceId}] 📂 FORCING DIRECTORY RENAME: ${cleanOldName} -> ${cleanNewName}`);
              
              // Use our proper instance-specific mediaManager to handle a consistent rename
              if (this.mediaManager) {
                if (typeof this.mediaManager.setPhoneToUsername === 'function') {
                  // Force immediate directory structure updates
                  this.mediaManager.setPhoneToUsername(phoneNumber, cleanNewName);
                  console.log(`[BaileysDiscordHandler:${this.instanceId}] 📂 DIRECTORY RENAME COMPLETED`);
                } else {
                  console.error(`[BaileysDiscordHandler:${this.instanceId}] mediaManager is missing setPhoneToUsername method`);
                }
              } else {
                console.error(`[BaileysDiscordHandler:${this.instanceId}] mediaManager is not available for directory rename`);
              }
            }
          } catch (renameError) {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] Error in forced directory rename: ${renameError.message}`);
          }
          
          // Update the user card AFTER renaming the directory
          if (typeof this.userCardManager.updateUserCard === 'function') {
            this.userCardManager.updateUserCard(phoneNumber, { 
              name, 
              notes
            });
          } else {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] userCardManager is missing updateUserCard method`);
          }
          
          // Update the ticket embed
          const channel = interaction.channel;
          const pinnedMessages = await channel.messages.fetchPinned();
          
          for (const [, message] of pinnedMessages) {
            if (message.embeds.length > 0) {
              const embed = message.embeds[0];
              
              // Create a formatted notes section
              const formattedNotes = notes 
                ? notes 
                : 'No notes provided yet. Use the Edit button to add details.';
              
              // Create updated embed, keeping same format but with new data
              const updatedEmbed = new EmbedBuilder()
                .setColor(embed.color || 0x00AE86)
                .setTitle(embed.title || 'Ticket Tool')
                .setDescription(`\`\`\`${cleanNewName}\`\`\` \`\`\`${phoneNumber}\`\`\``);
              
              // Find and maintain the "Opened Ticket" field
              if (embed.fields) {
                for (const field of embed.fields) {
                  if (field.name === 'Opened Ticket') {
                    updatedEmbed.addFields({
                      name: field.name,
                      value: field.value,
                      inline: field.inline || false
                    });
                    break;
                  }
                }
              }
              
              // Add the Notes field with properly formatted content
              updatedEmbed.addFields({
                name: 'Notes',
                value: `\`\`\`${formattedNotes}\`\`\``,
                inline: false
              });
              
              // CRITICAL: Preserve the edit and close buttons
              const row = new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(`edit-user-${phoneNumber}`)
                    .setLabel('Edit')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId(`close-ticket-${channel.id}`)
                    .setLabel('Close')
                    .setStyle(ButtonStyle.Danger)
                );
              
              // Update both the embed and the buttons
              await message.edit({ 
                embeds: [updatedEmbed],
                components: [row]
              });
              
              break;
            }
          }
          
          // FIXED: Update channel name when name is edited WITH HYPHEN
          if (oldName && cleanOldName !== cleanNewName) {
            try {
              // Make sure the name in the channel is updated
              const currentChannelName = channel.name;
              
              console.log(`[BaileysDiscordHandler:${this.instanceId}] Channel name before: ${currentChannelName}`);
              
              // FIXED: Preserve emoji with hyphen format
              let newChannelName;
              
              // Check if the channel name starts with an emoji (Unicode character or 📋)
              if (/^[^\w\d-]/.test(currentChannelName) || currentChannelName.startsWith('📋')) {
                // Find where the name part starts (after emoji and hyphen)
                // We check for the first hyphen character
                const hyphenIndex = currentChannelName.indexOf('-');
                
                if (hyphenIndex > 0) {
                  // Extract the prefix with hyphen
                  const prefix = currentChannelName.substring(0, hyphenIndex + 1);
                  console.log(`[BaileysDiscordHandler:${this.instanceId}] Found prefix with hyphen: "${prefix}"`);
                  
                  // Format the new name - CRITICAL FIX: Use clean name
                  const formattedName = cleanNewName.replace(/\s+/g, '-').toLowerCase();
                  newChannelName = `${prefix}${formattedName}`;
                } else {
                  // No hyphen found, append one to the emoji
                  const emojiMatch = currentChannelName.match(/^([^\w\d-]+)/);
                  if (emojiMatch && emojiMatch[1]) {
                    const emojiPrefix = emojiMatch[1];
                    const formattedName = cleanNewName.replace(/\s+/g, '-').toLowerCase();
                    newChannelName = `${emojiPrefix}-${formattedName}`;
                    console.log(`[BaileysDiscordHandler:${this.instanceId}] Adding hyphen after emoji: ${emojiPrefix}-`);
                  } else {
                    // Fallback
                    newChannelName = cleanNewName.replace(/\s+/g, '-').toLowerCase();
                  }
                }
              } else {
                // No emoji, just use the name with Discord naming rules
                newChannelName = cleanNewName.replace(/\s+/g, '-').toLowerCase();
              }
              
              console.log(`[BaileysDiscordHandler:${this.instanceId}] Renaming channel to: ${newChannelName}`);
              
              // Set the new channel name
              await channel.setName(newChannelName);
              console.log(`[BaileysDiscordHandler:${this.instanceId}] Channel renamed from ${currentChannelName} to ${newChannelName}`);
            } catch (renameError) {
              console.error(`[BaileysDiscordHandler:${this.instanceId}] Error renaming channel: ${renameError.message}`);
            }
          }
          
          // Edit the reply after all operations are complete
          await interaction.editReply({ content: `User information updated!` });
        } catch (modalError) {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] Error processing modal:`, modalError);
          try {
            if (interaction.deferred) {
              await interaction.editReply({ content: `Error updating user: ${modalError.message}`, ephemeral: true });
            } else {
              await interaction.reply({ content: `Error updating user: ${modalError.message}`, ephemeral: true });
            }
          } catch (replyError) {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] Error replying after modal error:`, replyError);
          }
        }
        return;
      }
  
      // Handle buttons
      if (interaction.isButton()) {
        // Handle edit-user button
        if (interaction.customId.startsWith('edit-user-')) {
          try {
            // Extract phone number correctly from button ID
            const phoneNumber = interaction.customId.substring('edit-user-'.length);
            
            console.log(`[BaileysDiscordHandler:${this.instanceId}] Edit button clicked for phone: ${phoneNumber}`);
            
            // Validate userCardManager
            if (!this.userCardManager || typeof this.userCardManager.getUserCard !== 'function') {
              await interaction.reply({ content: 'Error: User manager not available', ephemeral: true });
              return;
            }
            
            // Show the modal for editing user info
            const modal = this.createUserEditModal(phoneNumber);
            if (modal) {
              // FIXED: Don't defer, just show the modal directly
              console.log(`[BaileysDiscordHandler:${this.instanceId}] Showing edit modal for phone: ${phoneNumber}`);
              await interaction.showModal(modal);
              return;
            } else {
              await interaction.reply({ content: 'Error: Could not create user edit form', ephemeral: true });
              return;
            }
          } catch (buttonError) {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] Error handling edit button:`, buttonError);
            await interaction.reply({ content: `Error: ${buttonError.message}`, ephemeral: true });
            return;
          }
        } 
        // Handle close-ticket button
        else if (interaction.customId.startsWith('close-ticket-')) {
          try {
            // Extract channel ID correctly from button ID
            const channelId = interaction.customId.substring('close-ticket-'.length);
            console.log(`[BaileysDiscordHandler:${this.instanceId}] Closing ticket with channel ID: ${channelId}`);
            
            // Get user info for sending closing message via WhatsApp
            const sender = this.channelManager?.getWhatsAppNumberByChannelId?.(interaction.channel.id);
            
            // First, acknowledge the interaction
            await interaction.reply({ 
              content: "Closing ticket and generating transcript...", 
              ephemeral: true 
            });
            
            // Get username for transcript
            let username = interaction.channel.name.replace(/^(✓|📋\s*-\s*)/, '');
            if (this.userCardManager && sender) {
              try {
                const userCard = this.userCardManager.getUserCard(sender);
                if (userCard && userCard.name) {
                  const MediaManager = require('../../utils/MediaManager');
                  username = MediaManager.formatFunctions.formatDisplayName(userCard.name);
                }
              } catch (err) {
                console.error(`[BaileysDiscordHandler:${this.instanceId}] Error getting username:`, err);
              }
            }
            
            // Send closing message to WhatsApp user if applicable

            const settingsPath = path.join(
                    __dirname,
                    "..",
                    "instances",
                    interaction.guildId,
                    "settings.json"
                  );
            
                  // Assume disabled by default
                  let shouldSendMessage = false;
            
                  if (fs.existsSync(settingsPath)) {
                    try {
                      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            
                      // ONLY send if explicitly true
                      if (settings.sendClosingMessage === true) {
                        shouldSendMessage = true;
                      }
            
                      console.log(
                        `[BaileysDiscordHandler:${this.instanceId}] Closing message setting: ${settings.sendClosingMessage}`
                      );
                      console.log(
                        `[BaileysDiscordHandler:${this.instanceId}] Should send message: ${shouldSendMessage}`
                      );
                    } catch (readError) {
                      console.error(
                        `[BaileysDiscordHandler:${this.instanceId}] Error reading settings:`,
                        readError
                      );
                    }
                  } else {
                    console.log(
                      `[BaileysDiscordHandler:${this.instanceId}] No settings file found at ${settingsPath}`
                    );
                  }
            if (sender && this.baileysClient && shouldSendMessage) {
              try {
                // Use custom message if configured
                let closeMessage = "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.";
                
                if (this.ticketManager?.getFormattedCloseMessage) {
                  closeMessage = this.ticketManager.getFormattedCloseMessage(username, sender);
                }
                
                await this.baileysClient.sendMessage(sender, closeMessage);
                console.log(`[BaileysDiscordHandler:${this.instanceId}] Sent closing message to ${sender}`);
              } catch (sendError) {
                console.error(`[BaileysDiscordHandler:${this.instanceId}] Error sending closing message:`, sendError);
              }
            } else{
              console.log("Cant send closing message because setting is off.");
            }
            
            // Make sure transcript manager has the phone number
            if (this.transcriptManager?.ensurePhoneForTranscript && sender) {
              this.transcriptManager.ensurePhoneForTranscript(interaction.channel.id, sender, username);
            }
            
            // Generate transcript
            let transcriptPath = null;
            try {
              if (this.transcriptManager?.generateHTMLTranscript) {
                transcriptPath = await this.transcriptManager.generateHTMLTranscript(
                  interaction.channel, 
                  interaction.user
                );
                
                // Update the interaction with success message
                await interaction.editReply("Transcript saved successfully. This channel will be deleted in 5 seconds.");
              } else {
                await interaction.editReply("Error: Transcript manager not available. Channel will be deleted in 5 seconds.");
              }
            } catch (transcriptError) {
              console.error(`[BaileysDiscordHandler:${this.instanceId}] Error generating transcript:`, transcriptError);
              await interaction.editReply(`Error generating transcript: ${transcriptError.message}. Channel will be deleted in 5 seconds.`);
            }
            
            // Remove from channel map
            if (sender && this.channelManager?.removeChannelMapping) {
              this.channelManager.removeChannelMapping(sender);
            }
            
            // Mark as closed
            if (this.ticketManager?.setTicketStatus) {
              this.ticketManager.setTicketStatus(interaction.channel.id, 'closed');
            }
            
            // Wait 5 seconds before deleting
            setTimeout(async () => {
              try {
                if (this.ticketManager?.deleteChannel) {
                  await this.ticketManager.deleteChannel(interaction.channel.id);
                } else {
                  // Fallback to direct deletion
                  const channel = await this.discordClient.channels.fetch(interaction.channel.id).catch(() => null);
                  if (channel) {
                    await channel.delete('Ticket closed');
                  }
                }
              } catch (deleteError) {
                console.error(`[BaileysDiscordHandler:${this.instanceId}] Error deleting channel:`, deleteError);
              }
            }, 5000);
            
            return;
          } catch (error) {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] Error handling close button:`, error);
            if (!interaction.replied) {
              await interaction.reply({ content: `Failed to close ticket: ${error.message}`, ephemeral: true });
            }
            return;
          }
        }
      }
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error in handleInteraction:`, error);
      
      // Try to respond to the interaction if not yet responded
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An error occurred while processing this action.', ephemeral: true });
        } else if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: 'An error occurred while processing this action.' });
        }
      } catch (replyError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error replying to interaction after failure:`, replyError);
      }
    }
  }
  
  async handleLegacyCloseButton(interaction, channelId) {
    try {
      // Get the associated WhatsApp number using multiple methods
      let sender = null;
      if (this.channelManager && typeof this.channelManager.getWhatsAppNumberByChannelId === 'function') {
        sender = this.channelManager.getWhatsAppNumberByChannelId(interaction.channel.id);
      }
      
      // Generate and save transcript
      let transcriptGenerated = false;
      try {
        await interaction.editReply("Closing ticket and generating transcript...");
        if (this.transcriptManager && typeof this.transcriptManager.generateHTMLTranscript === 'function') {
          // CRITICAL FIX: Get proper username for transcript
          let username = interaction.channel.name.replace(/^(✓|📋\s*-\s*)/, '');
          if (this.userCardManager && sender) {
            try {
              const userCard = this.userCardManager.getUserCard(sender);
              if (userCard && userCard.name) {
                // CRITICAL FIX: Clean the username
                const MediaManager = require('../../utils/MediaManager');
                username = MediaManager.formatFunctions.formatDisplayName(userCard.name);
              }
            } catch (err) {
              console.error(`[BaileysDiscordHandler:${this.instanceId}] Error getting username:`, err);
            }
          }
          
          // Make sure phone number is set in transcript manager
          if (this.transcriptManager.ensurePhoneForTranscript && sender) {
            this.transcriptManager.ensurePhoneForTranscript(interaction.channel.id, sender, username);
          }
          
          const transcript = await this.transcriptManager.generateHTMLTranscript(interaction.channel, interaction.user);
          transcriptGenerated = !!transcript;
          await interaction.editReply("Transcript saved successfully. This channel will be deleted in 5 seconds.");
        } else {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] transcriptManager is missing or generateHTMLTranscript method is not available`);
          await interaction.editReply("Error: Transcript manager not available. Channel will be deleted in 5 seconds.");
        }
      } catch (transcriptError) {
        console.error(`[BaileysDiscordHandler:${this.instanceId}] Error generating transcript:`, transcriptError);
        await interaction.editReply(`Error generating transcript: ${transcriptError.message}. Channel will be deleted in 5 seconds.`);
      }
      
      // Remove from channel map if we found the sender
      if (sender && this.channelManager && typeof this.channelManager.removeChannelMapping === 'function') {
        this.channelManager.removeChannelMapping(sender);
      }
      
      // Mark in ticket status map as closed
      if (this.ticketManager && typeof this.ticketManager.setTicketStatus === 'function') {
        this.ticketManager.setTicketStatus(interaction.channel.id, 'closed');
      }
      
      // Wait 5 seconds before deleting
      setTimeout(async () => {
        try {
          if (this.ticketManager && typeof this.ticketManager.deleteChannel === 'function') {
            await this.ticketManager.deleteChannel(interaction.channel.id);
          } else {
            console.error(`[BaileysDiscordHandler:${this.instanceId}] ticketManager is missing or deleteChannel method is not available`);
            // Try to delete directly as fallback
            const channel = await this.discordClient.channels.fetch(interaction.channel.id).catch(e => null);
            if (channel) {
              await channel.delete('Ticket closed');
            }
          }
        } catch (deleteError) {
          console.error(`[BaileysDiscordHandler:${this.instanceId}] Error deleting channel: ${deleteError.message}`);
        }
      }, 5000);
    } catch (error) {
      console.error(`[BaileysDiscordHandler:${this.instanceId}] Error in legacy close:`, error);
      throw error;
    }
  }
}

module.exports = BaileysDiscordHandler;