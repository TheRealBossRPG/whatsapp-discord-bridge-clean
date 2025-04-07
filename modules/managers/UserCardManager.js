// modules/managers/UserCardManager.js - Fixed with proper method names
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
  constructor(instanceId) {
    this.instanceId = instanceId;
    this.userCards = new Map();
    this.usersFile = path.join(__dirname, '..', '..', 'instances', instanceId, 'user_cards.json');
    this.phoneCache = new Map(); // Cache for phone number lookups
    
    // Load existing user cards
    this.loadUserCards();
    
    console.log(`[UserCardManager:${this.instanceId}] Initialized with ${this.userCards.size} user cards`);
  }
  
  /**
   * Load user cards from file
   */
  loadUserCards() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Process each user card
        for (const [key, value] of Object.entries(jsonData)) {
          this.userCards.set(key, value);
          
          // Also create phone number lookup cache
          if (value.phoneNumber) {
            const cleanPhone = this.cleanPhoneNumber(value.phoneNumber);
            this.phoneCache.set(cleanPhone, key);
          }
        }
        
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.usersFile}`);
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards: ${error.message}`);
    }
  }
  
  /**
   * Save user cards to file
   */
  saveUserCards() {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(this.usersFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert Map to object for serialization
      const jsonData = {};
      for (const [key, value] of this.userCards.entries()) {
        jsonData[key] = value;
      }
      
      // Write to file
      fs.writeFileSync(this.usersFile, JSON.stringify(jsonData, null, 2), 'utf8');
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
    
    return String(phoneNumber)
      .replace(/@s\.whatsapp\.net/g, '')
      .replace(/@c\.us/g, '')
      .replace(/@g\.us/g, '')
      .replace(/@broadcast/g, '')
      .replace(/@.*$/, '');
  }
  
  /**
   * Get a user card by unique ID
   * @param {string} uniqueId - Unique user ID
   * @returns {Object|null} - User card or null if not found
   */
  getUserCard(uniqueId) {
    return this.userCards.get(uniqueId) || null;
  }
  
  /**
   * CRITICAL FIX: Get a user card by phone number
   * This is the method that was missing
   * @param {string} phoneNumber - Phone number to lookup
   * @returns {Object|null} - User card or null if not found
   */
  getUserCardByPhone(phoneNumber) {
    try {
      if (!phoneNumber) return null;
      
      // Clean the phone number
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      // Check the phone cache first
      const uniqueId = this.phoneCache.get(cleanPhone);
      if (uniqueId) {
        return this.getUserCard(uniqueId);
      }
      
      // If not in cache, search all user cards
      for (const [id, card] of this.userCards.entries()) {
        if (card.phoneNumber && this.cleanPhoneNumber(card.phoneNumber) === cleanPhone) {
          // Update cache for future lookups
          this.phoneCache.set(cleanPhone, id);
          return card;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error getting user card by phone: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Create a new user card
   * @param {Object} userData - User data
   * @returns {string} - Unique ID for the user
   */
  createUserCard(userData) {
    // Generate a unique ID
    const uniqueId = `user_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Store the user card
    this.userCards.set(uniqueId, userData);
    
    // Update phone cache if phone number is provided
    if (userData.phoneNumber) {
      const cleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
      this.phoneCache.set(cleanPhone, uniqueId);
    }
    
    // Save to disk
    this.saveUserCards();
    
    return uniqueId;
  }
  
  /**
   * Update a user card
   * @param {string} uniqueId - Unique user ID
   * @param {Object} userData - Updated user data
   * @returns {boolean} - Success
   */
  updateUserCard(uniqueId, userData) {
    if (!this.userCards.has(uniqueId)) {
      return false;
    }
    
    // Get old data to check for phone number changes
    const oldData = this.userCards.get(uniqueId);
    
    // Update user card
    this.userCards.set(uniqueId, {
      ...oldData,
      ...userData
    });
    
    // Update phone cache if phone number changed
    if (userData.phoneNumber && oldData.phoneNumber !== userData.phoneNumber) {
      // Remove old phone number from cache
      if (oldData.phoneNumber) {
        const oldCleanPhone = this.cleanPhoneNumber(oldData.phoneNumber);
        this.phoneCache.delete(oldCleanPhone);
      }
      
      // Add new phone number to cache
      const newCleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
      this.phoneCache.set(newCleanPhone, uniqueId);
    }
    
    // Save to disk
    this.saveUserCards();
    
    return true;
  }
  
  /**
   * Delete a user card
   * @param {string} uniqueId - Unique user ID
   * @returns {boolean} - Success
   */
  deleteUserCard(uniqueId) {
    if (!this.userCards.has(uniqueId)) {
      return false;
    }
    
    // Remove from phone cache
    const userData = this.userCards.get(uniqueId);
    if (userData && userData.phoneNumber) {
      const cleanPhone = this.cleanPhoneNumber(userData.phoneNumber);
      this.phoneCache.delete(cleanPhone);
    }
    
    // Delete user card
    this.userCards.delete(uniqueId);
    
    // Save to disk
    this.saveUserCards();
    
    return true;
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
    
    for (const [id, card] of this.userCards.entries()) {
      if (card.name && card.name.toLowerCase().includes(searchName)) {
        results.push({
          id,
          ...card
        });
      }
    }
    
    return results;
  }
}

module.exports = UserCardManager;