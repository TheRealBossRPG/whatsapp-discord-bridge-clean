// events/whatsapp/qr.js - Enhanced with better error handling
const EventHandler = require('../../templates/EventHandler');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

/**
 * Handles WhatsApp QR code events
 */
class QREvent extends EventHandler {
  constructor() {
    super({
      event: 'qr'
    });
    
    // Avoid duplicate QR code processing
    this.lastProcessedQR = new Map();
  }
  
  /**
   * Process QR code
   * @param {Object} instance - WhatsApp instance
   * @param {string} qr - QR code data
   */
  async execute(instance, qr) {
    try {
      // Check if this is a duplicate QR code (can happen with failed connections)
      if (this.isDuplicateQR(instance?.instanceId, qr)) {
        return;
      }
      
      console.log(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Received QR code`);
      
      // Update instance QR code info if supported
      if (instance && instance.lastQrCode !== undefined) {
        instance.lastQrCode = qr;
        
        // Set timeout to clear QR code after 2 minutes
        if (instance.qrCodeTimer) {
          clearTimeout(instance.qrCodeTimer);
        }
        
        instance.qrCodeTimer = setTimeout(() => {
          instance.lastQrCode = null;
          console.log(`[WhatsAppEvent:${instance.instanceId}] QR code expired`);
        }, 120000);
      }
      
      // Generate QR code image if temp directory is available
      if (instance && instance.paths && instance.paths.temp) {
        try {
          const qrCodePath = path.join(instance.paths.temp, 'qrcode.png');
          
          // Generate the QR code
          await qrcode.toFile(qrCodePath, qr, {
            type: 'png',
            errorCorrectionLevel: 'H',
            margin: 4,
            scale: 16,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          console.log(`[WhatsAppEvent:${instance.instanceId}] QR code image saved to ${qrCodePath}`);
        } catch (qrError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error generating QR code image:`, qrError);
        }
      }
      
      // Update QR code message if we have stored data
      if (global.qrCodeMessages && global.qrCodeMessages.has(instance.guildId)) {
        await this.updateQRCodeMessage(instance, qr);
      }
      
      // Notify any registered callbacks
      this.notifyListeners(instance, qr);
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error processing QR code:`, error);
    }
  }
  
  /**
   * Check if this is a duplicate QR code to avoid spamming
   * @param {string} instanceId - Instance ID
   * @param {string} qr - QR code data
   * @returns {boolean} - Whether this is a duplicate
   */
  isDuplicateQR(instanceId, qr) {
    if (!instanceId || !qr) return false;
    
    const lastQR = this.lastProcessedQR.get(instanceId);
    const now = Date.now();
    
    // If we've seen the same QR code in the last 15 seconds, skip it
    if (lastQR && lastQR.qr === qr && (now - lastQR.time < 15000)) {
      return true;
    }
    
    // Update the last processed QR
    this.lastProcessedQR.set(instanceId, {
      qr,
      time: now
    });
    
    return false;
  }
  
  /**
   * Update QR code message in Discord
   * @param {Object} instance - WhatsApp instance
   * @param {string} qr - QR code data
   */
  async updateQRCodeMessage(instance, qr) {
    try {
      const storedData = global.qrCodeMessages.get(instance.guildId);
      if (!storedData) {
        return;
      }
      
      const { interaction } = storedData;
      
      // Make sure interaction is still valid
      if (!interaction || !interaction.editReply) {
        return;
      }
      
      // IMPROVED: Use central utility for QR code display
      try {
        const qrUtils = require('../../utils/qrCodeUtils');
        await qrUtils.displayQRCode(interaction, qr, instance.guildId);
      } catch (displayError) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] Error updating QR code message:`, displayError);
        
        // Try fallback update if central utility fails
        try {
          await interaction.editReply({
            content: "⚠️ New QR code received. Please scan with WhatsApp to connect.",
            components: interaction.message?.components || []
          });
        } catch (fallbackError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Fallback update also failed:`, fallbackError);
        }
      }
    } catch (updateError) {
      console.error(`[WhatsAppEvent:${instance.instanceId}] Error updating QR code message:`, updateError);
    }
  }
  
  /**
   * Notify QR code listeners
   * @param {Object} instance - WhatsApp instance
   * @param {string} qr - QR code data
   */
  notifyListeners(instance, qr) {
    if (!instance || !instance.qrCodeListeners) return;
    
    // Notify all registered listeners
    instance.qrCodeListeners.forEach(listener => {
      try {
        listener(qr);
      } catch (listenerError) {
        console.error(`[WhatsAppEvent:${instance.instanceId}] Error in QR code listener:`, listenerError);
      }
    });
  }
}

module.exports = new QREvent();