// modules/clients/baileys/BaileysMedia.js - Media handling
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

/**
 * Manages media for Baileys WhatsApp client
 */
class BaileysMedia {
  /**
   * Create a new BaileysMedia instance
   * @param {BaileysClient} client - Parent client
   */
  constructor(client) {
    this.client = client;
    this.instanceId = client.options.instanceId;
    this.socket = null;
    this.tempDir = client.options.tempDir;
    
    // Ensure temp directory exists
    this.ensureTempDir();
  }
  
  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
      console.log(`[BaileysMedia:${this.instanceId}] Created temp directory: ${this.tempDir}`);
    }
  }
  
  /**
   * Initialize with socket
   * @param {Object} socket - Baileys socket connection
   */
  initialize(socket) {
    this.socket = socket;
    console.log(`[BaileysMedia:${this.instanceId}] Media handler initialized`);
  }
  
  /**
   * Reset state
   */
  reset() {
    this.socket = null;
  }
  
  /**
   * Generate a random filename with given extension
   * @param {string} extension - File extension
   * @returns {string} Random filename
   */
  generateRandomFilename(extension) {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${randomString}.${extension}`;
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} File extension
   */
  getExtensionFromMime(mimeType) {
    const ext = mime.extension(mimeType);
    return ext || 'bin'; // Default to .bin
  }
  
  /**
   * Process and send media to WhatsApp
   * @param {string} to - Recipient phone number
   * @param {Buffer|string} media - Media content or path
   * @param {string} type - Media type (image, video, document, audio)
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Message info
   */
  async sendMedia(to, media, type, options = {}) {
    try {
      if (!this.socket) {
        throw new Error(`[BaileysMedia:${this.instanceId}] Socket not initialized`);
      }
      
      // Format the destination phone number
      let formattedTo = to;
      if (!to.includes('@')) {
        formattedTo = `${to}@s.whatsapp.net`;
      }
      
      // Prepare media content
      let mediaContent;
      
      // If media is a string, treat it as a file path
      if (typeof media === 'string') {
        if (!fs.existsSync(media)) {
          throw new Error(`[BaileysMedia:${this.instanceId}] File not found: ${media}`);
        }
        
        // Read file as buffer
        mediaContent = fs.readFileSync(media);
      } else if (Buffer.isBuffer(media)) {
        // Media is already a buffer
        mediaContent = media;
      } else {
        throw new Error(`[BaileysMedia:${this.instanceId}] Media must be a file path or Buffer`);
      }
      
      // Determine MIME type
      let mimeType;
      if (options.mimetype) {
        mimeType = options.mimetype;
      } else if (typeof media === 'string') {
        mimeType = mime.lookup(media) || `${type}/unknown`;
      } else {
        // Default MIME types by type
        const defaultMimes = {
          image: 'image/jpeg',
          video: 'video/mp4',
          audio: 'audio/mp3',
          document: 'application/pdf'
        };
        mimeType = defaultMimes[type] || 'application/octet-stream';
      }
      
      // Determine filename
      let filename;
      if (options.filename) {
        filename = options.filename;
      } else if (typeof media === 'string') {
        filename = path.basename(media);
      } else {
        // Generate a random filename
        const extension = this.getExtensionFromMime(mimeType);
        filename = this.generateRandomFilename(extension);
      }
      
      // Prepare the message content based on media type
      let content = {};
      
      switch (type) {
        case 'image':
          content = {
            image: mediaContent,
            caption: options.caption || '',
            mimetype: mimeType
          };
          break;
        
        case 'video':
          content = {
            video: mediaContent,
            caption: options.caption || '',
            mimetype: mimeType,
            gifPlayback: options.gifPlayback || false
          };
          break;
        
        case 'audio':
          content = {
            audio: mediaContent,
            mimetype: mimeType,
            ptt: options.ptt || false // Voice note mode
          };
          break;
        
        case 'document':
          content = {
            document: mediaContent,
            caption: options.caption || '',
            mimetype: mimeType,
            fileName: filename
          };
          break;
        
        default:
          throw new Error(`[BaileysMedia:${this.instanceId}] Unsupported media type: ${type}`);
      }
      
      // Send the media message
      console.log(`[BaileysMedia:${this.instanceId}] Sending ${type} to ${formattedTo}`);
      const result = await this.socket.sendMessage(formattedTo, content);
      
      console.log(`[BaileysMedia:${this.instanceId}] ${type} sent successfully to ${formattedTo}`);
      return result;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error sending media:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - WhatsApp message with media
   * @returns {Promise<Object>} Downloaded media info
   */
  async downloadMedia(message) {
    try {
      // Ensure temp directory exists
      this.ensureTempDir();
      
      // Determine media type and content
      let mediaType, mediaContent;
      
      if (message.message.imageMessage) {
        mediaType = 'image';
        mediaContent = message.message.imageMessage;
      } else if (message.message.videoMessage) {
        mediaType = 'video';
        mediaContent = message.message.videoMessage;
      } else if (message.message.audioMessage) {
        mediaType = 'audio';
        mediaContent = message.message.audioMessage;
      } else if (message.message.documentMessage) {
        mediaType = 'document';
        mediaContent = message.message.documentMessage;
      } else if (message.message.stickerMessage) {
        mediaType = 'sticker';
        mediaContent = message.message.stickerMessage;
      } else {
        throw new Error(`[BaileysMedia:${this.instanceId}] No media found in message`);
      }
      
      // Get media details
      const mimeType = mediaContent.mimetype || 'application/octet-stream';
      let filename = mediaContent.fileName || '';
      
      // Generate filename if none exists
      if (!filename) {
        const extension = this.getExtensionFromMime(mimeType);
        filename = this.generateRandomFilename(extension);
      }
      
      // Create full path
      const filePath = path.join(this.tempDir, filename);
      
      // Download the media
      console.log(`[BaileysMedia:${this.instanceId}] Downloading ${mediaType} from message`);
      
      const stream = await downloadContentFromMessage(mediaContent, mediaType);
      const buffer = await this.streamToBuffer(stream);
      
      // Save the media to the temp directory
      fs.writeFileSync(filePath, buffer);
      
      console.log(`[BaileysMedia:${this.instanceId}] Media saved to ${filePath}`);
      
      return {
        type: mediaType,
        mimetype: mimeType,
        filename,
        filePath,
        buffer,
        size: buffer.length,
        caption: mediaContent.caption || ''
      };
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Convert a stream to a buffer
   * @param {Stream} stream - Data stream
   * @returns {Promise<Buffer>} Buffer containing all stream data
   */
  async streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      
      stream.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  /**
   * Clean temporary files
   * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
   */
  cleanTempFiles(maxAge = 3600000) {
    try {
      console.log(`[BaileysMedia:${this.instanceId}] Cleaning temporary files...`);
      
      if (!fs.existsSync(this.tempDir)) {
        return;
      }
      
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      let deletedCount = 0;
      
      for (const file of files) {
        try {
          // Skip QR code file
          if (file === 'qrcode.png') continue;
          
          const filePath = path.join(this.tempDir, file);
          const stats = fs.statSync(filePath);
          
          // Check if file is older than maxAge
          if (now - stats.mtime.getTime() > maxAge) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (fileError) {
          console.error(`[BaileysMedia:${this.instanceId}] Error processing file ${file}:`, fileError);
        }
      }
      
      console.log(`[BaileysMedia:${this.instanceId}] Deleted ${deletedCount} temporary files`);
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error cleaning temporary files:`, error);
    }
  }
}

module.exports = { BaileysMedia };