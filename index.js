require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render service alive via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// =========================================================================
// 🎭 EDIT PERSONALITY & MEMORY RULES HERE
// =========================================================================
const SYSTEM_PERSONALITY = `You are a witty, concise Discord AI assistant. 
RULES:
1. ALWAYS reply in English unless specifically requested otherwise.
2. Focus strictly on answering the USER'S LATEST MESSAGE. Use past messages ONLY for immediate context.
3. Do not bleed topics or information from past conversation into new, unrelated questions.
4. Keep responses brief and under 400 characters.`;
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
        // Fallback to default model array
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
                temperature: 0.5, // Lower temperature reduces topic bleeding and hallucinations
                max_tokens: 400
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
    // Prevent infinite loops
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // 1. Fetch only the last 4 messages to keep memory focused on the immediate context
        const pastMessages = await message.channel.messages.fetch({ limit: 4 });
        
        // 2. Format chronological conversation history
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 3. Generate response
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
