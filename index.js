require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const http = require('http');

// Keep Render free instance awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

// Initialize OpenAI client pointed to GitHub Models inference endpoint
const clientAI = new OpenAI({
    baseURL: "https://models.inference.ai.azure.com",
    apiKey: process.env.GITHUB_TOKEN || process.env.GROQ_API_KEY
});

// Primary model for fast, accurate responses
const MODEL_NAME = "gpt-4o-mini";

const SYSTEM_PERSONALITY = `You are a concise, accurate Discord AI assistant.
RULES:
1. ALWAYS respond strictly in English unless requested otherwise.
2. Be 100% factually accurate. When asked about specific game items, mechanics, or builds that you do not have verified database knowledge for, clearly state: "I don't have exact database stats for that game's build system." NEVER invent fake RPG item names or stats.
3. Keep responses brief, clear, and under 500 characters.`;

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

async function getAIResponse(conversationHistory) {
    const completion = await clientAI.chat.completions.create({
        messages: [
            { role: 'system', content: SYSTEM_PERSONALITY },
            ...conversationHistory
        ],
        model: MODEL_NAME,
        temperature: 0.1, // Near-zero temperature for strict factual accuracy
        max_tokens: 300
    });

    return completion.choices[0]?.message?.content;
}

client.on('messageCreate', async (message) => {
    // Ignore self-messages
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // 1. Fetch rolling 3-message buffer for immediate context
        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 2. Generate response via GPT-4o-mini
        let responseText = await getAIResponse(conversationHistory);

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
