require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

// Keep Render web service awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';


const SYSTEM_PERSONALITY = `You are a strictly factual, highly precise Discord AI assistant for game queries and general information.

STRICT GROUNDING RULES:
1. ALWAYS respond strictly in English.
2. ALWAYS use the web_search tool when asked about specific game mechanics, weapon stats, talents, mantras, or item locations.
3. If the search results DO NOT contain the exact numbers, stats, or facts requested, state clearly: "I couldn't find verified database stats for that in the current search results." NEVER guess or invent RPG item names, talent requirements, scaling, or damage values.
4. Keep responses direct, clear, and under 1000 characters.`;

// Define the Web Search tool schema for Cohere
const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search the internet for live information, game stats, news, or factual data.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search query string."
                }
            },
            required: ["query"]
        }
    }
};

// Zero-dependency web fetcher using native Node fetch
// Universal MediaWiki Fetcher (Works for Wikipedia, Fandom, Deadlock Wiki, Deepwoken Wiki)
async function fetchWikiSnippet(baseUrl, query) {
    try {
        const searchEndpoint = `${baseUrl}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const res = await fetch(searchEndpoint, {
            headers: { 'User-Agent': 'DiscordAIBot/1.0 (contact@example.com)' }
        });

        if (!res.ok) return null;
        const data = await res.json();
        const results = data.query?.search;

        if (!results || results.length === 0) return null;

        // Clean out HTML tags returned by MediaWiki search snippets
        const snippets = results.slice(0, 3).map(item => {
            const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '').trim();
            return `[${item.title}]: ${cleanSnippet}`;
        });

        return snippets.join('\n\n');
    } catch (err) {
        return null;
    }
}

async function performWebSearch(query) {
    const q = query.toLowerCase();

    // 1. Deadlock-specific queries -> Deadlock Fandom & Deadlock.wiki
    if (q.includes('deadlock')) {
        const deadlockFandom = await fetchWikiSnippet('https://playdeadlock.fandom.com', query);
        if (deadlockFandom) return `--- Deadlock Wiki Results ---\n${deadlockFandom}`;

        const deadlockedWiki = await fetchWikiSnippet('https://deadlocked.wiki', query);
        if (deadlockedWiki) return `--- Deadlocked Wiki Results ---\n${deadlockedWiki}`;
    }

    // 2. Deepwoken-specific queries -> Deepwoken Fandom Wiki
    if (q.includes('deepwoken')) {
        const deepwokenFandom = await fetchWikiSnippet('https://deepwoken.fandom.com', query);
        if (deepwokenFandom) return `--- Deepwoken Wiki Results ---\n${deepwokenFandom}`;
    }

    // 3. Fallback / General Game Wiki -> Search across generic Fandom domains
    if (q.includes('build') || q.includes('stats') || q.includes('manga') || q.includes('anime')) {
        // Extract main topic word to attempt matching a fandom subdomain (e.g. "valorant")
        const words = query.split(' ').filter(w => w.length > 3);
        for (const word of words) {
            const genericFandom = await fetchWikiSnippet(`https://${word.toLowerCase()}.fandom.com`, query);
            if (genericFandom) return `--- ${word} Fandom Results ---\n${genericFandom}`;
        }
    }

    // 4. General Knowledge -> Wikipedia
    const wikipedia = await fetchWikiSnippet('https://en.wikipedia.org', query);
    if (wikipedia) return `--- Wikipedia Results ---\n${wikipedia}`;

    return "No relevant information found on Wikipedia or supported game wikis.";
}

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

    const messages = [
        { role: 'system', content: SYSTEM_PERSONALITY },
        ...conversationHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content
        }))
    ];

    // Step 1: Send request to Cohere with tool support
    let response = await cohere.chat({
        model: MODEL_NAME,
        messages: messages,
        tools: [webSearchTool],
        temperature: 0.1,
    });

    // Step 2: Check if Cohere requested a search tool call
    if (response.message?.toolCalls && response.message.toolCalls.length > 0) {
        messages.push(response.message);

        for (const toolCall of response.message.toolCalls) {
            if (toolCall.function?.name === 'web_search') {
                let args = {};
                try {
                    args = typeof toolCall.function.arguments === 'string' 
                        ? JSON.parse(toolCall.function.arguments) 
                        : toolCall.function.arguments;
                } catch (e) {
                    args = { query: '' };
                }

                console.log(`[Search Executing] Query: "${args.query}"`);
                const searchResults = await performWebSearch(args.query);

                messages.push({
                    role: 'tool',
                    toolCallId: toolCall.id,
                    content: searchResults
                });
            }
        }

        // Step 3: Trigger final completion with search results attached
        response = await cohere.chat({
            model: MODEL_NAME,
            messages: messages,
            tools: [webSearchTool],
            temperature: 0.1,
        });
    }

    // Step 4: Extract response text across blocks
    let textOutput = '';
    if (response.message?.content && Array.isArray(response.message.content)) {
        for (const block of response.message.content) {
            if (block.text) textOutput += block.text;
        }
    }

    if (!textOutput.trim()) {
        throw new Error("Received empty text output from Cohere API.");
    }

    return textOutput;
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
