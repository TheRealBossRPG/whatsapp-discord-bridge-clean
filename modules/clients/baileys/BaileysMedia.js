'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import baileys functions
let downloadMediaMessage;
try {
  downloadMediaMessage = require('@whiskeysockets/baileys').downloadMediaMessage;
} catch (error) {
  console.error('Error importing Baileys downloadMediaMessage:', error);
  // Fallback implementation if needed
  downloadMediaMessage = async () => {
    throw new Error('Baileys downloadMediaMessage not available');
  };
}

/**
 * Handles WhatsApp media processing
 */
class BaileysMedia {
  /**
   * Create a new media handler
   * @param {string} instanceId - Instance ID
   * @param {string} tempDir - Temporary directory for media
   */
  constructor(instanceId, tempDir) {
    this.instanceId = instanceId || 'default';
    this.tempDir = tempDir || path.join(__dirname, '..', '..', '..', 'temp', this.instanceId);
    this.socket = null;
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      try {
        fs.mkdirSync(this.tempDir, { recursive: true });
      } catch (mkdirError) {
        console.error(`[BaileysMedia:${this.instanceId}] Error creating temp directory:`, mkdirError);
      }
    }
    
    // Bind methods to preserve 'this' context
    this.setSocket = this.setSocket.bind(this);
    this.downloadMedia = this.downloadMedia.bind(this);
    this.getMediaType = this.getMediaType.bind(this);
    this.getFileExtension = this.getFileExtension.bind(this);
    this.sendMedia = this.sendMedia.bind(this);
    this.cleanupTempFiles = this.cleanupTempFiles.bind(this);
    
