// utils/InteractionTracker.js - Central tracking for interactions to prevent duplicate handling

/**
 * InteractionTracker - Handles global tracking of Discord interactions
 * to prevent duplicate handling and race conditions
 */
class InteractionTracker {
  constructor() {
    // Set to track handled interactions by ID
    this.handledInteractions = new Map();
    
    // States for interactions
    this.STATES = {
      RECEIVED: 'received',   // Interaction was received but not yet handled
      DEFERRED: 'deferred',   // Interaction has been deferred
      REPLIED: 'replied',     // Interaction has been replied to
      COMPLETE: 'complete'    // Interaction handling is complete
    };
  }
  
  /**
   * Mark an interaction as received
   * @param {Interaction} interaction - Discord interaction
   * @returns {boolean} - Whether this is the first time receiving this interaction
   */
  markReceived(interaction) {
    if (!interaction || !interaction.id) return false;
    
    // If already tracked, it's not the first time
    if (this.handledInteractions.has(interaction.id)) {
      return false;
    }
    
    // Track this interaction
    this.handledInteractions.set(interaction.id, {
      state: this.STATES.RECEIVED,
      timestamp: Date.now()
    });
    
    // Schedule cleanup after 5 minutes
    setTimeout(() => {
      this.handledInteractions.delete(interaction.id);
    }, 5 * 60 * 1000);
    
    return true;
  }
  
  /**
   * Mark an interaction as deferred
   * @param {Interaction} interaction - Discord interaction
   */
  markDeferred(interaction) {
    if (!interaction || !interaction.id) return;
    
    this.handledInteractions.set(interaction.id, {
      state: this.STATES.DEFERRED,
      timestamp: Date.now()
    });
  }
  
  /**
   * Mark an interaction as replied to
   * @param {Interaction} interaction - Discord interaction
   */
  markReplied(interaction) {
    if (!interaction || !interaction.id) return;
    
    this.handledInteractions.set(interaction.id, {
      state: this.STATES.REPLIED,
      timestamp: Date.now()
    });
  }
  
  /**
   * Mark an interaction as complete (fully handled)
   * @param {Interaction} interaction - Discord interaction
   */
  markComplete(interaction) {
    if (!interaction || !interaction.id) return;
    
    this.handledInteractions.set(interaction.id, {
      state: this.STATES.COMPLETE,
      timestamp: Date.now()
    });
  }
  
  /**
   * Get the current state of an interaction
   * @param {Interaction|string} interaction - Discord interaction or interaction ID
   * @returns {string|null} - Current state or null if not tracked
   */
  getState(interaction) {
    const id = typeof interaction === 'string' ? interaction : (interaction?.id || null);
    if (!id) return null;
    
    const data = this.handledInteractions.get(id);
    return data ? data.state : null;
  }
  
  /**
   * Check if interaction is in a specific state
   * @param {Interaction|string} interaction - Discord interaction or interaction ID
   * @param {string} state - State to check for
   * @returns {boolean} - Whether interaction is in the specified state
   */
  isInState(interaction, state) {
    const currentState = this.getState(interaction);
    return currentState === state;
  }
  
  /**
   * Check if an interaction should be deferred (hasn't been handled yet)
   * @param {Interaction} interaction - Discord interaction
   * @returns {boolean} - Whether interaction should be deferred
   */
  shouldDefer(interaction) {
    if (!interaction || !interaction.id) return false;
    
    // If already deferred or replied, don't defer again
    if (interaction.deferred || interaction.replied) return false;
    
    // Check tracked state
    const state = this.getState(interaction.id);
    return state === this.STATES.RECEIVED || state === null;
  }
  
  /**
   * Check if an interaction can be safely edited
   * @param {Interaction} interaction - Discord interaction
   * @returns {boolean} - Whether interaction can be edited
   */
  canEdit(interaction) {
    if (!interaction || !interaction.id) return false;
    
    // Must be deferred or replied to edit
    return interaction.deferred || interaction.replied;
  }
  
  /**
   * Safely defer an interaction if needed
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} options - Defer options (ephemeral, etc)
   * @returns {Promise<boolean>} - Whether defer was attempted
   */
  async safeDefer(interaction, options = {}) {
    if (!interaction || !interaction.id) return false;
    
    // If we shouldn't defer, don't
    if (!this.shouldDefer(interaction)) return false;
    
    try {
      await interaction.deferReply(options);
      this.markDeferred(interaction);
      console.log(`Deferred interaction: ${interaction.id} ${interaction.isCommand() ? `(${interaction.commandName})` : ''}`);
      return true;
    } catch (error) {
      console.error(`Error deferring interaction: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Safely edit an interaction's reply
   * @param {Interaction} interaction - Discord interaction 
   * @param {Object} options - Edit options
   * @returns {Promise<boolean>} - Whether edit was successful
   */
  async safeEdit(interaction, options) {
    if (!interaction || !interaction.id) return false;
    
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(options);
        return true;
      } else if (interaction.replied) {
        await interaction.editReply(options);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error editing interaction reply: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Safely reply to an interaction
   * @param {Interaction} interaction - Discord interaction
   * @param {Object} options - Reply options
   * @returns {Promise<boolean>} - Whether reply was successful
   */
  async safeReply(interaction, options) {
    if (!interaction || !interaction.id) return false;
    
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(options);
        this.markReplied(interaction);
        return true;
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(options);
        this.markReplied(interaction);
        return true;
      } else if (interaction.replied) {
        await interaction.followUp(options);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error replying to interaction: ${error.message}`);
      return false;
    }
  }
}

// Create a single global instance
const tracker = new InteractionTracker();

// Export the singleton
module.exports = tracker;