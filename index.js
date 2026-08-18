require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qr = require('qrcode');
const axios = require('axios');
const readline = require('readline');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small';

const aiEnabledChats = new Set();
let systemPrompt = "You are a helpful assistant.";

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function showMenu() {
    console.log('\n=== WhatsApp AI Bot ===');
    console.log('1. Start WhatsApp connection');
    console.log('2. Set system prompt');
    console.log('3. Exit');
    console.log('======================\n');

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

function setSystemPrompt() {
    rl.question('Enter system prompt: ', (prompt) => {
        systemPrompt = prompt;
        console.log('System prompt updated');
        showMenu();
    });
}

function startWhatsApp() {
    console.log('\nInitializing WhatsApp client...');

    client.on('qr', async (qrCode) => {
        console.log('\nScan this QR code with your phone:');
        try {
            const qrString = await qr.toString(qrCode, { type: 'terminal', small: true });
            console.log(qrString);
        } catch (err) {
            console.error('Error generating QR code:', err);
        }
    });

    client.on('ready', () => {
        console.log('\nClient is ready!');
        console.log('Type @ai on in any WhatsApp chat to enable the AI for that chat.');
    });

    client.on('message', async (msg) => {
        const chatId = msg.from;
        const messageText = msg.body.trim();

        if (messageText.toLowerCase() === '@ai on') {
            aiEnabledChats.add(chatId);
            await msg.reply('AI enabled for this chat. Type your messages and I will respond using Mistral AI.');
            return;
        }

        if (!aiEnabledChats.has(chatId)) {
            return;
        }

        console.log('Received message from ' + chatId + ': ' + messageText);

        // Send acknowledgment message first
        await msg.reply("Sure! I'll check for you");

        // Then process and send the actual response
        const mistralResponse = await callMistralAPI(messageText);
        console.log('Mistral response:', mistralResponse);
        await msg.reply(mistralResponse);
    });

    client.initialize();
    console.log('WhatsApp client initialized. Waiting for QR code...');
}

async function callMistralAPI(prompt) {
    try {
        const response = await axios.post(
            MISTRAL_API_ENDPOINT,
            {
                model: MISTRAL_MODEL,
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
                    'Authorization': 'Bearer ' + MISTRAL_API_KEY,
                },
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling Mistral API:', error.response?.data || error.message);
        return 'Sorry, I encountered an error processing your request.';
    }
}

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.destroy();
    rl.close();
    process.exit(0);
});

console.log('WhatsApp AI Bot - CLI Version');
showMenu();