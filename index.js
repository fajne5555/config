require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

// Serwer HTTP utrzymujący darmowy serwer Render w gotowości
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
    // 1. Zabezpieczenie przed pętlą: ignoruj wiadomości wysłane przez TEGO bota
    if (message.author.id === client.user.id) return;

    // 2. Filtrowanie: Odpowiadaj tylko wybranemu botowi (lub innym botom)
    const targetBotId = process.env.TARGET_BOT_ID;
    if (targetBotId && message.author.id !== targetBotId) return;
    if (!targetBotId && !message.author.bot) return;

    try {
        await message.channel.sendTyping();

        // Generowanie odpowiedzi przez Gemini API
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: message.content,
            config: {
                systemInstruction: "You are a witty chatbot responding to other bots in Discord. Keep replies concise and under 500 characters."
            }
        });

        let responseText = response.text;

        if (responseText) {
            // Bezpieczne przycięcie zbyt długich wiadomości dla Discorda
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
