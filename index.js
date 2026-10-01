require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const { search } = require('duckduckgo-search');
const http = require('http');

// Keep Render service alive via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// High-quality models for factual reasoning
const PREFERRED_MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant'
];

const SYSTEM_PERSONALITY = `You are an accurate, helpful Discord AI assistant.
RULES:
1. ALWAYS reply strictly in English unless explicitly asked otherwise.
2. Use the provided SEARCH RESULTS to answer accurately. Never invent or hallucinate game mechanics, stats, items, or names.
3. If you do not have search results or aren't 100% sure, clearly admit "I don't have exact data on that" instead of guessing.
4. Keep responses clear, accurate, and under 800 characters.`;

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

// Helper function to fetch web search context
async function getSearchContext(query) {
    try {
        const searchResults = await search(query, { safeSearch: 'STRICT' });
        if (searchResults && searchResults.results && searchResults.results.length > 0) {
            const topResults = searchResults.results.slice(0, 3);
            return topResults.map(r => `Source (${r.title}): ${r.snippet}`).join('\n\n');
        }
    } catch (err) {
        console.warn('Web search failed or timed out:', err.message);
    }
    return '';
}

async function getGroqResponse(conversationHistory, searchContext) {
    let lastError = null;

    // Inject web search context into system instructions if available
    const systemInstruction = searchContext
        ? `${SYSTEM_PERSONALITY}\n\nREAL-TIME WEB SEARCH RESULTS FOR THIS QUERY:\n${searchContext}`
        : SYSTEM_PERSONALITY;

    for (const modelName of PREFERRED_MODELS) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemInstruction },
                    ...conversationHistory
                ],
                model: modelName,
                temperature: 0.1, // Near-zero temperature for strict grounding
                max_tokens: 500
            });

            const text = completion.choices[0]?.message?.content;
            if (text) return text;
        } catch (err) {
            console.warn(`[Groq] Model ${modelName} failed (${err.status || err.message}), trying next...`);
            lastError = err;
        }
    }

    throw lastError || new Error('All configured Groq models failed.');
}

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // 1. Fetch search context for the user's latest prompt
        const searchContext = await getSearchContext(message.content);

        // 2. Fetch last 3 messages for conversational memory
        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 3. Generate grounded response
        let responseText = await getGroqResponse(conversationHistory, searchContext);

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
