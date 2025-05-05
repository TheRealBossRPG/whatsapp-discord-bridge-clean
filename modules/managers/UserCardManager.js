// modules/managers/UserCardManager.js - Complete rewrite for proper isolation and persistence

const fs = require("fs");
const path = require("path");

/**
 * UserCardManager class for managing user information
 */
class UserCardManager {
  /**
   * Create a new UserCardManager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = "default") {
    this.instanceId = instanceId;
    this.userCards = new Map();
    
    // Set up paths for storage - fully contained in instance directory
    this.baseDir = path.join(__dirname, '..', '..', 'instances', this.instanceId);
    this.userDataDir = path.join(this.baseDir, 'user_data');
    this.userCardsPath = path.join(this.userDataDir, 'user_cards.json');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }
    
    // Load existing user cards
    this.loadUserCards();
    
    // Initialize phone cache for backward compatibility
    this.phoneCache = new Map();
    
    console.log(`[UserCardManager:${this.instanceId}] Initialized with ${this.userCards.size} user cards`);
  }
  
  /**
   * Set WhatsApp client reference
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
  
  /**
   * Set MediaManager reference
   * @param {Object} mediaManager - MediaManager
   */
  setMediaManager(mediaManager) {
    this.mediaManager = mediaManager;
  }
  
