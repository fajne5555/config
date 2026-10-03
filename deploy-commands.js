require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Ask the AI companion anything')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('What do you want to ask?')
                .setRequired(true)
        )
        // Enable User Installation and usage in DMs/Servers
        .setIntegrationTypes([0, 1]) // 0: Guild Install, 1: User Install
        .setContexts([0, 1, 2])      // 0: Guilds, 1: Bot DMs, 2: Private Channels/Group DMs
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Registering global slash commands...');
        
        // Fetch Client ID dynamically from bot token or set process.env.CLIENT_ID
        const clientUser = await rest.get(Routes.user());
        
        await rest.put(
            Routes.applicationCommands(clientUser.id),
            { body: commands }
        );

        console.log('Successfully registered global /chat slash command!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
})();
