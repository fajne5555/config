require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const http = require('http');

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
    // 1. Krytyczne zabezpieczenie przed pętlą: ignoruj TYLKO wiadomości od samego siebie
    if (message.author.id === client.user.id) return;

    // Usunęliśmy filtr ograniczenia do innych botów – bot odpowiada teraz KAŻDEMU (ludziom i botom)!

    try {
        await message.channel.sendTyping();

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: message.content,
            config: {
                systemInstruction: "You are a witty, friendly Discord AI assistant. You respond to both human users and other bots. Keep responses concise and under 500 characters."
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
    }
});

client.login(process.env.DISCORD_TOKEN);
