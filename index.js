require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClient } = require('cohere-ai');
const http = require('http');

// Serwer HTTP utrzymujący aktywność usługi na Render
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

const SYSTEM_PERSONALITY = `You are a concise, strictly factual Discord AI assistant.
RULES:
1. ALWAYS respond strictly in English.
2. Be 100% factually accurate. When asked about game mechanics, stats, or builds that you do not have verified data for (such as Deepwoken), state clearly: "I don't have exact database stats for that game's build system." NEVER invent fake RPG item names or stats.
3. Keep responses brief, clear, and under 500 characters.`;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('clientReady', () => console.log(`Bot online as ${client.user.tag}`));

async function getAIResponse(conversationHistory) {
    if (!process.env.COHERE_API_KEY) {
        throw new Error("Missing COHERE_API_KEY environment variable in Render.");
    }

    // Formatowanie historii wiadomości dla API v2
    const messages = [
        { role: 'system', content: SYSTEM_PERSONALITY },
        ...conversationHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
        }))
    ];

    // Wywołanie v2/chat zgodne z nowymi modelami
    const response = await cohere.v2.chat({
        model: MODEL_NAME,
        messages: messages,
        temperature: 0.1,
        maxTokens: 300,
    });

    return response.message?.content?.[0]?.text;
}

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

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
