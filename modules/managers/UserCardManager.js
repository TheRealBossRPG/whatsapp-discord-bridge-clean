// modules/managers/UserCardManager.js - Fixed for phone number keys
const fs = require('fs');
const path = require('path');

/**
 * UserCardManager class for managing user information
 */
class UserCardManager {
  /**
   * Create a new UserCardManager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    this.instanceId = instanceId;
    this.userCards = new Map();
    this.phoneCache = new Map(); // Initialize the phone cache
    this.dataFile = path.join(__dirname, '..', '..', 'instances', instanceId, 'user_cards.json');
    
    this.loadUserCards();
    
    console.log(`[UserCardManager:${this.instanceId}] Initialized with ${this.userCards.size} user cards`);
  }
  
  /**
   * Load user cards from file
   */
  loadUserCards() {
    try {
      if (fs.existsSync(this.dataFile)) { // Fix: use dataFile not usersFile
        const data = fs.readFileSync(this.dataFile, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Check if it's the old format (keys like "user_1234_567")
        const isOldFormat = Object.keys(jsonData).some(key => key.startsWith('user_'));
        
        if (isOldFormat) {
          console.log(`[UserCardManager:${this.instanceId}] Converting old format user cards`);
          this.convertOldFormat(jsonData);
        } else {
          // Process each user card in the new format (phone numbers as keys)
          for (const [phoneNumber, userData] of Object.entries(jsonData)) {
            const cleanPhone = this.cleanPhoneNumber(phoneNumber);
            this.userCards.set(cleanPhone, userData);
          }
        }
        
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.dataFile}`);
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards: ${error.message}`);
    }
  }
  
