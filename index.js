const axios = require('axios');
const fs = require('fs');
const readline = require('readline-sync');

// Global Configuration
let config = {
    cookies: '',
    threadId: '',
    prefix: '',
    delay: 5,
    messages: []
};

async function setup() {
    console.log("=== FAIZU TOOL NODE.JS EDITION ===");
    
    config.cookies = readline.question('Enter Facebook Cookies (datr=...): ');
    config.threadId = readline.question('Enter Thread ID: ');
    config.prefix = readline.question('Enter Prefix (Hater Name): ');
    const filePath = readline.question('Enter Message File Path (e.g., msg.txt): ');
    config.delay = parseInt(readline.question('Enter Delay in Seconds: ')) * 1000;

    try {
        const data = fs.readFileSync(filePath, 'utf8');
        config.messages = data.split(/\r?\n/).filter(line => line.trim() !== "");
    } catch (err) {
        console.error("Error reading file:", err.message);
        process.exit(1);
    }

    console.log("\n[!] Starting Bot in Background...");
    startSender();
}

// Function to extract fb_dtsg (Security Token)
async function getFbDtsg() {
    try {
        const response = await axios.get(`https://mbasic.facebook.com/messages/t/${config.threadId}`, {
            headers: {
                'Cookie': config.cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });

        // Regex to find fb_dtsg value
        const fbDtsgMatch = response.data.match(/name="fb_dtsg" value="(.*?)"/);
        const jazoestMatch = response.data.match(/name="jazoest" value="(.*?)"/);

        if (fbDtsgMatch) {
            return {
                fb_dtsg: fbDtsgMatch[1],
                jazoest: jazoestMatch ? jazoestMatch[1] : ''
            };
        }
    } catch (error) {
        console.error("[!] Cookie Expired or Connection Error");
    }
    return null;
}

async function sendMessage(fbDtsgObj, message) {
    const url = `https://mbasic.facebook.com/messages/send/?icm=1`;
    const fullMsg = `${config.prefix} ${message}`;
    
    // Facebook mobile form data
    const params = new URLSearchParams();
    params.append('fb_dtsg', fbDtsgObj.fb_dtsg);
    params.append('jazoest', fbDtsgObj.jazoest);
    params.append('body', fullMsg);
    params.append('send', 'Send');
    params.append(`tids`, `cid.c.${config.threadId}`);

    try {
        const res = await axios.post(url, params, {
            headers: {
                'Cookie': config.cookies,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Referer': `https://mbasic.facebook.com/messages/t/${config.threadId}`
            }
        });

        if (res.status === 200) {
            console.log(`[SUCCESS] ${new Date().toLocaleTimeString()} | Sent: ${fullMsg}`);
        }
    } catch (error) {
        console.log(`[FAILED] Error sending message: ${error.message}`);
    }
}

async function startSender() {
    let index = 0;

    while (true) {
        if (index >= config.messages.length) index = 0; // Loop back to start

        const tokens = await getFbDtsg();
        
        if (tokens) {
            await sendMessage(tokens, config.messages[index]);
            index++;
        } else {
            console.log("[!] Retrying in 30 seconds... (Check your cookie)");
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
        }

        // Wait for the specified delay
        await new Promise(resolve => setTimeout(resolve, config.delay));
    }
}

// Start the app
setup();
