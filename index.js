require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// High-quality primary model for minimal hallucination
const PRIMARY_MODEL = 'llama-3.3-70b-versatile';

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

client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // 1. Fetch the last 10 messages from the channel for conversation context
        const pastMessages = await message.channel.messages.fetch({ limit: 10 });
        
        // 2. Format history chronologically into Groq format
        const conversationHistory = [];
        pastMessages.reverse().forEach(msg => {
            if (!msg.content) return;
            const role = msg.author.id === client.user.id ? 'assistant' : 'user';
            conversationHistory.push({ role, content: msg.content });
        });

        // 3. Inject strict System Persona instructions
        const systemPrompt = {
            role: 'system',
            content: 'You are a smart, engaging Discord assistant. ALWAYS reply strictly in English unless explicitly asked otherwise. Answer factual queries accurately.'
        };

        const completion = await groq.chat.completions.create({
            messages: [systemPrompt, ...conversationHistory],
            model: PRIMARY_MODEL,
            temperature: 0.6,
            max_tokens: 600
        });

        let responseText = completion.choices[0]?.message?.content;

        if (responseText) {
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        await message.reply(`⚠️ ${err.message || 'Error generating response.'}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
