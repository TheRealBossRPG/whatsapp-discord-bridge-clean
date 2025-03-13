// modules/BaileysWhatsAppHandler.js - FIXED FOR PROPER NAME HANDLING
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const MediaManager = require("./MediaManager");
const { formatDisplayName, formatDirectoryName, cleanPhoneNumber } =
  MediaManager.formatFunctions;

class BaileysWhatsAppHandler {
  constructor(
    baileysClient,
    userCardManager,
    channelManager,
    ticketManager,
    transcriptManager,
    vouchHandler,
    options = {}
  ) {
    this.baileysClient = baileysClient;
    this.userCardManager = userCardManager;
    this.channelManager = channelManager;
    this.ticketManager = ticketManager;
    this.transcriptManager = transcriptManager;
    this.vouchHandler = vouchHandler;

    // Set instance ID
    this.instanceId = options.instanceId || "default";

    // Configure temp directory
    this.tempDir =
      options.tempDir ||
      path.join(__dirname, "..", "instances", this.instanceId, "temp");
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    // Default welcome messages
    this.welcomeMessage =
    options.welcomeMessage ||
    "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
  this.introMessage =
    options.introMessage ||
    "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
  this.reopenTicketMessage = 
    options.reopenTicketMessage || 
    "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";

    // Use custom mediaManager if provided
    if (options.mediaManager) {
      this.mediaManager = options.mediaManager;
    } else {
      // Create a new MediaManager instance
      try {
        this.mediaManager = new MediaManager({
          instanceId: this.instanceId,
          baseDir: path.join(
            __dirname,
            "..",
            "instances",
            this.instanceId,
            "transcripts"
          ),
        });
      } catch (error) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Error creating MediaManager: ${error.message}`
        );
      }
    }

    // Flag to control media saving
    this.savePermanentMedia = options.savePermanentMedia || false;
    console.log(
      `[BaileysWhatsAppHandler:${this.instanceId}] Permanent media saving is ${
        this.savePermanentMedia ? "enabled" : "disabled"
      }`
    );

    // Initialize collections for message tracking
    this.processedMessageIds = new Set();
    this.processedMediaIds = new Set();
    this.incomingMessages = new Map();
    this.messageProcessing = new Set();
    this._introFlowUsers = new Map();
    this._messageAuthors = new Map();

    // Validate managers to ensure they're all available
    this.validateManagers();

    // Clean temp directory on startup
    this.cleanTempDirectory();

    // Set up event listeners at initialization
    this.setupEventListeners();

    console.log(
      `[BaileysWhatsAppHandler:${this.instanceId}] Initialized with all managers`
    );
  }

  // Validation function for manager references
  validateManagers() {
    // Check userCardManager
    if (!this.userCardManager) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: userCardManager is missing!`
      );
    } else if (typeof this.userCardManager.getUserCard !== "function") {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: userCardManager does not have getUserCard method!`
      );
    }

    // Check channelManager
    if (!this.channelManager) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: channelManager is missing!`
      );
    } else if (
      typeof this.channelManager.getChannelIdByPhoneNumber !== "function"
    ) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: channelManager does not have getChannelIdByPhoneNumber method!`
      );
    }

    // Check ticketManager
    if (!this.ticketManager) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: ticketManager is missing!`
      );
    } else if (
      typeof this.ticketManager.getExistingTicket !== "function" ||
      typeof this.ticketManager.createTicket !== "function"
    ) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: ticketManager methods are missing!`
      );
    }

    // Check mediaManager
    if (!this.mediaManager) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] WARNING: mediaManager is missing!`
      );
    }

    // Log validation results
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Validated managers:
      - userCardManager: ${this.userCardManager ? "Available" : "Missing"} 
      - channelManager: ${this.channelManager ? "Available" : "Missing"}
      - ticketManager: ${this.ticketManager ? "Available" : "Missing"}
      - mediaManager: ${this.mediaManager ? "Available" : "Missing"}`);
  }

  // Clean temp directory
  cleanTempDirectory() {
    try {
      console.log(
        `[BaileysWhatsAppHandler:${this.instanceId}] Cleaning temp directory on startup...`
      );
      if (fs.existsSync(this.tempDir)) {
        const files = fs.readdirSync(this.tempDir);
        let cleanedCount = 0;

        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.tempDir, file));
            cleanedCount++;
          } catch (e) {
            console.error(
              `[BaileysWhatsAppHandler:${this.instanceId}] Could not delete temp file ${file}: ${e.message}`
            );
          }
        }

        console.log(
          `[BaileysWhatsAppHandler:${this.instanceId}] Cleaned up ${cleanedCount} temp files on startup`
        );
      }
    } catch (e) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error cleaning temp directory: ${e.message}`
      );
    }
  }

  setupEventListeners() {
    if (!this.baileysClient) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Cannot set up event listeners: Baileys client is null!`);
      return;
    }
    
    // Only set up listeners once
    if (this._hasRegisteredListeners) {
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Event listeners already set up, skipping`);
      return;
    }
    
    // CRITICAL FIX: Set up message event listener with explicit binding to this instance
    this.baileysClient.on('message', async (msg) => {
      try {
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Message received: ${msg.from}`);
        await this.handleWhatsAppMessage(msg);
      } catch (error) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error handling message:`, error);
      }
    });
    
    this._hasRegisteredListeners = true;
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] WhatsApp message event listeners configured`);
  }

  // Enqueue message and process in order
  async enqueueMessage(msg) {
    try {
      if (!msg || !msg.from) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Invalid message received: missing 'from' property`
        );
        return;
      }

      const sender = msg.from;

      // IMPORTANT: Skip if we've already processed this message
      if (this.processedMessageIds.has(msg.id)) {
        console.log(
          `[BaileysWhatsAppHandler:${this.instanceId}] Skipping already processed message: ${msg.id}`
        );
        return;
      }

      // Add to processed messages set
      this.processedMessageIds.add(msg.id);

      // Keep the set from growing too large by implementing a simple LRU mechanism
      if (this.processedMessageIds.size > 1000) {
        // Remove oldest 200 entries when we reach 1000
        const toRemove = Array.from(this.processedMessageIds).slice(0, 200);
        toRemove.forEach((id) => this.processedMessageIds.delete(id));
      }

      // Initialize queue if needed
      if (!this.incomingMessages.has(sender)) {
        this.incomingMessages.set(sender, []);
      }

      // Add message to queue
      this.incomingMessages.get(sender).push(msg);

      // Start processing if not already in progress
      if (!this.messageProcessing.has(sender)) {
        this.messageProcessing.add(sender);
        await this.processMessageQueue(sender);
      }
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error enqueueing message:`,
        error
      );
    }
  }

  // Process messages in queue order
  async processMessageQueue(sender) {
    try {
      // Get the message queue
      const queue = this.incomingMessages.get(sender) || [];

      // Process all messages in order
      while (queue.length > 0) {
        const msg = queue.shift();
        await this.handleWhatsAppMessage(msg);
      }

      // Clear the processing flag
      this.messageProcessing.delete(sender);

      // Clear the queue
      this.incomingMessages.set(sender, []);
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error processing message queue:`,
        error
      );

      // Clear the processing flag even on error
      this.messageProcessing.delete(sender);
    }
  }

  // WhatsApp Message Handler
  async handleWhatsAppMessage(msg) {
    try {
      // Validate message
      if (!msg || !msg.from) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Invalid message received: missing 'from' property`);
        return;
      }
      
      const sender = msg.from;
      const messageBody = msg && msg.body ? msg.body.trim() : '';
      
      // Check for unique message ID
      const messageId = msg.id || msg.key?.id;
      
      // Skip if we've already processed this message
      if (messageId && this.processedMessageIds.has(messageId)) {
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Skipping duplicate message: ${messageId}`);
        return;
      }
      
      // Skip if this is a media message we've already processed
      if (msg.hasMedia && messageId && this.processedMediaIds.has(messageId)) {
        console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Skipping already processed media message: ${messageId}`);
        return;
      }
      
      // Get the contact's real name as fallback
      let senderName;
      try {
        if (typeof msg.getContact === 'function') {
          const contact = await msg.getContact();
          senderName = contact.pushname || contact.name || sender.split('@')[0];
        } else {
          senderName = sender.split('@')[0]; // Fallback to number
        }
      } catch (error) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error getting contact info:`, error);
        senderName = sender.split('@')[0]; // Fallback to number
      }
      
      // Store message ID as processed
      if (messageId) {
        this.processedMessageIds.add(messageId);
        
        // Keep the set from growing too large
        if (this.processedMessageIds.size > 1000) {
          const toRemove = Array.from(this.processedMessageIds).slice(0, 200);
          toRemove.forEach(id => this.processedMessageIds.delete(id));
        }
      }
      
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Message from "${senderName}" (${sender}): "${messageBody.substring(0, 30)}..."`);
      
      // Handle media info
      let mediaInfo = null;
      if (msg.hasMedia || ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type)) {
        mediaInfo = {
          hasMedia: true,
          type: msg.type || 'unknown',
          msgId: messageId
        };
      }
      
      // Check if this is a vouch command
      if (messageBody && messageBody.toLowerCase().startsWith('vouch!') && this.vouchHandler) {
        try {
          if (this.vouchHandler.isDisabled) {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Vouch system is disabled, ignoring vouch command`);
            return; // Skip vouch handling
          }
          const isVouchCommand = await this.vouchHandler.handleVouchCommand(msg, sender, senderName, messageBody);
          if (isVouchCommand) {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Handled as vouch command, skipping further processing`);
            return;
          }
        } catch (vouchError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error processing vouch command:`, vouchError);
        }
      }
      
      // Check if user is in intro flow
      if (this._introFlowUsers && this._introFlowUsers.has(sender)) {
        await this.handleIntroFlow(msg, sender, senderName, messageBody, mediaInfo);
        return;
      }
      
      // Handle user based on existing user card
      let userCard = null;
      let hasValidUserCard = false;
      
      if (this.userCardManager && typeof this.userCardManager.getUserCard === 'function') {
        try {
          userCard = this.userCardManager.getUserCard(sender);
          hasValidUserCard = (userCard && userCard.name);
        } catch (userCardError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error getting user card:`, userCardError.message);
        }
      }
      
      if (hasValidUserCard) {
        // Handle as returning user
        await this.handleReturningUser(msg, sender, userCard, messageBody, mediaInfo, senderName);
      } else {
        // New user without a name - start the intro flow
        await this.startIntroFlow(msg, sender, senderName, messageBody, mediaInfo);
      }
      
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error processing WhatsApp message:`, error);
      console.error(error.stack);
    }
  }

  async sendMessageWithRetry(recipient, message) {
    try {
      // First try: Direct sock method
      if (this.baileysClient && this.baileysClient.sock) {
        const jid = recipient.includes('@') ? recipient : `${recipient}@s.whatsapp.net`;
        await this.baileysClient.sock.sendMessage(jid, { text: message });
        return true;
      }
      
      // Second try: baileysClient.sendMessage
      if (this.baileysClient) {
        await this.baileysClient.sendMessage(recipient, message);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error in sendMessageWithRetry:`, error);
      return false;
    }
  }

  // Start the interactive flow for new users
  async startIntroFlow(msg, sender, senderName, messageBody, mediaInfo) {
    try {
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Starting intro flow for new user: ${senderName} (${sender})`);
      
      // Store message and media for when the user responds with their name
      const flowState = {
        stage: 'awaiting_name',
        originalMessage: messageBody,
        mediaInfo: mediaInfo,
        originalSenderName: senderName,
        startTime: Date.now()
      };
      
      // Store in intro flow map
      this._introFlowUsers.set(sender, flowState);
      
      // Ensure we have valid welcome message
      const welcomeMsg = this.welcomeMessage || "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?";
      
      // FIXED: Simplest direct approach for sending welcome message
      try {
        const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
        if (this.baileysClient && this.baileysClient.sock) {
          await this.baileysClient.sock.sendMessage(jid, { text: welcomeMsg });
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Sent welcome message to ${sender}: "${welcomeMsg}"`);
        } else {
          throw new Error("BaileysClient or sock is null");
        }
      } catch (sendError) {
        console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending welcome message:`, sendError);
        
        // Try fallback method
        try {
          if (this.baileysClient) {
            await this.baileysClient.sendMessage(sender, "Welcome to Support! What's your name?");
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Sent fallback welcome message to ${sender}`);
          } else {
            throw new Error("BaileysClient is null");
          }
        } catch (fallbackError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending fallback welcome:`, fallbackError);
          
          // Use basic handling as fallback
          await this.handleBasicMessage(msg, sender, senderName, messageBody, mediaInfo);
        }
      }
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error starting intro flow:`, error);
      
      // Clean up flow state
      this._introFlowUsers.delete(sender);
      
      // Use basic handling as fallback
      await this.handleBasicMessage(msg, sender, senderName, messageBody, mediaInfo);
    }
  }

  // Handle continued intro flow interaction
  async handleIntroFlow(msg, sender, senderName, messageBody, mediaInfo) {
    try {
      const flowState = this._introFlowUsers.get(sender);
      console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Continuing intro flow for ${sender}, stage: ${flowState.stage}`);
      
      // Handle awaiting_name stage
      if (flowState.stage === 'awaiting_name') {
        // Check if they provided a name
        if (!messageBody || messageBody.trim() === '') {
          // They didn't provide a name, prompt again
          try {
            const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
            if (this.baileysClient && this.baileysClient.sock) {
              await this.baileysClient.sock.sendMessage(jid, { 
                text: "Could you please share your name with us so we can help you better? 😊" 
              });
            }
          } catch (promptError) {
            console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending name prompt:`, promptError);
          }
          return;
        }
        
        // Use the message content as their name
        const name = messageBody.trim();
        
        // Update their user card with the provided name
        if (this.userCardManager && typeof this.userCardManager.updateUserCard === 'function') {
          // CRITICAL: This must happen before ticket creation to prevent phone as username
          this.userCardManager.updateUserCard(sender, { name });
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Updated user card for ${sender} with name: ${name}`);
        } else {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Cannot update user card - userCardManager is missing or updateUserCard method is not available`);
        }
        
        // Get clean display name
        const cleanName = this.mediaManager?.formatFunctions?.formatDisplayName?.(name) || name;
        
        // Update author mapping
        if (!this._messageAuthors) {
          this._messageAuthors = new Map();
        }
        const messageId = msg.id || msg.key?.id || `${sender}-${Date.now()}`;
        this._messageAuthors.set(messageId, name);
        
        // Send confirmation message using template with replaced variables
        const introMsgTemplate = this.introMessage || 
          "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!";
        
        const customIntroMessage = introMsgTemplate.replace(/\{name\}/g, cleanName);
        
        // Send confirmation message - use direct socket approach
        try {
          const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
          if (this.baileysClient && this.baileysClient.sock) {
            await this.baileysClient.sock.sendMessage(jid, { text: customIntroMessage });
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Sent intro message to ${sender}: "${customIntroMessage}"`);
          } else {
            throw new Error("BaileysClient or sock is null");
          }
        } catch (sendError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending intro message:`, sendError);
          
          // Try simplified fallback approach
          try {
            const simplifiedMsg = `Nice to meet you, ${cleanName}! Creating your support ticket now.`;
            const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
            if (this.baileysClient && this.baileysClient.sock) {
              await this.baileysClient.sock.sendMessage(jid, { text: simplifiedMsg });
            }
          } catch (fallbackError) {
            console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending fallback intro:`, fallbackError);
          }
        }
        
        // Create ticket - check for existing ticket first
        let channel = null;
        try {
          // Get existing channel ID 
          const existingChannelId = this.channelManager?.getChannelIdByPhoneNumber(sender);
          
          if (existingChannelId) {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Found existing channel ID: ${existingChannelId}`);
            
            try {
              // Get guild and try to fetch channel
              const guildId = this.ticketManager?.guildId;
              const discordClient = this.ticketManager?.discordClient;
              
              if (guildId && discordClient) {
                const guild = await discordClient.guilds.fetch(guildId);
                channel = await guild.channels.fetch(existingChannelId).catch(() => null);
              }
            } catch (e) {
              console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error fetching existing channel:`, e);
              channel = null;
            }
          }
          
          // If no channel found, create a new ticket
          if (!channel) {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] No existing ticket found, creating new ticket for ${cleanName} (${sender})`);
            channel = await this.ticketManager.createTicket(sender, cleanName);
          } else {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Using existing channel: ${channel.name}`);
          }
        } catch (ticketError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error creating ticket:`, ticketError);
          
          // Try to let the user know there was an error
          try {
            const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
            if (this.baileysClient?.sock) {
              await this.baileysClient.sock.sendMessage(jid, { 
                text: "I'm sorry, we're experiencing technical difficulties creating your support ticket. Please try again in a few minutes or contact support through another channel."
              });
            }
          } catch (e) {
            console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending error message:`, e);
          }
          
          // Clean up flow state
          this._introFlowUsers.delete(sender);
          return;
        }
        
        // IMPORTANT: Clear the intro flow state after successful ticket creation
        this._introFlowUsers.delete(sender);
        
        // Forward their original message if they sent one
        if (flowState.originalMessage && channel) {
          await channel.send(`**${cleanName}:** ${flowState.originalMessage}`);
        }
        
        // Handle original media if there was any
        if (flowState.mediaInfo && flowState.mediaInfo.hasMedia && channel) {
          // Try to download original media
          try {
            if (flowState.mediaInfo.msgId) {
              // Mark message as processed to prevent duplicates
              this.processedMediaIds.add(flowState.mediaInfo.msgId);
              await this.handleOriginalMedia(flowState.mediaInfo, channel, cleanName, sender);
            }
          } catch (mediaError) {
            console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error handling original media:`, mediaError);
          }
        }
        
        // Handle current message if it has media (different from original)
        if (msg.hasMedia && channel && 
            (!flowState.mediaInfo || flowState.mediaInfo.msgId !== (msg.id || msg.key?.id))) {
          // Mark message as processed
          const currentMessageId = msg.id || msg.key?.id;
          if (currentMessageId) {
            this.processedMediaIds.add(currentMessageId);
          }
          await this.handleSingleMediaFlowForCleanup(msg, channel, cleanName);
        }
      }
    } catch (error) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error in intro flow:`, error);
      
      // Clean up flow state on error
      this._introFlowUsers.delete(sender);
      
      // Use basic fallback handling
      await this.handleBasicMessage(msg, sender, senderName, messageBody, mediaInfo);
    }
  }

  // Handle a basic message without user management
  async handleBasicMessage(msg, sender, senderName, messageBody, mediaInfo) {
    console.log(
      `[BaileysWhatsAppHandler:${this.instanceId}] Using fallback message handler for ${senderName} (${sender})`
    );

    // CRITICAL FIX: Extract clean display name without phone number
    const displayName = formatDisplayName(senderName);

    // Try to get an existing channel if one exists
    let channelToUse = null;

    try {
      if (
        this.channelManager &&
        typeof this.channelManager.getChannelIdByPhoneNumber === "function"
      ) {
        const channelId = this.channelManager.getChannelIdByPhoneNumber(sender);

        if (
          channelId &&
          this.ticketManager &&
          typeof this.ticketManager.getExistingTicket === "function"
        ) {
          channelToUse = await this.ticketManager.getExistingTicket(sender);
        }
      }
    } catch (channelError) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error finding existing channel:`,
        channelError
      );
    }

    // If we don't have a channel, try to create one
    if (!channelToUse) {
      try {
        channelToUse = await this.createTicket(sender, displayName);
      } catch (createError) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Error creating ticket:`,
          createError
        );
      }
    }

    // If we have a channel, send the message
    if (channelToUse) {
      // Send message with attribution
      if (messageBody) {
        await channelToUse.send(`**${displayName}:** ${messageBody}`);
      }

      // Handle media if any
      if (msg.hasMedia) {
        // Use improved single media flow
        await this.handleSingleMediaFlowForCleanup(
          msg,
          channelToUse,
          displayName
        );
      }
    } else {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] No channel available for ${displayName} (${sender}). Creating channel failed.`
      );

      // Try to create channel again with more detailed error handling
      try {
        console.log(
          `[BaileysWhatsAppHandler:${this.instanceId}] Attempting to create ticket again with forced creation...`
        );
        const newChannel = await this.createTicket(sender, displayName, true);

        if (newChannel) {
          console.log(
            `[BaileysWhatsAppHandler:${this.instanceId}] Successfully created ticket on second attempt: ${newChannel.id}`
          );

          // Send message with attribution if we now have a channel
          if (messageBody) {
            await newChannel.send(`**${displayName}:** ${messageBody}`);
          }

          // Handle media if any
          if (msg.hasMedia) {
            await this.handleSingleMediaFlowForCleanup(
              msg,
              newChannel,
              displayName
            );
          }
        } else {
          console.error(
            `[BaileysWhatsAppHandler:${this.instanceId}] Second attempt to create ticket also failed!`
          );
          // Send a message to the user to let them know there was an issue
          await this.baileysClient.sendMessage(
            sender,
            "I'm sorry, we're experiencing technical difficulties creating your support ticket. Please try again in a few minutes or contact support through another channel."
          );
        }
      } catch (retryError) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Error in retry attempt to create ticket:`,
          retryError
        );
      }
    }
  }

  // Helper method to create a ticket, handling errors
  async createTicket(sender, username, forceCreate = false) {
    try {
      if (
        !this.ticketManager ||
        typeof this.ticketManager.createTicket !== "function"
      ) {
        throw new Error(
          "Ticket manager is not available or missing createTicket method"
        );
      }

      console.log(
        `[BaileysWhatsAppHandler:${this.instanceId}] Creating new ticket for ${username} (${sender})`
      );
      return await this.ticketManager.createTicket(sender, username);
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error creating ticket:`,
        error
      );
      if (forceCreate) {
        throw error; // Re-throw if in forced creation mode
      }
      return null;
    }
  }

  // Handle returning users with existing name
  async handleReturningUser(msg, sender, userCard, messageBody, mediaInfo, senderName) {
    // Always use the name from userCard for consistency
    // CRITICAL FIX: Make sure it's clean without phone numbers
    const displayName = formatDisplayName(userCard.name);
  
    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Message from returning user ${displayName} (${sender})`);
  
    // Update the messageAuthors cache for consistency
    if (!this._messageAuthors) {
      this._messageAuthors = new Map();
    }
    this._messageAuthors.set(msg.id, displayName);
  
    // Get or create ticket channel
    let channelToUse = null;
    let isExistingTicket = false;
  
    try {
      // First try to get existing ticket using the ticketManager
      if (this.ticketManager && typeof this.ticketManager.getExistingTicket === 'function') {
        channelToUse = await this.ticketManager.getExistingTicket(sender);
        if (channelToUse) {
          isExistingTicket = true;
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Using existing ticket channel: ${channelToUse.name}`);
        } else {
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] No existing active ticket found, will create new one`);
        }
      } else {
        // Fallback: Check for existing channel directly
        if (this.channelManager && typeof this.channelManager.getChannelIdByPhoneNumber === 'function') {
          const existingChannelId = this.channelManager.getChannelIdByPhoneNumber(sender);
          
          if (existingChannelId) {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Found existing channel mapping: ${existingChannelId}`);
            
            // Check if ticket is closed
            const isTicketClosed = this.ticketManager && 
                                typeof this.ticketManager.isTicketClosed === 'function' && 
                                this.ticketManager.isTicketClosed(existingChannelId);
            
            if (!isTicketClosed) {
              // Try to get the actual channel
              try {
                const guildId = this.ticketManager && this.ticketManager.guildId;
                const discordClient = this.ticketManager && this.ticketManager.discordClient;
                
                if (guildId && discordClient) {
                  const guild = await discordClient.guilds.fetch(guildId);
                  channelToUse = await guild.channels.fetch(existingChannelId).catch(e => null);
                  
                  if (channelToUse) {
                    isExistingTicket = true;
                    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Using existing open ticket channel: ${channelToUse.name}`);
                  } else {
                    console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Channel ${existingChannelId} no longer exists, will create new ticket`);
                    // Remove invalid mapping
                    this.channelManager.removeChannelMapping(sender);
                  }
                }
              } catch (fetchError) {
                console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error fetching channel:`, fetchError);
                channelToUse = null;
              }
            } else {
              console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Existing ticket is closed, will create new one`);
            }
          } else {
            console.log(`[BaileysWhatsAppHandler:${this.instanceId}] No channel mapping found for ${sender}`);
          }
        }
      }
      
      // If we don't have a valid channel, create a new ticket
      if (!channelToUse) {
        // Use custom reopening message if available
        const reopenMsgTemplate = this.reopenTicketMessage || 
          "Welcome back, {name}! 👋 Our team will continue assisting you with your request.";
        
        const customReopenMessage = reopenMsgTemplate.replace(/\{name\}/g, displayName);
        
        // Send welcome back message
        try {
          await this.baileysClient.sendMessage(sender, customReopenMessage);
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Sent reopening message to ${sender}`);
        } catch (msgError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error sending reopening message:`, msgError);
        }
  
        // Create new ticket
        try {
          console.log(`[BaileysWhatsAppHandler:${this.instanceId}] Creating new ticket for returning user ${displayName} (${sender})`);
          channelToUse = await this.ticketManager.createTicket(sender, displayName);
        } catch (createError) {
          console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error creating ticket for returning user:`, createError);
        }
      }
    } catch (e) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] Error handling returning user:`, e);
    }
  
    if (!channelToUse) {
      console.error(`[BaileysWhatsAppHandler:${this.instanceId}] No channel available for ${displayName} (${sender}). Using fallback method.`);
      await this.handleBasicMessage(msg, sender, displayName, messageBody, mediaInfo);
      return;
    }
  
    // Send message with proper attribution - only include the display name
    if (messageBody) {
      await channelToUse.send(`**${displayName}:** ${messageBody}`);
    }
  
    // Handle media if any
    if (msg.hasMedia) {
      // Use improved single media flow
      await this.handleSingleMediaFlowForCleanup(
        msg,
        channelToUse,
        displayName
      );
    }
  }

  // Helper function to force cleanup a file
  forceCleanupFile(filePath) {
    if (!filePath) return false;

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(
          `[BaileysWhatsAppHandler:${this.instanceId}] 🗑️ DELETED: ${filePath}`
        );

        // Double-check it's really gone
        if (fs.existsSync(filePath)) {
          console.error(
            `[BaileysWhatsAppHandler:${this.instanceId}] ⚠️ File still exists after deletion attempt: ${filePath}`
          );
          // Try one more time
          fs.unlinkSync(filePath);
          console.log(
            `[BaileysWhatsAppHandler:${this.instanceId}] 🗑️ Second deletion attempt for: ${filePath}`
          );
          return !fs.existsSync(filePath);
        }
        return true;
      } else {
        return true; // Consider it a success if the file doesn't exist
      }
    } catch (e) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error deleting ${filePath}: ${e.message}`
      );
      return false;
    }
  }

  // Enhanced Single media flow - FIXED to not save media permanently
  async handleSingleMediaFlowForCleanup(msg, channel, username) {
    try {
      if (!msg || !channel) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Cannot handle media: Invalid message or channel`
        );
        return;
      }

      console.log(
        `[BaileysWhatsAppHandler:${this.instanceId}] 📥 Processing media from ${username}: ${msg.id}`
      );

      // Record this message as processed to prevent duplicates
      if (!this.processedMediaIds) {
        this.processedMediaIds = new Set();
      }
      this.processedMediaIds.add(msg.id);

      // Download the media
      let mediaBuffer;
      try {
        mediaBuffer = await msg.downloadMedia();
      } catch (e) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Error downloading media:`,
          e
        );
      }

      if (!mediaBuffer) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] ❌ Failed to download media`
        );
        await channel.send(
          `**Error downloading media from ${username}. Please check WhatsApp directly.**`
        );
        return;
      }

      // Convert to buffer if needed
      let buffer;
      if (Buffer.isBuffer(mediaBuffer)) {
        buffer = mediaBuffer;
      } else if (mediaBuffer.data) {
        buffer = Buffer.from(mediaBuffer.data, "base64");
      } else {
        throw new Error("Unsupported media format");
      }

      // Determine file extension and media type
      let ext = ".bin";
      const mediaType = msg.type || "unknown";
      const mimetype = msg.mediaInfo?.mimetype || "";

      if (mediaType === "image") {
        ext = mimetype.includes("png") ? ".png" : ".jpg";
      } else if (mediaType === "video") {
        ext = ".mp4";
      } else if (mediaType === "audio") {
        ext = mimetype.includes("ogg") ? ".ogg" : ".mp3";
      } else if (mediaType === "document") {
        ext = ".pdf";
      } else if (mediaType === "sticker") {
        ext = ".webp";
      }

      // Create temp file with unique name
      const tempPath = path.join(
        this.tempDir,
        `temp_${Date.now()}_${msg.id}${ext}`
      );
      fs.writeFileSync(tempPath, buffer);

      // Create a readable description for the media type
      const mediaTypeDesc =
        mediaType === "image"
          ? "an image"
          : mediaType === "video"
          ? "a video"
          : mediaType === "audio"
          ? "an audio file"
          : mediaType === "document"
          ? "a document"
          : mediaType === "sticker"
          ? "a sticker"
          : "a file";

      // First, send the user attribution line
      await channel.send(`**${username} sent ${mediaTypeDesc}:**`);

      try {
        // Send the media file to Discord directly
        await channel.send({
          files: [
            {
              attachment: tempPath,
              name: path.basename(tempPath),
            },
          ],
        });

        // Ensure tempPath is cleaned up
        this.forceCleanupFile(tempPath);
      } catch (error) {
        console.error(
          `[BaileysWhatsAppHandler:${this.instanceId}] Error handling media: ${error.message}`
        );

        // Try again with more info
        try {
          await channel.send({
            content: `**Error with original media: ${error.message}. Trying again:**`,
            files: [
              {
                attachment: tempPath,
                name: path.basename(tempPath),
              },
            ],
          });

          // Clean up temp file after sending
          this.forceCleanupFile(tempPath);
        } catch (directError) {
          console.error(
            `[BaileysWhatsAppHandler:${this.instanceId}] Direct media send failed: ${directError.message}`
          );
          await channel.send(`**Error sending media**: ${directError.message}`);

          // Clean up temp file even after error
          this.forceCleanupFile(tempPath);
        }
      }
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error in handleSingleMediaFlowForCleanup: ${error.message}`
      );
      if (channel) {
        await channel.send(
          `**Error processing media message from ${username}**: ${error.message}`
        );
      }
    }
  }

  // Method to handle original media from first messages
  async handleOriginalMedia(mediaInfo, channel, username, sender) {
    try {
      console.log(
        `[BaileysWhatsAppHandler:${this.instanceId}] 💾 Processing original media from ${username}: ${mediaInfo.msgId}`
      );

      // Download the media
      const mediaBuffer = await this.baileysClient.downloadMedia(
        sender,
        mediaInfo.msgId
      );

      if (!mediaBuffer || mediaBuffer.length === 0) {
        throw new Error("Downloaded media is empty");
      }

      // Determine file extension
      let ext = ".bin";
      if (mediaInfo.type === "image") ext = ".jpg";
      else if (mediaInfo.type === "video") ext = ".mp4";
      else if (mediaInfo.type === "audio") ext = ".mp3";
      else if (mediaInfo.type === "document") ext = ".pdf";

      // Create temp file with unique name
      const tempPath = path.join(
        this.tempDir,
        `temp_original_${Date.now()}_${mediaInfo.msgId}${ext}`
      );
      fs.writeFileSync(tempPath, mediaBuffer);

      // Determine media type description
      const mediaTypeDesc =
        mediaInfo.type === "image"
          ? "an image"
          : mediaInfo.type === "video"
          ? "a video"
          : mediaInfo.type === "audio"
          ? "an audio file"
          : mediaInfo.type === "document"
          ? "a document"
          : "a file";

      // Send media announcement
      await channel.send(`**${username} sent ${mediaTypeDesc}:**`);

      // Send the file directly
      await channel.send({
        files: [
          {
            attachment: tempPath,
            name: path.basename(tempPath),
          },
        ],
      });

      // Force cleanup of temp file immediately
      this.forceCleanupFile(tempPath);
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error handling original media: ${error.message}`
      );
      await channel.send(
        `**Error retrieving original media. Please check WhatsApp directly.**`
      );
    }
  }

  // Helper method for readable display
  getDisplayName(phoneNumber, fallbackName) {
    try {
      // First, try to get from UserCard
      if (
        this.userCardManager &&
        typeof this.userCardManager.getUserCard === "function"
      ) {
        const userCard = this.userCardManager.getUserCard(phoneNumber);
        if (userCard && userCard.name) {
          return formatDisplayName(userCard.name);
        }
      }

      // If fallback provided, use it but make sure it's clean
      if (
        fallbackName &&
        fallbackName !== phoneNumber &&
        !fallbackName.includes("@")
      ) {
        return formatDisplayName(fallbackName);
      }

      // Last resort: remove @s.whatsapp.net and make it readable
      return phoneNumber
        .replace("@s.whatsapp.net", "")
        .replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    } catch (error) {
      console.error(
        `[BaileysWhatsAppHandler:${this.instanceId}] Error getting display name: ${error.message}`
      );
      return fallbackName ? formatDisplayName(fallbackName) : "Unknown User";
    }
  }

  // Set MediaManager
  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager;
    console.log(
      `[BaileysWhatsAppHandler:${this.instanceId}] Set mediaManager: ${
        mediaManager ? "Successful" : "Failed (null)"
      }`
    );
  }
}

module.exports = BaileysWhatsAppHandler;
