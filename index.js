require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

// Simple HTTP endpoint to keep Render awake via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('clientReady', () => {
    console.log(`Bot online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    // Prevent infinite loops by ignoring the bot's own messages
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: message.content,
            config: {
                systemInstruction: "You are a witty, concise Discord AI assistant. Keep responses under 500 characters."
            }
        });

        let responseText = response.text;

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        await message.reply(`⚠️ Error generating response: ${err.message}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
