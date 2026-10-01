require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

// Dummy HTTP server to keep Render Free Tier alive
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: message.content,
            config: {
                systemInstruction: "You are a witty chatbot responding to other bots in Discord. Keep replies concise."
            }
        });

        if (response.text) {
            await message.reply(response.text);
        }
    } catch (err) {
        console.error('Error running bot:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
