require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

// Keep Render free instance awake
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

const SYSTEM_PERSONALITY = `You are a helpful Discord AI assistant with access to real-time web search.
RULES:
1. ALWAYS respond strictly in English.
2. If asked about current events, live information, or specific game stats/builds you do not know natively, use the web_search tool to verify facts.
3. Keep responses concise and under 1000 characters.`;

// Define the Web Search tool schema for Cohere v2
const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search the web for up-to-date information, news, game stats, or facts.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The search engine query."
                }
            },
            required: ["query"]
        }
    }
};

// Simple web fetcher helper (uses DuckDuckGo HTML scraping or standard search endpoint)
async function performWebSearch(query) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const html = await res.text();
        
        // Extract basic snippets from results
        const snippets = [];
        const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/g;
        let match;
        while ((match = regex.exec(html)) !== null && snippets.length < 3) {
            snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
        }
        
        return snippets.length > 0 ? snippets.join('\n') : "No relevant search results found.";
    } catch (err) {
        return "Search failed due to network error.";
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

    // Step 1: Call Cohere with tools enabled
    let response = await cohere.chat({
        model: MODEL_NAME,
        messages: messages,
        tools: [webSearchTool],
        temperature: 0.1,
    });

    // Step 2: Handle Tool Calls if Cohere requests a web search
    if (response.message?.toolCalls && response.message.toolCalls.length > 0) {
        // Append Cohere's assistant message with tool calls to history
        messages.push(response.message);

        for (const toolCall of response.message.toolCalls) {
            if (toolCall.function?.name === 'web_search') {
                const args = JSON.parse(toolCall.function.arguments || '{}');
                console.log(`[Tool Call] Searching web for: "${args.query}"`);
                
                const searchResults = await performWebSearch(args.query);

                // Pass search results back to Cohere
                messages.push({
                    role: 'tool',
                    toolCallId: toolCall.id,
                    content: searchResults
                });
            }
        }

        // Step 3: Call Cohere again with search results included to generate final text
        response = await cohere.chat({
            model: MODEL_NAME,
            messages: messages,
            tools: [webSearchTool],
            temperature: 0.1,
        });
    }

    // Parse final text response
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
