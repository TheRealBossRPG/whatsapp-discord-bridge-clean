'use strict';

/**
 * Handles WhatsApp message processing
 */
class BaileysMessage {
  /**
   * Create a new message handler
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId) {
    this.instanceId = instanceId || 'default';
    this.socket = null;
    
    // Bind methods to preserve 'this' context
    this.setSocket = this.setSocket.bind(this);
    this.processMessage = this.processMessage.bind(this);
    this.getMessageType = this.getMessageType.bind(this);
    this.getMessageContent = this.getMessageContent.bind(this);
    this.getMediaContent = this.getMediaContent.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    
    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }
  
  /**
   * Set socket for sending messages
   * @param {Object} socket - WhatsApp socket
   */
  setSocket(socket) {
    if (!socket) {
      console.error(`[BaileysMessage:${this.instanceId}] Cannot set null socket`);
      return;
    }
    
    this.socket = socket;
    console.log(`[BaileysMessage:${this.instanceId}] Socket set successfully`);
  }
  
  /**
   * Process incoming message
   * @param {Object} message - WhatsApp message
   */
  processMessage(message) {
    try {
      // Skip if no socket or invalid message
      if (!this.socket || !message) {
        return;
      }
      
      // Extract key message info
      const msgKey = message.key || {};
      
      // Skip messages from self
      if (msgKey.fromMe) {
        return;
      }
      
      // Extract message info
      const jid = msgKey.remoteJid;
      const messageType = this.getMessageType(message);
      const messageContent = this.getMessageContent(message);
      const media = this.getMediaContent(message);
      
      // Skip empty or invalid messages
      if (!jid || !messageContent) {
        return;
      }
      
      // Format message for event emitting
      const formattedMessage = {
        key: msgKey,
        jid: jid,
        sender: jid.split('@')[0],
        isGroup: jid.endsWith('@g.us'),
        messageType: messageType,
        content: messageContent,
        media: media,
        timestamp: message.messageTimestamp || Date.now(),
        raw: message
      };
      
      // Emit to socket events handler
      if (this.socket.ev) {
        try {
          this.socket.ev.emit('message', formattedMessage);
        } catch (emitError) {
          console.error(`[BaileysMessage:${this.instanceId}] Error emitting message event:`, emitError);
        }
      }
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error processing message:`, error);
    }
  }
  
  /**
   * Get message type
   * @param {Object} message - WhatsApp message
   * @returns {string} Message type
   */
  getMessageType(message) {
    try {
      const msg = message.message || {};
      
      if (!msg) return 'unknown';
      
      if (msg.conversation) return 'text';
      if (msg.imageMessage) return 'image';
      if (msg.videoMessage) return 'video';
      if (msg.audioMessage) return 'audio';
      if (msg.documentMessage) return 'document';
      if (msg.stickerMessage) return 'sticker';
      if (msg.contactMessage) return 'contact';
      if (msg.locationMessage) return 'location';
      if (msg.liveLocationMessage) return 'liveLocation';
      if (msg.groupInviteMessage) return 'groupInvite';
      if (msg.buttonsMessage) return 'buttons';
      if (msg.templateMessage) return 'template';
      if (msg.listMessage) return 'list';
      
      // For text in extended message types
      if (msg.extendedTextMessage) return 'extendedText';
      
      return 'unknown';
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error getting message type:`, error);
      return 'unknown';
    }
  }
  
  /**
   * Get message content
   * @param {Object} message - WhatsApp message
   * @returns {string} Message content
   */
  getMessageContent(message) {
    try {
      const msg = message.message || {};
      
      if (!msg) return '';
      
      // Handle different message types
      if (msg.conversation) return msg.conversation;
      
      if (msg.extendedTextMessage && msg.extendedTextMessage.text) {
        return msg.extendedTextMessage.text;
      }
      
      // Image/video caption
      if (msg.imageMessage && msg.imageMessage.caption) {
        return msg.imageMessage.caption;
      }
      
      if (msg.videoMessage && msg.videoMessage.caption) {
        return msg.videoMessage.caption;
      }
      
      // Other message types
      if (msg.documentMessage && msg.documentMessage.fileName) {
        return `[Document: ${msg.documentMessage.fileName}]`;
      }
      
      if (msg.audioMessage) {
        return '[Audio Message]';
      }
      
      if (msg.stickerMessage) {
        return '[Sticker]';
      }
      
      if (msg.locationMessage) {
        const { degreesLatitude, degreesLongitude } = msg.locationMessage;
        return `[Location: ${degreesLatitude}, ${degreesLongitude}]`;
      }
      
      return '';
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error getting message content:`, error);
      return '';
    }
  }
  
  /**
   * Get media content from message
   * @param {Object} message - WhatsApp message
   * @returns {Object|null} Media information
   */
  getMediaContent(message) {
    try {
      const msg = message.message || {};
      
      if (!msg) return null;
      
      // Handle different media types
      if (msg.imageMessage) {
        return {
          type: 'image',
          mimetype: msg.imageMessage.mimetype || 'image/jpeg',
          url: msg.imageMessage.url || '',
          mediaKey: msg.imageMessage.mediaKey || '',
          fileSize: msg.imageMessage.fileSize || 0,
          fileName: 'image.' + (msg.imageMessage.mimetype ? msg.imageMessage.mimetype.split('/')[1] : 'jpg'),
          caption: msg.imageMessage.caption || ''
        };
      }
      
      if (msg.videoMessage) {
        return {
          type: 'video',
          mimetype: msg.videoMessage.mimetype || 'video/mp4',
          url: msg.videoMessage.url || '',
          mediaKey: msg.videoMessage.mediaKey || '',
          fileSize: msg.videoMessage.fileSize || 0,
          seconds: msg.videoMessage.seconds || 0,
          fileName: 'video.' + (msg.videoMessage.mimetype ? msg.videoMessage.mimetype.split('/')[1] : 'mp4'),
          caption: msg.videoMessage.caption || ''
        };
      }
      
      if (msg.audioMessage) {
        return {
          type: 'audio',
          mimetype: msg.audioMessage.mimetype || 'audio/mp4',
          url: msg.audioMessage.url || '',
          mediaKey: msg.audioMessage.mediaKey || '',
          fileSize: msg.audioMessage.fileSize || 0,
          seconds: msg.audioMessage.seconds || 0,
          ptt: msg.audioMessage.ptt || false,
          fileName: 'audio.' + (msg.audioMessage.mimetype ? msg.audioMessage.mimetype.split('/')[1] : 'mp3')
        };
      }
      
      if (msg.documentMessage) {
        return {
          type: 'document',
          mimetype: msg.documentMessage.mimetype || 'application/octet-stream',
          url: msg.documentMessage.url || '',
          mediaKey: msg.documentMessage.mediaKey || '',
          fileSize: msg.documentMessage.fileSize || 0,
          fileName: msg.documentMessage.fileName || 'document',
          pageCount: msg.documentMessage.pageCount || 0
        };
      }
      
      if (msg.stickerMessage) {
        return {
          type: 'sticker',
          mimetype: msg.stickerMessage.mimetype || 'image/webp',
          url: msg.stickerMessage.url || '',
          mediaKey: msg.stickerMessage.mediaKey || '',
          fileSize: msg.stickerMessage.fileSize || 0,
          isAnimated: msg.stickerMessage.isAnimated || false,
          fileName: 'sticker.webp'
        };
      }
      
      return null;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error getting media content:`, error);
      return null;
    }
  }
  
  /**
   * Send a message
   * @param {string} to - Recipient
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Send result
   */
  async sendMessage(to, content) {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }
      
      if (!to) {
        throw new Error('No recipient specified');
      }
      
      if (!content) {
        throw new Error('No content specified');
      }
      
      return await this.socket.sendMessage(to, content);
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
}

module.exports = BaileysMessage;