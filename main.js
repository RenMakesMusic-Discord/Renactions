const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, REST } = require("discord.js");
const { Routes } = require("discord-api-types/v9");
require("dotenv").config();

// Bot Configuration
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// File Paths
const mutesFilePath = path.join(__dirname, "mutes.json");
const reactionsFilePath = path.join(__dirname, "reactions.json");
const allowedChannelsFilePath = path.join(__dirname, "allowedChannels.json");

// Role IDs
const muteRoleId = "1080944658789716018"; // Replace with your mute role ID
const staffRoleId = "1012345633732042843"; // Replace with your staff role ID

// Reaction Map
let reactionMap = new Map();

// Helper Functions
function loadJSON(filePath, defaultValue = {}) {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return defaultValue;
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Load Data
const mutes = loadJSON(mutesFilePath);
reactionMap = new Map(Object.entries(loadJSON(reactionsFilePath)));
const allowedChannels = loadJSON(allowedChannelsFilePath).allowedChannels || [];

// Event: Bot Ready
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Event: Message Creation
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  const allowedChannelIds = ["1102332461695901837", "996526781127467079"];
  if (!allowedChannelIds.includes(msg.channel.id)) return;

  const args = msg.content.split(" ");
  const command = args.shift().toLowerCase();

  // Commands for managing reactions
  if (command === "/reactions") {
    const reactionList = Array.from(reactionMap)
      .map(([username, emoji]) => `${username}: ${emoji}`)
      .join("\n") || "No reactions set.";
    msg.channel.send(`Available reactions:\n${reactionList}`);
  } else if (command === "/reactions-set") {
    if (!msg.member.roles.cache.has(staffRoleId)) {
      return msg.reply("You do not have permission to use this command.");
    }

    const username = args[0]?.toLowerCase();
    const emoji = args[1];

    if (!username || !emoji) {
      return msg.reply("Please provide both a username and an emoji.");
    }

    reactionMap.set(username, emoji);
    saveJSON(reactionsFilePath, Object.fromEntries(reactionMap));
    msg.reply(`Reaction set for ${username} with emoji ${emoji}`);
  }

  // React to messages mentioning usernames (substring matching)
  for (const [username, emoji] of reactionMap.entries()) {
    // Case insensitive matching for usernames (this will now match substrings)
    const regex = new RegExp(username, "gi");
    if (regex.test(msg.content)) {
      try {
        // Ensure the emoji is a valid string or emoji object
        if (typeof emoji === "string" || emoji instanceof String) {
          await msg.react(emoji); // Reacting with the emoji
        } else {
          console.error("Invalid emoji:", emoji);
        }
      } catch (error) {
        console.error("Failed to react:", error);
      }
    }
  }
});

