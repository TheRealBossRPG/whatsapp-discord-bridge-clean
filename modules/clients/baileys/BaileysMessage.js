// modules/clients/baileys/BaileysMessage.js - Message handling
const { proto } = require('@whiskeysockets/baileys');

/**
 * Manages messages for Baileys WhatsApp client
 */
class BaileysMessage {
  /**
   * Create a new BaileysMessage instance
   * @param {BaileysClient} client - Parent client
   */
  constructor(client) {
    this.client = client;
    this.instanceId = client.options.instanceId;
    this.socket = null;
  }
  
  /**
   * Initialize with socket
   * @param {Object} socket - Baileys socket connection
   */
  initialize(socket) {
    this.socket = socket;
    console.log(`[BaileysMessage:${this.instanceId}] Message handler initialized`);
  }
  
  /**
   * Reset state
   */
  reset() {
    this.socket = null;
  }
  
  /**
   * Format a phone number for WhatsApp
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string
    let phone = String(phoneNumber);
    
    // Remove all non-digit characters, except + at the beginning
    phone = phone.replace(/[^0-9+]/g, '');
    
    // Remove any WhatsApp suffixes if present
    phone = phone.replace(/@s\.whatsapp\.net/g, '')
                .replace(/@c\.us/g, '')
                .replace(/@g\.us/g, '');
    
    // Ensure phone number is in correct format for WhatsApp (xxx@s.whatsapp.net)
    if (!phone.includes('@')) {
      phone = `${phone}@s.whatsapp.net`;
    }
    
    return phone;
  }
  
  /**
   * Clean a phone number for display
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string
    let phone = String(phoneNumber);
    
    // Remove WhatsApp suffixes
    return phone.replace(/@s\.whatsapp\.net/g, '')
                .replace(/@c\.us/g, '')
                .replace(/@g\.us/g, '');
  }
  
  /**
   * Parse message content from various types
   * @param {string|Object} content - Message content
   * @returns {Object} Formatted message content
   */
  parseContent(content) {
    // Handle string content (regular text message)
    if (typeof content === 'string') {
      return { text: content };
    }
    
    // Content is already an object
    return content;
  }
  
  /**
   * Send a message to a WhatsApp chat
   * @param {string} to - Recipient phone number
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Message info
   */
  async sendMessage(to, content) {
    try {
      if (!this.socket) {
        throw new Error(`[BaileysMessage:${this.instanceId}] Socket not initialized`);
      }
      
      // Format the destination phone number
      const formattedTo = this.formatPhoneNumber(to);
      
      // Parse content
      const messageContent = this.parseContent(content);
      
      // Send message
      console.log(`[BaileysMessage:${this.instanceId}] Sending message to ${formattedTo}`);
      const result = await this.socket.sendMessage(formattedTo, messageContent);
      
      console.log(`[BaileysMessage:${this.instanceId}] Message sent successfully to ${formattedTo}`);
      return result;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error sending message:`, error);
      throw error;
    }
  }
  
  /**
   * React to a message
   * @param {string} jid - Chat JID
   * @param {Object} messageKey - Key of message to react to
   * @param {string} emoji - Emoji reaction
   * @returns {Promise<Object>} Reaction result
   */
  async sendReaction(jid, messageKey, emoji) {
    try {
      if (!this.socket) {
        throw new Error(`[BaileysMessage:${this.instanceId}] Socket not initialized`);
      }
      
      // Format JID
      const formattedJid = this.formatPhoneNumber(jid);
      
      // Send reaction
      console.log(`[BaileysMessage:${this.instanceId}] Sending reaction ${emoji} to message in ${formattedJid}`);
      const result = await this.socket.sendMessage(formattedJid, {
        react: {
          text: emoji,
          key: messageKey
        }
      });
      
      console.log(`[BaileysMessage:${this.instanceId}] Reaction sent successfully`);
      return result;
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error sending reaction:`, error);
      throw error;
    }
  }
  
  /**
   * Send a typing indicator
   * @param {string} jid - Chat JID
   * @param {boolean} isTyping - Whether typing is starting or stopping
   */
  async sendTypingIndicator(jid, isTyping = true) {
    try {
      if (!this.socket) {
        throw new Error(`[BaileysMessage:${this.instanceId}] Socket not initialized`);
      }
      
      // Format JID
      const formattedJid = this.formatPhoneNumber(jid);
      
      // Send chat presence update
      if (isTyping) {
        await this.socket.sendPresenceUpdate('composing', formattedJid);
      } else {
        await this.socket.sendPresenceUpdate('paused', formattedJid);
      }
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error sending typing indicator:`, error);
      // Don't throw error for typing indicators
    }
  }
  
  /**
   * Mark a message as read
   * @param {string} jid - Chat JID
   * @param {Object} messageKey - Key of message to mark as read
   */
  async markMessageAsRead(jid, messageKey) {
    try {
      if (!this.socket) {
        throw new Error(`[BaileysMessage:${this.instanceId}] Socket not initialized`);
      }
      
      // Format JID
      const formattedJid = this.formatPhoneNumber(jid);
      
      // Mark message as read
      await this.socket.readMessages([messageKey]);
      console.log(`[BaileysMessage:${this.instanceId}] Marked message as read in ${formattedJid}`);
    } catch (error) {
      console.error(`[BaileysMessage:${this.instanceId}] Error marking message as read:`, error);
      // Don't throw error for read receipts
    }
  }
}

module.exports = { BaileysMessage };