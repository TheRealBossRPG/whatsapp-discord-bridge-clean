// modules/clients/BaileysClient.js - FIXED VERSION

const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@adiwajshing/baileys').default;
const { DisconnectReason, useMultiFileAuthState } = require('@adiwajshing/baileys');
const EventEmitter = require('events');
const P = require('pino');

/**
 * BaileysClient with improved messaging compatibility
 * CRITICAL FIX: Better event handling and message formatting
 */
class BaileysClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.instanceId = options.instanceId || 'default';
    this.authFolder = options.authFolder || path.join(__dirname, '..', '..', 'auth');
    this.tempDir = options.tempDir || path.join(__dirname, '..', '..', 'temp');
    
    // Create auth folder if it doesn't exist
    const baileyAuthPath = path.join(this.authFolder, 'baileys_auth');
    if (!fs.existsSync(baileyAuthPath)) {
      fs.mkdirSync(baileyAuthPath, { recursive: true });
    }
    
    // Create temp folder if it doesn't exist
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // Set up state for connection
    this.sock = null;
    this.isReady = false;
    this.qrCode = null;
    this.showQrCode = false;
    this.activeRetries = 0;
    this.maxRetries = options.maxRetries || 5;
    this.connectTimeout = options.connectTimeout || 60000;
    
    // Set up logger
    this.logger = P({
      timestamp: () => `,"time":"${new Date().toJSON()}"`,
      level: options.logLevel || 'info'
    });
    
    console.log(`[BaileysClient:${this.instanceId}] Initialized. Will connect on initialize() call.`);
  }
  
  /**
   * Set whether to show QR code
   * @param {boolean} show - Whether to show QR code
   */
  setShowQrCode(show) {
    this.showQrCode = show;
    console.log(`[BaileysClient:${this.instanceId}] QR code display set to: ${show}`);
  }
  
  /**
   * Initialize WhatsApp connection
   * @returns {Promise<boolean>} - Whether connection was successful
   */
  async initialize() {
    try {
      // Initialize auth state from folder
      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(this.authFolder, 'baileys_auth')
      );
      
      // Check if auth state exists
      const hasValidSession = fs.existsSync(path.join(this.authFolder, 'baileys_auth', 'creds.json'));
      console.log(`[BaileysClient:${this.instanceId}] Auth state: ${hasValidSession ? 'Valid session found' : 'No valid session found'}`);
      
      // Start connection
      console.log(`[BaileysClient:${this.instanceId}] Starting WhatsApp connection...`);
      
      // Create socket with options
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.logger
      });
      
      console.log(`[BaileysClient:${this.instanceId}] WhatsApp socket created`);
      
      // Set up connection status handler
      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Log connection state changes
        if (connection) {
          console.log(`[BaileysClient:${this.instanceId}] Connection state: ${connection}`);
        }
        
        // Handle connection status
        if (connection === 'close') {
          // Check if close was intentional or error
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[BaileysClient:${this.instanceId}] Connection closed with status: ${statusCode || 'unknown'}`);
          
          // Handle specific disconnect reasons
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && 
                                  statusCode !== 401 &&
                                  this.activeRetries < this.maxRetries;
          
          if (shouldReconnect) {
            console.log(`[BaileysClient:${this.instanceId}] Reconnecting...`);
            this.activeRetries++;
            this.initialize();
          } else if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            // Logged out - emit disconnect event
            this.isReady = false;
            this.emit('disconnected');
            console.log(`[BaileysClient:${this.instanceId}] Logged out. Manual reconnection required.`);
          } else if (this.activeRetries >= this.maxRetries) {
            // Too many retries
            this.isReady = false;
            this.emit('error', new Error(`Maximum reconnection attempts (${this.maxRetries}) reached`));
            console.log(`[BaileysClient:${this.instanceId}] Maximum reconnection attempts reached`);
          }
        } else if (connection === 'open') {
          // Successfully connected
          this.isReady = true;
          this.activeRetries = 0;
          
          // Get phone number (JID) and log it
          const phoneNumber = this.sock.user?.id?.split(':')[0];
          console.log(`[BaileysClient:${this.instanceId}] Connected as ${phoneNumber}`);
          
          // Emit ready event
          this.emit('ready');
        }
        
        // Handle QR code
        if (qr && this.showQrCode) {
          this.qrCode = qr;
          console.log(`[BaileysClient:${this.instanceId}] QR Code refreshed. Scan this with your WhatsApp app.`);
          this.emit('qr', qr);
        }
      });
      
      // Update credentials on update
      this.sock.ev.on('creds.update', saveCreds);
      
      // Handle messages with improved event handling
      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
          if (messages && messages.length > 0) {
            for (const msg of messages) {
              // Skip messages sent by us
              if (msg.key.fromMe) continue;
              
              // Skip status messages and empty messages
              if (
                msg.key.remoteJid === 'status@broadcast' ||
                !msg.message ||
                Object.keys(msg.message).length === 0
              ) continue;
              
              // Log and emit new message
              console.log(`[BaileysClient:${this.instanceId}] New message from ${msg.key.remoteJid}`);
              this.emit('message', msg);
            }
          }
        } catch (msgError) {
          console.error(`[BaileysClient:${this.instanceId}] Error processing messages:`, msgError);
        }
      });
      
      // Return success
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error initializing WhatsApp connection:`, error);
      this.emit('error', error);
      return false;
    }
  }
  
  /**
   * Send text message
   * @param {string} to - Recipient
   * @param {Object} content - Message content
   * @returns {Promise<Object>} - Send result
   */
  async sendMessage(to, content) {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error('WhatsApp client not connected');
      }
      
      // Ensure 'to' has the correct format
      let recipient = to;
      if (!recipient.includes('@')) {
        // Add WhatsApp suffix if not present
        recipient = `${recipient}@s.whatsapp.net`;
      }
      
      // Send the message
      const result = await this.sock.sendMessage(recipient, content);
      return result;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * Download media from a message
   * @param {Object} message - Message with media
   * @returns {Promise<Object>} - Media data
   */
  async downloadMedia(message) {
    try {
      if (!this.sock || !this.isReady) {
        throw new Error('WhatsApp client not connected');
      }
      
      // Extract media message
      let mediaMessage = null;
      let mimetype = null;
      
      if (message.message?.imageMessage) {
        mediaMessage = message.message.imageMessage;
        mimetype = mediaMessage.mimetype;
      } else if (message.message?.videoMessage) {
        mediaMessage = message.message.videoMessage;
        mimetype = mediaMessage.mimetype;
      } else if (message.message?.documentMessage) {
        mediaMessage = message.message.documentMessage;
        mimetype = mediaMessage.mimetype;
      } else if (message.message?.audioMessage) {
        mediaMessage = message.message.audioMessage;
        mimetype = mediaMessage.mimetype;
      } else {
        throw new Error('No media found in message');
      }
      
      // Download media
      const buffer = await this.sock.downloadMediaMessage(message);
      
      // Convert to base64
      const data = buffer.toString('base64');
      
      // Return media object
      return {
        mimetype,
        data,
        filename: mediaMessage.fileName || `${Date.now()}.${mimetype.split('/')[1]}`
      };
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error downloading media:`, error);
      throw error;
    }
  }
  
  /**
   * Disconnect from WhatsApp
   * @param {boolean} logout - Whether to perform full logout
   * @returns {Promise<boolean>} - Whether disconnection was successful
   */
  async disconnect(logout = false) {
    try {
      if (!this.sock) {
        return true; // Already disconnected
      }
      
      if (logout) {
        // Perform full logout
        await this.sock.logout();
        console.log(`[BaileysClient:${this.instanceId}] Logged out from WhatsApp`);
      }
      
      // Close the socket
      if (this.sock.end) {
        await this.sock.end();
      } else if (this.sock.close) {
        await this.sock.close();
      }
      
      // Clear state
      this.sock = null;
      this.isReady = false;
      this.qrCode = null;
      
      // Emit disconnected event
      this.emit('disconnected');
      
      return true;
    } catch (error) {
      console.error(`[BaileysClient:${this.instanceId}] Error disconnecting:`, error);
      return false;
    }
  }
}

module.exports = BaileysClient;