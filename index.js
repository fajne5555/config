require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-1.5-flash',
    systemInstruction: "You are a witty, friendly Discord AI assistant. You respond to both human users and other bots. Keep responses concise and under 500 characters."
});

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
    // Zapobiegaj zapętlaniu: ignoruj TYLKO wiadomości od samego siebie
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        const result = await model.generateContent(message.content);
        let responseText = result.response.text();

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
