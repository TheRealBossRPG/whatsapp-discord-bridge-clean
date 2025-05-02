// buttons/setup/changeCategory.js
const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Button = require('../../templates/Button');

/**
 * Button handler for changing the category
 */
class ChangeCategoryButton extends Button {
  constructor() {
    super({
      customId: 'change_category'
    });
  }
  
  async execute(interaction, instance) {
    try {
      console.log(`[ChangeCategory] Processing button`);
      
      // First defer the update to prevent timeout
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(err => {
          console.error(`[ChangeCategory] Error deferring update:`, err);
        });
      }
      
      // Get instance if not provided
      if (!instance) {
        // Try finding by route map
        if (interaction.client._instanceRoutes) {
          for (const [_, routeInfo] of interaction.client._instanceRoutes.entries()) {
            if (routeInfo.instance && routeInfo.instance.guildId === interaction.guildId) {
              instance = routeInfo.instance;
              console.log(`[ChangeCategory] Found instance via guild match: ${instance?.instanceId || 'unknown'}`);
              break;
            }
          }
        }
        
        // If still no instance, show error
        if (!instance) {
          console.error(`[ChangeCategory] No instance found for guild ${interaction.guildId}`);
          await interaction.editReply({
            content: '❌ Could not find WhatsApp configuration. Please run `/setup` first.',
            components: []
          });
          return;
        }
      }
      
      // Get all categories in the guild
      const categories = interaction.guild.channels.cache.filter(
        (c) => c.type === ChannelType.GuildCategory
      );
      
      if (categories.size === 0) {
        await interaction.editReply({
          content: "❌ No categories found in this server. Please create a category first.",
          components: [],
        });
        return;
      }
      
      // Create options array with category options
      const categoryOptions = [];
      
      // Add all categories
      categories.forEach((category) => {
        // Highlight the current category if set
        const isCurrent = instance.categoryId === category.id;
        categoryOptions.push({
          label: `${isCurrent ? '✓ ' : ''}${category.name}`,
          value: category.id,
          description: isCurrent ? "Current ticket category" : `Category with ${category.children?.cache.size || 0} channels`,
        });
      });
      
      // Create select menu for category (limit to 25 options)
      const categorySelectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("category_select")
          .setPlaceholder("Select a category for tickets")
          .addOptions(categoryOptions.slice(0, 25)) // Discord limit
      );
      
      // Update with message and select menu
      await interaction.editReply({
        content: `Please select a category to use for WhatsApp support tickets:`,
        components: [categorySelectRow],
        embeds: [] // Clear embeds
      });
    } catch (error) {
      console.error(`[ChangeCategory] Error:`, error);
      
      try {
        await interaction.editReply({
          content: `❌ Error: ${error.message}`,
          components: [],
          embeds: []
        });
      } catch (replyError) {
        console.error(`[ChangeCategory] Error sending error message:`, replyError);
      }
    }
  }
}

module.exports = new ChangeCategoryButton();