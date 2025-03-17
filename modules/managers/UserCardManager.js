// modules/managers/UserCardManager.js
const fs = require('fs');
const path = require('path');

/**
 * Manages user profile information and WhatsApp contact details
 */
class UserCardManager {
  /**
   * Create a new user card manager
   * @param {string} instanceId - Instance ID
   */
  constructor(instanceId = 'default') {
    this.instanceId = instanceId;
    this.userCards = new Map();
    
    // Set storage paths
    this.baseDir = path.join(__dirname, '..', '..', 'instances', instanceId);
    this.userCardsPath = path.join(this.baseDir, 'user_cards.json');
    
    // Ensure directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    // Load user cards from disk
    this.loadUserCards();
    
    console.log(`[UserCardManager:${instanceId}] Initialized with ${this.userCards.size} user cards`);
  }
  
  /**
   * Clean phone number for consistent storage
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} - Cleaned phone number
   */
  cleanPhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown';
    
    // Convert to string first
    let clean = String(phoneNumber);
    
    // Remove WhatsApp extensions (be thorough)
    clean = clean.replace(/@s\.whatsapp\.net/g, '')
                .replace(/@c\.us/g, '')
                .replace(/@g\.us/g, '')
                .replace(/@broadcast/g, '')
                .replace(/@.*$/, '');
    
    // Remove any non-digit characters except possibly leading '+' sign
    if (clean.startsWith('+')) {
      clean = '+' + clean.substring(1).replace(/[^0-9]/g, '');
    } else {
      clean = clean.replace(/[^0-9]/g, '');
    }
    
