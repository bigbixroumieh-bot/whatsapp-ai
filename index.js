const { Client, LocalAuth } = require('whatsapp-web.js');
const qr = require('qrcode');
const axios = require('axios');
const readline = require('readline');

// Mistral API Configuration
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || 'your_mistral_api_key';
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

// Track which chats have AI enabled
const aiEnabledChats = new Set();

// System prompt
let systemPrompt = "You are a helpful assistant.";

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

// Create readline interface for CLI
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Main menu
function showMenu() {
    console.log('
=== WhatsApp AI Bot ===');
    console.log('1. Start WhatsApp connection');
    console.log('2. Set system prompt');
    console.log('3. Exit');
    console.log('======================
');

    rl.question('Select an option: ', (answer) => {
        switch(answer) {
            case '1':
                startWhatsApp();
                break;
            case '2':
                setSystemPrompt();
                break;
            case '3':
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('Invalid option');
                showMenu();
        }
    });
}

// Set system prompt
function setSystemPrompt() {
    rl.question('Enter system prompt: ', (prompt) => {
        systemPrompt = prompt;
        console.log('System prompt updated');
        showMenu();
    });
}

// Start WhatsApp connection
function startWhatsApp() {
    console.log('
Initializing WhatsApp client...');

    client.on('qr', async (qrCode) => {
        console.log('
Scan this QR code with your phone:');
        try {
            const qrString = await qr.toString(qrCode, { type: 'terminal', small: true });
            console.log(qrString);
        } catch (err) {
            console.error('Error generating QR code:', err);
        }
    });

    client.on('ready', () => {
        console.log('
Client is ready!');
        console.log('Type @ai on in any WhatsApp chat to enable the AI for that chat.');
    });

    client.on('message', async (msg) => {
        const chatId = msg.from;
        const messageText = msg.body.trim();

        // Check for @ai on command
        if (messageText.toLowerCase() === '@ai on') {
            aiEnabledChats.add(chatId);
            await msg.reply('AI enabled for this chat. Type your messages and I will respond using Mistral AI.');
            return;
        }

        // Check if AI is enabled for this chat
        if (!aiEnabledChats.has(chatId)) {
            return;
        }

        console.log(`Received message from ${chatId}: ${messageText}`);

        // Call Mistral API to generate a response
        const mistralResponse = await callMistralAPI(messageText);
        console.log('Mistral response:', mistralResponse);

        // Send the response back to WhatsApp
        await msg.reply(mistralResponse);
    });

    client.initialize();
    console.log('WhatsApp client initialized. Waiting for QR code...');
}

// Call Mistral API
async function callMistralAPI(prompt) {
    try {
        const response = await axios.post(
            MISTRAL_API_ENDPOINT,
            {
                model: 'mistral-tiny',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${MISTRAL_API_KEY}`,
                },
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling Mistral API:', error.response?.data || error.message);
        return 'Sorry, I encountered an error processing your request.';
    }
}

// Handle process termination
process.on('SIGINT', () => {
    console.log('
Shutting down...');
    client.destroy();
    rl.close();
    process.exit(0);
});

// Start the application
console.log('WhatsApp AI Bot - CLI Version');
showMenu();