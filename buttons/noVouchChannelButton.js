const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Button = require('../templates/Button');

class NoVouchChannelButton extends Button {
  constructor() {
    super({
      customId: 'no_vouch_channel'
    });
  }
  
  async execute(interaction, instance) {
    try {
      await interaction.deferUpdate();
      
      // Get setup info
      const guildId = interaction.guild.id;
      const setupParams = global.setupStorage.getSetupParams(guildId);
      
      // Summarize selections
      let statusText = `Category: <#${setupParams.categoryId}>\n`;
      if (setupParams.transcriptChannelId) {
        statusText += `Transcript channel: <#${setupParams.transcriptChannelId}>\n`;
      } else {
        statusText += `Transcript channel: None (disabled)\n`;
      }
      
      statusText += `Vouch channel: None (disabled)\n`;
      
      // Create customize options buttons
      const customizeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("customize_messages")
          .setLabel("Customize Messages")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("continue_default")
          .setLabel("Continue with Defaults")
          .setStyle(ButtonStyle.Secondary)
      );
      
      await interaction.editReply({
        content: `${statusText}\nWould you like to customize the messages users will see?\n\nYou can include \`{name}\` in messages to insert the user's name automatically and \`{phoneNumber}\` for their phone number.`,
        components: [customizeRow],
      });
    } catch (error) {
      console.error("Error handling no vouch channel option:", error);
      await interaction.editReply({
        content: "Error: " + error.message,
        components: [],
      });
    }
  }
}

module.exports = new NoVouchChannelButton();