  /**
   * Clean phone number by removing extensions
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return "";
    
    // Convert to string first
    let clean = String(phoneNumber);
    
    // Remove WhatsApp extensions
    clean = clean
      .replace(/@s\.whatsapp\.net/g, "")
      .replace(/@c\.us/g, "")
      .replace(/@g\.us/g, "")
      .replace(/@broadcast/g, "")
      .replace(/@.*$/, "");
    
    // Only keep digits and possibly a leading +
    if (clean.startsWith("+")) {
      clean = "+" + clean.substring(1).replace(/[^0-9]/g, "");
    } else {
      clean = clean.replace(/[^0-9]/g, "");
    }
    
    return clean;
  }
  
  /**
   * Load user cards from file
   */
  loadUserCards() {
    try {
      if (fs.existsSync(this.userCardsPath)) {
        const data = fs.readFileSync(this.userCardsPath, "utf8");
        const jsonData = JSON.parse(data);
        
        // Check if it's an object (old format) or array
        if (typeof jsonData === 'object' && !Array.isArray(jsonData)) {
          // Convert object to Map
          for (const [key, value] of Object.entries(jsonData)) {
            const cleanPhone = this.cleanPhoneNumber(key);
            
            // Ensure value is an object with username
            let userObject = value;
            if (typeof value === 'string') {
              userObject = { username: value };
            } else if (!value || typeof value !== 'object') {
              userObject = { username: 'Unknown User' };
            }
            
            this.userCards.set(cleanPhone, userObject);
          }
        }
        
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.userCardsPath}`);
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards: ${error.message}`);
    }
  }
  
  /**
   * Save user cards to file - crucial for persistence
   * @returns {Promise<boolean>} - Success status
   */
  async saveUserCards() {
    try {
      // Create a serializable version of the user cards
      const serializedCards = {};
      
      this.userCards.forEach((card, phoneNumber) => {
        serializedCards[phoneNumber] = card;
      });
      
      // Ensure directory exists
      if (!fs.existsSync(this.userDataDir)) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      }
      
      // Write to file
      fs.writeFileSync(this.userCardsPath, JSON.stringify(serializedCards, null, 2), "utf8");
      
      console.log(`[UserCardManager:${this.instanceId}] Saved ${this.userCards.size} user cards to ${this.userCardsPath}`);
      return true;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error saving user cards:`, error);
      return false;
    }
  }
  
  /**
   * Get user information - CRITICAL METHOD that other components use
   * @param {string} phoneNumber - User's phone number
   * @returns {Object|null} - User info or null if not found
   */
  getUserInfo(phoneNumber) {
    try {
      if (!phoneNumber) return null;
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Log what we're looking up
      console.log(`[UserCardManager:${this.instanceId}] Looking up info for ${cleanPhone}`);
      
      // Get from userCards map
      if (this.userCards.has(cleanPhone)) {
        const userCard = this.userCards.get(cleanPhone);
        console.log(`[UserCardManager:${this.instanceId}] Found user info for ${cleanPhone}: ${JSON.stringify(userCard)}`);
        return userCard;
      }
      
      console.log(`[UserCardManager:${this.instanceId}] No user info found for ${cleanPhone}`);
      return null;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error getting user info:`, error);
      return null;
    }
  }
  
  /**
   * Set user information - CRITICAL METHOD that other components use
   * @param {string} phoneNumber - User's phone number
   * @param {string|Object} userInfo - User's info
   * @returns {Promise<boolean>} - Success status
   */
  async setUserInfo(phoneNumber, userInfo) {
    try {
      if (!phoneNumber) {
        console.error(`[UserCardManager:${this.instanceId}] Cannot set user info: missing phone number`);
        return false;
      }
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Standardize user info
      let userObject;
      if (typeof userInfo === 'string') {
        userObject = { username: userInfo };
      } else {
        userObject = { ...userInfo };
      }
      
      // Ensure username is present
      if (!userObject.username) {
        userObject.username = "Unknown User";
      }
      
      // Ensure lastSeen is present
      if (!userObject.lastSeen) {
        userObject.lastSeen = Date.now();
      }
      
      // Check for username change that requires directory update
      const oldUserInfo = this.userCards.get(cleanPhone);
      const oldUsername = oldUserInfo?.username;
      
      // Store user info with the phone number as the key
      console.log(`[UserCardManager:${this.instanceId}] Setting user info for ${cleanPhone}: ${JSON.stringify(userObject)}`);
      this.userCards.set(cleanPhone, userObject);
      
      // Save to disk immediately
      await this.saveUserCards();
      
      // Try to update MediaManager if available
      if (oldUsername && oldUsername !== userObject.username) {
        try {
          // Find MediaManager instance
          if (this.mediaManager) {
            if (typeof this.mediaManager.setPhoneToUsername === 'function') {
              this.mediaManager.setPhoneToUsername(cleanPhone, userObject.username);
            }
            
            if (typeof this.mediaManager.renameUserDirectory === 'function') {
              this.mediaManager.renameUserDirectory(cleanPhone, oldUsername, userObject.username);
            }
            
            console.log(`[UserCardManager:${this.instanceId}] Username changed from "${oldUsername}" to "${userObject.username}", updated media directories`);
          }
        } catch (mediaError) {
          console.error(`[UserCardManager:${this.instanceId}] Error updating media directories:`, mediaError);
        }
      }
      
      // Update WhatsApp client if available
      if (this.whatsAppClient) {
        try {
          // Different clients might store contacts differently
          if (this.whatsAppClient.contacts) {
            const jid = `${cleanPhone}@s.whatsapp.net`;
            if (this.whatsAppClient.contacts[jid]) {
              this.whatsAppClient.contacts[jid].name = userObject.username;
              this.whatsAppClient.contacts[jid].notify = userObject.username;
            }
          }
          
          // Try updateContact method if available
          if (typeof this.whatsAppClient.updateContact === 'function') {
            await this.whatsAppClient.updateContact(cleanPhone, userObject.username);
          }
          
          // Try to use sock.updateProfileName (for @whiskeysockets/baileys)
          if (this.whatsAppClient.sock && typeof this.whatsAppClient.sock.updateProfileName === 'function') {
            await this.whatsAppClient.sock.updateProfileName(cleanPhone, userObject.username);
          }
          
          console.log(`[UserCardManager:${this.instanceId}] Updated username in WhatsApp client`);
        } catch (whatsappError) {
          console.error(`[UserCardManager:${this.instanceId}] Error updating WhatsApp client:`, whatsappError);
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error setting user info:`, error);
      return false;
    }
  }
  
  /**
   * Update user information - improved version with better persistence
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @returns {Promise<boolean>} - Success status
   */
  async updateUserInfo(phoneNumber, username) {
    try {
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Get existing user info
      const existingInfo = this.userCards.get(cleanPhone) || {};
      
      // Create updated user info
      const updatedInfo = {
        ...existingInfo,
        username: username,
        lastSeen: Date.now()
      };
      
      // Use setUserInfo to handle all the updates
      return await this.setUserInfo(cleanPhone, updatedInfo);
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error updating user info:`, error);
      return false;
    }
  }
  
  /**
   * Get the number of user cards
   * @returns {number} - Count of user cards
   */
  getUserCardCount() {
    return this.userCards.size;
  }
  
  /**
   * Get all user cards
   * @returns {Map} - Map of all user cards
   */
  getAllUserCards() {
    return this.userCards;
  }
  
  /**
   * Find user cards by name
   * @param {string} name - User name to search for
   * @returns {Array} - Array of matching user cards
   */
  findUserCardsByName(name) {
    const results = [];
    const searchName = name.toLowerCase();
    
    for (const [phone, card] of this.userCards.entries()) {
      if (
        (card.name && card.name.toLowerCase().includes(searchName)) ||
        (card.username && card.username.toLowerCase().includes(searchName))
      ) {
        results.push({
          id: phone, // Use phone number as ID
          ...card,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Find a user's phone number by their username
   * @param {string} username - Username to search for
   * @returns {string|null} - Phone number or null if not found
   */
  findPhoneNumberByUsername(username) {
    if (!username) return null;
    
    const searchName = username.toLowerCase();
    
    for (const [phone, card] of this.userCards.entries()) {
      const cardName = card.username || card.name || '';
      if (cardName.toLowerCase() === searchName) {
        return phone;
      }
    }
    
    return null;
  }
}

module.exports = UserCardManager;