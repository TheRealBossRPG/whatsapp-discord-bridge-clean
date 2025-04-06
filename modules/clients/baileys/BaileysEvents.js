// modules/clients/baileys/BaileysEvents.js
const { DisconnectReason } = require('@whiskeysockets/baileys');

/**
 * Handles events for the Baileys WhatsApp client
 */
class BaileysEvents {
  /**
   * Create a new BaileysEvents instance
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.socket = null;
    this.handlers = {};
    this.listeners = new Set();
    console.log(`[BaileysEvents:${this.instanceId}] Initialized event handler`);
  }
  
  /**
   * Set the WhatsApp socket
   * @param {Object} socket - Baileys socket
   */
  setSocket(socket) {
    this.socket = socket;
    console.log(`[BaileysEvents:${this.instanceId}] Socket set`);
    this.resetListeners();
  }
  
  /**
   * Reset event listeners
   */
  resetListeners() {
    this.listeners.clear();
    console.log(`[BaileysEvents:${this.instanceId}] Event listeners reset`);
  }
  
  /**
   * Register an event handler
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  registerHandler(event, handler) {
    this.handlers[event] = handler;
    console.log(`[BaileysEvents:${this.instanceId}] Registered handler for event: ${event}`);
  }
  
  /**
   * Setup event listeners for WhatsApp socket
   * @returns {Promise<boolean>} - Setup success status
   */
  async setupEventListeners() {
    try {
      // Reset existing listeners
      this.resetListeners();
      
      console.log(`[BaileysEvents:${this.instanceId}] Setting up event listeners...`);
      
      if (!this.socket) {
        console.error(`[BaileysEvents:${this.instanceId}] No socket available for event listeners`);
        return false;
      }
      
      // Set up connection events
      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Handle connection state changes
        if (connection === 'close') {
          // Get status code
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          console.log(`[BaileysEvents:${this.instanceId}] Connection closed, statusCode: ${statusCode}`);
          
          // Emit disconnected event
          if (this.handlers.disconnected) {
            let reason = 'unknown';
            
            // Convert status code to reason
            if (statusCode === 401) {
              reason = 'unauthorized';
            } else if (statusCode === 403) {
              reason = 'forbidden';
            } else if (statusCode === 408) {
              reason = 'timeout';
            } else if (statusCode === 428) {
              reason = 'connection_lost';
            } else if (statusCode === 440) {
              reason = 'logged_out';
            } else if (statusCode === 500) {
              reason = 'server_error';
            }
            
            this.handlers.disconnected(reason);
          }
        } else if (connection === 'open') {
          console.log(`[BaileysEvents:${this.instanceId}] Connection opened`);
          
          // Emit ready event
          if (this.handlers.ready) {
            this.handlers.ready();
          }
        }
        
        // CRITICAL FIX: QR code handling
        if (qr) {
          // Check if QR code display is enabled
          let shouldShowQr = true;
          
          try {
            // Try to get the client instance - note parent is up one directory
            const BaileysClient = require('../BaileysClient');
            if (BaileysClient && BaileysClient.instances) {
              const client = BaileysClient.instances.get(this.instanceId);
              if (client && typeof client.shouldShowQrCode === 'function') {
                shouldShowQr = client.shouldShowQrCode();
              }
            }
          } catch (error) {
            console.error(`[BaileysEvents:${this.instanceId}] Error checking QR code display flag:`, error);
            // Default to showing QR code
            shouldShowQr = true;
          }
          
          if (shouldShowQr) {
            console.log(`[BaileysEvents:${this.instanceId}] Received QR code`);
            if (this.handlers.qr) {
              this.handlers.qr(qr);
            }
          } else {
            console.log(`[BaileysEvents:${this.instanceId}] QR code received but display is disabled`);
          }
        }
      });
      
      // Set up message events
      this.socket.ev.on('messages.upsert', ({ messages }) => {
        if (!messages || messages.length === 0) return;
        
        for (const message of messages) {
          if (message.key && message.key.fromMe === false) {
            // Process incoming message
            if (this.handlers.message) {
              this.handlers.message(message);
            }
          }
        }
      });
      
      console.log(`[BaileysEvents:${this.instanceId}] Event listeners set up successfully`);
      return true;
    } catch (error) {
      console.error(`[BaileysEvents:${this.instanceId}] Error setting up event listeners:`, error);
      return false;
    }
  }
}

module.exports = BaileysEvents;