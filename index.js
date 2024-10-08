const { google } = require("googleapis");
const { Worker } = require('worker_threads');
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
    GatewayIntentBits.GuildMembers,
  ],
});

// Replace with your channel ID
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID; 


const startTime = "09:00:00";
const endTime = "15:07:00";

let menuItems = [];
let pollMessage = null;
let votes = {};

let votingEnabled = true;

// Google Sheets authentication
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json", // Path to your credentials file
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// Function to update the poll buttons when voting is enabled/disabled
async function updatePollButtons() {
  if (!pollMessage) return;

  const row = new ActionRowBuilder();

  menuItems.forEach((item, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`item_${index}`)
        .setLabel(item[1])
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!votingEnabled) // Disable buttons based on the flag
    );
  });

  row.addComponents(
    new ButtonBuilder()
      .setCustomId('cancel_order')
      .setLabel('Cancel Order')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!votingEnabled) // Disable buttons based on the flag
  );

  try {
    await pollMessage.edit({ components: [row] });
    console.log("Poll buttons updated based on voting status.");
  } catch (error) {
    console.error("Error updating poll buttons:", error);
  }
}

// Worker setup to handle voting status
const worker = new Worker('./pollWorker.js');

worker.on('message', (message) => {
  if (message.action === 'disableVoting') {
    votingEnabled = false;
    updatePollButtons();
    console.log('Voting has been disabled.');
  } else if (message.action === 'enableVoting') {
    votingEnabled = true;
    updatePollButtons();
    console.log('Voting has been enabled.');
  }
});

// Function to list all members in the "Members List" sheet
async function listAllMembers(guild) {
  const members = await guild.members.fetch();

  const memberData = members
    .filter(member => !member.user.bot)  
    .map(member => [member.user.id, member.displayName || ""]);

  const sheetName = "Members List";

  try {
    const getSheets = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
    });

    const sheetExists = getSheets.data.sheets.some(
      (sheet) => sheet.properties.title === sheetName
    );

    if (!sheetExists) {
      // Create the sheet if it doesn't exist
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.SPREADSHEET_ID,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                },
              },
            },
          ],
        },
      });

      console.log(`Created sheet: ${sheetName}`);
    }

    // Clear the current sheet contents
    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:B`,
    });

    // Insert member data into the sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A1:B`,  // Adjusted the range here
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [["User ID", "Display Name"], ...memberData],
      },
    });

    console.log(`Member list updated in sheet: ${sheetName}`);
  } catch (error) {
    console.error("Error listing all members:", error);
  }
}

// Function to add a new member to the sheet
async function addMemberToSheet(member) {
  const sheetName = "Members List";
  const userId = member.user.id;
  const displayName = member.displayName || "";

  try {
    // Append the new member to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:B`,
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[userId, displayName]],
      },
    });

    console.log(`Added new member to sheet: ${userId}, ${displayName}`);
  } catch (error) {
    console.error("Error adding new member to sheet:", error);
  }
}

// Function to remove a departing member from the sheet
async function removeMemberFromSheet(member) {
  const sheetName = "Members List";
  const userId = member.user.id;

  try {
    // Get the current data from the sheet
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:B`,
    });

    const rows = getRows.data.values || [];

    const rowIndex = rows.findIndex(row => row[0] === userId);

    if (rowIndex !== -1) {
      // Remove the row of the departing member
      rows.splice(rowIndex, 1);

      // Clear the sheet
      await sheets.spreadsheets.values.clear({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheetName}!A:B`,
      });

      // Update the sheet with the remaining data
      if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${sheetName}!A1`,
          valueInputOption: "USER_ENTERED",
          resource: {
            values: rows,
          },
        });
      }

      console.log(`Removed member from sheet: ${userId}`);
    } else {
      console.log(`Member not found in sheet: ${userId}`);
    }
  } catch (error) {
    console.error("Error removing member from sheet:", error);
  }
}

// Function to read items from the spreadsheet (Sheet1)
async function readSpreadsheet() {
  try {
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "Sheet1!A:B",
    });

    const rows = getRows.data.values;
    if (rows && rows.length) {
      menuItems = rows.slice(1);
      console.log("Menu items updated:", menuItems);
    } else {
      console.log("No data found.");
    }
  } catch (error) {
    console.error("Error reading spreadsheet:", error);
  }
}

// Function to get the current date in the format dd/mm/yyyy
function getCurrentDateFormatted(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(2); // Get last two digits of the year

  return `${day}/${month}/${year}`;
}

// Function to create a new sheet with the current date as the title
async function createSheetIfNotExists(dateFormatted) {
  try {
    const getSheets = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
    });

    const sheetExists = getSheets.data.sheets.some(
      (sheet) => sheet.properties.title === dateFormatted
    );

    if (!sheetExists) {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.SPREADSHEET_ID,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: dateFormatted,
                },
              },
            },
          ],
        },
      });

      const sheetId =
        addSheetResponse.data.replies[0].addSheet.properties.sheetId;

      // Add column headers to the new sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${dateFormatted}!A1:D1`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [["User ID", "Timestamp", "Display Name", "Item Voted"]],
        },
      });

      // Apply bold formatting to the headers
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.SPREADSHEET_ID,
        resource: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: {
                      bold: true,
                    },
                  },
                },
                fields: "userEnteredFormat.textFormat.bold",
              },
            },
          ],
        },
      });

      console.log(`Created sheet: ${dateFormatted} with bold headers`);
    } else {
      console.log(`Sheet ${dateFormatted} already exists`);
    }

    return dateFormatted;
  } catch (error) {
    console.error("Error creating sheet:", error);
  }
}

