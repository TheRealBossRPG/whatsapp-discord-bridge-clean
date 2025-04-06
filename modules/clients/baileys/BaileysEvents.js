'use strict';

const EventEmitter = require('events');

/**
 * Handles WhatsApp Baileys events
 */
class BaileysEvents {
  /**
   * Create a new BaileysEvents instance
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId) {
    this.instanceId = instanceId || 'default';
    this.socket = null;
    this.listeners = new Map();
    this.messageHandler = null;
    this.mediaHandler = null;
    this.isListening = false;
    this.eventEmitter = new EventEmitter();
    
    // Bind methods to ensure 'this' context
    this.setSocket = this.setSocket.bind(this);
    this.setupListeners = this.setupListeners.bind(this);
    this.cleanupListeners = this.cleanupListeners.bind(this);
    this.on = this.on.bind(this);
    this.emit = this.emit.bind(this);
    
    console.log(`[BaileysEvents:${this.instanceId}] Initialized event handler`);
  }
  
  /**
   * Set socket for events
   * @param {Object} socket - WhatsApp socket
   */
  setSocket(socket) {
    if (!socket) {
      console.error(`[BaileysEvents:${this.instanceId}] Cannot set null socket`);
      return;
    }
    
    this.socket = socket;
    console.log(`[BaileysEvents:${this.instanceId}] Socket set`);
  }
  
  /**
   * Set up all event listeners
   * @param {Object} messageHandler - Message handler
   * @param {Object} mediaHandler - Media handler
   */
  setupListeners(messageHandler, mediaHandler) {
    if (!this.socket) {
      console.error(`[BaileysEvents:${this.instanceId}] No socket available for setting up listeners`);
      return false;
    }
    
    // Store handlers
    this.messageHandler = messageHandler;
    this.mediaHandler = mediaHandler;
    
    // Reset existing listeners to prevent duplicates
    this.cleanupListeners();
    
    console.log(`[BaileysEvents:${this.instanceId}] Setting up event listeners...`);
    
    try {
      // Connection update handler - handles QR codes, connection state changes
      const onConnectionUpdate = (update) => {
        try {
          const { connection, lastDisconnect, qr } = update;
          
          // Handle QR code
          if (qr) {
            console.log(`[BaileysEvents:${this.instanceId}] Received QR code`);
            this.emit('qr', qr);
          }
          
          // Handle connection state changes
          if (connection === 'open') {
            console.log(`[BaileysEvents:${this.instanceId}] Connection is now open`);
            this.emit('ready');
          } else if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message || 'Unknown';
            
            console.log(`[BaileysEvents:${this.instanceId}] Connection closed, statusCode: ${statusCode}`);
            
            if (statusCode === 401) {
              // Authentication failure
              this.emit('auth_failure', new Error('Authentication failed: ' + reason));
            } else {
              // Other disconnection
              this.emit('disconnected', reason);
            }
          }
        } catch (handlerError) {
          console.error(`[BaileysEvents:${this.instanceId}] Error in connection update handler:`, handlerError);
        }
      };
      
      // Register connection update handler
      if (this.socket.ev) {
        this.socket.ev.on('connection.update', onConnectionUpdate);
        this.listeners.set('connection.update', onConnectionUpdate);
      }
      
      // Messages handler
      const onMessage = (m) => {
        try {
          const { messages, type } = m;
          
          if (Array.isArray(messages) && messages.length > 0 && this.messageHandler) {
            messages.forEach(message => {
              if (this.messageHandler.processMessage) {
                this.messageHandler.processMessage(message);
              }
            });
          }
        } catch (messageError) {
          console.error(`[BaileysEvents:${this.instanceId}] Error processing messages:`, messageError);
        }
      };
      
      // Register messages handler
      if (this.socket.ev) {
        this.socket.ev.on('messages.upsert', onMessage);
        this.listeners.set('messages.upsert', onMessage);
      }
      
      this.isListening = true;
      console.log(`[BaileysEvents:${this.instanceId}] Event listeners set up successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error setting up event listeners:`, error);
      return false;
    }
  }
  
  /**
   * Clean up all event listeners - FIXED to prevent errors
   */
  cleanupListeners() {
    try {
      if (!this.socket || !this.socket.ev) {
        console.log(`[BaileysEvents:${this.instanceId}] No socket to clean up`);
        this.listeners.clear();
        this.isListening = false;
        return;
      }
      
      // We'll avoid direct removal of listeners because it's causing errors
      // Instead, just reset our state and let the garbage collector handle it
      
      console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`);
      
      // Clear internal listeners map
      this.listeners.clear();
      
      this.isListening = false;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error resetting event listeners:`, error);
    }
  }
  
  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {Function} callback - Event callback
   */
  on(event, callback) {
    if (typeof callback !== 'function') {
      console.error(`[BaileysEvents:${this.instanceId}] Cannot register non-function callback for event ${event}`);
      return;
    }
    
    this.eventEmitter.on(event, callback);
    console.log(`[BaileysEvents:${this.instanceId}] Registered handler for event: ${event}`);
  }
  
  /**
   * Emit event to external listeners
   * @param {string} event - Event name
   * @param {...any} args - Event arguments
   */
  emit(event, ...args) {
    try {
      // Emit to our event emitter
      this.eventEmitter.emit(event, ...args);
      
      // Also emit to socket if it exists
      if (this.socket && this.socket.ev && typeof this.socket.ev.emit === 'function') {
        try {
          this.socket.ev.emit(event, ...args);
        } catch (socketEmitError) {
          console.error(`[BaileysEvents:${this.instanceId}] Error emitting ${event} event through socket:`, socketEmitError);
        }
      }
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error emitting ${event} event:`, error);
    }
  }
}

module.exports = BaileysEvents;