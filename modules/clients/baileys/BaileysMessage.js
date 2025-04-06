// modules/clients/baileys/BaileysMessage.js - Improved message handling
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Helper class for handling Baileys message structures
 */
class BaileysMessage {
  /**
   * Create a new message handler
   * @param {Object} options - Handler options
   */
  constructor(options = {}) {
    this.instanceId = options.instanceId || 'default';
    this.tempDir = options.tempDir || path.join(__dirname, '../../../temp');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }
  
  /**
   * Extract text from a message
   * @param {Object} message - WhatsApp message object
   * @returns {string} - Extracted text
   */
  extractMessageText(message) {
    try {
      if (!message || !message.message) {
        return '';
      }
      
      const content = message.message;
      
      // Check various message types in order of likelihood
      if (content.conversation) {
        return content.conversation;
      }
      
      if (content.extendedTextMessage) {
        return content.extendedTextMessage.text || '';
      }
      
      if (content.imageMessage) {
        return content.imageMessage.caption || '';
      }
      
      if (content.videoMessage) {
        return content.videoMessage.caption || '';
      }
      
      // Handle button response messages
      if (content.buttonsResponseMessage) {
        return content.buttonsResponseMessage.selectedDisplayText || '';
      }
      
      // Handle list response
      if (content.listResponseMessage) {
        return content.listResponseMessage.title || 
               content.listResponseMessage.selectedDisplayText || '';
      }
      
      // Handle template buttons
      if (content.templateButtonReplyMessage) {
        return content.templateButtonReplyMessage.selectedDisplayText || '';
      }
      
      // Try to extract from more complex message types
      const possibleTextContainers = [
        content.buttonsMessage?.contentText,
        content.listMessage?.description,
        content.templateMessage?.hydratedTemplate?.hydratedContentText
      ];
      
      for (const textContainer of possibleTextContainers) {
        if (textContainer) {
          return textContainer;
        }
      }
      
      // Handle media types with descriptions
      const mediaTypes = [
        'audioMessage',
        'documentMessage',
        'stickerMessage',
        'contactMessage',
        'locationMessage'
      ];
      
      for (const mediaType of mediaTypes) {
        if (content[mediaType]) {
          // For documents, return filename
          if (mediaType === 'documentMessage' && content[mediaType].fileName) {
            return `[Document: ${content[mediaType].fileName}]`;
          }
          
          // For audio, check if it's a voice note
          if (mediaType === 'audioMessage') {
            return content[mediaType].ptt ? '[Voice Message]' : '[Audio]';
          }
          
          // For contact messages
          if (mediaType === 'contactMessage' && content[mediaType].displayName) {
            return `[Contact: ${content[mediaType].displayName}]`;
          }
          
          // For location
          if (mediaType === 'locationMessage') {
            const lat = content[mediaType].degreesLatitude;
            const lng = content[mediaType].degreesLongitude;
            return `[Location: ${lat},${lng}]`;
          }
          
          // For other media types
          return `[${mediaType.replace('Message', '')}]`;
        }
      }
      
      // If nothing found, return empty string
      return '';
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error extracting message text:`, error);
      return '';
    }
  }
  
  /**
   * Extract media information from a message
   * @param {Object} message - WhatsApp message object
   * @returns {Object} - Media information
   */
  extractMediaInfo(message) {
    try {
      if (!message || !message.message) {
        return { hasMedia: false };
      }
      
      const content = message.message;
      
      // Check for image
      if (content.imageMessage) {
        return {
          hasMedia: true,
          mediaType: 'image',
          caption: content.imageMessage.caption || '',
          mimetype: content.imageMessage.mimetype || 'image/jpeg'
        };
      }
      
      // Check for video
      if (content.videoMessage) {
        return {
          hasMedia: true,
          mediaType: 'video',
          caption: content.videoMessage.caption || '',
          mimetype: content.videoMessage.mimetype || 'video/mp4'
        };
      }
      
      // Check for audio
      if (content.audioMessage) {
        return {
          hasMedia: true,
          mediaType: 'audio',
          isVoiceNote: content.audioMessage.ptt || false,
          mimetype: content.audioMessage.mimetype || 'audio/mp4'
        };
      }
      
      // Check for document
      if (content.documentMessage) {
        return {
          hasMedia: true,
          mediaType: 'document',
          fileName: content.documentMessage.fileName || 'document',
          mimetype: content.documentMessage.mimetype || 'application/octet-stream'
        };
      }
      
      // Check for sticker
      if (content.stickerMessage) {
        return {
          hasMedia: true,
          mediaType: 'sticker',
          mimetype: content.stickerMessage.mimetype || 'image/webp'
        };
      }
      
      // No media found
      return { hasMedia: false };
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error extracting media info:`, error);
      return { hasMedia: false };
    }
  }
  
  /**
   * Save media to a temporary file
   * @param {Buffer} buffer - Media buffer
   * @param {string} mediaType - Media type
   * @param {string} extension - File extension
   * @returns {string} - Path to saved file
   */
  saveMediaToTemp(buffer, mediaType, extension) {
    try {
      if (!buffer) {
        return null;
      }
      
      // Generate a unique filename
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const filename = `${mediaType}-${hash}.${extension}`;
      const filePath = path.join(this.tempDir, filename);
      
      // Save the file
      fs.writeFileSync(filePath, buffer);
      
      return filePath;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error saving media:`, error);
      return null;
    }
  }
  
  /**
   * Get appropriate file extension from mimetype
   * @param {string} mimetype - MIME type
   * @returns {string} - File extension
   */
  getExtensionFromMimetype(mimetype) {
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'application/pdf': 'pdf',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/zip': 'zip'
    };
    
    return mimeToExt[mimetype] || 'bin';
  }
  
  /**
   * Determine if a message has a quoted message
   * @param {Object} message - WhatsApp message
   * @returns {boolean} - Whether the message has a quoted message
   */
  hasQuotedMessage(message) {
    try {
      if (!message || !message.message) {
        return false;
      }
      
      const content = message.message;
      
      // Check for quoted message in extended text message
      if (content.extendedTextMessage && content.extendedTextMessage.contextInfo) {
        return !!content.extendedTextMessage.contextInfo.quotedMessage;
      }
      
      // Check for quoted message in media messages
      const mediaTypes = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage'
      ];
      
      for (const mediaType of mediaTypes) {
        if (content[mediaType] && content[mediaType].contextInfo) {
          return !!content[mediaType].contextInfo.quotedMessage;
        }
      }
      
      return false;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error checking quoted message:`, error);
      return false;
    }
  }
  
  /**
   * Extract quoted message from a message
   * @param {Object} message - WhatsApp message
   * @returns {Object|null} - Quoted message or null
   */
  getQuotedMessage(message) {
    try {
      if (!this.hasQuotedMessage(message)) {
        return null;
      }
      
      const content = message.message;
      
      // Check in extended text message
      if (content.extendedTextMessage && content.extendedTextMessage.contextInfo) {
        return content.extendedTextMessage.contextInfo.quotedMessage;
      }
      
      // Check in media messages
      const mediaTypes = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage'
      ];
      
      for (const mediaType of mediaTypes) {
        if (content[mediaType] && content[mediaType].contextInfo) {
          return content[mediaType].contextInfo.quotedMessage;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error getting quoted message:`, error);
      return null;
    }
  }
}

module.exports = BaileysMessage;