    return clean;
  }
  
  /**
   * Format phone number consistently
   * @param {string} phoneNumber - Phone number
   * @returns {string} - Formatted phone number
   */
  formatPhoneNumber(phoneNumber) {
    const clean = this.cleanPhoneNumber(phoneNumber);
    
    // Make sure it has the WhatsApp suffix if not already present
    if (!phoneNumber.includes('@')) {
      return `${clean}@s.whatsapp.net`;
    }
    
    return phoneNumber;
  }
  
  /**
   * Load user cards from disk
   */
  loadUserCards() {
    try {
      if (fs.existsSync(this.userCardsPath)) {
        const cardsData = JSON.parse(fs.readFileSync(this.userCardsPath, 'utf8'));
        
        // Convert to Map object
        Object.entries(cardsData).forEach(([phone, userCard]) => {
          this.userCards.set(this.formatPhoneNumber(phone), userCard);
        });
        
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards from ${this.userCardsPath}`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.userCardsPath}`);
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards:`, error);
    }
  }
  
  /**
   * Save user cards to disk
   */
  saveUserCards() {
    try {
      // Convert Map to regular object for JSON serialization
      const cardsData = {};
      this.userCards.forEach((userCard, phone) => {
        cardsData[phone] = userCard;
      });
      
      // Ensure directory exists
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      
      // Write to file
      fs.writeFileSync(this.userCardsPath, JSON.stringify(cardsData, null, 2), 'utf8');
      
      console.log(`[UserCardManager:${this.instanceId}] Saved ${this.userCards.size} user cards to ${this.userCardsPath}`);
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error saving user cards:`, error);
    }
  }
  
  /**
   * Create a new user card
   * @param {string} phoneNumber - User's phone number
   * @param {string} name - User's name
   * @param {Object} additionalInfo - Additional user information
   * @returns {Object} - Created user card
   */
  async createUserCard(phoneNumber, name, additionalInfo = {}) {
    try {
      // Format phone number
      const phone = this.formatPhoneNumber(phoneNumber);
      
      // Check if user card already exists
      if (this.userCards.has(phone)) {
        // Update existing card
        const existingCard = this.userCards.get(phone);
        
        // Only update name if it's significantly different (not just case, spacing, etc.)
        if (name && existingCard.name.toLowerCase().replace(/\s+/g, '') !== name.toLowerCase().replace(/\s+/g, '')) {
          existingCard.name = name;
          existingCard.updatedAt = Date.now();
        }
        
        // Merge additional info
        Object.assign(existingCard, additionalInfo);
        
        // Save to disk
        this.saveUserCards();
        
        console.log(`[UserCardManager:${this.instanceId}] Updated user card for ${phone}: ${name}`);
        
        return existingCard;
      }
      
      // Create new user card
      const userCard = {
        id: phone,
        phoneNumber: this.cleanPhoneNumber(phoneNumber),
        name: name || 'Unknown User',
        firstContact: Date.now(),
        lastContact: Date.now(),
        updatedAt: Date.now(),
        profilePicUrl: null,
        ...additionalInfo
      };
      
      // Try to get profile picture if WhatsApp client is available
      if (this.whatsAppClient && typeof this.whatsAppClient.getProfilePicture === 'function') {
        try {
          userCard.profilePicUrl = await this.whatsAppClient.getProfilePicture(phone);
        } catch (picError) {
          console.log(`[UserCardManager:${this.instanceId}] Could not get profile picture for ${phone}`);
        }
      }
      
      // Add to map
      this.userCards.set(phone, userCard);
      
      // Save to disk
      this.saveUserCards();
      
      console.log(`[UserCardManager:${this.instanceId}] Created user card for ${phone}: ${name}`);
      
      return userCard;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error creating user card:`, error);
      throw error;
    }
  }
  
  /**
   * Get user card
   * @param {string} phoneNumber - User's phone number
   * @returns {Object|null} - User card or null if not found
   */
  async getUserCard(phoneNumber) {
    try {
      // Format phone number
      const phone = this.formatPhoneNumber(phoneNumber);
      
      // Get from map
      const userCard = this.userCards.get(phone);
      
      if (userCard) {
        // Update last contact time
        userCard.lastContact = Date.now();
        
        // If we have a WhatsApp client but no profile pic, try to get it
        if (this.whatsAppClient && !userCard.profilePicUrl && typeof this.whatsAppClient.getProfilePicture === 'function') {
          try {
            userCard.profilePicUrl = await this.whatsAppClient.getProfilePicture(phone);
            userCard.updatedAt = Date.now();
            
            // Save updated user card
            this.saveUserCards();
          } catch (picError) {
            // Ignore profile pic errors
          }
        }
      }
      
      return userCard || null;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error getting user card:`, error);
      return null;
    }
  }
  
  /**
   * Check if user exists
   * @param {string} phoneNumber - User's phone number
   * @returns {boolean} - Whether user exists
   */
  async userExists(phoneNumber) {
    // Format phone number
    const phone = this.formatPhoneNumber(phoneNumber);
    
    // Check if in map
    return this.userCards.has(phone);
  }
  
  /**
   * Update user card
   * @param {string} phoneNumber - User's phone number
   * @param {Object} updates - Updates to apply
   * @returns {Object|null} - Updated user card or null if not found
   */
  async updateUserCard(phoneNumber, updates) {
    try {
      // Format phone number
      const phone = this.formatPhoneNumber(phoneNumber);
      
      // Check if user card exists
      if (!this.userCards.has(phone)) {
        console.log(`[UserCardManager:${this.instanceId}] User card not found for ${phone}`);
        return null;
      }
      
      // Get existing card
      const userCard = this.userCards.get(phone);
      
      // Apply updates
      Object.assign(userCard, updates, { updatedAt: Date.now() });
      
      // Save to disk
      this.saveUserCards();
      
      console.log(`[UserCardManager:${this.instanceId}] Updated user card for ${phone}`);
      
      return userCard;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error updating user card:`, error);
      return null;
    }
  }
  
  /**
   * Delete user card
   * @param {string} phoneNumber - User's phone number
   * @returns {boolean} - Whether deletion was successful
   */
  deleteUserCard(phoneNumber) {
    try {
      // Format phone number
      const phone = this.formatPhoneNumber(phoneNumber);
      
      // Remove from map
      const deleted = this.userCards.delete(phone);
      
      if (deleted) {
        // Save to disk
        this.saveUserCards();
        
        console.log(`[UserCardManager:${this.instanceId}] Deleted user card for ${phone}`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] User card not found for ${phone}`);
      }
      
      return deleted;
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error deleting user card:`, error);
      return false;
    }
  }
  
  /**
   * Get all user cards
   * @returns {Array} - Array of user cards
   */
  getAllUserCards() {
    return Array.from(this.userCards.values());
  }
  
  /**
   * Get user card count
   * @returns {number} - Number of user cards
   */
  getUserCardCount() {
    return this.userCards.size;
  }
  
  /**
   * Set WhatsApp client
   * @param {Object} client - WhatsApp client
   */
  setWhatsAppClient(client) {
    this.whatsAppClient = client;
  }
}

module.exports = UserCardManager;