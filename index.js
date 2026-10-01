require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render free instance alive
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Fallback hardcoded model list in case dynamic listing is delayed
let availableModels = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192'
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Fetch active models dynamically from your Groq API key on startup
async function refreshGroqModels() {
    try {
        const response = await groq.models.list();
        if (response && response.data && response.data.length > 0) {
            // Filter out audio/whisper models to only keep text chat models
            const chatModels = response.data
                .map(m => m.id)
                .filter(id => !id.includes('whisper') && !id.includes('guard'));
            
            if (chatModels.length > 0) {
                availableModels = chatModels;
                console.log('Successfully loaded available Groq models:', availableModels);
            }
        }
    } catch (err) {
        console.warn('Could not fetch dynamic Groq model list, using fallback defaults:', err.message);
    }
}

client.once('clientReady', async () => {
    console.log(`Bot online as ${client.user.tag}`);
    await refreshGroqModels();
});

async function getGroqResponse(userPrompt) {
    let lastError = null;

    for (const modelName of availableModels) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a witty, helpful Discord AI assistant. Keep responses engaging and concise.'
                    },
                    {
                        role: 'user',
                        content: userPrompt
                    }
                ],
                model: modelName,
                temperature: 0.7,
                max_tokens: 500
            });

            const text = completion.choices[0]?.message?.content;
            if (text) return text;
        } catch (err) {
            console.warn(`[Groq] Model "${modelName}" failed (${err.status || err.message}), trying next fallback model...`);
            lastError = err;
        }
    }

    throw lastError || new Error('All available Groq models failed.');
}

client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        let responseText = await getGroqResponse(message.content);

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        await message.reply(`⚠️ ${err.message || 'Error generating response.'}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
