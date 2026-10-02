require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

// Friendly, open persona for general chat + accurate facts
const SYSTEM_PERSONALITY = `You are a friendly, intelligent, and helpful Discord AI companion.

BEHAVIOR RULES:
1. You can chat about anything, answer general questions, give advice, or help with gaming (including games like Deepwoken, Deadlock, Valorant, etc.).
2. ALWAYS respond strictly in English.
3. Keep responses conversational, clear, and engaging.
4. Use the web_search tool ONLY when you need real-time data, specific patch notes, exact item stats, or facts you aren't sure about.
5. Never invent or guess fake stats, RPG talent values, or item names. If search results don't contain exact numbers, be honest and state what you know or offer general advice.`;

const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search Wikipedia, Fandom wikis, or topic endpoints for live facts, game data, or information.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" }
            },
            required: ["query"]
        }
    }
};

// Flexible Multi-Source Search Engine
async function fetchWikiPageContent(domain, query) {
    try {
        const searchUrl = `https://${domain}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const res1 = await fetch(searchUrl, { headers: { 'User-Agent': 'DiscordBot/1.0' } });
        if (!res1.ok) return null;
        
        const data1 = await res1.json();
        const searchResults = data1.query?.search;
        if (!searchResults || searchResults.length === 0) return null;

        const topResult = searchResults[0];

        // Try full article parse first
        const parseUrl = `https://${domain}/api.php?action=parse&page=${encodeURIComponent(topResult.title)}&prop=text&format=json&origin=*`;
        const res2 = await fetch(parseUrl, { headers: { 'User-Agent': 'DiscordBot/1.0' } });
        
        if (res2.ok) {
            const data2 = await res2.json();
            const rawHtml = data2.parse?.text?.['*'];
            if (rawHtml) {
                const cleanText = rawHtml
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (cleanText.length > 100) {
                    return `[Source: ${domain} - Page: ${topResult.title}]\n${cleanText.substring(0, 1200)}`;
                }
            }
        }

        // Snippet fallback
        const snippets = searchResults.slice(0, 3).map(r => {
            const cleanSnippet = r.snippet.replace(/<[^>]+>/g, '').trim();
            return `Result (${r.title}): ${cleanSnippet}`;
        });

        return `[Source: ${domain} Snippets]\n${snippets.join('\n\n')}`;
    } catch (e) {
        return null;
    }
}

async function performWebSearch(query) {
    const q = query.toLowerCase();

    // Game Specific Routes
    if (q.includes('deadlock') || q.includes('spirit power')) {
        const result = await fetchWikiPageContent('playdeadlock.fandom.com', query) 
            || await fetchWikiPageContent('deadlocked.wiki', query);
        if (result) return result;
    }

    if (q.includes('deepwoken') || q.includes('shadowcast')) {
        const result = await fetchWikiPageContent('deepwoken.fandom.com', query);
        if (result) return result;
    }

    // Dynamic Fandom Route for other games/topics
    const words = query.split(' ').filter(w => w.length > 3);
    for (const word of words) {
        const fandomResult = await fetchWikiPageContent(`${word.toLowerCase()}.fandom.com`, query);
        if (fandomResult) return fandomResult;
    }

    // General Knowledge Route (Wikipedia)
    const wikiContent = await fetchWikiPageContent('en.wikipedia.org', query);
    if (wikiContent) return wikiContent;

    return "No direct articles or search snippets were found for this topic.";
}

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
        temperature: 0.3, // Slightly higher for friendly, natural chatting
    });

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

                console.log(`[Search Executing] Query: "${args.query}"`);
                const searchResults = await performWebSearch(args.query);

                messages.push({
                    role: 'tool',
                    toolCallId: toolCall.id,
                    content: searchResults
                });
            }
        }

        response = await cohere.chat({
            model: MODEL_NAME,
            messages: messages,
            tools: [webSearchTool],
            temperature: 0.3,
        });
    }

    const textOutput = extractCohereText(response);

    if (!textOutput) {
        return "I'm having trouble retrieving details on that right now, but feel free to ask me anything else!";
    }

    return textOutput;
}

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        const pastMessages = await message.channel.messages.fetch({ limit: 4 });
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