// Event: Interaction Creation (Slash Commands)
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === "reactions") {
    const reactionList = Array.from(reactionMap)
      .map(([username, emoji]) => `${username}: ${emoji}`)
      .join("\n") || "No reactions set.";
    interaction.reply({ content: `Available reactions:\n${reactionList}` });
  } else if (commandName === "reactions-set") {
    if (!interaction.member.roles.cache.has(staffRoleId)) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const username = options.getString("username").toLowerCase();
    const emoji = options.getString("emoji");

    reactionMap.set(username, emoji);
    saveJSON(reactionsFilePath, Object.fromEntries(reactionMap));

    interaction.reply({
      content: `Reaction set for ${username} with emoji ${emoji}`,
      ephemeral: true,
    });
  } else if (commandName === "mute") {
    if (!interaction.member.roles.cache.has(staffRoleId)) {
      return interaction.reply({
        content: "You do not have permission to use this command.",
        ephemeral: true,
      });
    }

    const member = options.getMember("user");

    if (!member) {
      return interaction.reply({
        content: "User not found.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Remove all roles and store them
    const memberRoles = member.roles.cache.filter(role => role.id !== interaction.guild.id && role.id !== muteRoleId);
    const botMember = interaction.guild.members.cache.get(interaction.client.user.id);

    if (botMember.roles.highest.position <= member.roles.highest.position) {
      return interaction.followUp({
        content: "I cannot mute this user because their role is higher than mine.",
        ephemeral: true,
      });
    }

    try {
      await member.roles.remove(memberRoles); // Remove all roles
      mutes[member.id] = memberRoles.map(role => role.id); // Store roles in mutes.json
      saveJSON(mutesFilePath, mutes);

      await member.roles.add(muteRoleId); // Add mute role
      await interaction.followUp(`Muted <@${member.id}> successfully.`);
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        content: "An error occurred while trying to mute the user.",
        ephemeral: true,
      });
    }
  } else if (commandName === "unmute") {
    if (!interaction.member.roles.cache.has(staffRoleId)) {
        return interaction.reply({
            content: "You do not have permission to use this command.",
            ephemeral: true,
        });
    }

    const member = options.getMember("user");

    if (!member) {
        return interaction.reply({
            content: "User not found.",
            ephemeral: true,
        });
    }

    await interaction.deferReply();

    try {
        // Check if user had roles saved
        let rolesToRestore = [];
        if (mutes[member.id]) {
            rolesToRestore = mutes[member.id];
            // Delete the entry from mutes.json before unmuting
            delete mutes[member.id];
            saveJSON(mutesFilePath, mutes); // Save the updated mutes data
        }

        // Restore previous roles if any
        if (rolesToRestore.length > 0) {
            await member.roles.add(rolesToRestore);
        }

        // Remove mute role last
        await member.roles.remove(muteRoleId);

        await interaction.followUp(`Unmuted <@${member.id}> successfully.`);
    } catch (error) {
        console.error(error);
        await interaction.followUp({
            content: "An error occurred while trying to unmute the user.",
            ephemeral: true,
        });
    }
}

if (commandName === "eventopen") {
    // Ensure the user has one of the required roles
    const hasRequiredRole = interaction.member.roles.cache.some((role) =>
      ["1012345633732042843", "1035594543036387378"].includes(role.id)
    );
    if (!hasRequiredRole) {
      return interaction.reply({
        content: "You do not have the required permissions to use this command.",
        ephemeral: true,
      });
    }
  
    // Check if the channel ID is in the allowed channels JSON file
    if (!allowedChannels.includes(interaction.channel.id)) {
      return interaction.reply({
        content: "This channel is not authorized for this action.",
        ephemeral: true,
      });
    }
  
    try {
      await interaction.deferReply();
  
      // Update channel permissions to allow everyone to view
      const everyoneRole = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyoneRole, {
        ViewChannel: true,
      });
  
      await interaction.followUp(`The channel in <#${interaction.channel.id}> is now open.`);
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        content: "An error occurred while trying to open the channel.",
        ephemeral: true,
      });
    }
  }
  
  if (commandName === "eventclose") {
    const hasRequiredRole = interaction.member.roles.cache.some((role) =>
      ["1012345633732042843", "1035594543036387378"].includes(role.id)
    );
    if (!hasRequiredRole) {
      return interaction.reply({
        content: "You do not have the required permissions to use this command.",
        ephemeral: true,
      });
    }
  
    if (!allowedChannels.includes(interaction.channel.id)) {
      return interaction.reply({
        content: "This channel is not authorized for this action.",
        ephemeral: true,
      });
    }
  
    try {
      await interaction.deferReply();
  
      const everyoneRole = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyoneRole, {
        ViewChannel: false,
      });
  
      await interaction.followUp(`The event in <#${interaction.channel.id}> is now closed.`);
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        content: "An error occurred while trying to close the event.",
        ephemeral: true,
      });
    }
  }

  if (commandName === "minor") {
    // Ensure the user has the required staff role
    const hasRequiredRole = interaction.member.roles.cache.some(
      (role) => role.id === staffRoleId
    );
  
    if (!hasRequiredRole) {
      return interaction.reply({
        content: "You do not have the required permissions to use this command.",
        ephemeral: true,
      });
    }
  
    // Get the target user to apply the restriction to
    const targetUser = interaction.options.getUser("user");
    if (!targetUser) {
      return interaction.reply({
        content: "You must mention a user to apply the restriction to.",
        ephemeral: true,
      });
    }
  
    // Channels to restrict view access
    const restrictedChannelIds = [
      "1102332461695901837",
      "1214384726169886760",
      "1150866157822300160",
      "1146042325378801694",
      "996812939665358898",
      "996782066119229580",
      "1174488070943420517",
      "1032398233235902494",
      "988166773671100466",
    ];
  
    try {
      await interaction.deferReply();
  
      // Loop through the restricted channels and update the permissions
      for (const channelId of restrictedChannelIds) {
        const channel = await interaction.guild.channels.fetch(channelId);
        if (channel) {
          // Modify permissions for the target user
          await channel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: false,
          });
        }
      }
  
      await interaction.followUp({
        content: `The user ${targetUser.tag} is now restricted from viewing the specified channels.`,
      });
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        content: "An error occurred while trying to apply the restriction.",
        ephemeral: true,
      });
    }
  }

