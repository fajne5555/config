require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

const SYSTEM_PERSONALITY = `You are a strictly factual assistant for game mechanics, builds, and items.

RULES:
1. ALWAYS respond strictly in English.
2. NEVER invent fake builds, item names, talent stats, or mechanics.
3. ALWAYS use the web_search tool when asked about items, game builds, stats, or mechanics.
4. If the search context does not explicitly list the requested item stats or mechanics, state clearly: "I couldn't find specific database details for that in the game wiki search results."`;

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

        // Truncate to 1200 chars to avoid overloading Cohere's output parser
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

    if (q.includes('deepwoken') || q.includes('build') || q.includes('talent') || q.includes('mantra')) {
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
    
    // Check message content array
    if (response.message?.content && Array.isArray(response.message.content)) {
        for (const block of response.message.content) {
            if (block.type === 'text' && block.text) {
                output += block.text;
            } else if (block.text) {
                output += block.text;
            }
        }
    }
    
    // Fallback check for single text string field
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

    if (response.message?.toolCalls && response.message.toolCalls.length > 0) {
        messages.push(response.message);

        for (const toolCall of response.message.toolCalls) {
            if (toolCall.function?.name === 'web_search') {
                let args = {};
                try {
                    args = typeof toolCall.function.arguments === 'string' 
                        ? JSON.parse(toolCall.function.arguments) 
                        : toolCall.function.arguments;
                } catch (e) { args = { query: '' }; }

                console.log(`[Wiki Fetching] Query: "${args.query}"`);
                const searchResults = await performWebSearch(args.query);

                messages.push({
                    role: 'tool',
                    toolCallId: toolCall.id,
                    content: searchResults
                });
            }
        }

        // Second API call following tool execution
        response = await cohere.chat({
            model: MODEL_NAME,
            messages: messages,
            tools: [webSearchTool],
            temperature: 0.0,
        });
    }

    const textOutput = extractCohereText(response);

    if (!textOutput) {
        console.error("Empty text error payload debug:", JSON.stringify(response, null, 2));
        return "I retrieved the wiki page, but I couldn't extract direct factual details for that specific query.";
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

    // Loop to support multi-step tool calls (e.g. Cohere refining its search query)
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

        // Execute follow-up request to Cohere
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
