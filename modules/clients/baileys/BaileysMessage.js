// modules/clients/baileys/BaileysMessage.js

class BaileysMessage {
  constructor(client) {
    this.client = client;
    this.messageStore = {};  // Store for recent messages
  }
  
  // Store a message for future reference
  storeMessage(msg) {
    const msgId = msg.key.id;
    const chatId = msg.key.remoteJid;
    
    // Initialize chat in message store if not exists
    if (!this.messageStore[chatId]) {
      this.messageStore[chatId] = {};
    }
    
    // Store the message
    this.messageStore[chatId][msgId] = msg;
    
    // Limit store to 100 messages per chat (keep most recent)
    const keys = Object.keys(this.messageStore[chatId]);
    if (keys.length > 100) {
      delete this.messageStore[chatId][keys[0]];
    }
  }

  // Get a stored message
  getStoredMessage(chatId, msgId) {
    if (this.messageStore[chatId] && this.messageStore[chatId][msgId]) {
      return this.messageStore[chatId][msgId];
    }
    return null;
  }
  
  // Format phone number to a valid JID
  formatJid(number) {
    // If it already includes @, it's already formatted
    if (number.includes('@')) {
      // Convert from @c.us to @s.whatsapp.net if needed
      return number.replace('@c.us', '@s.whatsapp.net');
    }
    
    // Remove any non-numeric characters
    const cleanNumber = number.replace(/[^0-9]/g, '');
    return `${cleanNumber}@s.whatsapp.net`;
  }
  
  // Format incoming message to standardized format
  formatIncomingMessage(msg) {
    // Extract the basic message details
    const formatted = {
      id: msg.key.id,
      from: msg.key.remoteJid,
      fromMe: msg.key.fromMe,
      timestamp: msg.messageTimestamp || Date.now(),
      hasMedia: false,
      type: 'text',
      body: '',
      hasAttachment: false
    };
    
    // Extract participant info for group messages
    if (msg.key.participant) {
      formatted.participant = msg.key.participant;
    }
    
    // Get the actual message content
    const messageContent = msg.message || {};
    
    // Handle different types of messages
    if (messageContent.conversation) {
      // Simple text message
      formatted.body = messageContent.conversation;
      formatted.type = 'text';
    } 
    else if (messageContent.extendedTextMessage) {
      // Extended text message (may include mentions or quoted messages)
      formatted.body = messageContent.extendedTextMessage.text || '';
      formatted.type = 'text';
      
      // Check for quoted message
      if (messageContent.extendedTextMessage.contextInfo?.quotedMessage) {
        formatted.quotedMessage = messageContent.extendedTextMessage.contextInfo.quotedMessage;
        formatted.quotedMessageId = messageContent.extendedTextMessage.contextInfo.stanzaId;
      }
    }
    // Image message
    else if (messageContent.imageMessage) {
      formatted.hasMedia = true;
      formatted.type = 'image';
      formatted.body = messageContent.imageMessage.caption || '';
      formatted.mediaInfo = {
        mimetype: messageContent.imageMessage.mimetype,
        fileLength: messageContent.imageMessage.fileLength,
        fileName: messageContent.imageMessage.fileName || `image.${messageContent.imageMessage.mimetype.split('/')[1]}`,
        mediaKey: messageContent.imageMessage.mediaKey
      };
      formatted.hasAttachment = true;
    }
    // Video message
    else if (messageContent.videoMessage) {
      formatted.hasMedia = true;
      formatted.type = 'video';
      formatted.body = messageContent.videoMessage.caption || '';
      formatted.mediaInfo = {
        mimetype: messageContent.videoMessage.mimetype,
        fileLength: messageContent.videoMessage.fileLength,
        fileName: messageContent.videoMessage.fileName || `video.${messageContent.videoMessage.mimetype.split('/')[1]}`,
        mediaKey: messageContent.videoMessage.mediaKey,
        seconds: messageContent.videoMessage.seconds
      };
      formatted.hasAttachment = true;
    }
    // Audio message
    else if (messageContent.audioMessage) {
      formatted.hasMedia = true;
      formatted.type = messageContent.audioMessage.ptt ? 'ptt' : 'audio';
      formatted.mediaInfo = {
        mimetype: messageContent.audioMessage.mimetype,
        fileLength: messageContent.audioMessage.fileLength,
        seconds: messageContent.audioMessage.seconds,
        mediaKey: messageContent.audioMessage.mediaKey
      };
      formatted.hasAttachment = true;
    }
    // Document message
    else if (messageContent.documentMessage) {
      formatted.hasMedia = true;
      formatted.type = 'document';
      formatted.body = messageContent.documentMessage.caption || '';
      formatted.mediaInfo = {
        mimetype: messageContent.documentMessage.mimetype,
        fileLength: messageContent.documentMessage.fileLength,
        fileName: messageContent.documentMessage.fileName || 'document',
        mediaKey: messageContent.documentMessage.mediaKey
      };
      formatted.hasAttachment = true;
    }
    // Sticker message
    else if (messageContent.stickerMessage) {
      formatted.hasMedia = true;
      formatted.type = 'sticker';
      formatted.mediaInfo = {
        mimetype: messageContent.stickerMessage.mimetype,
        fileLength: messageContent.stickerMessage.fileLength,
        isAnimated: messageContent.stickerMessage.isAnimated || false,
        mediaKey: messageContent.stickerMessage.mediaKey
      };
      formatted.hasAttachment = true;
    }
    // Location message
    else if (messageContent.locationMessage) {
      formatted.type = 'location';
      formatted.body = messageContent.locationMessage.name || 'Location';
      formatted.location = {
        degreesLatitude: messageContent.locationMessage.degreesLatitude,
        degreesLongitude: messageContent.locationMessage.degreesLongitude,
        address: messageContent.locationMessage.address
      };
    }
    // Contact card message
    else if (messageContent.contactMessage || messageContent.contactsArrayMessage) {
      formatted.type = 'contact';
      formatted.body = 'Contact card';
      formatted.contacts = messageContent.contactMessage ? 
        [messageContent.contactMessage] : 
        messageContent.contactsArrayMessage.contacts;
    }
    // Button response
    else if (messageContent.buttonsResponseMessage) {
      formatted.type = 'buttons_response';
      formatted.body = messageContent.buttonsResponseMessage.selectedDisplayText || '';
      formatted.selectedButtonId = messageContent.buttonsResponseMessage.selectedButtonId;
    }
    // List response
    else if (messageContent.listResponseMessage) {
      formatted.type = 'list_response';
      formatted.body = messageContent.listResponseMessage.title || '';
      formatted.selectedRowId = messageContent.listResponseMessage.singleSelectReply.selectedRowId;
    }
    // Other types of messages
    else {
      // Unknown message type
      formatted.type = 'unknown';
      formatted.rawMessage = msg.message;
      formatted.body = 'Unsupported message type';
    }
    
    // Add original message to allow access to all properties
    formatted.originalMessage = msg;
    
    // Add convenience methods for interacting with the message
    this.addConvenienceMethods(formatted);
    
    return formatted;
  }
  
