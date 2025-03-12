// modules/userCardManager.js - FIXED FOR PROPER NAME HANDLING
const fs = require('fs');
const path = require('path');
const MediaManager = require('./MediaManager');

class UserCardManager {
  constructor(instanceId) {
    this.instanceId = instanceId || 'default';
    this.userCards = new Map();
    this.userState = new Map();
    
    // FIXED: Use more reliable path calculation
    const baseDir = instanceId 
      ? path.join(__dirname, '..', 'instances', instanceId)
      : path.join(__dirname, '..');
    
    // Instance-specific file path
    this.filePath = path.join(baseDir, 'user_cards.json');
    
    // Ensure the directory exists
    const dirPath = path.dirname(this.filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    // Log initialization
    console.log(`[UserCardManager:${this.instanceId}] Initialized with instance ID: ${this.instanceId}`);
    console.log(`[UserCardManager:${this.instanceId}] Using file path: ${this.filePath}`);
    
    this.loadUserCards();
  }

  loadUserCards() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.userCards = new Map(Object.entries(data));
        console.log(`[UserCardManager:${this.instanceId}] Loaded ${this.userCards.size} user cards from ${this.filePath}`);
      } else {
        console.log(`[UserCardManager:${this.instanceId}] No user cards file found at ${this.filePath}, starting with empty map`);
        this.userCards = new Map();
        // Create empty file
        fs.writeFileSync(this.filePath, '{}', 'utf8');
        console.log(`[UserCardManager:${this.instanceId}] Created empty user cards file at ${this.filePath}`);
      }
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error loading user cards: ${error.message}`);
      this.userCards = new Map();
      
      // Create empty file if it doesn't exist
      if (!fs.existsSync(this.filePath)) {
        try {
          fs.writeFileSync(this.filePath, '{}', 'utf8');
          console.log(`[UserCardManager:${this.instanceId}] Created empty user cards file at ${this.filePath}`);
        } catch (writeError) {
          console.error(`[UserCardManager:${this.instanceId}] Error creating empty user cards file: ${writeError.message}`);
        }
      }
    }
  }

  saveUserCards() {
    try {
      const cardObj = Object.fromEntries(this.userCards);
      fs.writeFileSync(this.filePath, JSON.stringify(cardObj, null, 2), 'utf8');
      console.log(`[UserCardManager:${this.instanceId}] Saved ${this.userCards.size} user cards to ${this.filePath}`);
    } catch (error) {
      console.error(`[UserCardManager:${this.instanceId}] Error saving user cards: ${error.message}`);
    }
  }

  // CRITICAL FIX: Ensure phone number normalization is consistent
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return 'unknown';
    
    // Remove WhatsApp extensions if present
    let normalized = String(phoneNumber).replace(/@.*$/, '');
    
    // Ensure it's a string
    normalized = String(normalized);
    
    // Clean up any other formatting issues
    normalized = normalized.trim();
    
    return normalized;
  }

  // CRITICAL FIX: Better user card retrieval without including phone in name
  getUserCard(phoneNumber) {
    // Validate input
    if (!phoneNumber) {
      console.error(`[UserCardManager:${this.instanceId}] getUserCard called with empty phoneNumber`);
      phoneNumber = 'unknown';
    }
    
    // Normalize phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    // Check for existing user card
    if (!this.userCards.has(phoneNumber)) {
      // Create a new user card with defaults
      console.log(`[UserCardManager:${this.instanceId}] Creating new user card for ${phoneNumber}`);
      const newCard = {
        phoneNumber: phoneNumber,
        name: null, // Will be filled in during conversation
        createdAt: new Date().toISOString(),
        lastContact: new Date().toISOString()
      };
      
      this.userCards.set(phoneNumber, newCard);
      this.saveUserCards();
      return newCard;
    }
    
    // Update last contact time
    const card = this.userCards.get(phoneNumber);
    card.lastContact = new Date().toISOString();
    this.userCards.set(phoneNumber, card);
    
    return card;
  }

  // FIXED: Update user card with proper directory structure handling
  updateUserCard(phoneNumber, updates) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    // Make sure we have a card first
    const card = this.getUserCard(phoneNumber);
    
    // Track if name changed for directory updates
    const nameChanged = updates.name && card.name !== updates.name;
    const oldName = card.name;
    
    // Apply updates
    Object.keys(updates).forEach(key => {
      // Don't allow phone number to change
      if (key !== 'phoneNumber') {
        card[key] = updates[key];
      }
    });

    // When updating a user's name, update the directory structure
    if (nameChanged) {
      try {
        // IMPORTANT - Use clean names for directory structure
        const cleanOldName = oldName ? MediaManager.formatFunctions.formatDisplayName(oldName) : null;
        const cleanNewName = MediaManager.formatFunctions.formatDisplayName(updates.name);
        
        console.log(`[UserCardManager:${this.instanceId}] Updating username from ${cleanOldName} to ${cleanNewName} for phone ${phoneNumber}`);
        
        // Try the proper MediaManager class first
        try {
          // Create a new MediaManager instance if necessary
          const mediaManager = new MediaManager({
            instanceId: this.instanceId,
            baseDir: path.join(__dirname, '..', 'instances', this.instanceId, 'transcripts')
          });
          
          // Force immediate directory structure updates - IMPORTANT: pass clean names
          if (cleanOldName) {
            mediaManager.setPhoneToUsername(phoneNumber, cleanOldName);
          }
          mediaManager.setPhoneToUsername(phoneNumber, cleanNewName);
        } catch (e) {
          // Fallback to simplified mediaManager
          const simplifiedMediaManager = require('./simplifiedMediaManager');
          if (typeof simplifiedMediaManager.setInstanceId === 'function') {
            simplifiedMediaManager.setInstanceId(this.instanceId);
          }
          if (typeof simplifiedMediaManager.setPhoneToUsername === 'function') {
            simplifiedMediaManager.setPhoneToUsername(phoneNumber, cleanNewName);
          }
        }
      } catch (error) {
        console.error(`[UserCardManager:${this.instanceId}] Error updating directory structure: ${error.message}`);
      }
    }
    
    this.userCards.set(phoneNumber, card);
    this.saveUserCards();
    return card;
  }
  
  hasUserCard(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    return this.userCards.has(phoneNumber);
  }
  
  getUserState(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    return this.userState.get(phoneNumber);
  }
  
  setUserState(phoneNumber, state) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    this.userState.set(phoneNumber, state);
  }
  
  clearUserState(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    this.userState.delete(phoneNumber);
  }
  
  getUserCardCount() {
    return this.userCards.size;
  }

  /**
   * Find a user card by username (useful for lookups)
   * @param {string} username - Username to search for
   * @returns {Object|null} - User card object if found, null otherwise
   */
  findUserCardByUsername(username) {
    if (!username) return null;
    
    // Clean and normalize the search term
    const normalizedSearch = MediaManager.formatFunctions.formatDisplayName(username).toLowerCase().trim();
    
    for (const [phone, card] of this.userCards.entries()) {
      if (card.name) {
        // Clean and normalize stored name for comparison
        const normalizedName = MediaManager.formatFunctions.formatDisplayName(card.name).toLowerCase().trim();
        if (normalizedName === normalizedSearch) {
          return { ...card, phoneNumber: phone };
        }
      }
    }
    
    return null;
  }
  
  /**
   * Find users by partial username match
   * @param {string} partialName - Partial name to search for
   * @param {number} limit - Maximum number of results (default 5)
   * @returns {Array} - Array of matching user cards
   */
  findUsersByPartialName(partialName, limit = 5) {
    if (!partialName || partialName.length < 2) return [];
    
    // Clean and normalize the search term
    const normalizedSearch = MediaManager.formatFunctions.formatDisplayName(partialName).toLowerCase().trim();
    const results = [];
    
    for (const [phone, card] of this.userCards.entries()) {
      if (card.name) {
        // Clean and normalize stored name for comparison
        const normalizedName = MediaManager.formatFunctions.formatDisplayName(card.name).toLowerCase().trim();
        if (normalizedName.includes(normalizedSearch)) {
          results.push({ ...card, phoneNumber: phone });
          
          if (results.length >= limit) break;
        }
      }
    }
    
    return results;
  }
  
  /**
   * Delete a user card
   * @param {string} phoneNumber - Phone number to delete
   * @returns {boolean} - Success status
   */
  deleteUserCard(phoneNumber) {
    // Normalize the phone number
    phoneNumber = this.normalizePhoneNumber(phoneNumber);
    
    if (!this.userCards.has(phoneNumber)) {
      return false;
    }
    
    this.userCards.delete(phoneNumber);
    this.saveUserCards();
    return true;
  }
}

module.exports = UserCardManager;