// Function to create the poll
async function createPoll(message) {
  if (pollMessage) {
    try {
      await pollMessage.delete();
    } catch (error) {
      if (error.code === 10008) {
        console.log("The previous poll message was already deleted by a user.");
      } else {
        console.error(
          "An unexpected error occurred while deleting the previous poll message:",
          error
        );
      }
    }
  }

  if (menuItems.length === 0) {
    await message.reply("No menu items available.");
    return;
  }

  const row = new ActionRowBuilder();

  menuItems.forEach((item, index) => {
    votes[`item_${index}`] = 0;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`item_${index}`)
        .setLabel(item[1])
        .setStyle(ButtonStyle.Primary) // Blue buttons for menu items
        .setDisabled(!votingEnabled)   // Disable button if voting is disabled
    );
  });

  // Add the red Cancel button
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('cancel_order')
      .setLabel('Cancel Order')
      .setStyle(ButtonStyle.Danger)   // Red button for cancel
      .setDisabled(!votingEnabled)    // Disable button if voting is disabled
  );

  pollMessage = await message.reply({
    content: "Today's Menu:",
    components: [row],
  });
}

// Function to update or append the vote in the sheet
async function updateOrAppendVote(interaction, userId, displayName, itemName) {
  const now = new Date(); // Always represents the current date/time
  const currentDate = getCurrentDateFormatted(now);
  const tomorrow = new Date(now); // Create a copy of the current date
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = getCurrentDateFormatted(tomorrow);

  const startDate = new Date(now);
  startDate.setHours(startTime.split(":")[0]);
  startDate.setMinutes(startTime.split(":")[1]);
  startDate.setSeconds(startTime.split(":")[2]);

  const endDate = new Date(now);
  endDate.setHours(endTime.split(":")[0]);
  endDate.setMinutes(endTime.split(":")[1]);
  endDate.setSeconds(endTime.split(":")[2]);

  let sheetName;

  console.log(now, "\n", startDate, "\n", endDate);

  // Handling votes on Friday after 15:00:00
  if (now.getDay() === 5 && now > endDate) { // 5 is the index for Friday
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7)); // Ensures it's always the next Monday
    const nextMondayDate = getCurrentDateFormatted(nextMonday);
    sheetName = await createSheetIfNotExists(nextMondayDate);
  } else if (now > endDate && now.getHours() < 24) {
    // If current time is between 3:00 PM and 11:59:59 PM, record in tomorrow's sheet
    sheetName = await createSheetIfNotExists(tomorrowDate);
  } else if (now < startDate || now.getHours() < 9) {
    // If current time is between 12:00 AM and 8:59:59 AM, record in today's sheet
    sheetName = await createSheetIfNotExists(currentDate);
  } else {
    // If current time is between 9:00 AM and 3:00 PM, disallow voting
    console.log(`Voting timestamp between 9 AM and 3 PM; voting not allowed.`);
    await interaction.editReply({
      content: `Sorry!! Restaurant is closed for today. Please place order within 3:00 PM to 9:00 AM`,
    });
    return;
  }

  const timestamp = now.toTimeString().split(" ")[0]; // Format: HH:MM:SS

  try {
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:D`,
    });

    const rows = getRows.data.values || [];

    let userFound = false;
    let rowIndex;

    if (rows.length > 1) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === userId) {
          userFound = true;
          rowIndex = i + 1;
          break;
        }
      }
    }

    if (userFound) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheetName}!B${rowIndex}:D${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[timestamp, displayName, itemName]],
        },
      });
      console.log(`Updated existing vote for UserID: ${userId}`);
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheetName}!A:D`,
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [[userId, timestamp, displayName, itemName]],
        },
      });
      console.log(`Appended new vote for UserID: ${userId}`);
    }

    // Only send "Noted" message if the vote was recorded
    await interaction.editReply({ content: `Noted` });
  } catch (error) {
    console.error("Error updating or appending vote:", error);
  }
}