  /**
   * Convert old format user cards to new format
   * @param {Object} oldData - Old format user data
   */
  convertOldFormat(oldData) {
    try {
      // Clear the existing maps
      this.userCards.clear();
      this.phoneCache.clear();
      
      // Process each entry in old format
      for (const [oldKey, userData] of Object.entries(oldData)) {
        // Extract phone number if it exists
        if (userData.phoneNumber) {
          const cleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
          this.userCards.set(cleanPhone, userData);
        } 
        // If it's a string value, it might be the old "user_id": "phoneNumber" format
        else if (typeof userData === 'string') {
          const cleanPhone = this.cleanPhoneNumber(userData);
          this.userCards.set(cleanPhone, {
            phoneNumber: cleanPhone,
            username: 'Unknown User',
            lastSeen: Date.now()
          });
        }
      }
      
      // Save in new format
      this.saveUserCards();
      console.log(`[UserCardManager:${this.instanceId}] Converted ${this.userCards.size} user cards to new format`);
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error converting old format:`, error);
    }
  }
  
  /**
   * Save user cards to file
   */
  saveUserCards() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.dataFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert Map to object for serialization
      const jsonData = {};
      for (const [key, value] of this.userCards.entries()) {
        jsonData[key] = value;
      }
      
      // Write to file
      fs.writeFileSync(this.dataFile, JSON.stringify(jsonData, null, 2), 'utf8');
      console.log(`[UserCardManager:${this.instanceId}] Saved ${this.userCards.size} user cards`);
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error saving user cards: ${error.message}`);
    }
  }
  
  /**
   * Clean phone number by removing extensions
   * @param {string} phoneNumber - Phone number to clean
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Convert to string
    let clean = String(phoneNumber);
    
    // Remove WhatsApp extensions
    clean = clean.replace(/@s\.whatsapp\.net/g, '')
               .replace(/@c\.us/g, '')
               .replace(/@g\.us/g, '')
               .replace(/@broadcast/g, '')
               .replace(/@.*$/, '');
    
    // Only keep digits and possibly a leading +
    if (clean.startsWith('+')) {
      clean = '+' + clean.substring(1).replace(/[^0-9]/g, '');
    } else {
      clean = clean.replace(/[^0-9]/g, '');
    }
    
    return clean;
  }
  
  /**
   * Set user information - CRITICAL NEW METHOD that other components expect
   * @param {string} phoneNumber - User's phone number
   * @param {string} username - User's name
   * @param {Object} additionalInfo - Additional user info
   * @returns {boolean} - Success status
   */
  setUserInfo(phoneNumber, username, additionalInfo = {}) {
    try {
      if (!phoneNumber) {
        console.error(`[UserCardManager:${this.instanceId}] Cannot set user info: missing phone number`);
        return false;
      }
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Store user info with the phone number as the key
      this.userCards.set(cleanPhone, {
        phoneNumber: cleanPhone,
        username: username || 'Unknown User',
        lastSeen: Date.now(),
        ...additionalInfo
      });
      
      // Save to disk
      this.saveUserCards();
      
      console.log(`[UserCardManager:${this.instanceId}] Updated user info for ${cleanPhone} (${username})`);
      return true;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error setting user info:`, error);
      return false;
    }
  }
  
  /**
   * Get user information - CRITICAL NEW METHOD that other components expect
   * @param {string} phoneNumber - User's phone number
   * @returns {Object|null} - User info or null if not found
   */
  getUserInfo(phoneNumber) {
    try {
      if (!phoneNumber) return null;
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Get from cache
      if (this.userCards.has(cleanPhone)) {
        return this.userCards.get(cleanPhone);
      }
      
      console.log(`[UserCardManager:${this.instanceId}] No user info found for ${cleanPhone}`);
      return null;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error getting user info:`, error);
      return null;
    }
  }
  
  // Backward compatibility methods:
  
  /**
   * Get a user card by unique ID (compatibility method)
   * @param {string} uniqueId - Unique user ID or phone number
   * @returns {Object|null} - User card or null if not found
   */
  getUserCard(uniqueId) {
    // First try as a direct key (phone number)
    if (this.userCards.has(uniqueId)) {
      return this.userCards.get(uniqueId);
    }
    
    // Then try as a cleaned phone number
    const cleanPhone = this.cleanPhoneNumber(uniqueId);
    if (this.userCards.has(cleanPhone)) {
      return this.userCards.get(cleanPhone);
    }
    
    return null;
  }
  
  /**
   * Get a user card by phone number (compatibility method)
   * @param {string} phoneNumber - Phone number to lookup
   * @returns {Object|null} - User card or null if not found
   */
  getUserCardByPhone(phoneNumber) {
    return this.getUserInfo(phoneNumber);
  }
  
  /**
   * Create a new user card (compatibility method - now uses phone number as key)
   * @param {Object} userData - User data
   * @returns {string} - Phone number as user ID
   */
  createUserCard(userData) {
    if (!userData.phoneNumber) {
      console.error(`[UserCardManager:${this.instanceId}] Cannot create user card without phone number`);
      return null;
    }
    
    const cleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
    this.userCards.set(cleanPhone, userData);
    this.saveUserCards();
    
    return cleanPhone;
  }
  
  /**
   * Update a user card (compatibility method)
   * @param {string} uniqueId - Unique user ID or phone number
   * @param {Object} userData - Updated user data
   * @returns {boolean} - Success
   */
  updateUserCard(uniqueId, userData) {
    // If uniqueId is not a phone number, try to find the corresponding phone number
    if (!uniqueId.match(/^\+?\d+$/)) {
      console.warn(`[UserCardManager:${this.instanceId}] Non-phone number ID provided: ${uniqueId}`);
      
      // If userData contains a phone number, use that as the key
      if (userData.phoneNumber) {
        const cleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
        this.userCards.set(cleanPhone, {
          ...userData,
          phoneNumber: cleanPhone // Ensure clean phone number is stored
        });
        this.saveUserCards();
        return true;
      }
      
      return false;
    }
    
    // Clean the phone number
    const cleanPhone = this.cleanPhoneNumber(uniqueId);
    
    // Update or create the entry
    const existingData = this.userCards.get(cleanPhone) || {};
    this.userCards.set(cleanPhone, {
      ...existingData,
      ...userData,
      phoneNumber: cleanPhone // Ensure clean phone number is stored
    });
    
    // Save to disk
    this.saveUserCards();
    
    return true;
  }
  
  /**
   * Delete a user card (compatibility method)
   * @param {string} uniqueId - Unique user ID or phone number
   * @returns {boolean} - Success
   */
  deleteUserCard(uniqueId) {
    // Try as a direct key
    if (this.userCards.has(uniqueId)) {
      this.userCards.delete(uniqueId);
      this.saveUserCards();
      return true;
    }
    
    // Try as a cleaned phone number
    const cleanPhone = this.cleanPhoneNumber(uniqueId);
    if (this.userCards.has(cleanPhone)) {
      this.userCards.delete(cleanPhone);
      this.saveUserCards();
      return true;
    }
    
    return false;
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} whatsAppClient - WhatsApp client
   */
  setWhatsAppClient(whatsAppClient) {
    this.whatsAppClient = whatsAppClient;
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
      if ((card.name && card.name.toLowerCase().includes(searchName)) ||
          (card.username && card.username.toLowerCase().includes(searchName))) {
        results.push({
          id: phone, // Use phone number as ID
          ...card
        });
      }
    }
    
    return results;
  }
}

module.exports = UserCardManager;