    console.log(`[BaileysMedia:${this.instanceId}] Media handler initialized with temp dir: ${this.tempDir}`);
  }
  
  /**
   * Set socket for media operations
   * @param {Object} socket - WhatsApp socket
   */
  setSocket(socket) {
    if (!socket) {
      console.error(`[BaileysMedia:${this.instanceId}] Cannot set null socket`);
      return;
    }
    
    this.socket = socket;
    console.log(`[BaileysMedia:${this.instanceId}] Socket set successfully`);
  }
  
  /**
   * Download media from message
   * @param {Object} message - WhatsApp message
   * @returns {Promise<string>} Path to downloaded file
   */
  async downloadMedia(message) {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }
      
      // Check if message contains media
      if (!message || !message.message) {
        throw new Error('Invalid message or no media in message');
      }
      
      // Get media type and info
      const mediaType = this.getMediaType(message.message);
      if (!mediaType) {
        throw new Error('No media found in message');
      }
      
      // Generate filename based on message ID and type
      const messageId = message.key?.id || crypto.randomBytes(6).toString('hex');
      const fileExt = this.getFileExtension(mediaType, message.message);
      const fileName = `${messageId}.${fileExt}`;
      const filePath = path.join(this.tempDir, fileName);
      
      // Download the media
      console.log(`[BaileysMedia:${this.instanceId}] Downloading media ${mediaType} to ${filePath}`);
      
      // Check if downloadMediaMessage function is available
      if (!downloadMediaMessage) {
        throw new Error('downloadMediaMessage function not available');
      }
      
      const buffer = await downloadMediaMessage(
        message,
        'buffer',
        {},
        { logger: console }
      );
      
      if (!buffer) {
        throw new Error('Failed to download media');
      }
      
      // Write to file
      fs.writeFileSync(filePath, buffer);
      
      return filePath;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Get media type from message
   * @param {Object} message - WhatsApp message content
   * @returns {string|null} Media type
   */
  getMediaType(message) {
    try {
      if (!message) return null;
      
      if (message.imageMessage) return 'image';
      if (message.videoMessage) return 'video';
      if (message.audioMessage) return 'audio';
      if (message.documentMessage) return 'document';
      if (message.stickerMessage) return 'sticker';
      
      return null;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error getting media type:`, error);
      return null;
    }
  }
  
  /**
   * Get file extension for media type
   * @param {string} mediaType - Media type
   * @param {Object} message - WhatsApp message content
   * @returns {string} File extension
   */
  getFileExtension(mediaType, message) {
    try {
      if (!message) return 'bin';
      
      switch (mediaType) {
        case 'image':
          if (message.imageMessage?.mimetype) {
            const parts = message.imageMessage.mimetype.split('/');
            return parts.length > 1 ? parts[1] : 'jpg';
          }
          return 'jpg';
          
        case 'video':
          if (message.videoMessage?.mimetype) {
            const parts = message.videoMessage.mimetype.split('/');
            return parts.length > 1 ? parts[1] : 'mp4';
          }
          return 'mp4';
          
        case 'audio':
          if (message.audioMessage?.mimetype) {
            const parts = message.audioMessage.mimetype.split('/');
            return parts.length > 1 ? parts[1] : 'mp3';
          }
          return 'mp3';
          
        case 'document':
          // Extract extension from filename if available
          if (message.documentMessage?.fileName) {
            const fileNameParts = message.documentMessage.fileName.split('.');
            if (fileNameParts.length > 1) {
              return fileNameParts.pop();
            }
          }
          // Fallback to mimetype
          if (message.documentMessage?.mimetype) {
            const parts = message.documentMessage.mimetype.split('/');
            return parts.length > 1 ? parts[1] : 'bin';
          }
          return 'bin';
          
        case 'sticker':
          return 'webp';
          
        default:
          return 'bin';
      }
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error getting file extension:`, error);
      return 'bin';
    }
  }
  
  /**
   * Send media file
   * @param {string} to - Recipient
   * @param {string} filePath - Path to media file
   * @param {string} caption - Optional caption
   * @returns {Promise<Object>} Send result
   */
  async sendMedia(to, filePath, caption = '') {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      // Read file
      const buffer = fs.readFileSync(filePath);
      
      // Detect media type from extension
      const ext = path.extname(filePath).toLowerCase().substring(1);
      let mediaType;
      
      switch (ext) {
        case 'jpg':
        case 'jpeg':
        case 'png':
          mediaType = 'image';
          break;
        case 'mp4':
        case 'mkv':
        case 'avi':
          mediaType = 'video';
          break;
        case 'mp3':
        case 'ogg':
        case 'wav':
          mediaType = 'audio';
          break;
        case 'pdf':
        case 'doc':
        case 'docx':
        case 'xlsx':
        case 'txt':
          mediaType = 'document';
          break;
        case 'webp':
          mediaType = 'sticker';
          break;
        default:
          mediaType = 'document';
      }
      
      // Prepare media message
      let content;
      
      switch (mediaType) {
        case 'image':
          content = {
            image: buffer,
            caption: caption
          };
          break;
        case 'video':
          content = {
            video: buffer,
            caption: caption
          };
          break;
        case 'audio':
          content = {
            audio: buffer,
            mimetype: 'audio/mp4'
          };
          break;
        case 'document':
          content = {
            document: buffer,
            mimetype: 'application/octet-stream',
            fileName: path.basename(filePath),
            caption: caption
          };
          break;
        case 'sticker':
          content = {
            sticker: buffer
          };
          break;
      }
      
      // Send the media
      return await this.socket.sendMessage(to, content);
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error sending media:`, error);
      throw error;
    }
  }
  
  /**
   * Clean up temporary media files
   * @param {number} maxAgeMinutes - Maximum age in minutes
   * @returns {Promise<number>} Number of files deleted
   */
  async cleanupTempFiles(maxAgeMinutes = 60) {
    try {
      let deletedCount = 0;
      
      // Verify temp directory exists
      if (!fs.existsSync(this.tempDir)) {
        console.log(`[BaileysMedia:${this.instanceId}] Temp directory does not exist: ${this.tempDir}`);
        return 0;
      }
      
      // Get all files in temp directory
      const files = fs.readdirSync(this.tempDir);
      
      // Current time
      const now = Date.now();
      
      // Max age in milliseconds
      const maxAge = maxAgeMinutes * 60 * 1000;
      
      // Check each file
      for (const file of files) {
        // Skip QR code file
        if (file === 'qrcode.png') continue;
        
        const filePath = path.join(this.tempDir, file);
        
        try {
          // Skip directories
          const stats = fs.statSync(filePath);
          if (!stats.isFile()) continue;
          
          // Check if file is older than max age
          if (now - stats.mtimeMs > maxAge) {
            // Delete file
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (fileError) {
          console.error(`[BaileysMedia:${this.instanceId}] Error processing file ${file}:`, fileError);
        }
      }
      
      console.log(`[BaileysMedia:${this.instanceId}] Deleted ${deletedCount} temporary files`);
      
      return deletedCount;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error cleaning up temp files:`, error);
      return 0;
    }
  }
}

module.exports = BaileysMedia;