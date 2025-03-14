const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const Button = require('../templates/Button');

class CustomizeMessagesButton extends Button {
  constructor() {
    super({
      customId: 'customize_messages'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log("Starting customization flow");

      // Create the modal with all the required fields
      const modal = new ModalBuilder()
        .setCustomId("customize_messages_modal")
        .setTitle("Customize Messages");

      // Welcome message
      const welcomeInput = new TextInputBuilder()
        .setCustomId("welcome_message")
        .setLabel("Welcome Message (first contact)")
        .setPlaceholder("Welcome to Support! What's your name?")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(
          "Welcome to Support! 😊 We're here to help. What's your name so we can get you connected?"
        )
        .setRequired(true);

      // Introduction message
      const introInput = new TextInputBuilder()
        .setCustomId("intro_message")
        .setLabel("Introduction (after user gives name)")
        .setPlaceholder("Nice to meet you, {name}!")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(
          "Nice to meet you, {name}! 😊 I'm setting up your support ticket right now. Our team will be with you soon to help with your request!"
        )
        .setRequired(true);

      // Reopen message
      const reopenInput = new TextInputBuilder()
        .setCustomId("reopen_message")
        .setLabel("Reopen Message (when user contacts again)")
        .setPlaceholder("Welcome back, {name}!")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(
          "Welcome back, {name}! 👋 Our team will continue assisting you with your request."
        )
        .setRequired(true);

      // Vouch message
      const vouchInput = new TextInputBuilder()
        .setCustomId("vouch_message")
        .setLabel("Vouch Command Message (for !vouch)")
        .setPlaceholder("Hey {name}! Thanks for using our service!")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(
          "Hey {name}! Thanks for using our service! We'd love to hear your feedback.\n\nTo leave a vouch, simply send a message starting with *Vouch!* followed by your feedback."
        )
        .setRequired(true);

      // Close ticket message
      const closeTicketInput = new TextInputBuilder()
        .setCustomId("close_message")
        .setLabel("Closing Message (sent when ticket closes)")
        .setPlaceholder("Thank you for contacting support!")
        .setStyle(TextInputStyle.Paragraph)
        .setValue(
          "Thank you for contacting support. Your ticket is now being closed and a transcript will be saved."
        )
        .setRequired(true);

      // Create action rows for each input
      const welcomeRow = new ActionRowBuilder().addComponents(welcomeInput);
      const introRow = new ActionRowBuilder().addComponents(introInput);
      const reopenRow = new ActionRowBuilder().addComponents(reopenInput);
      const vouchRow = new ActionRowBuilder().addComponents(vouchInput);
      const closeRow = new ActionRowBuilder().addComponents(closeTicketInput);

      // Add components to the modal
      modal.addComponents(welcomeRow, introRow, reopenRow, vouchRow, closeRow);

      // Show the modal - IMPORTANT: Just show the modal without updating or deferring
      await interaction.showModal(modal);
      console.log("Customization modal shown to user");

      return true;
    } catch (error) {
      console.error("Error in customization flow:", error);

      try {
        // Try to send a followup about the error
        await interaction.followUp({
          content: `Error showing customization form: ${error.message}. Please try again or use default messages.`,
          ephemeral: true,
        });
      } catch (followUpError) {
        console.error("Error sending followup:", followUpError);

        // Last resort attempt
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: `Error showing customization form: ${error.message}. Please try again or use default messages.`,
              ephemeral: true,
            });
          }
        } catch (finalError) {
          console.error("Final error attempt failed:", finalError);
        }
      }

      return false;
    }
  }
}

module.exports = new CustomizeMessagesButton();