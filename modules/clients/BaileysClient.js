// modules/clients/BaileysClient.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const pino = require('pino');
const events = require('events');

/**
 * WhatsApp client using WhiskeySockets/Baileys library with improved instance isolation
 */
class BaileysClient extends events.EventEmitter {
  constructor(options = {}) {
    // CRITICAL FIX: Call super() before using 'this'
    super();
    
    // Instance ID for proper isolation
    this.instanceId = options.instanceId || 'default';
    
    // Create required directories with proper isolation
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'baileys_auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'temp');
    this.mediaArchiveDir = options.mediaArchiveDir || path.join(__dirname, '..', '..', 'instances', this.instanceId, 'media_archive');
    
    // Create all required directories
    this.ensureDirectories();
    
    this.sock = null;
    this.isReady = false;
    this.isInitializing = false;
    this.connectionPromises = [];
    this.messageQueue = []; // Queue messages if sent before ready
    this.messageStore = {};  // Store for recent messages

    // Connection settings
    this.maxReconnectAttempts = options.maxRetries || 10;
    this.reconnectAttempts = 0;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.shouldReconnect = true;
    
    // QR code settings
    this.qrTimeout = options.qrTimeout || 60000;
    this.showQrCode = options.showQrCode !== false; // Default to true

    // Logger setup with instance ID
    const loggerOpts = { 
      level: options.logLevel || 'warn',
      msgPrefix: `[BaileysClient:${this.instanceId}] `
    };
    this.logger = options.logger || pino(loggerOpts);
    
    // Phone number normalization cache to maintain consistent formatting
    this.phoneNumberCache = new Map();
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized with auth folder: ${this.authFolder}`);
  }
  
  /**
   * Create all required directories
   */
  ensureDirectories() {
    const dirs = [this.authFolder, this.tempDir, this.mediaArchiveDir];
    
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[BaileysClient:${this.instanceId}] Created directory: ${dir}`);
      }
    }
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
  }
  
  /**
   * Set QR code timeout
   * @param {number} timeout - Timeout in milliseconds
   */
  setQrTimeout(timeout) {
    this.qrTimeout = timeout;
  }
  
  /**
   * Normalize a phone number for consistent processing
   * @param {string} phoneNumber - Phone number to normalize
   * @returns {string} - Normalized phone number
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Check if already in cache
    if (this.phoneNumberCache.has(phoneNumber)) {
      return this.phoneNumberCache.get(phoneNumber);
    }
    
    // Remove WhatsApp extensions
    let normalized = String(phoneNumber).replace(/@.*$/, '');
    
    // Remove any non-digit characters except the leading +
    if (normalized.startsWith('+')) {
      normalized = '+' + normalized.substring(1).replace(/[^0-9]/g, '');
    } else {
      normalized = normalized.replace(/[^0-9]/g, '');
    }
    
    // Cache the result
    this.phoneNumberCache.set(phoneNumber, normalized);
    
    return normalized;
  }
  
  /**
   * Reset the reconnection counter and enable reconnection
   */
  resetReconnectCounter() {
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;
  }
  
  /**
   * Initialize the Baileys connection
   * @returns {Promise<boolean>} - Connection success status
   */
  async initialize() {
    if (this.isReady) return true;
    if (this.isInitializing) {
      return new Promise((resolve) => {
        this.connectionPromises.push(resolve);
      });
    }
    
    this.isInitializing = true;
    this.resetReconnectCounter();
    
    try {
      console.log(`[BaileysClient:${this.instanceId}] Initializing Baileys connection...`);
      
      // Check if FFmpeg is installed (needed for media conversion)
      await this.checkFfmpeg();
      
      // Get authentication state
      let state, saveCreds;
      try {
        const authStateResult = await useMultiFileAuthState(this.authFolder);
        state = authStateResult.state;
        saveCreds = authStateResult.saveCreds;
      } catch (authError) {
        console.error(`[BaileysClient:${this.instanceId}] Error loading auth state: ${authError.message}`);
        console.log(`[BaileysClient:${this.instanceId}] Creating fresh auth state`);
        
        // Ensure auth folder exists
        if (!fs.existsSync(this.authFolder)) {
          fs.mkdirSync(this.authFolder, { recursive: true });
        }
        
        // Try again with fresh directory
        const authStateResult = await useMultiFileAuthState(this.authFolder);
        state = authStateResult.state;
        saveCreds = authStateResult.saveCreds;
      }
      
      // Check for valid credentials
      const credsPath = path.join(this.authFolder, 'creds.json');
      const credsExist = fs.existsSync(credsPath);
      const credsValid = credsExist && fs.statSync(credsPath).size > 10;
      
      console.log(`[BaileysClient:${this.instanceId}] Auth state: ${credsValid ? 'Found valid session' : 'No valid session found'}`);
      
      // Fetch the latest version to ensure compatibility
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[BaileysClient:${this.instanceId}] Using WA v${version.join('.')}, isLatest: ${isLatest}`);
      
      // Create socket with extended timeouts and more robust settings
      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // We handle QR code ourselves
        logger: this.logger,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        browser: ['WhatsApp-Discord-Bridge', 'Chrome', '10.0'],
        markOnlineOnConnect: true,
        retryRequestDelayMs: 500,
        qrTimeout: 60000,
        connectTimeout: 120000,
        fireInitQueries: true,
        shouldIgnoreJid: jid => jid.endsWith('@broadcast'),
        shouldSyncHistoryMessage: false,
        linkPreviewImageThumbnailWidth: 300,
        transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
        getMessage: async (key) => {
          if (this.messageStore[key.remoteJid] && this.messageStore[key.remoteJid][key.id]) {
            return this.messageStore[key.remoteJid][key.id].message;
          }
          return undefined;
        }
      });
      
      // Save credentials when updated
      this.sock.ev.on('creds.update', saveCreds);
      
      // Handle connection updates
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        console.log(`[BaileysClient:${this.instanceId}] Connection state update: ${connection || 'none'}`);
        
        if (connection === 'close') {
          // Get disconnect reason code
          const statusCode = lastDisconnect?.error?.output?.statusCode || 0;
          const shouldReconnect = 
            (lastDisconnect?.error instanceof Boom) && 
            statusCode !== DisconnectReason.loggedOut &&
            this.shouldReconnect;
          
          console.log(`[BaileysClient:${this.instanceId}] Connection closed due to ${lastDisconnect?.error?.message || 'unknown reason'} (code: ${statusCode || 'unknown'})`);
          
          if (shouldReconnect) {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              console.log(`[BaileysClient:${this.instanceId}] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
              this.isReady = false;
              this.isInitializing = false;
              
              // Wait a bit before reconnecting
              await new Promise(resolve => setTimeout(resolve, this.reconnectInterval));
              
              // Clear socket
              this.sock = null;
              
              // Try to initialize again
              await this.initialize();
            } else {
              console.log(`[BaileysClient:${this.instanceId}] Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`);
              this.isReady = false;
              this.isInitializing = false;
              this.connectionPromises.forEach(resolve => resolve(false));
              this.connectionPromises = [];
              
              // Emit the disconnect event with error
              this.emit('disconnect', new Error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`));
              this.shouldReconnect = false; // Prevent further reconnection attempts
            }
          } else if (statusCode === DisconnectReason.loggedOut) {
            console.log(`[BaileysClient:${this.instanceId}] Logged out, no reconnection`);
            this.isReady = false;
            this.isInitializing = false;
            this.connectionPromises.forEach(resolve => resolve(false));
            this.connectionPromises = [];
            
            this.emit('disconnect', new Error('Logged out from WhatsApp'));
            this.shouldReconnect = false;
          } else {
            this.isReady = false;
            this.isInitializing = false;
            this.connectionPromises.forEach(resolve => resolve(false));
            this.connectionPromises = [];
            this.emit('disconnect', new Error(`Connection closed: ${lastDisconnect?.error?.message || 'unknown reason'}`));
          }
        } else if (connection === 'open') {
          console.log(`[BaileysClient:${this.instanceId}] Connection established successfully!`);
          this.isReady = true;
          this.isInitializing = false;
          this.reconnectAttempts = 0; // Reset reconnection attempts
          
          // Process any queued messages
          while (this.messageQueue.length > 0) {
            const { to, content, options } = this.messageQueue.shift();
            await this.sendMessage(to, content, options).catch(err => 
              console.error(`[BaileysClient:${this.instanceId}] Error sending queued message:`, err)
            );
          }
          
          this.connectionPromises.forEach(resolve => resolve(true));
          this.connectionPromises = [];
          
          this.emit('ready');
        }
        
        if (qr && this.showQrCode) {
          console.log(`[BaileysClient:${this.instanceId}] QR Code refreshed. Length: ${qr.length} chars`);
          this.emit('qr', qr);
        }
      });
      
      // Handle incoming messages
      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type === 'notify') {
          for (const msg of messages) {
            // Store message for future reference
            this.storeMessage(msg);
            
            // Skip messages sent by us
            if (msg.key.fromMe) continue;
            
            // Skip system messages
            if (msg.key.remoteJid === 'status@broadcast') continue;
            
            // Determine if this is a group message
            const isGroupMessage = msg.key.remoteJid.endsWith('@g.us');
            if (isGroupMessage) continue; // Skip group messages for now
            
            // For non-group messages, emit the 'message' event
            console.log(`[BaileysClient:${this.instanceId}] Received message from ${msg.key.remoteJid}`);
            this.emit('message', this.formatIncomingMessage(msg));
          }
        }
      });
      
      // IMPROVED: Use existing session detection for timeout
      if (credsValid) {
        console.log(`[BaileysClient:${this.instanceId}] Attempting to restore previous session...`);
      } else {
        console.log(`[BaileysClient:${this.instanceId}] No existing valid session found, waiting for QR code scan...`);
      }
      
      // Wait for connection or timeout
      const result = await new Promise((resolve) => {
        const timeoutDuration = credsValid ? 60000 : this.qrTimeout;
        const timeout = setTimeout(() => {
          if (!this.isReady) {
            console.log(`[BaileysClient:${this.instanceId}] Connection timed out after ${timeoutDuration/1000} seconds`);
            this.isInitializing = false;
            resolve(false);
            
            // Force a disconnect
            if (this.sock) {
              if (typeof this.sock.end === 'function') {
                this.sock.end();
              }
              this.sock = null;
            }
          }
        }, timeoutDuration);
        
        this.connectionPromises.push((success) => {
          clearTimeout(timeout);
          resolve(success);
        });
      });
      
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing Baileys connection:`, error);
      this.isInitializing = false;
      return false;
    }
  }
  
  /**
   * Explicitly disconnect the client
   * @param {boolean} logOut - Whether to log out completely
   * @returns {Promise<boolean>} - Success status
   */
  async disconnect(logOut = false) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Disconnecting WhatsApp...${logOut ? ' (with full logout)' : ''}`);
      
      // Prevent automatic reconnection
      this.shouldReconnect = false;
      
      if (this.sock) {
        if (logOut) {
          // Full logout - will delete credentials
          try {
            if (typeof this.sock.logout === 'function') {
              await this.sock.logout();
              console.log(`[BaileysClient:${this.instanceId}] Successfully logged out of WhatsApp`);
            } else {
              console.log(`[BaileysClient:${this.instanceId}] Logout function not available, falling back to end()`);
              if (typeof this.sock.end === 'function') {
                await this.sock.end();
              }
            }
            
            // Safely delete auth files with retry
            await this.safelyDeleteAuthFiles();
            
          } catch (logoutError) {
            console.error(`[BaileysClient:${this.instanceId}] Error during logout: ${logoutError.message}`);
          }
        } else {
          // Simple disconnect without logout
          if (typeof this.sock.end === 'function') {
            await this.sock.end();
          }
        }
        
        this.sock = null;
      }
      
      this.isReady = false;
      this.isInitializing = false;
      
      // Clear message queue
      this.messageQueue = [];
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp disconnected successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      
      // Force reset state on error
      this.isReady = false;
      this.isInitializing = false;
      this.sock = null;
      
      return false;
    }
  }

  /**
   * Safely delete auth files with retries to handle permission issues
   */
  async safelyDeleteAuthFiles() {
    // Safely delete auth files with retry for Windows permission issues
    const credsPath = path.join(this.authFolder, 'creds.json');
    
    // Helper to safely delete a file with retries
    const safeDelete = async (filePath, maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
          }
          return false; // File doesn't exist
        } catch (err) {
          console.log(`[BaileysClient:${this.instanceId}] Delete attempt ${attempt + 1} failed for ${filePath}: ${err.message}`);
          // Wait a bit before trying again (Windows sometimes needs this)
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      console.error(`[BaileysClient:${this.instanceId}] Failed to delete ${filePath} after ${maxRetries} attempts`);
      return false;
    };
    
    // Delete credentials file
    await safeDelete(credsPath);
    
    // Delete auth_info files in the directory
    if (fs.existsSync(this.authFolder)) {
      const files = fs.readdirSync(this.authFolder);
      for (const file of files) {
        if (file.includes('auth_info') || file.includes('session') || file.includes('key')) {
          const filePath = path.join(this.authFolder, file);
          await safeDelete(filePath);
        }
      }
    }
  }
  
  /**
   * Store a message for later reference
   * @param {Object} msg - Baileys message
   */
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
  
  /**
   * Format incoming message to a standard format
   * @param {Object} msg - Baileys message object
   * @returns {Object} - Standardized message object
   */
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
    // Other types of messages
    else {
      // Unknown message type
      formatted.type = 'unknown';
      formatted.rawMessage = msg.message;
      formatted.body = 'Unsupported message type';
    }
    
    // Add original message to allow access to all properties
    formatted.originalMessage = msg;
    
    // Add convenience method for downloading media
    formatted.downloadMedia = async () => {
      if (formatted.hasMedia) {
        return await this.downloadMedia(formatted.from, formatted.id, formatted.originalMessage);
      }
      return null;
    };
    
    return formatted;
  }
  
  /**
   * Check if FFmpeg is installed
   * @returns {Promise<boolean>}
   */
  async checkFfmpeg() {
    return new Promise((resolve) => {
      exec('ffmpeg -version', (error) => {
        if (error) {
          console.error(`[BaileysClient:${this.instanceId}] FFmpeg is not installed or not in PATH`);
          resolve(false);
          return;
        }
        console.log(`[BaileysClient:${this.instanceId}] FFmpeg is installed and available`);
        resolve(true);
      });
    });
  }
  
  /**
   * Format phone number to a valid JID
   * @param {string} number - Phone number
   * @returns {string} - Valid JID
   */
  formatJid(number) {
    // If it already includes @, it's already formatted
    if (number.includes('@')) {
      // Convert from @c.us to @s.whatsapp.net if needed
      return number.replace('@c.us', '@s.whatsapp.net');
    }
    
    // Normalize the number
    const cleanNumber = this.normalizePhoneNumber(number);
    
    // Return formatted JID
    return `${cleanNumber}@s.whatsapp.net`;
  }
  
  /**
   * Send a message
   * @param {string} to - Recipient phone number
   * @param {string|Object} content - Message content
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Message info
   */
  async sendMessage(to, content, options = {}) {
    // Queue message if not connected yet
    if (!this.isReady) {
      console.log(`[BaileysClient:${this.instanceId}] Baileys not ready, queueing message`);
      this.messageQueue.push({ to, content, options });
      if (!this.isInitializing) {
        await this.initialize();
      }
      return null;
    }
    
    try {
      // Format the recipient JID
      const jid = this.formatJid(to);
      
      // Handle string content as text message
      if (typeof content === 'string') {
        return await this.sock.sendMessage(jid, { text: content });
      }
      
      // Handle other content types
      if (Buffer.isBuffer(content)) {
        // Buffer content - try to determine type
        const mimeType = options.mimetype || 'application/octet-stream';
        if (mimeType.startsWith('image/')) {
          return await this.sock.sendMessage(jid, {
            image: content,
            caption: options.caption || '',
            mimetype: mimeType
          });
        } else if (mimeType.startsWith('video/')) {
          return await this.sock.sendMessage(jid, {
            video: content,
            caption: options.caption || '',
            gifPlayback: options.sendVideoAsGif === true,
            mimetype: mimeType
          });
        } else if (mimeType.startsWith('audio/')) {
          return await this.sock.sendMessage(jid, {
            audio: content,
            mimetype: mimeType,
            ptt: options.sendAudioAsPtt === true
          });
        } else {
          return await this.sock.sendMessage(jid, {
            document: content,
            mimetype: mimeType,
            fileName: options.filename || 'file',
            caption: options.caption || ''
          });
        }
      }
      
      // Default to text if content type is unknown
      if (typeof content === 'object') {
        try {
          return await this.sock.sendMessage(jid, { text: JSON.stringify(content) });
        } catch (jsonError) {
          console.error(`[BaileysClient:${this.instanceId}] Error stringifying content:`, jsonError);
          return await this.sock.sendMessage(jid, { text: "Content could not be processed" });
        }
      } else {
        return await this.sock.sendMessage(jid, { text: String(content) });
      }
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message with Baileys:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {string} chatId - Chat ID (e.g. '1234567890@s.whatsapp.net')
   * @param {string} messageId - Message ID
   * @param {Object} messageObj - Optional message object if already available
   * @returns {Promise<Buffer>} - Media buffer
   */
  async downloadMedia(chatId, messageId, messageObj = null) {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Downloading media from chat ${chatId}, message ${messageId}`);
      
      // Ensure Baileys is initialized
      if (!this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Baileys not connected, initializing...`);
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format chat ID if needed
      const jid = this.formatJid(chatId);
      
      // Try to get the message object
      let msg = messageObj;
      
      // If no message object provided, try to get from store
      if (!msg) {
        msg = this.messageStore[jid]?.[messageId];
      }
      
      if (!msg) {
        throw new Error(`Message ${messageId} not found in chat ${jid}`);
      }
      
      // Download the media
      console.log(`[BaileysClient:${this.instanceId}] Found message, downloading media...`);
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { 
          logger: console,
          reuploadRequest: this.sock.updateMediaMessage
        }
      );
      
      if (!buffer || buffer.length === 0) {
        throw new Error('Downloaded buffer is empty');
      }
      
      console.log(`[BaileysClient:${this.instanceId}] Successfully downloaded ${buffer.length} bytes of media`);
      return buffer;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media with Baileys:`, error);
      throw error;
    }
  }
  
  /**
   * Convert GIF to MP4 using direct FFmpeg command
   * @param {string|Buffer} gifInput - GIF path or buffer
   * @returns {Promise<string>} - Path to MP4 file
   */
  async convertGifToMp4(gifInput) {
    try {
      let gifPath;
      let needToCleanup = false;
      
      // Handle buffer input
      if (Buffer.isBuffer(gifInput)) {
        gifPath = path.join(this.tempDir, `baileys_gif_${Date.now()}.gif`);
        fs.writeFileSync(gifPath, gifInput);
        needToCleanup = true;
      } else {
        gifPath = gifInput;
      }
      
      const outputPath = path.join(
        this.tempDir,
        `baileys_mp4_${Date.now()}.mp4`
      );
      
      console.log(`[BaileysClient:${this.instanceId}] Converting GIF to MP4 for Baileys: ${gifPath} -> ${outputPath}`);
      
      // Using exact command from working test
      return new Promise((resolve, reject) => {
        const command = `ffmpeg -i "${gifPath}" -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -b:v 1M -maxrate 1M -bufsize 1M -an "${outputPath}"`;
        
        exec(command, (error, stdout, stderr) => {
          // Clean up the input if we created it
          if (needToCleanup) {
            try { fs.unlinkSync(gifPath); } catch (e) { /* ignore */ }
          }
          
          if (error) {
            console.error(`[BaileysClient:${this.instanceId}] FFmpeg error:`, error);
            reject(error);
            return;
          }
          
          if (stderr) {
            console.log(`[BaileysClient:${this.instanceId}] FFmpeg stderr:`, stderr);
          }
          
          console.log(`[BaileysClient:${this.instanceId}] GIF to MP4 conversion complete: ${outputPath}`);
          resolve(outputPath);
        });
      });
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error in convertGifToMp4:`, error);
      throw error;
    }
  }
  
  /**
   * Send a GIF using Baileys
   * @param {string} recipient - WhatsApp number (with or without @c.us)
   * @param {Buffer|string} gifInput - GIF buffer or path
   * @param {string} caption - Optional caption
   * @returns {Promise<Object>} - Message info
   */
  async sendGif(recipient, gifInput, caption = '') {
    try {
      console.log(`[BaileysClient:${this.instanceId}] Preparing to send GIF to ${recipient} via Baileys...`);
      
      // Ensure initialized
      if (!this.isReady) {
        console.log(`[BaileysClient:${this.instanceId}] Baileys not connected, initializing...`);
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize Baileys connection');
        }
      }
      
      // Format recipient for Baileys
      const jid = this.formatJid(recipient);
      
      console.log(`[BaileysClient:${this.instanceId}] Converting GIF for ${jid}...`);
      
      // Convert GIF to MP4
      const mp4Path = await this.convertGifToMp4(gifInput);
      
      console.log(`[BaileysClient:${this.instanceId}] Sending MP4 as GIF to ${jid}...`);
      
      // Send as GIF
      const result = await this.sock.sendMessage(jid, {
        video: fs.readFileSync(mp4Path),
        caption: caption || undefined,
        gifPlayback: true
      });
      
      console.log(`[BaileysClient:${this.instanceId}] GIF sent successfully via Baileys!`);
      
      // Clean up
      try {
        fs.unlinkSync(mp4Path);
      } catch (e) {
        console.error(`[BaileysClient:${this.instanceId}] Error cleaning up temp file:`, e);
      }
      
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending GIF with Baileys:`, error);
      throw error;
    }
  }
  
  /**
   * Get client status
   * @returns {Object} - Status info
   */
  getStatus() {
    return {
      isInitialized: this.isInitializing || this.isReady,
      isReady: this.isReady,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      qrTimeout: this.qrTimeout
    };
  }
}

module.exports = BaileysClient;