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

const SYSTEM_PERSONALITY = `You are a strictly factual assistant for game mechanics, builds, and items.

RULES:
1. ALWAYS respond strictly in English.
2. NEVER invent fake builds, item names, talent stats, or mechanics.
3. ALWAYS use the web_search tool when asked about items, game builds, stats, or mechanics.`;

const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Fetch full wiki article content for games and general queries.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" }
            },
            required: ["query"]
        }
    }
};

// Fetches exact parsed text of top matching wiki page with clean truncation
async function fetchWikiPageContent(domain, query) {
    try {
        const searchUrl = `https://${domain}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const res1 = await fetch(searchUrl, { headers: { 'User-Agent': 'DiscordBot/1.0' } });
        if (!res1.ok) return null;
        
        const data1 = await res1.json();
        const topResult = data1.query?.search?.[0];
        if (!topResult) return null;

        const parseUrl = `https://${domain}/api.php?action=parse&page=${encodeURIComponent(topResult.title)}&prop=text&format=json&origin=*`;
        const res2 = await fetch(parseUrl, { headers: { 'User-Agent': 'DiscordBot/1.0' } });
        if (!res2.ok) return null;

        const data2 = await res2.json();
        const rawHtml = data2.parse?.text?.['*'];
        if (!rawHtml) return null;

        const cleanText = rawHtml
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return `[Source: ${domain} - Page: ${topResult.title}]\n${cleanText.substring(0, 1200)}`;
    } catch (e) {
        return null;
    }
}

async function performWebSearch(query) {
    const q = query.toLowerCase();

    if (q.includes('deadlock') || q.includes('spirit power') || q.includes('spirit item')) {
        const deadlockFandom = await fetchWikiPageContent('playdeadlock.fandom.com', query);
        if (deadlockFandom) return deadlockFandom;

        const deadlocked = await fetchWikiPageContent('deadlocked.wiki', query);
        if (deadlocked) return deadlocked;
    }

    if (q.includes('deepwoken') || q.includes('build') || q.includes('talent') || q.includes('mantra') || q.includes('shadowcast')) {
        const deepwokenFandom = await fetchWikiPageContent('deepwoken.fandom.com', query);
        if (deepwokenFandom) return deepwokenFandom;
    }

    const wikiContent = await fetchWikiPageContent('en.wikipedia.org', query);
    if (wikiContent) return wikiContent;

    return "No relevant full article content was found on the target wikis.";
}

// Safely extracts text from any block in Cohere v2 response structure
function extractCohereText(response) {
    let output = '';
    
    if (response.message?.content && Array.isArray(response.message.content)) {
        for (const block of response.message.content) {
            if (block.type === 'text' && block.text) {
                output += block.text;
            } else if (block.text) {
                output += block.text;
            }
        }
    }
    
    if (!output && typeof response.message?.content === 'string') {
        output = response.message.content;
    }

    return output.trim();
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

    let response = await cohere.chat({
        model: MODEL_NAME,
        messages: messages,
        tools: [webSearchTool],
        temperature: 0.0,
    });

    // Handle multi-step tool calls (e.g. Cohere refining its search query)
    let turns = 0;
    const maxTurns = 3;

    while (response.finishReason === 'TOOL_CALL' && response.message?.toolCalls?.length > 0 && turns < maxTurns) {
        turns++;
        messages.push(response.message);

        for (const toolCall of response.message.toolCalls) {
            if (toolCall.function?.name === 'web_search') {
                let args = {};
                try {
                    args = typeof toolCall.function.arguments === 'string' 
                        ? JSON.parse(toolCall.function.arguments) 
                        : toolCall.function.arguments;
                } catch (e) { args = { query: '' }; }

                console.log(`[Wiki Fetching Step ${turns}] Query: "${args.query}"`);
                const searchResults = await performWebSearch(args.query);

                messages.push({
                    role: 'tool',
                    toolCallId: toolCall.id,
                    content: searchResults
                });
            }
        }

        // Trigger follow-up Cohere completion after feeding back search result
        response = await cohere.chat({
            model: MODEL_NAME,
            messages: messages,
            tools: [webSearchTool],
            temperature: 0.0,
        });
    }

    const textOutput = extractCohereText(response);

    if (!textOutput) {
        return "I retrieved wiki articles for that query, but I couldn't find specific database stats matching your request.";
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
