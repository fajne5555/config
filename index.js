require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render free service awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// List of active models in order of attempt
const GROQ_MODELS = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768'
];

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

async function getGroqResponse(userPrompt) {
    let lastError = null;

    for (const modelName of GROQ_MODELS) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You are a witty, helpful Discord AI assistant. Keep responses under 500 characters.'
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
            console.warn(`[Groq] Model ${modelName} failed (${err.status || err.message}), trying fallback...`);
            lastError = err;
        }
    }

    throw lastError || new Error('All Groq models failed.');
}

client.on('messageCreate', async (message) => {
    // Ignore self-messages to prevent loops
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
