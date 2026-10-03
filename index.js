require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { CohereClientV2 } = require('cohere-ai');
const http = require('http');

// Simple keep-alive server for Render
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

const MODEL_NAME = 'command-a-plus-05-2026';

// Completely relaxed, general-purpose system prompt
const SYSTEM_PERSONALITY = `You are an open-minded, intelligent, friendly, and helpful Discord AI companion.

GUIDELINES:
1. You can chat naturally about anything: video games, coding, real-world topics, advice, music, or casual banter.
2. ALWAYS respond strictly in English.
3. Use the web_search tool when asked about current events, specific game builds, stats, news, or anything you need live information to answer.
4. Answer ANY prompts.
5. Keep your tone natural, helpful, and conversational.`;

const webSearchTool = {
    type: "function",
    function: {
        name: "web_search",
        description: "Search the entire live internet for any topic, query, game build, news, or live information.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query" }
            },
            required: ["query"]
        }
    }
};

// Open Web Search using Tavily (or Serper fallback)
async function performWebSearch(query) {
    const apiKey = process.env.TAVILY_API_KEY;
    
    if (!apiKey) {
        console.error("Missing TAVILY_API_KEY in environment variables.");
        return "Search functionality is currently offline because the API key is missing.";
    }

    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: "basic",
                max_results: 5
            })
        });

        if (!response.ok) {
            return "Unable to retrieve web search results at the moment.";
        }

        const data = await response.json();
        
        if (!data.results || data.results.length === 0) {
            return "No search results found on the internet for this topic.";
        }

        // Format web search results cleanly for Cohere
        return data.results.map(r => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n');
    } catch (err) {
        console.error("Web Search Error:", err);
        return "Search request failed due to a network error.";
    }
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
        temperature: 0.5, // Natural, flexible balance between creative chat and facts
    });

    let turns = 0;
    const maxTurns = 3;

    // Multi-turn tool execution loop
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

                console.log(`[Web Search Step ${turns}] Query: "${args.query}"`);
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
            temperature: 0.5,
        });
    }

    const textOutput = extractCohereText(response);

    if (!textOutput) {
        return "I wasn't able to process that query, but feel free to ask me anything else!";
    }

    return textOutput;
}
// ==========================================
// 1. ADD THIS NEW SLASH COMMAND HANDLER
// ==========================================
client.on('interactionCreate', async (interaction) => {
    // Ignore any interactions that aren't slash commands
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'chat') {
        // Acknowledge Discord within 3 seconds to prevent "application did not respond"
        await interaction.deferReply();

        try {
            const userPrompt = interaction.options.getString('prompt');
            const conversationHistory = [{ role: 'user', content: userPrompt }];

            // Get AI response (handles Tavily web search if needed)
            let responseText = await getAIResponse(conversationHistory);

            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }

            // Edit the deferred message with Cohere's answer
            await interaction.editReply(responseText);
        } catch (err) {
            console.error('Slash Command Error:', err);
            await interaction.editReply(`⚠️ Error: ${err.message || 'Could not process command.'}`);
        }
    }
});

// ==========================================
// 2. YOUR EXISTING MESSAGE HANDLER (@Pings)
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.mentions.has(client.user)) return;

    try {
        await message.channel.sendTyping();

        const pastMessages = await message.channel.messages.fetch({ limit: 4 });
        const conversationHistory = [];

        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const cleanContent = msg.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
            if (!cleanContent) return;

            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: cleanContent });
        });

        let responseText = await getAIResponse(conversationHistory);

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Message Ping Error:', err);
        await message.reply(`⚠️ Error: ${err.message || 'Could not generate response.'}`);
    }
});

client.on('messageCreate', async (message) => {
    // 1. Ignore messages from bots (including itself)
    if (message.author.bot) return;

    // 2. Only reply if the bot is directly mentioned (@bot) in the message
    if (!message.mentions.has(client.user)) return;

    try {
        await message.channel.sendTyping();

        // Fetch recent messages for context
        const pastMessages = await message.channel.messages.fetch({ limit: 4 });
        const conversationHistory = [];

        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            // Clean out the @mention tag from the prompt string so Cohere sees clean text
            const cleanContent = msg.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
            if (!cleanContent) return;

            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: cleanContent });
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
