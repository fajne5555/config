require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render service awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// High-quality primary self-serve production models on Groq
const PREFERRED_MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant'
];

// =========================================================================
// 🎭 EDIT PERSONALITY & RULES HERE
// =========================================================================
const SYSTEM_PERSONALITY = `You are a smart, accurate Discord AI assistant.
RULES:
1. ALWAYS reply strictly in English unless explicitly asked otherwise.
2. Be factually accurate and truthful. If you do not know something, say so instead of guessing.
3. Focus strictly on answering the USER'S LATEST MESSAGE. Use past messages ONLY for immediate context.
4. Keep responses brief, clear, and under 400 characters.`;
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
    let lastError = null;

    // Cycle through top high-quality self-serve models until one succeeds
    for (const modelName of PREFERRED_MODELS) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: SYSTEM_PERSONALITY },
                    ...conversationHistory
                ],
                model: modelName,
                temperature: 0.2, // Low temperature forces grounded, non-hallucinated answers
                max_tokens: 400
            });

            const text = completion.choices[0]?.message?.content;
            if (text) return text;
        } catch (err) {
            console.warn(`[Groq] Model ${modelName} unavailable (${err.status || err.message}), trying next fallback...`);
            lastError = err;
        }
    }

    throw lastError || new Error('All configured Groq models failed.');
}

client.on('messageCreate', async (message) => {
    // Ignore self-messages
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // Fetch only the last 3 messages to prevent topic bleeding
        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        
        // Format chronological context
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // Generate response
        let responseText = await getGroqResponse(conversationHistory);

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        await message.reply(`⚠️ Error: ${err.message || 'Could not generate response.'}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
