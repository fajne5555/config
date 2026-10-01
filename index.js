require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render service alive via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Lock strictly to the high-accuracy 70B model to eliminate 8B hallucinations
const HIGH_QUALITY_MODEL = 'llama-3.3-70b-versatile';

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
    // Directly invoke the 70B model with low temperature for factual precision
    const completion = await groq.chat.completions.create({
        messages: [
            { role: 'system', content: SYSTEM_PERSONALITY },
            ...conversationHistory
        ],
        model: HIGH_QUALITY_MODEL,
        temperature: 0.2, // Very low temperature forces strictly grounded, non-creative answers
        max_tokens: 400
    });

    return completion.choices[0]?.message?.content;
}

client.on('messageCreate', async (message) => {
    // Ignore self-messages to prevent loops
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // Fetch only the last 3 messages to avoid mixing up old chat context
        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        
        // Format chronological conversation history
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // Generate response using strictly 70B
        let responseText = await getGroqResponse(conversationHistory);

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        
        if (err.status === 429) {
            await message.reply('⚠️ Rate limit reached on 70B model. Please wait a few seconds.');
        } else {
            await message.reply(`⚠️ Error: ${err.message || 'Could not generate response.'}`);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
