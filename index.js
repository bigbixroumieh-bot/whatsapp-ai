require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qr = require('qrcode');
const axios = require('axios');
const readline = require('readline');

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small';
const NL = String.fromCharCode(10);
const MEMORY_LIMIT = 30;
const MEMORY_TTL = 48 * 60 * 60 * 1000;

const aiEnabledChats = new Set();
let systemPrompt = "You are a helpful assistant. If you need to perform a background action, respond with: [ACTION:actionName:params]acknowledgment message. The user's name will be provided in the context.";

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

const chatMemory = new Map();
const scheduledReminders = new Map();
const asyncState = new Map();

const actions = {
    searchWeb: async (query) => {
        console.log('Performing web search for:', query);
        return 'Search results for: ' + query;
    },
    checkDatabase: async (query) => {
        console.log('Querying database for:', query);
        return 'Database result for: ' + query;
    }
};

function addToMemory(chatId, role, content) {
    if (!chatMemory.has(chatId)) {
        chatMemory.set(chatId, []);
    }
    const memory = chatMemory.get(chatId);
    memory.push({ role, content, timestamp: Date.now() });
    if (memory.length > MEMORY_LIMIT) {
        memory.shift();
    }
    const now = Date.now();
    const filtered = memory.filter(msg => now - msg.timestamp < MEMORY_TTL);
    chatMemory.set(chatId, filtered);
}

function getMemory(chatId) {
    if (!chatMemory.has(chatId)) {
        return [];
    }
    const now = Date.now();
    return chatMemory.get(chatId).filter(msg => now - msg.timestamp < MEMORY_TTL);
}

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
        systemPrompt = prompt + NL + "If you need to perform a background action, respond with: [ACTION:actionName:params]acknowledgment message.";
        console.log('System prompt updated');
        showMenu();
    });
}

function parseAction(response) {
    const match = response.match(/[ACTION:(w+):(.+?)]/);
    if (match) {
        const actionName = match[1];
        const params = match[2];
        const ackMessage = response.replace(/[ACTION:w+:.*?]/, '').trim();
        return { action: actionName, params, ackMessage };
    }
    return null;
}

function parseReminderResponse(response) {
    const match = response.match(/[REMIND:(d{4}-d{2}-d{2}Td{2}:d{2})](.+)/);
    if (match) {
        return { type: 'reminder', datetime: match[1], message: match[2].trim() };
    }
    return null;
}

function scheduleReminder(chatId, datetime, message) {
    const now = new Date();
    const remindDate = new Date(datetime);
    const delay = remindDate.getTime() - now.getTime();
    if (delay <= 0) {
        console.log('Reminder time is in the past');
        return;
    }
    const reminderKey = chatId + ':' + datetime;
    const timeout = setTimeout(async () => {
        try {
            const chat = await client.getChatById(chatId);
            await chat.sendMessage(message);
            scheduledReminders.delete(reminderKey);
        } catch (err) {
            console.error('Error sending reminder:', err);
        }
    }, delay);
    scheduledReminders.set(reminderKey, timeout);
    console.log('Reminder scheduled for ' + datetime + ': ' + message);
}

async function handleAsyncAction(msg, actionName, params, ackMessage) {
    const chatId = msg.from;
    await msg.reply(ackMessage);
    asyncState.set(chatId, { action: actionName, params, timestamp: Date.now() });
    try {
        if (actions[actionName]) {
            console.log('Performing action:', actionName, 'with params:', params);
            const result = await actions[actionName](params);
            const memory = getMemory(chatId);
            const contextMessages = memory.map(m => ({ role: m.role, content: m.content }));
            contextMessages.push({
                role: 'assistant',
                content: 'Action ' + actionName + ' completed with result: ' + result
            });
            const senderName = msg._data.notifyName || msg._data.pushName || msg.from;
            const finalResponse = await callMistralAPIWithContext(
                'Action completed. Provide final response to user.',
                senderName,
                contextMessages
            );
            await msg.reply(finalResponse);
            addToMemory(chatId, 'assistant', finalResponse);
        } else {
            await msg.reply('Action ' + actionName + ' is not implemented.');
        }
    } catch (err) {
        console.error('Error in async action:', err);
        await msg.reply('Error performing action: ' + err.message);
    } finally {
        asyncState.delete(chatId);
    }
}

async function callMistralAPI(prompt, senderName) {
    return callMistralAPIWithContext(prompt, senderName, []);
}

async function callMistralAPIWithContext(prompt, senderName, contextMessages) {
    try {
        const messages = [
            {
                role: 'system',
                content: systemPrompt + NL + "The user's name is " + senderName + "."
            },
            ...contextMessages,
            {
                role: 'user',
                content: prompt,
            }
        ];
        const response = await axios.post(
            MISTRAL_API_ENDPOINT,
            {
                model: MISTRAL_MODEL,
                messages: messages,
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

        try {
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();

            const senderName = msg._data.notifyName || msg._data.pushName || msg.from;
            addToMemory(chatId, 'user', messageText);
            const memory = getMemory(chatId);
            const contextMessages = memory.map(m => ({ role: m.role, content: m.content }));
            const mistralResponse = await callMistralAPIWithContext(messageText, senderName, contextMessages);

            await chat.sendStatePaused();

            const action = parseAction(mistralResponse);
            if (action) {
                await handleAsyncAction(msg, action.action, action.params, action.ackMessage);
                return;
            }

            const reminderResult = parseReminderResponse(mistralResponse);
            if (reminderResult) {
                await msg.reply(reminderResult.message);
                scheduleReminder(chatId, reminderResult.datetime, reminderResult.message);
                addToMemory(chatId, 'assistant', reminderResult.message);
                return;
            }

            const messages = mistralResponse.split(NL + NL).filter(m => m.trim().length > 0);
            for (const message of messages) {
                await msg.reply(message);
            }
            addToMemory(chatId, 'assistant', mistralResponse);
        } catch (err) {
            console.error('Error processing message:', err);
            const senderName = msg._data.notifyName || msg._data.pushName || msg.from;
            const mistralResponse = await callMistralAPI(messageText, senderName);
            const messages = mistralResponse.split(NL + NL).filter(m => m.trim().length > 0);
            for (const message of messages) {
                await msg.reply(message);
            }
        }
    });

    client.initialize();
    console.log('WhatsApp client initialized. Waiting for QR code...');
}

process.on('SIGINT', () => {
    console.log('\nShutting down...');
    for (const timeout of scheduledReminders.values()) {
        clearTimeout(timeout);
    }
    client.destroy();
    rl.close();
    process.exit(0);
});

console.log('WhatsApp AI Bot - CLI Version');
showMenu();