// Updated buttons/setup/continueDefault.js
const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class ContinueDefaultButton extends Button {
  constructor() {
    super({
      customId: 'continue_default'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[ContinueDefault] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.update({
          content: "Continuing with default messages.\n\nGenerating QR code...",
          components: [],
        }).catch(err => {
          console.error(`[ContinueDefault] Error updating interaction:`, err);
        });
      }
      
      // Get setup info directly from storage file
      const guildId = interaction.guild.id;
      let setupParams = {};
      
      // Load existing setup params directly from file
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[ContinueDefault] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          const params = global.setupStorage.getSetupParams(guildId);
          if (params) setupParams = params;
          console.log(`[ContinueDefault] Loaded setup params from global.setupStorage`);
        }
      } catch (loadError) {
        console.error(`[ContinueDefault] Error loading setup params:`, loadError);
      }
      
      // Prepare default settings
      const customSettings = {
        welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
        transcriptsEnabled: !!setupParams.transcriptChannelId,
        vouchEnabled: !!setupParams.vouchChannelId,
      };
      
      // Generate QR code using the utility function
      let qrCode = null;
      
      try {
        // Import QRCodeUtils
        const QRCodeUtils = require('../../utils/qrCodeUtils');
        
        // Generate QR code
        qrCode = await QRCodeUtils.generateQRCode({
          guildId,
          categoryId: setupParams.categoryId,
          transcriptChannelId: setupParams.transcriptChannelId,
          vouchChannelId: setupParams.vouchChannelId,
          customSettings,
          discordClient: interaction.client,
        });
      } catch (qrError) {
        console.error(`[ContinueDefault] Error generating QR code:`, qrError);
        await interaction.editReply({
          content: `❌ Error generating QR code: ${qrError.message}. Please try again.`,
          components: [],
        });
        return;
      }
      
      if (qrCode === null) {
        await interaction.editReply({
          content: "✅ WhatsApp is already connected for this server!",
          components: [],
        });
        
        // Clean up setup params
        try {
          if (global.setupStorage && typeof global.setupStorage.cleanupSetupParams === 'function') {
            global.setupStorage.cleanupSetupParams(guildId);
          } else {
            const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
            if (fs.existsSync(setupStoragePath)) {
              fs.unlinkSync(setupStoragePath);
              console.log(`[ContinueDefault] Manually removed setup params file`);
            }
          }
        } catch (cleanupError) {
          console.error(`[ContinueDefault] Error cleaning up setup params:`, cleanupError);
        }
        
        return;
      }
      
      if (qrCode === "TIMEOUT") {
        await interaction.editReply({
          content: "⚠️ QR code generation timed out. Please try again later.",
          components: [],
        });
        
        // Clean up setup params
        try {
          if (global.setupStorage && typeof global.setupStorage.cleanupSetupParams === 'function') {
            global.setupStorage.cleanupSetupParams(guildId);
          } else {
            const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
            if (fs.existsSync(setupStoragePath)) {
              fs.unlinkSync(setupStoragePath);
              console.log(`[ContinueDefault] Manually removed setup params file`);
            }
          }
        } catch (cleanupError) {
          console.error(`[ContinueDefault] Error cleaning up setup params:`, cleanupError);
        }
        
        return;
      }
      
      // Display QR code
      try {
        const { displayQRCode } = require('../../utils/qrCodeUtils');
        await displayQRCode(interaction, qrCode, guildId);
      } catch (displayError) {
        console.error(`[ContinueDefault] Error displaying QR code:`, displayError);
        await interaction.editReply({
          content: `❌ Error displaying QR code: ${displayError.message}. Please try again.`,
          components: [],
        });
        return;
      }
      
      // Clean up setup params
      try {
        if (global.setupStorage && typeof global.setupStorage.cleanupSetupParams === 'function') {
          global.setupStorage.cleanupSetupParams(guildId);
        } else {
          const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
          if (fs.existsSync(setupStoragePath)) {
            fs.unlinkSync(setupStoragePath);
            console.log(`[ContinueDefault] Manually removed setup params file`);
          }
        }
      } catch (cleanupError) {
        console.error(`[ContinueDefault] Error cleaning up setup params:`, cleanupError);
      }
    } catch (error) {
      console.error("[ContinueDefault] Error handling continue with defaults:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: [],
        });
      } catch (replyError) {
        console.error("[ContinueDefault] Error sending error message:", replyError);
      }
    }
  }
}

module.exports = new ContinueDefaultButton();