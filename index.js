const { google } = require("googleapis");
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let menuItems = [];
let pollMessage = null;
let votes = {}; // To track votes for each item
let userVotes = {}; // To track who has voted

// Function to read items from the spreadsheet (Sheet1)
async function readSpreadsheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const sheetsClient = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: sheetsClient });

  const spreadsheetId = process.env.SPREADSHEET_ID; // Use the spreadsheetId from .env

  // Read rows from Sheet1
  const getRows = await googleSheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: "Sheet1!A:B", // Adjust the range if needed
  });

  const rows = getRows.data.values;
  if (rows.length) {
    menuItems = rows.slice(1); // Remove header row
    console.log("Menu items updated:", menuItems);
  } else {
    console.log("No data found.");
  }
}

// Function to check if the current time is before 9:00 AM
function isBeforeCutoffTime() {
  const now = new Date();
  const cutoffTime = new Date();
  cutoffTime.setHours(19, 0, 0, 0); // Set to 9:00 AM

  return now < cutoffTime;
}

// Function to create the poll
async function createPoll(message) {
  if (pollMessage) {
    try {
      await pollMessage.delete(); // Attempt to delete the previous poll message if it exists
    } catch (error) {
      if (error.code === 10008) { // Code 10008 corresponds to "Unknown Message"
        console.log("The previous poll message was already deleted by a user.");
      } else {
        console.error("An unexpected error occurred while deleting the previous poll message:", error);
      }
    }
  }

  if (menuItems.length === 0) {
    await message.reply("No menu items available.");
    return;
  }

  const row = new ActionRowBuilder();

  menuItems.forEach((item, index) => {
    votes[`item_${index}`] = 0; // Initialize vote count
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`item_${index}`)
        .setLabel(item[1]) // Item name
        .setStyle(ButtonStyle.Primary)
    );
  });

  pollMessage = await message.reply({
    content: "Today's Menu:",
    components: [row],
  });
}

// Function to update the vote in Sheet2
async function updateVoteInSheet(userId, userName, itemName) {
  if (!isBeforeCutoffTime()) {
    console.log("Voting is closed. No more updates allowed.");
    return;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  const sheetsClient = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: sheetsClient });

  const spreadsheetId = process.env.SPREADSHEET_ID; // Use the spreadsheetId from .env

  try {
    // Check if the user has already voted
    const getRows = await googleSheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: "Sheet2!A:C", // Adjust the range if needed
    });

    const rows = getRows.data.values || []; // Handle case where rows are undefined

    let userFound = false;
    let rowIndex;

    for (let i = 1; i < rows.length; i++) {
      // Start at 1 to skip header row
      if (rows[i][0] === userId) {
        userFound = true;
        rowIndex = i + 1; // +1 because row index in API is 1-based
        break;
      }
    }

    if (userFound) {
      // Update the existing row with the new choice
      await googleSheets.spreadsheets.values.update({
        auth,
        spreadsheetId,
        range: `Sheet2!B${rowIndex}:C${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[userName, itemName]],
        },
      });
    } else {
      // Append the new vote
      await googleSheets.spreadsheets.values.append({
        auth,
        spreadsheetId,
        range: "Sheet2!A:C",
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[userId, userName, itemName]],
        },
      });
    }
  } catch (error) {
    console.error("Error updating vote in sheet:", error);
  }
}

// Discord bot setup
client.once("ready", () => {
  console.log("Bot is online!");
});

// Handle text-based commands
client.on("messageCreate", async (message) => {
  if (message.content.toLowerCase() === "!menu") {
    // Read the spreadsheet and create a new poll every time the command is used
    await readSpreadsheet();
    await createPoll(message);
  }
});

// Handle button clicks for voting
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const userName = interaction.user.username;
  const buttonId = interaction.customId;
  const itemIndex = parseInt(buttonId.split("_")[1]);
  const itemName = menuItems[itemIndex][1];

  if (!isBeforeCutoffTime()) {
    // Acknowledge the button click with a message that voting is closed
    await interaction.reply({ content: `Voting is closed for today.`, ephemeral: true });
    return;
  }

  if (userVotes[userId]) {
    // User has already voted, update their vote
    await updateVoteInSheet(userId, userName, itemName);
  } else {
    // First-time vote, register it
    userVotes[userId] = buttonId; // Record the user's vote
    votes[buttonId] += 1;
    await updateVoteInSheet(userId, userName, itemName);
  }

  // Acknowledge the button click
  await interaction.reply({ content: `Noted`, ephemeral: true });
});

client.login(process.env.DISCORD_BOT_TOKEN);
