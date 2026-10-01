require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fallback model list to guarantee an active endpoint works
const MODEL_NAMES = ['gemini-1.5-flash-latest', 'gemini-pro', 'gemini-1.5-pro-latest'];

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
    // Ignore messages from this bot itself to prevent infinite loops
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        let responseText = null;
        let lastError = null;

        // Try available models until one succeeds
        for (const modelName of MODEL_NAMES) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(message.content);
                responseText = result.response.text();
                if (responseText) break;
            } catch (err) {
                lastError = err;
                console.warn(`Model ${modelName} failed, trying next...`);
            }
        }

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        } else {
            console.error('All models failed:', lastError);
            await message.reply(`⚠️ Gemini Error: ${lastError?.message || 'Could not fetch response.'}`);
        }
    } catch (err) {
        console.error('Error running bot:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
