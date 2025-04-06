// modules/clients/baileys/BaileysMedia.js - Fixed for proper instance ID handling
const fs = require('fs');
const path = require('path');
const { delay } = require('@whiskeysockets/baileys');
const mime = require('mime-types');

/**
 * Handles media operations for Baileys WhatsApp client
 */
class BaileysMedia {
  /**
   * Create a media handler
   * @param {Object} options - Options
   * @param {string} options.instanceId - Instance ID
   * @param {string} options.tempDir - Temporary directory for media files
   */
  constructor(options) {
    this.instanceId = String(options.instanceId || 'default');
    this.tempDir = String(options.tempDir || path.join(__dirname, '..', '..', '..', '..', 'instances', this.instanceId, 'temp'));
    this.socket = null;
    this.mediaQueue = [];
    this.processingQueue = false;

    console.log(`[BaileysMedia:${this.instanceId}] Media handler initialized with temp dir: ${this.tempDir}`);
    
    // Create temp directory if it doesn't exist
    this.createTempDir();
  }

  /**
   * Create temporary directory
   */
  createTempDir() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
        console.log(`[BaileysMedia:${this.instanceId}] Created temp directory: ${this.tempDir}`);
      }
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error creating temp directory:`, error);
    }
  }

  /**
   * Initialize media handler
   */
  initialize() {
    this.createTempDir();
    this.mediaQueue = [];
    this.processingQueue = false;
    console.log(`[BaileysMedia:${this.instanceId}] Media handler initialized`);
  }

  /**
   * Set socket for sending media
   * @param {Object} socket - WhatsApp socket
   */
  setSocket(socket) {
    this.socket = socket;

    // Process any queued media
    if (this.mediaQueue.length > 0 && !this.processingQueue) {
      this.processMediaQueue();
    }
  }

  /**
   * Generate a temporary file path
   * @param {string} prefix - File prefix
   * @param {string} extension - File extension
   * @returns {string} - File path
   */
  getTempFilePath(prefix, extension) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return path.join(this.tempDir, `${prefix}-${timestamp}-${random}.${extension}`);
  }

  /**
   * Send media message
   * @param {string} to - Recipient
   * @param {string} mediaPath - Path to media file
   * @param {Object} options - Additional options
   * @returns {Promise<Object|null>} - Message info
   */
  async sendMedia(to, mediaPath, options = {}) {
    // If no socket, queue the media
    if (!this.socket) {
      console.log(`[BaileysMedia:${this.instanceId}] No socket available, queueing media to ${to}`);
      this.mediaQueue.push({ to, mediaPath, options });
      return null;
    }

    try {
      // Check if media file exists
      if (!fs.existsSync(mediaPath)) {
        throw new Error(`Media file not found: ${mediaPath}`);
      }

      // Ensure JID has @s.whatsapp.net unless it's a group
      let jid = to;
      if (!jid.includes('@g.us') && !jid.includes('@s.whatsapp.net')) {
        jid = `${jid}@s.whatsapp.net`;
      }

      // Get file info
      const fileStats = fs.statSync(mediaPath);
      
      // Skip if file is empty or very small
      if (fileStats.size === 0) {
        throw new Error(`Media file is empty: ${mediaPath}`);
      }
      
      // Determine MIME type
      const mimeType = mime.lookup(mediaPath) || 'application/octet-stream';
      
      // Get file extension
      const fileExt = path.extname(mediaPath).substring(1).toLowerCase();
      
      // Get filename
      const fileName = options.fileName || path.basename(mediaPath);
      
      // Read file as buffer
      const mediaBuffer = fs.readFileSync(mediaPath);
      
      // Create media message based on type
      let mediaMessage = {};
      
      // Process based on MIME type
      if (mimeType.startsWith('image/')) {
        // Image message
        mediaMessage = {
          image: mediaBuffer,
          caption: options.caption || '',
          mimetype: mimeType
        };
      } else if (mimeType.startsWith('video/')) {
        // Video message
        mediaMessage = {
          video: mediaBuffer,
          caption: options.caption || '',
          mimetype: mimeType,
          gifPlayback: options.gif === true
        };
      } else if (mimeType.startsWith('audio/')) {
        // Audio message
        mediaMessage = {
          audio: mediaBuffer,
          mimetype: mimeType,
          ptt: options.ptt === true // Push to talk (voice note)
        };
      } else {
        // Default to document
        mediaMessage = {
          document: mediaBuffer,
          mimetype: mimeType,
          fileName: fileName,
          caption: options.caption || ''
        };
      }
      
      // Add any additional options
      if (options.mentions) {
        mediaMessage.mentions = options.mentions;
      }
      
      // Send the media message
      console.log(`[BaileysMedia:${this.instanceId}] Sending ${mimeType} to ${jid}`);
      const sentMsg = await this.socket.sendMessage(jid, mediaMessage);
      
      return sentMsg;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error sending media to ${to}:`, error);
      
      // Queue for retry if appropriate
      if (error.output?.statusCode !== 403 && error.output?.statusCode !== 404) {
        this.mediaQueue.push({ to, mediaPath, options });
        
        // Start processing queue if not already
        if (!this.processingQueue) {
          this.processMediaQueue();
        }
      }
      
      return null;
    }
  }

  /**
   * Process queued media messages
   */
  async processMediaQueue() {
    // Exit if already processing or no queue
    if (this.processingQueue || this.mediaQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    console.log(`[BaileysMedia:${this.instanceId}] Processing media queue: ${this.mediaQueue.length} items`);

    while (this.mediaQueue.length > 0) {
      // If no socket, pause queue processing
      if (!this.socket) {
        this.processingQueue = false;
        return;
      }

      // Get next media
      const { to, mediaPath, options } = this.mediaQueue.shift();

      try {
        // Send media
        await this.sendMedia(to, mediaPath, options);
        
        // Small delay to prevent rate limiting
        await delay(1000);
      } catch (error) {
        console.error(`[BaileysMedia:${this.instanceId}] Error sending queued media:`, error);
      }
    }

    this.processingQueue = false;
    console.log(`[BaileysMedia:${this.instanceId}] Media queue processing completed`);
  }

  /**
   * Download media from WhatsApp
   * @param {Object} message - WhatsApp message
   * @returns {Promise<string|null>} - Path to downloaded media
   */
  async downloadMedia(message) {
    if (!this.socket || !message) return null;

    try {
      // Find the media content
      let mediaMessage = null;
      let mediaType = null;
      
      if (message.message?.imageMessage) {
        mediaMessage = message.message.imageMessage;
        mediaType = 'image';
      } else if (message.message?.videoMessage) {
        mediaMessage = message.message.videoMessage;
        mediaType = 'video';
      } else if (message.message?.audioMessage) {
        mediaMessage = message.message.audioMessage;
        mediaType = 'audio';
      } else if (message.message?.documentMessage) {
        mediaMessage = message.message.documentMessage;
        mediaType = 'document';
      } else if (message.message?.stickerMessage) {
        mediaMessage = message.message.stickerMessage;
        mediaType = 'sticker';
      } else {
        return null; // No media found
      }

      // Get MIME type
      const mimeType = mediaMessage.mimetype || 'application/octet-stream';
      
      // Determine file extension from MIME type
      let extension = mime.extension(mimeType) || 'bin';
      
      // Use original extension for documents if available
      if (mediaType === 'document' && mediaMessage.fileName) {
        const originalExt = path.extname(mediaMessage.fileName).substring(1);
        if (originalExt) {
          extension = originalExt;
        }
      }
      
      // Generate temporary file path
      const filePath = this.getTempFilePath(mediaType, extension);
      
      // Download the media
      console.log(`[BaileysMedia:${this.instanceId}] Downloading ${mediaType} from message`);
      const buffer = await this.socket.downloadMediaMessage(message);
      
      // Save to file
      fs.writeFileSync(filePath, buffer);
      console.log(`[BaileysMedia:${this.instanceId}] Media saved to ${filePath}`);
      
      return filePath;
    } catch (error) {
      console.error(`[BaileysMedia:${this.instanceId}] Error downloading media:`, error);
      return null;
    }
  }
}

module.exports = BaileysMedia;