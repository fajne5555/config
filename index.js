require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Groq = require('groq-sdk');
const http = require('http');

// Simple HTTP endpoint to keep Render awake via UptimeRobot
http.createServer((req, res) => res.end('Bot is active!')).listen(process.env.PORT || 3000);

// Initialize Groq SDK
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
    // Prevent infinite loops by ignoring the bot's own messages
    if (message.author.id === client.user.id) return;

    try {
        await message.channel.sendTyping();

        // Request chat completion from Groq (Llama 3.3 70B)
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are a witty, helpful Discord AI assistant. Keep responses engaging and under 500 characters.'
                },
                {
                    role: 'user',
                    content: message.content
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            max_tokens: 500
        });

        let responseText = completion.choices[0]?.message?.content;

        if (responseText) {
            // Trim if response exceeds Discord's 2000 character limit
            if (responseText.length > 1900) {
                responseText = responseText.substring(0, 1900) + '...';
            }
            await message.reply(responseText);
        }
    } catch (err) {
        console.error('Error running bot:', err);
        
        if (err.status === 429) {
            await message.reply('⚠️ Rate limit reached. Please wait a few seconds before asking again.');
        } else {
            await message.reply(`⚠️ Error: ${err.message || 'Could not generate response.'}`);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
