// modals/setup/customizeMessagesModal.js - Complete rewrite for proper instance isolation

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Modal = require('../../templates/Modal');
const fs = require('fs');
const path = require('path');

class CustomizeMessagesModal extends Modal {
  constructor() {
    super({
      customId: 'customize_messages_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[CustomizeMessagesModal] Processing modal submission for ${interaction.customId}`);
      
      // Defer the reply to prevent timeout
      await interaction.deferReply({ ephemeral: true });
  
      // Get values from the modal fields
      const welcomeMessage = interaction.fields.getTextInputValue("welcome_message");
      const introMessage = interaction.fields.getTextInputValue("intro_message");
      const reopenMessage = interaction.fields.getTextInputValue("reopen_message");
      const vouchMessage = interaction.fields.getTextInputValue("vouch_message");
      const closeMessage = interaction.fields.getTextInputValue("close_message");
  
      // Log the fields we got for debugging
      console.log("Modal fields received:", {
        welcomeMessage: welcomeMessage ? welcomeMessage.substring(0, 20) + "..." : "missing",
        introMessage: introMessage ? introMessage.substring(0, 20) + "..." : "missing",
        reopenMessage: reopenMessage ? reopenMessage.substring(0, 20) + "..." : "missing",
        vouchMessage: vouchMessage ? vouchMessage.substring(0, 20) + "..." : "missing",
        closeMessage: closeMessage ? closeMessage.substring(0, 20) + "..." : "missing",
      });
  
      // Store settings in a well-structured object with correct field names
      const customSettings = {
        welcomeMessage,
        introMessage,
        reopenTicketMessage: reopenMessage,
        vouchMessage,
        closingMessage: closeMessage,
        // Include default new ticket message
        newTicketMessage: "# 📋 New Support Ticket\n**A new ticket has been created for {name}**\nWhatsApp: `{phoneNumber}`\n\nSupport agents will respond as soon as possible.",
        sendClosingMessage: true,
        transcriptsEnabled: true,
        vouchEnabled: true,
      };
  
      // Store in global variable for later use in QR code generation
      global.lastCustomSettings = customSettings;
  
      // Get the guild ID to determine instance
      const guildId = interaction.guild.id;
      
      // Get setup params from storage
      let setupParams = null;
      try {
        const setupStoragePath = path.join(__dirname, '..', '..', 'setup_storage', `${guildId}_setup.json`);
        if (fs.existsSync(setupStoragePath)) {
          setupParams = JSON.parse(fs.readFileSync(setupStoragePath, 'utf8'));
        } else if (global.setupStorage && typeof global.setupStorage.getSetupParams === 'function') {
          setupParams = global.setupStorage.getSetupParams(guildId);
        }
      } catch (setupError) {
        console.error(`[CustomizeMessagesModal] Error getting setup params:`, setupError);
      }
      
      // Add channel IDs from setup params to settings, if available
      if (setupParams) {
        if (setupParams.categoryId) {
          customSettings.categoryId = setupParams.categoryId;
        }
        if (setupParams.transcriptChannelId) {
          customSettings.transcriptChannelId = setupParams.transcriptChannelId;
          customSettings.transcriptsEnabled = true;
        }
        if (setupParams.vouchChannelId) {
          customSettings.vouchChannelId = setupParams.vouchChannelId;
          customSettings.vouchEnabled = true;
        }
      }
      
      // CRITICAL: Save settings directly to instance folder
      try {
        // Create instance directory
        const instanceDir = path.join(__dirname, '..', '..', 'instances', guildId);
        if (!fs.existsSync(instanceDir)) {
          fs.mkdirSync(instanceDir, { recursive: true });
        }
        
        // Check if there's already a settings file
        const settingsPath = path.join(instanceDir, 'settings.json');
        let existingSettings = {};
        
        if (fs.existsSync(settingsPath)) {
          try {
            existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          } catch (readError) {
            console.error(`[CustomizeMessagesModal] Error reading existing settings:`, readError);
          }
        }
        
        // Merge settings
        const mergedSettings = {
          ...existingSettings,
          ...customSettings
        };
        
        // Save to file
        fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf8');
        
        console.log(`[CustomizeMessagesModal] Saved settings directly to instance file: ${settingsPath}`);
      } catch (saveError) {
        console.error(`[CustomizeMessagesModal] Error saving settings:`, saveError);
      }
      
      // If we're in an existing instance, update settings there too
      if (instance && !instance.isTemporary) {
        try {
          // Update instance settings directly
          instance.customSettings = {
            ...instance.customSettings,
            ...customSettings
          };
          
          // Save settings through instance
          if (typeof instance.saveSettings === 'function') {
            await instance.saveSettings(customSettings);
            console.log(`[CustomizeMessagesModal] Saved settings through instance.saveSettings`);
          }
          
          // Apply settings if method available
          if (typeof instance.applySettings === 'function') {
            await instance.applySettings(customSettings);
            console.log(`[CustomizeMessagesModal] Applied settings to instance components`);
          }
        } catch (instanceError) {
          console.error(`[CustomizeMessagesModal] Error updating instance:`, instanceError);
        }
      }
  
      // Create continue setup button
      const continueRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("continue_setup")
          .setLabel("Continue Setup")
          .setStyle(ButtonStyle.Primary)
      );
  
      // Reply with success message and continue button
      await interaction.editReply({
        content: "✅ Messages customized successfully! Click 'Continue Setup' to proceed.",
        components: [continueRow],
      });
  
      // Show preview of the customized messages
      let previewContent = "**Preview of your custom messages:**\n\n";
  
      if (welcomeMessage) {
        previewContent += `**First contact:** "${welcomeMessage}"\n\n`;
      }
  
      if (introMessage) {
        previewContent += `**After name:** "${introMessage.replace("{name}", "John")}"\n\n`;
      }
  
      if (reopenMessage) {
        previewContent += `**When reopening ticket:** "${reopenMessage.replace("{name}", "John")}"\n\n`;
      }
  
      if (vouchMessage) {
        previewContent += `**Vouch instructions:** "${vouchMessage.replace("{name}", "John")}"\n\n`;
      }
  
      if (closeMessage) {
        previewContent += `**Closing message:** "${closeMessage.replace("{name}", "John")}"\n\n`;
      }
  
      previewContent += 'Click the "Continue Setup" button to proceed with setup.';
  
      try {
        await interaction.followUp({
          content: previewContent,
          ephemeral: true,
        });
      } catch (followupError) {
        console.error("[CustomizeMessagesModal] Error sending preview followup:", followupError);
        // Try again with a simpler message
        try {
          await interaction.followUp({
            content: "Settings saved successfully. Click 'Continue Setup' to proceed.",
            ephemeral: true,
          });
        } catch (retryError) {
          console.error("[CustomizeMessagesModal] Error sending simplified followup:", retryError);
        }
      }
  
      console.log(`[CustomizeMessagesModal] Setup customization completed by ${interaction.user.tag}`);
      return true;
    } catch (modalError) {
      console.error("[CustomizeMessagesModal] Error handling customization modal:", modalError);
  
      try {
        if (!interaction.replied) {
          await interaction.reply({
            content: `Error processing form: ${modalError.message}. Default settings will be used.`,
            ephemeral: true,
          });
        } else {
          await interaction.followUp({
            content: `Error processing form: ${modalError.message}. Default settings will be used.`,
            ephemeral: true,
          });
        }
      } catch (finalError) {
        console.error("[CustomizeMessagesModal] Failed to send error message:", finalError);
      }
  
      // Create continue button anyway to prevent users from getting stuck
      try {
        const continueRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("continue_setup")
            .setLabel("Continue with Default Settings")
            .setStyle(ButtonStyle.Primary)
        );
  
        if (!interaction.replied) {
          await interaction.reply({
            content: "There was an error processing your settings. Click to continue with default settings.",
            components: [continueRow],
            ephemeral: true,
          });
        } else {
          await interaction.followUp({
            content: "There was an error processing your settings. Click to continue with default settings.",
            components: [continueRow],
            ephemeral: true,
          });
        }
      } catch (buttonError) {
        console.error("[CustomizeMessagesModal] Failed to create continue button:", buttonError);
      }
  
      return false;
    }
  }
}

module.exports = new CustomizeMessagesModal();