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
  }
  
  /**
   * Process QR code
   * @param {Object} instance - WhatsApp instance
   * @param {string} qr - QR code data
   */
  async execute(instance, qr) {
    try {
      console.log(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Received QR code`);
      
      // Update instance QR code info if supported
      if (instance.lastQrCode !== undefined) {
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
      if (instance.paths && instance.paths.temp) {
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
        const { interaction, embedData } = global.qrCodeMessages.get(instance.guildId);
        
        try {
          // Generate a new QR code image
          if (interaction && interaction.editReply) {
            const qrUtils = require('../../utils/qrCodeUtils');
            await qrUtils.displayQRCode(interaction, qr, instance.guildId);
          }
        } catch (updateError) {
          console.error(`[WhatsAppEvent:${instance.instanceId}] Error updating QR code message:`, updateError);
        }
      }
      
      // Notify any registered callbacks
      if (instance.qrCodeListeners && instance.qrCodeListeners.size > 0) {
        for (const listener of instance.qrCodeListeners) {
          try {
            listener(qr);
          } catch (listenerError) {
            console.error(`[WhatsAppEvent:${instance.instanceId}] Error in QR code listener:`, listenerError);
          }
        }
      }
    } catch (error) {
      console.error(`[WhatsAppEvent:${instance?.instanceId || 'unknown'}] Error processing QR code:`, error);
    }
  }
}

module.exports = new QREvent();