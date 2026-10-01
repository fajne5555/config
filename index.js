require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

const SYSTEM_PERSONALITY = `You are a strictly factual assistant for game mechanics, builds, and items (Deepwoken, Deadlock).

RULES:
1. ALWAYS respond strictly in English.
2. NEVER invent fake builds, item names, or talent stats (e.g. Do NOT create fake classes like "Stalwart Defender").
3. When asked for builds, search for specific mechanics, weapons, attunements, or items associated with that game and combine the facts into a structured answer.
4. If search results do not explicitly contain requested stats, state clearly: "I couldn't find specific database details for that in the game wiki."`;

const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search game wikis for mechanics, builds, items, and stats.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" }
            },
            required: ["query"]
        }
    }
};

// Advanced MediaWiki Fetcher: Tries exact article parse first, falls back to full-text search snippets
async function fetchWikiPageContent(domain, query) {
    try {
        // Step 1: Search for page titles
        const searchUrl = `https://${domain}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const res1 = await fetch(searchUrl, { headers: { 'User-Agent': 'DiscordBot/1.0' } });
        if (!res1.ok) return null;
        
        const data1 = await res1.json();
        const searchResults = data1.query?.search;
        if (!searchResults || searchResults.length === 0) return null;

        const topResult = searchResults[0];

        // Step 2: Try to get exact page parse
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

        // Step 3: Fallback - combine snippets across top 3 search results if full page parse fails
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

    return "No relevant article content was found on the target wikis.";
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
        temperature: 0.0,
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

                console.log(`[Wiki Fetching Step ${turns}] Query: "${args.query}"`);
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
            temperature: 0.0,
        });
    }

    const textOutput = extractCohereText(response);

    if (!textOutput) {
        return "I retrieved wiki articles for that query, but I couldn't find specific database details matching your request.";
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
