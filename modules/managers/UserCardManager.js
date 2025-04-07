// modules/managers/UserCardManager.js
const fs = require('fs');
const path = require('path');

/**
 * Manages user information cards
 */
class UserCardManager {
  /**
   * Create a new user card manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.userCards = new Map();
    this.whatsAppClient = null;
    
    // Path to user cards storage
    this.filePath = path.join(__dirname, '..', '..', 'instances', this.instanceId, 'user_cards.json');
    
    // Load stored user cards
    this.loadUserCards();
  }
  
  /**
   * Set WhatsApp client reference
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Load user cards from storage
   */
  loadUserCards() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        // Convert to Map
        for (const [jid, card] of Object.entries(parsed)) {
          this.userCards.set(jid, card);
        }
        
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.filePath}`);
        this.userCards = new Map();
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards:`, error);
      this.userCards = new Map();
    }
    
    console.log(`[UserCardManager:${this.instanceId}] Initialized with ${this.userCards.size} user cards`);
  }
  
  /**
   * Save user cards to storage
   */
  saveUserCards() {
    try {
      // Create directory if it doesn't exist
      const directory = path.dirname(this.filePath);
      if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
      }
      
      // Convert Map to object
      const data = {};
      for (const [jid, card] of this.userCards.entries()) {
        data[jid] = card;
      }
      
      // Write to file
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error saving user cards:`, error);
    }
  }
  
  /**
   * Get user card for a JID
   * @param {string} jid - JID to get user card for
   * @returns {Object|null} - User card or null
   */
  getUserCard(jid) {
    // Clean JID
    const cleanJid = this.cleanJid(jid);
    return this.userCards.get(cleanJid) || null;
  }
  
  /**
   * Create a new user card
   * @param {string} jid - JID to create user card for
   * @param {string} name - User name (optional)
   * @returns {Object} - Created user card
   */
  createUserCard(jid, name = null) {
    const cleanJid = this.cleanJid(jid);
    
    const userCard = {
      jid: cleanJid,
      name: name || 'Unknown',
      lastActivity: new Date().toISOString(),
      queuedMessages: [],
      attributes: {},
      metadata: {}
    };
    
    this.userCards.set(cleanJid, userCard);
    this.saveUserCards();
    
    return userCard;
  }
  
  /**
   * Update a user card
   * @param {string} jid - JID to update
   * @param {Object} updates - Fields to update
   * @returns {Object|null} - Updated user card or null
   */
  updateUserCard(jid, updates) {
    const cleanJid = this.cleanJid(jid);
    const userCard = this.getUserCard(cleanJid);
    
    if (!userCard) {
      return null;
    }
    
    // Update fields
    Object.assign(userCard, updates);
    
    // Always update last activity
    userCard.lastActivity = new Date().toISOString();
    
    this.userCards.set(cleanJid, userCard);
    this.saveUserCards();
    
    return userCard;
  }
  
  /**
   * Delete a user card
   * @param {string} jid - JID to delete
   * @returns {boolean} - Whether deletion was successful
   */
  deleteUserCard(jid) {
    const cleanJid = this.cleanJid(jid);
    const result = this.userCards.delete(cleanJid);
    
    if (result) {
      this.saveUserCards();
    }
    
    return result;
  }
  
  /**
   * Add a message to a user's queue
   * @param {string} jid - JID to queue message for
   * @param {Object} message - Message to queue
   * @returns {boolean} - Success status
   */
  queueMessage(jid, message) {
    const cleanJid = this.cleanJid(jid);
    let userCard = this.getUserCard(cleanJid);
    
    // Create user card if it doesn't exist
    if (!userCard) {
      userCard = this.createUserCard(cleanJid);
    }
    
    // Initialize queued messages if not present
    if (!userCard.queuedMessages) {
      userCard.queuedMessages = [];
    }
    
    // Add message to queue
    userCard.queuedMessages.push(message);
    
    // Save
    this.saveUserCards();
    
    return true;
  }
  
  /**
   * Get the number of user cards
   * @returns {number} - Number of user cards
   */
  getUserCardCount() {
    return this.userCards.size;
  }
  
  /**
   * Get all user cards
   * @returns {Array} - Array of user cards
   */
  getAllUserCards() {
    return Array.from(this.userCards.values());
  }
  
  /**
   * Clean a JID for storage
   * @param {string} jid - JID to clean
   * @returns {string} - Cleaned JID
   */
  cleanJid(jid) {
    if (!jid) {
      return '';
    }
    
    // Remove WhatsApp domain
    return jid.split('@')[0];
  }
  
  /**
   * Format a JID for WhatsApp
   * @param {string} jid - JID to format
   * @returns {string} - Formatted JID
   */
  formatJid(jid) {
    if (!jid) {
      return '';
    }
    
    // Ensure JID has WhatsApp domain
    return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    this.saveUserCards();
  }
}

module.exports = UserCardManager;