  // Add convenience methods to the message object
  addConvenienceMethods(formatted) {
    // Get contact information
    formatted.getContact = async () => {
      try {
        // Get the JID's contact info from Baileys
        const formattedJid = this.formatJid(formatted.from);
        const jid = formattedJid.split('@')[0];
        
        // Try to get contact using store
        if (this.client.auth.sock && this.client.auth.sock.store && this.client.auth.sock.store.contacts) {
          const contact = this.client.auth.sock.store.contacts[formattedJid];
          if (contact) {
            return {
              pushname: contact.notify || contact.name || jid,
              id: formattedJid
            };
          }
        }
        
        // Fallback to basic info
        return {
          pushname: jid,
          id: formattedJid,
          name: jid
        };
      } catch (error) {
        console.error(`[BaileysMessage:${this.client.instanceId}] Error getting contact:`, error);
        const jid = formatted.from.split('@')[0];
        return { 
          pushname: jid, 
          id: formatted.from,
          name: jid
        };
      }
    };
    
    // Download media
    formatted.downloadMedia = async () => {
      if (formatted.hasMedia) {
        return await this.client.downloadMedia(formatted.from, formatted.id, formatted.originalMessage);
      }
      return null;
    };
  }
  
  // Send a message
  async sendMessage(to, content, options = {}) {
    // Queue message if not connected yet
    if (!this.client.isReady) {
      console.log(`[BaileysMessage:${this.client.instanceId}] Client not ready, queueing message`);
      this.client.messageQueue.push({ to, content, options });
      
      if (!this.client.isInitializing) {
        await this.client.initialize();
      }
      return null;
    }
    
    try {
      // Format the recipient JID
      const jid = this.formatJid(to);
      
      // Check content type and prepare message
      let messageContent;
      
      if (typeof content === 'string') {
        // Simple text message
        messageContent = { text: content };
      } else if (content.mimetype) {
        // Media from downloadMedia or MessageMedia
        if (content.mimetype.startsWith('image/')) {
          // Image
          messageContent = {
            image: content.data ? Buffer.from(content.data, 'base64') : content,
            caption: options.caption || '',
            mimetype: content.mimetype
          };
        } else if (content.mimetype.startsWith('video/')) {
          // Video
          messageContent = {
            video: content.data ? Buffer.from(content.data, 'base64') : content,
            caption: options.caption || '',
            gifPlayback: options.sendVideoAsGif === true,
            mimetype: content.mimetype
          };
        } else if (content.mimetype.startsWith('audio/')) {
          // Audio
          messageContent = {
            audio: content.data ? Buffer.from(content.data, 'base64') : content,
            mimetype: content.mimetype,
            ptt: options.sendAudioAsPtt === true
          };
        } else if (content.mimetype.includes('pdf') || 
                  content.mimetype.includes('document') ||
                  content.mimetype.includes('application/')) {
          // Document
          messageContent = {
            document: content.data ? Buffer.from(content.data, 'base64') : content,
            mimetype: content.mimetype,
            fileName: content.filename || 'document',
            caption: options.caption || ''
          };
        } else {
          // Generic file
          messageContent = {
            document: content.data ? Buffer.from(content.data, 'base64') : content,
            mimetype: content.mimetype,
            fileName: content.filename || 'file',
            caption: options.caption || ''
          };
        }
      } else if (options.sendMediaAsSticker) {
        // Sticker
        const stickerOptions = {
          sticker: content.data ? Buffer.from(content.data, 'base64') : content,
          author: options.stickerAuthor || 'WhatsApp-Discord-Bridge',
          packname: options.stickerName || 'Stickers',
          categories: options.stickerCategories || []
        };
        messageContent = stickerOptions;
      } else {
        // Default to text if content type is unknown
        messageContent = { text: JSON.stringify(content) };
      }
      
      // Send the message through the socket
      return await this.client.auth.sock.sendMessage(jid, messageContent);
    } catch (error) {
      console.error(`[BaileysMessage:${this.client.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
}

module.exports = BaileysMessage;