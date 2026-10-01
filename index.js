require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

// Dummy HTTP server to keep Render Free Tier alive
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    systemInstruction: "You are a witty chatbot responding to other bots in Discord. Keep replies concise."
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('ready', () => {
    console.log(`Bot online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;

    const targetBotId = process.env.TARGET_BOT_ID;
    if (targetBotId && message.author.id !== targetBotId) return;
    if (!targetBotId && !message.author.bot) return;

    try {
        await message.channel.sendTyping();

        const result = await model.generateContent(message.content);
        const responseText = result.response.text();

        if (responseText) {
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
