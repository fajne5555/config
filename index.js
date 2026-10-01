require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Keep Render service awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PREFERRED_MODELS = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant'
];

const SYSTEM_PERSONALITY = `You are an accurate, highly knowledgeable Discord AI assistant.
RULES:
1. ALWAYS reply strictly in English unless explicitly asked otherwise.
2. Use the provided SEARCH / WIKI CONTEXT to answer questions accurately.
3. NEVER make up game stats, items, talents, or mechanics that do not exist. If you don't know exact game values, explicitly say "I don't have exact stats for that build/item" rather than hallucinating generic RPG tropes.
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

// Helper function to fetch live DuckDuckGo search context natively
async function fetchWebContext(query) {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url);
        const data = await res.json();
        
        let context = '';
        if (data.AbstractText) {
            context += `Abstract: ${data.AbstractText}\n`;
        }
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            const snippets = data.RelatedTopics
                .filter(t => t.Text)
                .slice(0, 3)
                .map(t => t.Text)
                .join('\n');
            context += `Related Info:\n${snippets}`;
        }
        return context.trim();
    } catch (err) {
        console.warn('Web lookup failed:', err.message);
        return '';
    }
}

async function getGroqResponse(conversationHistory, webContext) {
    let lastError = null;

    const systemInstruction = webContext
        ? `${SYSTEM_PERSONALITY}\n\nREAL-TIME REFERENCE DATA:\n${webContext}`
        : SYSTEM_PERSONALITY;

    for (const modelName of PREFERRED_MODELS) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemInstruction },
                    ...conversationHistory
                ],
                model: modelName,
                temperature: 0.1, // Near-zero temperature prevents making up fake names
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

        // 1. Fetch web search context
        const webContext = await fetchWebContext(message.content);

        // 2. Fetch last 3 messages for conversational context
        const pastMessages = await message.channel.messages.fetch({ limit: 3 });
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 3. Generate response
        let responseText = await getGroqResponse(conversationHistory, webContext);

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
