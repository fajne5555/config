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

const SYSTEM_PERSONALITY = `You are a concise, strictly factual Discord AI assistant with real-time web search capabilities.
RULES:
1. ALWAYS respond strictly in English.
2. If asked about current events, live stats, or specific game mechanics (such as Deepwoken) that require exact data, use the web_search tool.
3. Keep responses clear, accurate, and under 1000 characters.`;

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
async function performWebSearch(query) {
    try {
        const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) return "Search engine returned an error status.";

        const html = await response.text();
        const snippets = [];
        
        // Extract plain text snippets from HTML body
        const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(html)) !== null && snippets.length < 4) {
            const cleanText = match[1].replace(/<[^>]+>/g, '').trim();
            if (cleanText) snippets.push(cleanText);
        }

        return snippets.length > 0 ? snippets.join('\n') : "No search results returned for this query.";
    } catch (err) {
        console.error("Web search error:", err);
        return "Search failed due to network connection issues.";
    }
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
