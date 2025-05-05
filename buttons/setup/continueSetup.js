// buttons/setup/continueSetup.js - Complete rewrite for proper instance isolation

const Button = require('../../templates/Button');
const fs = require('fs');
const path = require('path');

class ContinueSetupButton extends Button {
  constructor() {
    super({
      customId: 'continue_setup'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[ContinueSetup] Processing button click`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.update({
          content: "Continuing with setup.\n\nGenerating QR code...",
          components: [],
        }).catch(err => {
          console.error(`[ContinueSetup] Error updating interaction:`, err);
        });
      }
      
      // Get guild ID for instance identification
      const guildId = interaction.guild.id;
  
      // Get setup info from storage
      let setupParams = null;
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          const setupData = fs.readFileSync(setupStoragePath, 'utf8');
          setupParams = JSON.parse(setupData);
          console.log(`[ContinueSetup] Loaded setup params directly from file`);
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          setupParams = global.setupStorage.getSetupParams(guildId);
          console.log(`[ContinueSetup] Loaded setup params from global.setupStorage`);
        }
      } catch (paramError) {
        console.error(`[ContinueSetup] Error loading setup parameters:`, paramError);
        setupParams = {}; // Fallback to empty object
      }
      
      if (!setupParams || !setupParams.categoryId) {
        console.error(`[ContinueSetup] Setup parameters not found for guild ${guildId}`);
        await interaction.editReply({
          content: "❌ Error: Setup information not found. Please run /setup again.",
          components: [],
        });
        return;
      }
  
      // Check for custom settings in global variable or use defaults
      const customSettings = global.lastCustomSettings || {
        welcomeMessage: "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?",
        introMessage: "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!",
        reopenTicketMessage: "Welcome back, {name}! 👋 Our team will continue assisting you with your request.",
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        closingMessage: "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved.",
        vouchMessage: "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback. For example:\n\n*Vouch! Great service, very quick response!*\n\nYou can also attach an image or video to your vouch message.",
        vouchSuccessMessage: "✅ Thank you for your vouch! It has been posted to our community channel.",
        sendClosingMessage: true,
        transcriptsEnabled: !!setupParams.transcriptChannelId,
        vouchEnabled: !!setupParams.vouchChannelId,
      };
      
      // Add channel IDs from setupParams to custom settings
      customSettings.categoryId = setupParams.categoryId;
      if (setupParams.transcriptChannelId) {
        customSettings.transcriptChannelId = setupParams.transcriptChannelId;
      }
      if (setupParams.vouchChannelId) {
        customSettings.vouchChannelId = setupParams.vouchChannelId;
      }
      
      // Clean up global variable after using it
      global.lastCustomSettings = null;
  
      // Log which source we're using for customSettings
      if (global.lastCustomSettings) {
        console.log(`[ContinueSetup] Using custom settings from global.lastCustomSettings for guild ${guildId}`);
        console.log("Custom settings content:", JSON.stringify(customSettings, null, 2));
      } else {
        console.log(`[ContinueSetup] Using default settings for guild ${guildId}`);
      }
  
      // CRITICAL: Save settings directly to instance folder first
      try {
        // Create instance directory
        const instanceDir = path.join(__dirname, '..', '..', 'instances', guildId);
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        // Save settings to instance settings file
        const settingsPath = path.join(instanceDir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(customSettings, null, 2), 'utf8');
        
        console.log(`[ContinueSetup] Saved settings to instance-specific file at ${settingsPath}`);
      } catch (saveError) {
        console.error(`[ContinueSetup] Error saving settings to instance file:`, saveError);
      }
  
      // Generate QR code
      const InstanceManager = require('../../core/InstanceManager');
      
      // Only pass essential connection information to QR generator, not all settings
      const qrCode = await InstanceManager.generateQRCode({
        guildId,
        categoryId: setupParams.categoryId,
        transcriptChannelId: setupParams.transcriptChannelId,
        vouchChannelId: setupParams.vouchChannelId,
        discordClient: interaction.client,
      });
  
      if (qrCode === null) {
        await interaction.editReply({
          content: "✅ WhatsApp is already connected for this server!",
          components: [],
        });
  
        // Even if already connected, ensure instance has correct settings
        try {
          const existingInstance = InstanceManager.getInstanceByGuildId(guildId);
          if (existingInstance) {
            await InstanceManager.saveInstanceSettings(existingInstance.instanceId, customSettings);
            console.log(`[ContinueSetup] Saved settings to existing instance ${existingInstance.instanceId}`);
          }
        } catch (instanceError) {
          console.error(`[ContinueSetup] Error saving to existing instance:`, instanceError);
        }
        
        // Clean up setup params
        try {
          if (global.setupStorage && typeof global.setupStorage.cleanupSetupParams === 'function') {
            global.setupStorage.cleanupSetupParams(guildId);
          } else {
            const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
            if (fs.existsSync(setupStoragePath)) {
              fs.unlinkSync(setupStoragePath);
              console.log(`[ContinueSetup] Manually removed setup params file`);
            }
          }
        } catch (cleanupError) {
          console.error(`[ContinueSetup] Error cleaning up setup params:`, cleanupError);
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
              console.log(`[ContinueSetup] Manually removed setup params file`);
            }
          }
        } catch (cleanupError) {
          console.error(`[ContinueSetup] Error cleaning up setup params:`, cleanupError);
        }
        
        return;
      }
  
      // Display QR code
      const { displayQRCode } = require('../../utils/qrCodeUtils');
      await displayQRCode(interaction, qrCode, guildId);
  
      // Clean up setup params
      try {
        if (global.setupStorage && typeof global.setupStorage.cleanupSetupParams === 'function') {
          global.setupStorage.cleanupSetupParams(guildId);
        } else {
          const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
          if (fs.existsSync(setupStoragePath)) {
            fs.unlinkSync(setupStoragePath);
            console.log(`[ContinueSetup] Manually removed setup params file`);
          }
        }
      } catch (cleanupError) {
        console.error(`[ContinueSetup] Error cleaning up setup params:`, cleanupError);
      }
    } catch (error) {
      console.error("[ContinueSetup] Error handling continue setup button:", error);
      
      try {
        await interaction.editReply({
          content: `❌ Error continuing setup: ${error.message}`,
        });
      } catch (followupError) {
        console.error("[ContinueSetup] Error sending error message:", followupError);
      }
    }
  }
}

module.exports = new ContinueSetupButton();