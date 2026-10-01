require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

// Keep Render free instance awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

// Azure Inference API endpoint for GitHub Models
const API_URL = "https://models.inference.ai.azure.com/chat/completions";
const MODEL_NAME = "gpt-4o-mini";

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
    const token = process.env.GITHUB_TOKEN;
    
    if (!token) {
        throw new Error("Missing GITHUB_TOKEN environment variable in Render.");
    }

    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token.trim()}`
        },
        body: JSON.stringify({
            messages: [
                { role: "system", content: SYSTEM_PERSONALITY },
                ...conversationHistory
            ],
            model: MODEL_NAME,
            temperature: 0.1,
            max_tokens: 300
        })
    });

    const responseText = await response.text();

    if (!response.ok) {
        throw new Error(`GitHub API Error (${response.status}): ${responseText}`);
    }

    // Guard against plain text "OK" responses
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`GitHub returned non-JSON response: "${responseText.trim()}"`);
    }

    if (!data.choices?.[0]?.message?.content) {
        throw new Error("Received empty or malformed completion payload from API.");
    }

    return data.choices[0].message.content;
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
