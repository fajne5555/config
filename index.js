require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render web service active via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// =========================================================================
// 🎭 CHANGE YOUR BOT'S PERSONALITY HERE
// =========================================================================
const SYSTEM_PERSONALITY = `You are a sigma larper and heavily respect Kaileb Smith.
RULES:
1. ALWAYS respond in English unless specifically requested otherwise.
2. Keep responses brief, clever, and under 400 characters.`;
// =========================================================================

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

async function getGroqResponse(conversationHistory) {
    // Dynamic model fetching ensures it uses active models on your Groq key
    let modelList = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    try {
        const response = await groq.models.list();
        if (response?.data?.length > 0) {
            const activeModels = response.data
                .map(m => m.id)
                .filter(id => !id.includes('whisper') && !id.includes('guard'));
            if (activeModels.length > 0) modelList = activeModels;
        }
    } catch (e) {
        // Fallback to defaults if list endpoint is slow
    }

    let lastError = null;

    for (const modelName of modelList) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: SYSTEM_PERSONALITY },
                    ...conversationHistory
                ],
                model: modelName,
                temperature: 0.7,
                max_tokens: 500
            });

            const text = completion.choices[0]?.message?.content;
            if (text) return text;
        } catch (err) {
            console.warn(`[Groq] Model ${modelName} failed, trying next...`);
            lastError = err;
        }
    }

    throw lastError || new Error('All available Groq models failed.');
}

client.on('messageCreate', async (message) => {
    // Prevent infinite loops by ignoring the bot's own messages
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // 1. Fetch the last 10 messages in the channel for memory
        const pastMessages = await message.channel.messages.fetch({ limit: 10 });
        
        // 2. Format chronological conversation context for Groq
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 3. Generate completion with context & custom personality
        let responseText = await getGroqResponse(conversationHistory);

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
