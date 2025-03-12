/**
 * Enhanced user purge utility with more thorough data cleanup and Discord channel deletion
 * Run with: node purgeUser.js [phoneNumber] [username]
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client, GatewayIntentBits } = require('discord.js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Get user info from command line
const phoneNumber = process.argv[2];
const username = process.argv[3];

if (!phoneNumber || !username) {
  console.error('Usage: node purgeUser.js [phoneNumber] [username]');
  console.error('Example: node purgeUser.js 1234567890 "Mario Alex"');
  process.exit(1);
}

console.log(`🧹 Starting complete purge for user: ${username} (${phoneNumber})`);
console.log(`Discord channel deletion will be performed automatically`);

// Normalize phone number for various formats
const normalizedPhoneNumbers = [
  phoneNumber,
  phoneNumber.replace(/[^0-9]/g, ''), // digits only
  phoneNumber.startsWith('+') ? phoneNumber.substring(1) : `+${phoneNumber}`, // with/without +
  phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`, // with/without JID
  phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us` // with alternative JID format
];

// Create different username formats for searching
const possibleUsernames = [
  username,
  username.replace(/\s+/g, ''), // no spaces
  username.replace(/\s+/g, '_'), // underscore spaces
  username.replace(/\s+/g, '-'), // hyphen spaces
  username.toLowerCase(),
  username.toLowerCase().replace(/\s+/g, ''),
  username.toLowerCase().replace(/\s+/g, '_'),
  username.toLowerCase().replace(/\s+/g, '-'),
  username.replace(/[^a-zA-Z0-9]/g, '_'), // sanitized with underscores
  username.replace(/[^a-zA-Z0-9]/g, '-') // sanitized with hyphens
];

// Utility function to safely delete files and directories
function safeDelete(filePath, isDir = false) {
  try {
    if (fs.existsSync(filePath)) {
      if (isDir) {
        fs.rmSync(filePath, { recursive: true, force: true });
        console.log(`✅ Deleted directory: ${filePath}`);
      } else {
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted file: ${filePath}`);
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error deleting ${isDir ? 'directory' : 'file'}: ${filePath}`, error);
    return false;
  }
}

// Helper to save JSON data
function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`✅ Updated file: ${file}`);
    return true;
  } catch (error) {
    console.error(`❌ Error saving file: ${file}`, error);
    return false;
  }
}

// Helper to check if content matches any of our search terms
function contentMatches(content, searchTerms) {
  if (typeof content !== 'string') return false;
  
  const contentLower = content.toLowerCase();
  return searchTerms.some(term => 
    contentLower.includes(term.toLowerCase())
  );
}

// Initialize Discord client
let discordClient = null;
let discordGuild = null;

async function initializeDiscord() {
  console.log('🔄 Initializing Discord client...');
  
  // Validate environment variables
  if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is missing');
    return false;
  }
  
  if (!process.env.DISCORD_GUILD_ID) {
    console.error('❌ DISCORD_GUILD_ID environment variable is missing');
    return false;
  }
  
  try {
    // Initialize Discord client
    discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
      ]
    });
    
    // Login to Discord
    await discordClient.login(process.env.DISCORD_TOKEN);
    console.log('✅ Logged in to Discord');
    
    // Get the guild
    discordGuild = discordClient.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    if (!discordGuild) {
      console.error(`❌ Guild with ID ${process.env.DISCORD_GUILD_ID} not found`);
      return false;
    }
    
    console.log(`✅ Connected to guild: ${discordGuild.name}`);
    return true;
  } catch (error) {
    console.error('❌ Error initializing Discord client:', error);
    return false;
  }
}

// Function to delete a Discord channel
async function deleteDiscordChannel(channelId) {
  if (!discordClient || !discordGuild) return false;
  
  try {
    // Get the channel
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.log(`Channel ${channelId} not found or already deleted`);
      return false;
    }
    
    // Delete the channel
    await channel.delete(`Purged for user: ${username} (${phoneNumber})`);
    console.log(`✅ Deleted Discord channel: ${channel.name} (${channelId})`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting channel ${channelId}:`, error);
    return false;
  }
}

// Main purge process
async function purgeUser() {
  // Track statistics
  const stats = {
    userCards: 0,
    channelMappings: 0,
    mediaFiles: 0,
    transcripts: 0,
    tempFiles: 0,
    discordChannels: 0
  };
  
  // Initialize Discord
  const discordReady = await initializeDiscord();
  if (!discordReady) {
    console.log('⚠️ Continuing without Discord channel deletion');
  }
  
  // 0. First collect Discord channels to delete later
  const channelsToDelete = [];
  
  // 1. Purge from user_cards.json
  try {
    console.log('🔍 Checking user_cards.json...');
    if (fs.existsSync('user_cards.json')) {
      const userCards = JSON.parse(fs.readFileSync('user_cards.json', 'utf8'));
      let found = false;
      
      // Check all phone number formats
      for (const phone of normalizedPhoneNumbers) {
        if (userCards[phone]) {
          console.log(`Found user in user_cards.json: ${userCards[phone].name || phone}`);
          
          // Delete the user entry
          delete userCards[phone];
          found = true;
          stats.userCards++;
        }
      }
      
      // Look for username matches as well (in case phone number format is different)
      for (const [phone, card] of Object.entries(userCards)) {
        if (card.name && possibleUsernames.some(name => 
          card.name.toLowerCase().includes(name.toLowerCase()))) {
          console.log(`Found user by name match in user_cards.json: ${card.name} (${phone})`);
          
          // Delete the user entry
          delete userCards[phone];
          found = true;
          stats.userCards++;
        }
      }
      
      if (found) {
        // Save the updated file
        saveJson('user_cards.json', userCards);
      } else {
        console.log('User not found in user_cards.json');
      }
    } else {
      console.log('user_cards.json not found');
    }
  } catch (error) {
    console.error('❌ Error processing user_cards.json:', error);
  }
  
  // 2. Remove from channel_map.json
  try {
    console.log('🔍 Checking channel_map.json...');
    if (fs.existsSync('channel_map.json')) {
      const channelMap = JSON.parse(fs.readFileSync('channel_map.json', 'utf8'));
      let found = false;
      
      // Check all phone number formats
      for (const phone of normalizedPhoneNumbers) {
        if (channelMap[phone]) {
          console.log(`Found user in channel_map.json with channel: ${channelMap[phone]}`);
          
          // Record channel ID for Discord deletion
          channelsToDelete.push(channelMap[phone]);
          
          // Delete the user entry
          delete channelMap[phone];
          found = true;
          stats.channelMappings++;
        }
      }
      
      if (found) {
        // Save the updated file
        saveJson('channel_map.json', channelMap);
        
        // Also check ticket_status.json for these channels
        if (fs.existsSync('ticket_status.json')) {
          const ticketStatus = JSON.parse(fs.readFileSync('ticket_status.json', 'utf8'));
          let ticketFound = false;
          
          for (const channelId of channelsToDelete) {
            if (ticketStatus[channelId]) {
              console.log(`Found channel in ticket_status.json: ${channelId}`);
              
              // Delete the channel entry
              delete ticketStatus[channelId];
              ticketFound = true;
            }
          }
          
          if (ticketFound) {
            // Save the updated file
            saveJson('ticket_status.json', ticketStatus);
          }
        }
      } else {
        console.log('User not found in channel_map.json');
      }
    } else {
      console.log('channel_map.json not found');
    }
  } catch (error) {
    console.error('❌ Error processing channel_map.json:', error);
  }
  
  // 3. Delete media in new simplified structure
  try {
    console.log('🔍 Checking simplified media structure...');
    
    // Check all possible username formats in transcripts directory
    const transcriptsDir = path.join(__dirname, 'transcripts');
    if (fs.existsSync(transcriptsDir)) {
      for (const possibleUsername of possibleUsernames) {
        const sanitizedUsername = possibleUsername.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const userDir = path.join(transcriptsDir, sanitizedUsername);
        
        if (fs.existsSync(userDir)) {
          console.log(`Found user directory: ${userDir}`);
          
          // Check for media directory
          const mediaDir = path.join(userDir, 'media');
          if (fs.existsSync(mediaDir)) {
            console.log(`Found media directory: ${mediaDir}`);
            
            // Count files before deletion
            const files = fs.readdirSync(mediaDir);
            stats.mediaFiles += files.length;
            
            // Delete the media directory
            safeDelete(mediaDir, true);
          }
          
          // Check for transcript files
          const transcriptFiles = fs.readdirSync(userDir)
            .filter(file => file.startsWith('transcript-') && file.endsWith('.md'));
          
          if (transcriptFiles.length > 0) {
            console.log(`Found ${transcriptFiles.length} transcript files`);
            stats.transcripts += transcriptFiles.length;
            
            // Delete each transcript file
            for (const file of transcriptFiles) {
              safeDelete(path.join(userDir, file));
            }
          }
          
          // Check if the directory is now empty
          const remainingFiles = fs.readdirSync(userDir);
          if (remainingFiles.length === 0) {
            console.log(`Removing empty user directory: ${userDir}`);
            safeDelete(userDir, true);
          } else {
            console.log(`User directory not empty, ${remainingFiles.length} files remain`);
          }
        }
      }
    } else {
      console.log('transcripts directory not found');
    }
  } catch (error) {
    console.error('❌ Error cleaning simplified media structure:', error);
  }
  
  // 4. Delete media archives (legacy structure)
  try {
    console.log('🔍 Checking legacy media archives...');
    
    const mediaArchiveDir = path.join(__dirname, 'media_archive');
    if (fs.existsSync(mediaArchiveDir)) {
      // First check for user-specific directories
      const userDirs = fs.readdirSync(mediaArchiveDir).filter(dir => 
        fs.statSync(path.join(mediaArchiveDir, dir)).isDirectory() &&
        !dir.match(/^\d{4}-\d{2}-\d{2}$/) // Skip date-formatted directories
      );
      
      for (const dir of userDirs) {
        const dirPath = path.join(mediaArchiveDir, dir);
        
        // Check if directory name matches any username variant
        const dirLower = dir.toLowerCase();
        const isMatch = possibleUsernames.some(name => 
          dirLower.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_'))
        );
        
        if (isMatch) {
          console.log(`Found matching user media archive directory: ${dir}`);
          
          // Count files before deletion
          const fileCount = countFilesRecursively(dirPath);
          stats.mediaFiles += fileCount;
          
          safeDelete(dirPath, true);
        }
      }
      
      // Then check date-based directories for files with username pattern
      const dateDirs = fs.readdirSync(mediaArchiveDir).filter(dir => 
        fs.statSync(path.join(mediaArchiveDir, dir)).isDirectory() &&
        dir.match(/^\d{4}-\d{2}-\d{2}$/) // Only date-formatted directories
      );
      
      for (const dateDir of dateDirs) {
        const dateDirPath = path.join(mediaArchiveDir, dateDir);
        const files = fs.readdirSync(dateDirPath);
        
        let deletedFiles = 0;
        
        for (const file of files) {
          const filePath = path.join(dateDirPath, file);
          
          // Skip directories
          if (fs.statSync(filePath).isDirectory()) continue;
          
          // Check if filename matches any username variant
          const fileLower = file.toLowerCase();
          const isMatch = possibleUsernames.some(name => 
            fileLower.includes(name.toLowerCase().replace(/[^a-z0-9]/g, '_'))
          );
          
          if (isMatch) {
            console.log(`Found matching media file: ${dateDir}/${file}`);
            safeDelete(filePath);
            deletedFiles++;
            stats.mediaFiles++;
          }
          
          // Also check JSON metadata files for phone number
          if (file.endsWith('.json')) {
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              if (data.phoneNumber && normalizedPhoneNumbers.includes(data.phoneNumber)) {
                console.log(`Found matching media metadata: ${dateDir}/${file}`);
                safeDelete(filePath);
                
                // Also delete the corresponding media file
                const mediaFile = file.replace('.json', path.extname(data.originalPath || ''));
                const mediaPath = path.join(dateDirPath, mediaFile);
                if (fs.existsSync(mediaPath)) {
                  safeDelete(mediaPath);
                  deletedFiles++;
                  stats.mediaFiles++;
                }
              }
            } catch (err) {
              // Skip invalid JSON files
            }
          }
        }
        
        // Clean up empty date directories
        if (deletedFiles > 0) {
          const remainingFiles = fs.readdirSync(dateDirPath);
          if (remainingFiles.length === 0) {
            console.log(`Removing empty directory: ${dateDirPath}`);
            safeDelete(dateDirPath, true);
          }
        }
      }
    } else {
      console.log('media_archive directory not found');
    }
  } catch (error) {
    console.error('❌ Error processing media archives:', error);
  }
  
  // 5. Check for other references in temp directory
  try {
    console.log('🔍 Checking temp directory...');
    
    const tempDir = path.join(__dirname, 'temp');
    if (fs.existsSync(tempDir)) {
      // Delete any temp files related to this user
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        
        // Skip directories
        if (fs.statSync(filePath).isDirectory()) continue;
        
        // Check if filename matches any search term
        const filenameLower = file.toLowerCase();
        const isMatch = possibleUsernames.some(term => 
          filenameLower.includes(term.toLowerCase().replace(/[^a-z0-9]/g, '_'))
        );
        
        if (isMatch) {
          console.log(`Found matching temp file: ${file}`);
          safeDelete(filePath);
          stats.tempFiles++;
        }
      }
    } else {
      console.log('temp directory not found');
    }
  } catch (error) {
    console.error('❌ Error processing temp directory:', error);
  }
  
  // 6. Check for baileys session data
  try {
    console.log('🔍 Checking Baileys session data...');
    
    const baileysAuthDir = path.join(__dirname, 'baileys_auth');
    if (fs.existsSync(baileysAuthDir)) {
      // Look for files that might contain the phone number
      const files = fs.readdirSync(baileysAuthDir);
      for (const file of files) {
        const filePath = path.join(baileysAuthDir, file);
        
        // Skip directories
        if (fs.statSync(filePath).isDirectory()) continue;
        
        // Only check JSON files
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            // Check if any of our phone numbers appear in the file
            if (normalizedPhoneNumbers.some(num => content.includes(num))) {
              console.log(`⚠️ Found possible reference in Baileys auth file: ${file}`);
              console.log(`   This may require manual checking as these files are complex`);
            }
          } catch (e) {
            // Skip if can't read file
          }
        }
      }
    } else {
      console.log('baileys_auth directory not found');
    }
  } catch (error) {
    console.error('❌ Error processing Baileys auth data:', error);
  }
  
  // 7. Delete Discord channels if enabled
  if (discordClient && discordGuild && channelsToDelete.length > 0) {
    console.log(`🔍 Deleting ${channelsToDelete.length} Discord channels...`);
    
    for (const channelId of channelsToDelete) {
      const success = await deleteDiscordChannel(channelId);
      if (success) {
        stats.discordChannels++;
      }
    }
    
    // Also search for channels by name
    console.log('🔍 Searching for additional Discord channels by name...');
    
    try {
      // Get all text channels
      const channels = await discordGuild.channels.fetch();
      const textChannels = channels.filter(ch => ch.type === 0); // 0 = text channel
      
      // Look for matches in channel names
      for (const [id, channel] of textChannels) {
        // Skip if already deleted
        if (channelsToDelete.includes(id)) continue;
        
        // Check if channel name contains any username
        const channelNameLower = channel.name.toLowerCase();
        const isMatch = possibleUsernames.some(name => {
          const nameLower = name.toLowerCase();
          return channelNameLower.includes(nameLower) || 
                 channelNameLower.includes(nameLower.replace(/\s+/g, '-')) ||
                 channelNameLower.includes(nameLower.replace(/\s+/g, '_'));
        });
        
        if (isMatch) {
          console.log(`Found matching channel by name: ${channel.name} (${channel.id})`);
          const success = await deleteDiscordChannel(channel.id);
          if (success) {
            stats.discordChannels++;
          }
        }
      }
    } catch (error) {
      console.error('Error searching channels by name:', error);
    }
  }
  
  // Cleanup Discord client if initialized
  if (discordClient) {
    console.log('🔄 Logging out of Discord...');
    discordClient.destroy();
  }
  
  console.log('🧹 User purge complete!');
  console.log(`
📋 Summary:
- Purged user: ${username} (${phoneNumber})
- Removed ${stats.userCards} user entries from user_cards.json
- Removed ${stats.channelMappings} channel mappings from channel_map.json
- Deleted ${stats.mediaFiles} media files
- Deleted ${stats.transcripts} transcript files
- Cleaned up ${stats.tempFiles} temp files
- Deleted ${stats.discordChannels} Discord channels

Note: You may need to restart the bridge service for all changes to take effect.
`);
}

// Helper function to count files recursively in a directory
function countFilesRecursively(directory) {
  let fileCount = 0;
  
  function countFiles(dir) {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isFile()) {
        fileCount++;
      } else if (stat.isDirectory()) {
        countFiles(itemPath);
      }
    }
  }
  
  countFiles(directory);
  return fileCount;
}

// Run the purge process
purgeUser();