if (commandName === "fitbrole") {
  // Ensure the user has one of the required roles
  const allowedRoleIds = ["1012345633732042843", "1035594543036387378"];
  const hasPermission = allowedRoleIds.some(roleId =>
    interaction.member.roles.cache.has(roleId)
  );

  if (!hasPermission) {
    return interaction.reply({
      content: "You do not have permission to use this command.",
      ephemeral: true,
    });
  }

  // Get the target user and the role to be assigned
  const member = options.getMember("user");
  const roleId = "1130894056537469100"; // Replace with the role ID you want to assign

  if (!member) {
    return interaction.reply({
      content: "User not found.",
      ephemeral: true,
    });
  }

  try {
    // Assign the role
    await member.roles.add(roleId);

    // Reply to confirm the role assignment
    await interaction.reply({
      content: `Successfully assigned the role to <@${member.id}> for 7 days.`,
      ephemeral: true,
    });

    // Set a timeout to remove the role after 7 days (7 days = 604800000 ms)
    setTimeout(async () => {
      try {
        // Remove the role after 7 days
        await member.roles.remove(roleId);
        console.log(`Removed the role from <@${member.id}> after 7 days.`);
      } catch (error) {
        console.error("Error removing role:", error);
      }
    }, 604800000); // 7 days in milliseconds (7 * 24 * 60 * 60 * 1000)
    
  } catch (error) {
    console.error(error);
    await interaction.reply({
      content: "An error occurred while assigning the role.",
      ephemeral: true,
    });
  }
}
});

// Register Slash Commands
async function registerSlashCommands() {
  const commands = [
    {
      name: "reactions",
      description: "List all available reactions",
    },
    {
      name: "reactions-set",
      description: "Set a reaction for a user",
      options: [
        {
          name: "username",
          type: 3, // String
          description: "The username of the user",
          required: true,
        },
        {
          name: "emoji",
          type: 3, // String
          description: "The emoji to associate",
          required: true,
        },
      ],
    },
    {
      name: "mute",
      description: "Mute a user",
      options: [
        {
          name: "user",
          type: 6, // User
          description: "The user to mute",
          required: true,
        },
      ],
    },
        {
          name: "eventopen",
          description: "Open channel for everyone to view",
    },
        {
          name: "eventclose",
          description: "Close channel to restrict viewing for everyone",
    },
    {
        name: "minor",
        description: "Restrict a user from viewing specific channels",
        options: [
          {
            name: "user",
            type: 6, // '6' corresponds to a 'USER' type
            description: "The user to restrict from viewing the channels",
            required: true,
          },
        ],
      },   
        {
          name: "unmute",
          description: "Unmute a user",
          options: [
            {
              name: "user",
              type: 6, // User
              description: "The user to unmute",
              required: true,
            },
       ],
    },
    {
        name: "fitbrole",
        description: "Assign fitbrole role to the user",
        options: [
          {
            name: "user",
            type: 6, // User
            description: "The user to assign the role to",
            required: true,
          },
        ],
      },
  ];

  const rest = new REST({ version: "9" }).setToken(token);

  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}

// Start the bot
client.login(token).then(registerSlashCommands);