async function cancelOrder(interaction) {
  const userId = interaction.user.id;
  const userName = interaction.user.username;
  const now = new Date();
  const currentDate = getCurrentDateFormatted(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = getCurrentDateFormatted(tomorrow);

  const startDate = new Date(now);
  startDate.setHours(startTime.split(":")[0]);
  startDate.setMinutes(startTime.split(":")[1]);
  startDate.setSeconds(startTime.split(":")[2]);

  const endDate = new Date(now);
  endDate.setHours(endTime.split(":")[0]);
  endDate.setMinutes(endTime.split(":")[1]);
  endDate.setSeconds(endTime.split(":")[2]);

  let sheetName;

  if (now > endDate && now.getHours() < 24) {
    // If current time is between 3:00 PM and 11:59:59 PM, use tomorrow's sheet
    sheetName = tomorrowDate;
  } else if (now < startDate || now.getHours() < 9) {
    // If current time is between 12:00 AM and 8:59:59 AM, use today's sheet
    sheetName = currentDate;
  } else {
    await interaction.editReply("Cannot cancel between 9:00 AM and 3:00 PM.");
    return;
  }

  try {
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${sheetName}!A:D`,
    });

    const rows = getRows.data.values || [];

    if (!rows || rows.length === 0) {
      await interaction.editReply("No orders found to cancel.");
      return;
    }

    const rowIndex = rows.findIndex(row => row[0] === userId);

    if (rowIndex === -1) {
      await interaction.editReply("You have not placed an order yet.");
    } else {
      rows.splice(rowIndex, 1); // Remove the matching row

      // Clear the current sheet
      await sheets.spreadsheets.values.clear({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${sheetName}!A:D`,
      });

      // Update the sheet with the modified data
      if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${sheetName}!A1`,
          valueInputOption: "RAW",
          resource: {
            values: rows,
          },
        });
      }

      await interaction.editReply("Your order has been canceled.");
    }
  } catch (error) {
    console.error("Error canceling order:", error);
    await interaction.editReply("An error occurred while attempting to cancel your order.");
  }
}

// Discord bot setup
client.once("ready", async () => {
  console.log("Bot is online!");

  // List all members in the "Members List" sheet when the bot starts
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    await listAllMembers(guild);
  }

  // Send the poll message in the designated channel
  const channel = await client.channels.fetch(TARGET_CHANNEL_ID);
  if (channel) {
    await readSpreadsheet();
    await createPoll({ reply: (content) => channel.send(content) });
  } else {
    console.error("Could not find the target channel.");
  }
});

// Handle text-based commands
client.on("messageCreate", async (message) => {
  
  // Ignore bot's own messages
  if (message.author.bot) return;

  // Check bot command with ! at start
  if (message.content.startsWith("!")) {
    // Check if the message is in the designated channel
    if (message.channel.id !== TARGET_CHANNEL_ID) {
      await message.channel.send("Please give bot commands in the lunch channel.");
      return;
    }
  }

  if (message.content.toLowerCase() === "!menu") {
    await readSpreadsheet();
    await createPoll(message);
  }
});

// Handle button clicks for voting
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  
  // If the cancel button is clicked
  if (interaction.customId === 'cancel_order') {
    await interaction.deferReply({ ephemeral: true });
    await cancelOrder(interaction);
    return;
  }

  if (!votingEnabled) {
    await interaction.reply({
      content: 'Voting is disabled from 9:00 AM to 3:00 PM. Please try again later.',
      ephemeral: true
    });
    return;
  }

  // Handle voting buttons
  const guildMember = interaction.guild.members.cache.get(userId);
  const displayName = guildMember ? guildMember.displayName : interaction.user.username;

  const buttonId = interaction.customId;
  const itemIndex = parseInt(buttonId.split("_")[1]);
  const itemName = menuItems[itemIndex][1];

  // Defer the reply to give you more time
  await interaction.deferReply({ ephemeral: true });

  await updateOrAppendVote(interaction, userId, displayName, itemName);
});

// Listen for new members joining
client.on("guildMemberAdd", async (member) => {
  await addMemberToSheet(member);
});

// Listen for members leaving
client.on("guildMemberRemove", async (member) => {
  await removeMemberFromSheet(member);
});

client.login(process.env.DISCORD_BOT_TOKEN);
