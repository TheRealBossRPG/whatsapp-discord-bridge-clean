// modals/setup/customizeMessagesModal.js - Fixed for proper settings saving
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Modal = require('../../templates/Modal');

class CustomizeMessagesModal extends Modal {
  constructor() {
    super({
      customId: 'customize_messages_modal'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`Processing modal submission for ${interaction.customId}`);
  
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
  
      // Get bridge instance manager
      const InstanceManager = require('../../core/InstanceManager');
      
      // Try to get an instance - but don't fail if we can't find one (setup flow)
      if (instance && !instance.isTemporary) {
        // If we have a real instance, update its settings too
        console.log(`Updating existing instance ${instance.instanceId} settings`);
        
        // Save settings through the instance manager to ensure proper persistence
        await InstanceManager.saveInstanceSettings(instance.instanceId, customSettings);
      } else {
        // We're in setup mode, just log that we're storing temporary settings
        console.log("No existing instance found - storing settings for later use in setup");
        
        // Make sure these settings are saved to setupStorage too
        const setupParams = global.setupStorage.getSetupParams(interaction.guildId) || {};
        setupParams.customSettings = customSettings;
        global.setupStorage.saveSetupParams(interaction.guildId, setupParams);
      }
  
      // Create continue setup button
      const continueRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("continue_setup")
          .setLabel("Continue Setup")
          .setStyle(ButtonStyle.Primary)
      );
  
      // Reply with success message and continue button
      await interaction.reply({
        content: "✅ Messages customized successfully! Click 'Continue Setup' to proceed.",
        components: [continueRow],
        ephemeral: true,
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
        console.error("Error sending preview followup:", followupError);
        // Try again with a simpler message
        try {
          await interaction.followUp({
            content: "Messages saved successfully. Click 'Continue Setup' to proceed.",
            ephemeral: true,
          });
        } catch (retryError) {
          console.error("Error sending simplified followup:", retryError);
        }
      }
  
      console.log(`Setup customization completed by ${interaction.user.tag}`);
      return true;
    } catch (modalError) {
      console.error("Error handling customization modal:", modalError);
  
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
        console.error("Failed to send error message:", finalError);
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
        console.error("Failed to create continue button:", buttonError);
      }
  
      return false;
    }
  }
}

module.exports = new CustomizeMessagesModal();