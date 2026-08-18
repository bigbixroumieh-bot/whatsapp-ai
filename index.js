const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Mistral API Configuration
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || 'your_mistral_api_key';
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
});

// Generate QR code for authentication
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR code generated. Scan it with your phone to authenticate.');
});

// Ready event
client.on('ready', () => {
    console.log('Client is ready!');
});

// Listen for incoming messages
client.on('message', async (msg) => {
    const chatId = msg.from;
    const messageText = msg.body;

    console.log(`Received message from ${chatId}: ${messageText}`);

    // Call Mistral API to generate a response
    const mistralResponse = await callMistralAPI(messageText);
    console.log('Mistral response:', mistralResponse);

    // Send the response back to WhatsApp
    await msg.reply(mistralResponse);
});

// Call Mistral API to generate a response
async function callMistralAPI(prompt) {
    try {
        const response = await axios.post(
            MISTRAL_API_ENDPOINT,
            {
                model: 'mistral-tiny',
                messages: [
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

// Initialize the client
client.initialize();

// Handle process termination
process.on('SIGINT', () => {
    console.log('Shutting down...');
    client.destroy();
    process.exit(0);
});