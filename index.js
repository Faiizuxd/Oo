// save as server.js
// npm install express ws axios w3-fca uuid

const fs = require('fs');
const express = require('express');
const wiegine = require('ws3-fca'); // CHANGED: w3-fca instead of fca-mafiya
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5941;

// NO PERSISTENT STORAGE - MEMORY ONLY
let activeTasks = new Map();

// AUTO CONSOLE CLEAR SETUP
let consoleClearInterval;
function setupConsoleClear() {
    // Clear console every 30 minutes
    consoleClearInterval = setInterval(() => {
        console.clear();
        console.log(`🔄 Console cleared at: ${new Date().toLocaleTimeString()}`);
        console.log(`🚀 Server running smoothly - ${activeTasks.size} active tasks`);
        console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    }, 30 * 60 * 1000); // 30 minutes
}

// Modified Task class to handle multiple cookies
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        
        // Parse multiple cookies from userData
        this.cookies = this.parseCookies(userData.cookieContent);
        this.currentCookieIndex = -1; // Start from -1 taki first message pe 0 index mile
        
        this.config = {
            prefix: '',
            delay: userData.delay || 5,
            running: false,
            apis: [], // Array to hold multiple APIs for multiple cookies
            repeat: true,
            lastActivity: Date.now(),
            restartCount: 0,
            maxRestarts: 1000
        };
        this.messageData = {
            threadID: userData.threadID,
            messages: [],
            currentIndex: 0,
            loopCount: 0
        };
        this.stats = {
            sent: 0,
            failed: 0,
            activeCookies: 0,
            totalCookies: this.cookies.length,
            loops: 0,
            restarts: 0,
            lastSuccess: null,
            cookieUsage: Array(this.cookies.length).fill(0) // Track usage per cookie
        };
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 50;
        this.initializeMessages(userData.messageContent, userData.hatersName, userData.lastHereName);
    }

    // NEW METHOD: Parse multiple cookies from content
    parseCookies(cookieContent) {
        const cookies = [];
        
        // Split by new lines
        const lines = cookieContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        // Check if it's JSON format or raw cookie
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            try {
                // Try to parse as JSON
                const parsed = JSON.parse(line);
                cookies.push(line); // Keep as JSON string
            } catch {
                // If not JSON, treat as raw cookie
                cookies.push(line);
            }
        }
        
        return cookies;
    }

    initializeMessages(messageContent, hatersName, lastHereName) {
        this.messageData.messages = messageContent
            .split('\n')
            .map(line => line.replace(/\r/g, '').trim())
            .filter(line => line.length > 0)
            .map(message => `${hatersName} ${message} ${lastHereName}`);
        
        this.addLog(`Loaded ${this.messageData.messages.length} formatted messages`);
        this.addLog(`Detected ${this.cookies.length} cookies in file`, 'info');
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' }),
            message: message,
            type: messageType
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: messageType
        });
    }

    healthCheck() {
        return Date.now() - this.config.lastActivity < 300000;
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task is already running', 'info');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;
        
        if (this.messageData.messages.length === 0) {
            this.addLog('No messages found in the file', 'error');
            this.config.running = false;
            return false;
        }

        this.addLog(`Starting task with ${this.messageData.messages.length} messages and ${this.cookies.length} cookies`);
        
        // Initialize all cookies
        return this.initializeAllBots();
    }

    // MODIFIED METHOD: Initialize all bots for all cookies with sequential login
    initializeAllBots() {
        return new Promise((resolve) => {
            let currentIndex = 0;
            const totalCookies = this.cookies.length;
            
            const loginNextCookie = () => {
                if (currentIndex >= totalCookies) {
                    // All cookies processed
                    if (this.stats.activeCookies > 0) {
                        this.addLog(`✅ ${this.stats.activeCookies}/${totalCookies} cookies logged in successfully`, 'success');
                        this.startSending();
                        resolve(true);
                    } else {
                        this.addLog('❌ All cookies failed to login', 'error');
                        resolve(false);
                    }
                    return;
                }
                
                const cookieIndex = currentIndex;
                const cookieContent = this.cookies[cookieIndex];
                
                // Delay between logins to avoid conflicts
                setTimeout(() => {
                    this.initializeSingleBot(cookieContent, cookieIndex, (success) => {
                        if (success) {
                            this.stats.activeCookies++;
                        }
                        currentIndex++;
                        loginNextCookie();
                    });
                }, cookieIndex * 2000); // 2 second delay between each login
            };
            
            loginNextCookie();
        });
    }

    // MODIFIED METHOD: Initialize single bot with better error handling
    initializeSingleBot(cookieContent, index, callback) {
        this.addLog(`Attempting login for Cookie ${index + 1}...`, 'info');
        
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false,
            online: true
        }, (err, api) => {
            if (err || !api) {
                this.addLog(`❌ Cookie ${index + 1} login failed: ${err ? err.message : 'Unknown error'}`, 'error');
                this.config.apis[index] = null;
                callback(false);
                return;
            }

            this.config.apis[index] = api;
            this.addLog(`✅ Cookie ${index + 1} logged in successfully`, 'success');
            
            // Store the API for this cookie
            this.config.apis[index] = api;
            
            // Setup error handling for this API
            this.setupApiErrorHandling(api, index);
            
            // Get group info
            this.getGroupInfo(api, this.messageData.threadID, index);
            
            callback(true);
        });
    }

    setupApiErrorHandling(api, index) {
        if (api && typeof api.listen === 'function') {
            try {
                api.listen((err, event) => {
                    if (err && this.config.running) {
                        // If this API fails, mark it as inactive
                        this.config.apis[index] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        this.addLog(`⚠️ Cookie ${index + 1} disconnected, will retry`, 'warning');
                        
                        // Try to re-login this cookie after delay
                        setTimeout(() => {
                            if (this.config.running) {
                                this.addLog(`🔄 Reconnecting Cookie ${index + 1}...`, 'info');
                                this.initializeSingleBot(this.cookies[index], index, (success) => {
                                    if (success) {
                                        this.stats.activeCookies++;
                                    }
                                });
                            }
                        }, 30000);
                    }
                });
            } catch (e) {
                // Silent catch
            }
        }
    }

    getGroupInfo(api, threadID, cookieIndex) {
        try {
            if (api && typeof api.getThreadInfo === 'function') {
                api.getThreadInfo(threadID, (err, info) => {
                    if (!err && info) {
                        this.addLog(`Cookie ${cookieIndex + 1}: Target - ${info.name || 'Unknown'} (ID: ${threadID})`, 'info');
                    }
                });
            }
        } catch (e) {
            // Silent error
        }
    }

    // NEW METHOD: Start sending messages with multiple cookies
    startSending() {
        if (!this.config.running) return;
        
        // Check if we have any active APIs
        const activeApis = this.config.apis.filter(api => api !== null);
        if (activeApis.length === 0) {
            this.addLog('No active cookies available', 'error');
            return;
        }

        this.addLog(`Starting message sending with ${activeApis.length} active cookies`, 'info');
        this.sendNextMessage();
    }

    // MODIFIED METHOD: Send messages with cookie rotation
    sendNextMessage() {
        if (!this.config.running) return;

        // Check if we need to reset message index
        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog(`Loop #${this.messageData.loopCount} completed. Restarting.`, 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        // Get next available cookie (round-robin)
        const api = this.getNextAvailableApi();
        if (!api) {
            this.addLog('No active cookie available, retrying in 10 seconds...', 'warning');
            setTimeout(() => this.sendNextMessage(), 10000);
            return;
        }

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    // FIXED METHOD: Get next available API (proper round-robin)
    getNextAvailableApi() {
        const totalCookies = this.config.apis.length;
        
        // Try to find next active cookie
        for (let attempt = 0; attempt < totalCookies; attempt++) {
            this.currentCookieIndex = (this.currentCookieIndex + 1) % totalCookies;
            const api = this.config.apis[this.currentCookieIndex];
            
            if (api !== null) {
                // Track usage for this cookie
                this.stats.cookieUsage[this.currentCookieIndex]++;
                return api;
            }
        }
        
        // No active cookies found
        return null;
    }

    sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt = 0) {
        if (!this.config.running) return;

        const maxSendRetries = 10;
        const cookieNum = this.currentCookieIndex + 1;
        
        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');
                
                if (err) {
                    this.stats.failed++;
                    
                    if (retryAttempt < maxSendRetries) {
                        this.addLog(`🔄 Cookie ${cookieNum} | RETRY ${retryAttempt + 1}/${maxSendRetries} | Message ${currentIndex + 1}/${totalMessages}`, 'info');
                        
                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog(`❌ Cookie ${cookieNum} | FAILED after ${maxSendRetries} retries | ${timestamp} | Message ${currentIndex + 1}/${totalMessages}`, 'error');
                        // Mark this API as failed
                        this.config.apis[this.currentCookieIndex] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        
                        // Move to next message and cookie
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage();
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog(`✅ Cookie ${cookieNum} | SENT | ${timestamp} | Message ${currentIndex + 1}/${totalMessages} | Loop ${this.messageData.loopCount + 1}`, 'success');
                    
                    // Move to next message
                    this.messageData.currentIndex++;
                    this.scheduleNextMessage();
                }
            });
        } catch (sendError) {
            this.addLog(`🚨 Cookie ${cookieNum} | CRITICAL: Send error - ${sendError.message}`, 'error');
            this.config.apis[this.currentCookieIndex] = null;
            this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
            this.messageData.currentIndex++;
            this.scheduleNextMessage();
        }
    }

    scheduleNextMessage() {
        if (!this.config.running) return;

        setTimeout(() => {
            try {
                this.sendNextMessage();
            } catch (e) {
                this.addLog(`🚨 Error in message scheduler: ${e.message}`, 'error');
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('🔄 RESTARTING TASK WITH ALL COOKIES...', 'info');
        this.stats.restarts++;
        this.config.restartCount++;
        
        // Clear all APIs
        this.config.apis = [];
        this.stats.activeCookies = 0;
        
        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeAllBots();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('🚨 MAX RESTARTS REACHED - Task stopped', 'error');
                this.config.running = false;
            }
        }, 10000);
    }

    stop() {
        console.log(`🛑 Stopping task: ${this.taskId}`);
        this.config.running = false;
        
        // NO LOGOUT - ONLY STOP THE TASK
        this.stats.activeCookies = 0;
        this.addLog('⏸️ Task stopped by user - IDs remain logged in', 'info');
        this.addLog(`🔢 Total cookies used: ${this.stats.totalCookies}`, 'info');
        this.addLog('🔄 You can use same cookies again without relogin', 'info');
        
        return true;
    }

    getDetails() {
        // Calculate cookie usage statistics
        const activeCookies = this.config.apis.filter(api => api !== null).length;
        const cookieStats = this.cookies.map((cookie, index) => ({
            cookieNumber: index + 1,
            active: this.config.apis[index] !== null,
            messagesSent: this.stats.cookieUsage[index] || 0
        }));
        
        return {
            taskId: this.taskId,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeCookies: activeCookies,
            totalCookies: this.stats.totalCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            cookieStats: cookieStats,
            logs: this.logs,
            running: this.config.running,
            uptime: this.config.lastActivity ? Date.now() - this.config.lastActivity : 0
        };
    }
}

// Global error handlers (remain same)
process.on('uncaughtException', (error) => {
    console.log('🛡️ Global error handler caught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('🛡️ Global handler caught rejection at:', promise, 'reason:', reason);
});

// WebSocket broadcast functions (remain same)
function broadcastToTask(taskId, message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // ignore
            }
        }
    });
}

// HTML Control Panel (same as before - unchanged)
const htmlControlPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Multi-User Terror System</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --color-lavender: #e6e6ff;
    --color-lavender-light: #f0f0ff;
    --color-lavender-dark: #d1d1f0;
    --color-pastel-pink: #ffd6e7;
    --color-pastel-pink-dark: #f2c2d8;
    --color-sky-blue: #d6f0ff;
    --color-sky-blue-dark: #c2e0f2;
    --color-cream: #fffaf0;
    --color-cream-dark: #f5f0e6;
    --color-text: #4a4a6a;
    --color-text-light: #8a8aaa;
    --color-success: #8ce99a;
    --color-warning: #ffd8a8;
    --color-error: #ffaba8;
    --shadow-soft: 0 8px 32px rgba(138, 138, 170, 0.08);
    --shadow-medium: 0 12px 40px rgba(138, 138, 170, 0.12);
    --radius-large: 20px;
    --radius-medium: 16px;
    --radius-small: 12px;
    --transition-slow: 0.6s ease;
    --transition-medium: 0.3s ease;
    --transition-fast: 0.15s ease;
  }
  
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  
  html, body {
    height: 100%;
    font-family: 'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: linear-gradient(135deg, #f8f7ff 0%, #f0eeff 50%, #e8e6ff 100%);
    color: var(--color-text);
    font-weight: 400;
    line-height: 1.6;
    overflow-x: hidden;
  }
  
  body {
    position: relative;
    overflow-y: auto;
    animation: fadeIn 1.2s ease-out;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  /* Background elements */
  .background-elements {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    overflow: hidden;
  }
  
  .floating-bubble {
    position: absolute;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(230, 230, 255, 0.4), rgba(255, 214, 231, 0.3));
    filter: blur(20px);
    animation: float 25s infinite ease-in-out;
  }
  
  .floating-bubble:nth-child(1) {
    width: 200px;
    height: 200px;
    top: 10%;
    left: 5%;
    animation-delay: 0s;
  }
  
  .floating-bubble:nth-child(2) {
    width: 150px;
    height: 150px;
    top: 60%;
    right: 8%;
    animation-delay: 5s;
  }
  
  .floating-bubble:nth-child(3) {
    width: 180px;
    height: 180px;
    bottom: 15%;
    left: 15%;
    animation-delay: 10s;
  }
  
  .floating-bubble:nth-child(4) {
    width: 120px;
    height: 120px;
    top: 20%;
    right: 15%;
    animation-delay: 15s;
  }
  
  @keyframes float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    33% { transform: translateY(-20px) rotate(5deg); }
    66% { transform: translateY(10px) rotate(-5deg); }
  }
  
  /* Header */
  header {
    padding: 28px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.75);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(230, 230, 255, 0.8);
    position: sticky;
    top: 0;
    z-index: 100;
    animation: slideDown 0.8s ease-out;
  }
  
  @keyframes slideDown {
    from { transform: translateY(-20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  
  .logo {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  
  .logo-icon {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, var(--color-lavender), var(--color-pastel-pink));
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 24px;
    box-shadow: var(--shadow-soft);
  }
  
  .logo-text h1 {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    font-size: 24px;
    color: var(--color-text);
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }
  
  .logo-text p {
    font-size: 14px;
    color: var(--color-text-light);
    font-weight: 400;
  }
  
  .header-info {
    display: flex;
    align-items: center;
    gap: 24px;
  }
  
  .system-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 100px;
    border: 1px solid rgba(230, 230, 255, 0.8);
    font-size: 14px;
    color: var(--color-text);
    font-weight: 500;
  }
  
  .status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--color-success);
    animation: pulse 2s infinite ease-in-out;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  /* Main container */
  .container {
    max-width: 1200px;
    margin: 32px auto;
    padding: 0 32px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 28px;
  }
  
  /* Cards */
  .card {
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(20px);
    border-radius: var(--radius-large);
    padding: 32px;
    border: 1px solid rgba(230, 230, 255, 0.6);
    box-shadow: var(--shadow-soft);
    transition: all var(--transition-medium);
  }
  
  .card:hover {
    box-shadow: var(--shadow-medium);
    transform: translateY(-4px);
  }
  
  .card-header {
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .card-title {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    font-size: 20px;
    color: var(--color-text);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  .card-title-icon {
    width: 36px;
    height: 36px;
    background: linear-gradient(135deg, var(--color-lavender), var(--color-sky-blue));
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
  }
  
  /* Form elements */
  .form-group {
    margin-bottom: 24px;
  }
  
  label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text);
    margin-bottom: 8px;
  }
  
  .form-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    margin-bottom: 20px;
  }
  
  input[type="text"], 
  input[type="number"], 
  textarea, 
  select,
  .file-input-wrapper {
    width: 100%;
    padding: 16px 20px;
    border-radius: var(--radius-medium);
    border: 1px solid rgba(230, 230, 255, 0.8);
    background: rgba(255, 255, 255, 0.9);
    color: var(--color-text);
    font-family: 'Manrope', sans-serif;
    font-size: 15px;
    transition: all var(--transition-medium);
    outline: none;
  }
  
  input:focus, 
  textarea:focus, 
  select:focus {
    border-color: var(--color-lavender-dark);
    box-shadow: 0 0 0 3px rgba(230, 230, 255, 0.3);
    background: white;
  }
  
  .file-input-wrapper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }
  
  .file-input-wrapper span {
    color: var(--color-text-light);
    font-size: 14px;
  }
  
  .file-input-wrapper:hover {
    background: white;
    border-color: var(--color-lavender);
  }
  
  input[type="file"] {
    display: none;
  }
  
  .hint {
    font-size: 13px;
    color: var(--color-text-light);
    margin-top: 6px;
    display: block;
  }
  
  /* Radio options */
  .radio-group {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
  }
  
  .radio-option {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }
  
  .radio-option input[type="radio"] {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--color-lavender);
    background: white;
    position: relative;
    cursor: pointer;
    transition: all var(--transition-medium);
  }
  
  .radio-option input[type="radio"]:checked {
    border-color: var(--color-sky-blue-dark);
    background: var(--color-sky-blue);
  }
  
  .radio-option input[type="radio"]:checked::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-sky-blue-dark);
  }
  
  .radio-option label {
    margin-bottom: 0;
    cursor: pointer;
    font-weight: 500;
  }
  
  /* Buttons */
  .buttons-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid rgba(230, 230, 255, 0.6);
  }
  
  .btn {
    padding: 16px 32px;
    border-radius: var(--radius-medium);
    border: none;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    font-size: 15px;
    cursor: pointer;
    transition: all var(--transition-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, var(--color-lavender), var(--color-sky-blue));
    color: white;
    box-shadow: 0 4px 16px rgba(138, 138, 170, 0.15);
  }
  
  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(138, 138, 170, 0.2);
  }
  
  .btn-secondary {
    background: white;
    color: var(--color-text);
    border: 1px solid rgba(230, 230, 255, 0.8);
  }
  
  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.9);
    border-color: var(--color-lavender);
  }
  
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none !important;
  }
  
  .status-indicator-text {
    font-size: 14px;
    color: var(--color-text-light);
    font-weight: 500;
  }
  
  /* Tabs */
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 24px;
    border-bottom: 1px solid rgba(230, 230, 255, 0.6);
  }
  
  .tab {
    padding: 16px 28px;
    background: transparent;
    border: none;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    color: var(--color-text-light);
    cursor: pointer;
    border-radius: var(--radius-medium) var(--radius-medium) 0 0;
    transition: all var(--transition-medium);
    position: relative;
    font-size: 15px;
  }
  
  .tab.active {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.9);
  }
  
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, var(--color-lavender), var(--color-sky-blue));
  }
  
  .tab-content {
    display: none;
    animation: fadeInUp 0.5s ease-out;
  }
  
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .tab-content.active {
    display: block;
  }
  
  /* Log console */
  .log-console {
    height: 320px;
    overflow-y: auto;
    background: rgba(255, 255, 255, 0.7);
    border-radius: var(--radius-medium);
    padding: 20px;
    border: 1px solid rgba(230, 230, 255, 0.6);
    font-family: 'Monaco', 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  
  .log-entry {
    padding: 12px 16px;
    margin-bottom: 8px;
    border-radius: var(--radius-small);
    background: rgba(255, 255, 255, 0.9);
    border-left: 3px solid var(--color-lavender);
    animation: fadeIn 0.5s ease-out;
  }
  
  .log-entry.success {
    border-left-color: var(--color-success);
    background: rgba(140, 233, 154, 0.08);
  }
  
  .log-entry.error {
    border-left-color: var(--color-error);
    background: rgba(255, 171, 168, 0.08);
  }
  
  .log-entry.warning {
    border-left-color: var(--color-warning);
    background: rgba(255, 216, 168, 0.08);
  }
  
  .log-time {
    color: var(--color-text-light);
    font-size: 12px;
    margin-right: 12px;
  }
  
  /* Task ID display */
  .task-id-card {
    background: linear-gradient(135deg, rgba(230, 230, 255, 0.9), rgba(214, 240, 255, 0.9));
    padding: 24px;
    border-radius: var(--radius-large);
    text-align: center;
    margin: 20px 0;
    border: 1px solid rgba(230, 230, 255, 0.8);
    box-shadow: var(--shadow-soft);
    animation: gentleGlow 3s infinite alternate ease-in-out;
  }
  
  @keyframes gentleGlow {
    0% { box-shadow: var(--shadow-soft); }
    100% { box-shadow: 0 12px 40px rgba(138, 138, 170, 0.15); }
  }
  
  .task-id-label {
    font-size: 14px;
    color: var(--color-text-light);
    margin-bottom: 8px;
    display: block;
  }
  
  .task-id-value {
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    font-size: 22px;
    color: var(--color-text);
    word-break: break-all;
    padding: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius-medium);
    margin: 12px 0;
    border: 1px solid rgba(230, 230, 255, 0.8);
  }
  
  /* Stats grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 20px;
    margin: 24px 0;
  }
  
  .stat-card {
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius-medium);
    padding: 20px;
    border: 1px solid rgba(230, 230, 255, 0.6);
    text-align: center;
    transition: all var(--transition-medium);
  }
  
  .stat-card:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-soft);
  }
  
  .stat-value {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 32px;
    color: var(--color-text);
    margin-bottom: 4px;
    line-height: 1;
  }
  
  .stat-label {
    font-size: 13px;
    color: var(--color-text-light);
  }
  
  /* Cookie stats */
  .cookie-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
    margin: 20px 0;
  }
  
  .cookie-stat-item {
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius-medium);
    padding: 16px;
    text-align: center;
    border: 1px solid rgba(230, 230, 255, 0.6);
    transition: all var(--transition-medium);
  }
  
  .cookie-stat-item.active {
    border-color: var(--color-success);
    background: rgba(140, 233, 154, 0.1);
  }
  
  .cookie-stat-item.inactive {
    border-color: var(--color-error);
    background: rgba(255, 171, 168, 0.1);
  }
  
  .cookie-number {
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 6px;
  }
  
  .cookie-status {
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 4px;
  }
  
  .cookie-active {
    color: var(--color-success);
  }
  
  .cookie-inactive {
    color: var(--color-error);
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    header {
      flex-direction: column;
      align-items: flex-start;
      gap: 20px;
      padding: 24px;
    }
    
    .header-info {
      width: 100%;
      justify-content: space-between;
    }
    
    .container {
      padding: 0 20px;
      margin: 24px auto;
    }
    
    .card {
      padding: 24px;
    }
    
    .form-row {
      grid-template-columns: 1fr;
    }
    
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .buttons-row {
      flex-direction: column;
      gap: 16px;
      align-items: stretch;
    }
    
    .btn {
      width: 100%;
    }
    
    .tabs {
      overflow-x: auto;
    }
    
    .tab {
      padding: 14px 20px;
      white-space: nowrap;
    }
  }
  
  @media (max-width: 480px) {
    .stats-grid {
      grid-template-columns: 1fr;
    }
    
    .cookie-stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .radio-group {
      flex-direction: column;
      gap: 12px;
    }
  }
</style>
</head>
<body>
  <!-- Background elements -->
  <div class="background-elements">
    <div class="floating-bubble"></div>
    <div class="floating-bubble"></div>
    <div class="floating-bubble"></div>
    <div class="floating-bubble"></div>
  </div>
  
  <!-- Header -->
  <header>
    <div class="logo">
      <div class="logo-icon">✉️</div>
      <div class="logo-text">
        <h1>Terror Rulex Convo Server ;3</h1>
        <p>This is Cookies Server Made By Faiizu</p>
      </div>
    </div>
    
    <div class="header-info">
      <div class="system-status">
        <div class="status-indicator"></div>
        <span>System Online</span>
      </div>
      <div class="system-status">
        <span>v2.1.0</span>
      </div>
    </div>
  </header>
  
  <!-- Main container -->
  <div class="container">
    <!-- Configuration card -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">
          <div class="card-title-icon">⚙️</div>
          <h2>Details Penel</h2>
        </div>
      </div>
      
      <div class="multi-cookie-info" style="background: rgba(230, 230, 255, 0.2); padding: 20px; border-radius: var(--radius-medium); margin-bottom: 24px; border: 1px solid rgba(230, 230, 255, 0.4);">
        <h3 style="color: var(--color-text); margin-bottom: 8px; font-size: 16px; display: flex; align-items: center; gap: 8px;">
          <span style="background: var(--color-sky-blue); width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center;"></span>
          Multiple Cookie Support
        </h3>
        <p style="color: var(--color-text); font-size: 14px; margin-bottom: 8px;">
          <strong>ultra Future:</strong> multiple cookies in a single file. 
        </p>
        <ul style="color: var(--color-text-light); font-size: 13px; padding-left: 20px;">
          <li>Each cookie on a separate line</li>
          <li>System automatically uses all available cookies</li>
          <li>Messages rotate between active cookies</li>
          <li>Failover protection with automatic recovery</li>
        </ul>
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label for="cookie-mode">Cookie Input Method</label>
          <div class="radio-group">
            <div class="radio-option">
              <input type="radio" id="cookie-file-mode" name="cookie-mode" value="file" checked>
              <label for="cookie-file-mode">Upload File</label>
            </div>
            <div class="radio-option">
              <input type="radio" id="cookie-paste-mode" name="cookie-mode" value="paste">
              <label for="cookie-paste-mode">Paste Text</label>
            </div>
          </div>
        </div>
        
        <div class="form-group">
          <label for="delay">Message Delay (seconds)</label>
          <input type="number" id="delay" value="5" min="1" max="60">
          <span class="hint">Delay between sending messages</span>
        </div>
      </div>
      
      <div class="form-row">
        <div class="form-group" id="cookie-file-wrapper">
          <label for="cookie-file">Cookie File (.txt or .json)</label>
          <div class="file-input-wrapper" id="cookie-file-display">
            <span>Choose a file</span>
            <span></span>
          </div>
          <input type="file" id="cookie-file" accept=".txt or json ">
          <span class="hint">One cookie per line. Multiple cookies are supported.</span>
        </div>
        
        <div class="form-group" id="cookie-paste-wrapper" style="display: none;">
          <label for="cookie-paste">Paste Cookies (one per line)</label>
          <textarea id="cookie-paste" rows="4" placeholder="Paste cookies here, one per line..."></textarea>
          <span class="hint">_</span>
        </div>
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label for="haters-name">Heter Name</label>
          <input type="text" id="haters-name" placeholder="Enter name">
          <span class="hint">This will be added at First On top of the message</span>
        </div>
        
        <div class="form-group">
          <label for="thread-id">Thread / Group ID</label>
          <input type="text" id="thread-id" placeholder="Enter thread or group ID">
          <span class="hint">Target conversation</span>
        </div>
        
        <div class="form-group">
          <label for="last-here-name">End Text</label>
          <input type="text" id="last-here-name" placeholder="Enter footer text">
          <span class="hint">This will be added at the end of each message</span>
        </div>
      </div>
      
      <div class="form-group">
        <label for="message-file">Messages File (.txt)</label>
        <div class="file-input-wrapper" id="message-file-display">
          <span>Choose a messages file</span>
          <span>📄</span>
        </div>
        <input type="file" id="message-file" accept=".txt">
        <span class="hint">One message per line. Messages will loop when finished.</span>
      </div>
      
      <div class="buttons-row">
        <button class="btn btn-primary" id="start-btn">
          <span></span>
          Start Sending
        </button>
        <div class="status-indicator-text" id="status">Status: Ready</div>
      </div>
    </div>
    
    <!-- Console card -->
    <div class="card">
      <div class="tabs">
        <button class="tab active" data-tab="log">Console Logs</button>
        <button class="tab" data-tab="stop">Stop Task</button>
        <button class="tab" data-tab="view">Task Details</button>
      </div>
      
      <!-- Console Logs Tab -->
      <div id="log-tab" class="tab-content active">
        <div class="log-console" id="log-container">
          <div class="log-entry">
            <span class="log-time">10:30:15</span>
            System initialized and ready.
          </div>
          <div class="log-entry">
            <span class="log-time">10:30:22</span>
            Welcome to the Multi-User Messaging System.
          </div>
        </div>
      </div>
      
      <!-- Stop Task Tab -->
      <div id="stop-tab" class="tab-content">
        <div class="form-group">
          <label for="stop-task-id">Task ID</label>
          <input type="text" id="stop-task-id" placeholder="Enter your task ID to stop">
          <span class="hint">Find your task ID in the console logs or task details.</span>
        </div>
        
        <div class="buttons-row" style="border-top: none; margin-top: 0; padding-top: 0;">
          <button class="btn btn-secondary" id="stop-btn">
            <span>⏹️</span>
            Stop Task
          </button>
        </div>
        
        <div class="task-id-card" style="margin-top: 20px; display: none;" id="stop-result">
          <div class="task-id-label">Task Status</div>
          <div class="task-id-value" id="stop-result-text"></div>
          <div style="font-size: 13px; color: var(--color-text-light); margin-top: 12px;">
            Your Facebook IDs remain logged in and can be reused.
          </div>
        </div>
      </div>
      
      <!-- View Task Details Tab -->
      <div id="view-tab" class="tab-content">
        <div class="form-group">
          <label for="view-task-id">Task ID</label>
          <input type="text" id="view-task-id" placeholder="Enter your task ID to view details">
          <span class="hint">Enter a task ID to view its current status and statistics.</span>
        </div>
        
        <div class="buttons-row" style="border-top: none; margin-top: 0; padding-top: 0;">
          <button class="btn btn-secondary" id="view-btn">
            <span>👁️</span>
            View Task Details
          </button>
        </div>
        
        <div id="task-details" style="display: none;">
          <div class="task-id-card">
            <div class="task-id-label">Your Task ID</div>
            <div class="task-id-value" id="detail-task-id">TASK-ABC-123-XYZ</div>
            <div style="font-size: 13px; color: var(--color-text-light); margin-top: 12px;">
              Copy this ID to stop or monitor your task later.
            </div>
          </div>
          
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-value" id="detail-sent">0</div>
              <div class="stat-label">Messages Sent</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="detail-failed">0</div>
              <div class="stat-label">Messages Failed</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="detail-active-cookies">0</div>
              <div class="stat-label">Active Cookies</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="detail-total-cookies">0</div>
              <div class="stat-label">Total Cookies</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="detail-loops">0</div>
              <div class="stat-label">Loops Completed</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="detail-restarts">0</div>
              <div class="stat-label">Auto Restarts</div>
            </div>
          </div>
          
          <h3 style="color: var(--color-text); margin: 24px 0 16px 0; font-size: 18px;">Cookie Statistics</h3>
          <div class="cookie-stats-grid" id="detail-cookie-stats">
            <!-- Cookie stats will be populated here -->
          </div>
          
          <h3 style="color: var(--color-text); margin: 24px 0 16px 0; font-size: 18px;">Recent Activity</h3>
          <div class="log-console" id="detail-log" style="height: 200px;">
            <!-- Task logs will be populated here -->
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  // Initialize the UI
  document.addEventListener('DOMContentLoaded', function() {
    // Background elements animation
    const bubbles = document.querySelectorAll('.floating-bubble');
    bubbles.forEach((bubble, index) => {
     // bubble.style.animationDelay = `${index * 5}s`;
    });
    
    // Tab switching
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        
        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show target content
        tabContents.forEach(content => {
          content.classList.remove('active');
          if (content.id === `${targetTab}-tab`) {
            content.classList.add('active');
          }
        });
      });
    });
    
    // Cookie mode toggle
    const cookieModeRadios = document.querySelectorAll('input[name="cookie-mode"]');
    const cookieFileWrapper = document.getElementById('cookie-file-wrapper');
    const cookiePasteWrapper = document.getElementById('cookie-paste-wrapper');
    
    cookieModeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.value === 'file') {
          cookieFileWrapper.style.display = 'block';
          cookiePasteWrapper.style.display = 'none';
        } else {
          cookieFileWrapper.style.display = 'none';
          cookiePasteWrapper.style.display = 'block';
        }
      });
    });
    
    // File input display
    const cookieFileInput = document.getElementById('cookie-file');
    const cookieFileDisplay = document.getElementById('cookie-file-display');
    const messageFileInput = document.getElementById('message-file');
    const messageFileDisplay = document.getElementById('message-file-display');
    
    cookieFileInput.addEventListener('change', function() {
      if (this.files.length > 0) {
        cookieFileDisplay.innerHTML = `<span>${this.files[0].name}</span> <span>📁</span>`;
      }
    });
    
    messageFileInput.addEventListener('change', function() {
      if (this.files.length > 0) {
        messageFileDisplay.innerHTML = `<span>${this.files[0].name}</span> <span>📄</span>`;
      }
    });
    
    // Mock WebSocket connection (in a real app, this would connect to a server)
    let mockTaskId = null;
    let logEntries = 0;
    
    // Start button handler
    const startBtn = document.getElementById('start-btn');
    const statusDiv = document.getElementById('status');
    const logContainer = document.getElementById('log-container');
    
    function addLogEntry(message, type = '') {
      logEntries++;
      const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.innerHTML = `<span class="log-time">${time}</span> ${message}`;
      logContainer.appendChild(logEntry);
      logContainer.scrollTop = logContainer.scrollHeight;
      
      // Limit logs to 50 entries
      if (logEntries > 50) {
        logContainer.removeChild(logContainer.firstChild);
        logEntries--;
      }
    }
    
    startBtn.addEventListener('click', () => {
      // Validate inputs
      const cookieMode = document.querySelector('input[name="cookie-mode"]:checked').value;
      const hatersName = document.getElementById('haters-name').value;
      const threadId = document.getElementById('thread-id').value;
      const lastHereName = document.getElementById('last-here-name').value;
      const delay = document.getElementById('delay').value;
      
      if (cookieMode === 'file' && cookieFileInput.files.length === 0) {
        addLogEntry('Please select a cookie file.', 'error');
        return;
      }
      
      if (cookieMode === 'paste' && !document.getElementById('cookie-paste').value.trim()) {
        addLogEntry('Please paste cookies in the text area.', 'error');
        return;
      }
      
      if (!hatersName) {
        addLogEntry('Please enter a sender name.', 'error');
        return;
      }
      
      if (!threadId) {
        addLogEntry('Please enter a thread/group ID.', 'error');
        return;
      }
      
      if (!lastHereName) {
        addLogEntry('Please enter footer text.', 'error');
        return;
      }
      
      if (messageFileInput.files.length === 0) {
        addLogEntry('Please select a messages file.', 'error');
        return;
      }
      
      // Simulate starting a task
      startBtn.disabled = true;
      statusDiv.textContent = 'Status: Starting...';
      
      addLogEntry('Starting message sending task...', '');
      
      setTimeout(() => {
        mockTaskId = 'TASK-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        
        addLogEntry(`Task started successfully with ID: ${mockTaskId}`, 'success');
        addLogEntry('Multiple Cookie Support: Active', '');
        addLogEntry('Auto-recovery enabled - Task will auto-restart on errors', '');
        addLogEntry('Cookie Safety: Your IDs will NOT logout when you stop task', '');
        
        // Show task ID in console
        addLogEntry(`Task ID: ${mockTaskId} - Copy this to stop or view task later`, '');
        
        statusDiv.textContent = 'Status: Running';
        startBtn.disabled = false;
        
        // Simulate periodic updates
        simulateTaskUpdates();
      }, 1500);
    });
    
    // Stop button handler
    const stopBtn = document.getElementById('stop-btn');
    const stopResult = document.getElementById('stop-result');
    const stopResultText = document.getElementById('stop-result-text');
    
    stopBtn.addEventListener('click', () => {
      const taskIdInput = document.getElementById('stop-task-id').value.trim();
      
      if (!taskIdInput) {
        stopResult.style.display = 'block';
        stopResultText.textContent = 'Please enter a task ID';
        stopResult.style.background = 'linear-gradient(135deg, rgba(255, 171, 168, 0.9), rgba(255, 216, 168, 0.9))';
        return;
      }
      
      stopResult.style.display = 'block';
      stopResultText.textContent = `Stopping task: ${taskIdInput}...`;
      stopResult.style.background = 'linear-gradient(135deg, rgba(255, 216, 168, 0.9), rgba(230, 230, 255, 0.9))';
      
      setTimeout(() => {
        stopResultText.textContent = `Task ${taskIdInput} stopped successfully`;
        stopResult.style.background = 'linear-gradient(135deg, rgba(140, 233, 154, 0.9), rgba(214, 240, 255, 0.9))';
        
        // Also add to console logs
        addLogEntry(`Task ${taskIdInput} has been stopped`, '');
        addLogEntry('Your Facebook IDs remain logged in - Same cookies can be reused', 'success');
      }, 2000);
    });
    
    // View task button handler
    const viewBtn = document.getElementById('view-btn');
    const taskDetails = document.getElementById('task-details');
    
    viewBtn.addEventListener('click', () => {
      const taskIdInput = document.getElementById('view-task-id').value.trim();
      
      if (!taskIdInput) {
        taskDetails.style.display = 'block';
        document.getElementById('detail-task-id').textContent = 'Please enter a task ID';
        return;
      }
      
      taskDetails.style.display = 'block';
      document.getElementById('detail-task-id').textContent = taskIdInput;
      
      // Simulate task data
      document.getElementById('detail-sent').textContent = Math.floor(Math.random() * 100);
      document.getElementById('detail-failed').textContent = Math.floor(Math.random() * 5);
      document.getElementById('detail-active-cookies').textContent = Math.floor(Math.random() * 5) + 1;
      document.getElementById('detail-total-cookies').textContent = Math.floor(Math.random() * 8) + 2;
      document.getElementById('detail-loops').textContent = Math.floor(Math.random() * 10);
      document.getElementById('detail-restarts').textContent = Math.floor(Math.random() * 3);
      
      // Populate cookie stats
      const cookieStatsContainer = document.getElementById('detail-cookie-stats');
      cookieStatsContainer.innerHTML = '';
      
      const totalCookies = parseInt(document.getElementById('detail-total-cookies').textContent);
      const activeCookies = parseInt(document.getElementById('detail-active-cookies').textContent);
      
      for (let i = 1; i <= totalCookies; i++) {
        const isActive = i <= activeCookies;
        const messagesSent = Math.floor(Math.random() * 20);
        
        const cookieStat = document.createElement('div');
        cookieStat.className = `cookie-stat-item ${isActive ? 'active' : 'inactive'}`;
        cookieStat.innerHTML = `
          <div class="cookie-number">Cookie ${i}</div>
          <div class="cookie-status ${isActive ? 'cookie-active' : 'cookie-inactive'}">
            ${isActive ? '🟢 Active' : '🔴 Inactive'}
          </div>
          <div style="font-size: 12px; color: var(--color-text-light);">Sent: ${messagesSent} messages</div>
        `;
        cookieStatsContainer.appendChild(cookieStat);
      }
      
      // Populate recent activity
      const detailLog = document.getElementById('detail-log');
      detailLog.innerHTML = '';
      
      const activities = [
        'Task initialized with multiple cookies',
        'Message rotation started between 3 active cookies',
        'Sent message: "Hello from the system"',
        'Cookie #2 temporarily inactive - failover to cookie #3',
        'Auto-recovery completed for cookie #2',
        'Completed message loop #1',
        'All cookies active and functioning'
      ];
      
      activities.forEach((activity, index) => {
        const time = new Date(Date.now() - (activities.length - index) * 60000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">${time}</span> ${activity}`;
        detailLog.appendChild(logEntry);
      });
    });
    
    // Simulate task updates (for demo purposes)
    function simulateTaskUpdates() {
      if (!mockTaskId) return;
      
      const updateInterval = setInterval(() => {
        if (Math.random() > 0.7) {
          const messages = [
            'Message sent successfully via cookie rotation',
            'Completed message batch #' + Math.floor(Math.random() * 10),
            'All cookies active and responding',
            'Auto-recovery mechanism is idle (no errors detected)'
          ];
          
          addLogEntry(messages[Math.floor(Math.random() * messages.length)], 'success');
        }
        
        // 5% chance of simulated error
        if (Math.random() > 0.95) {
          addLogEntry('Temporary connection issue - auto-recovery activated', 'warning');
          
          setTimeout(() => {
            addLogEntry('Connection restored - continuing normal operation', 'success');
          }, 3000);
        }
      }, 8000);
      
      // Clear interval after 2 minutes for demo
      setTimeout(() => {
        clearInterval(updateInterval);
      }, 120000);
    }
    
    // Add some initial demo logs
    setTimeout(() => {
      addLogEntry('System ready. Configure your settings and start a task.', '');
    }, 1000);
    
    setTimeout(() => {
      addLogEntry('Multiple cookie support enabled. You can upload a file with multiple cookies.', '');
    }, 3000);
  });
</script>
</body>
</html>
`;

// Set up Express server
app.get('/', (req, res) => {
  res.send(htmlControlPanel);
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Terror Server running at http://localhost:${PORT}`);
  console.log(`💾 Memory Only Mode: ACTIVE - No file storage`);
  console.log(`🔄 Auto Console Clear: ACTIVE - Every 30 minutes`);
  console.log(`🔢 Multiple Cookie Support: ENABLED`);
  console.log(`⚡ Low CPU Mode: ENABLED`);
  console.log(`🔄 Using w3-fca engine for Facebook API`);
  
  // Start console clear interval
  setupConsoleClear();
});

// Set up WebSocket server
let wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.taskId = null;
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start') {
        const taskId = uuidv4();
        ws.taskId = taskId;
        
        const task = new Task(taskId, {
          cookieContent: data.cookieContent,
          messageContent: data.messageContent,
          hatersName: data.hatersName,
          threadID: data.threadID,
          lastHereName: data.lastHereName,
          delay: data.delay
        });
        
        if (task.start()) {
          activeTasks.set(taskId, task);
          ws.send(JSON.stringify({
            type: 'task_started',
            taskId: taskId
          }));
          
          console.log(`✅ New task started: ${taskId} - ${task.stats.totalCookies} cookies loaded`);
        }
        
      } else if (data.type === 'stop') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          const stopped = task.stop();
          if (stopped) {
            activeTasks.delete(data.taskId);
            ws.send(JSON.stringify({
              type: 'task_stopped',
              taskId: data.taskId
            }));
            
            console.log(`🛑 Task stopped: ${data.taskId} - ${task.stats.totalCookies} cookies preserved`);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to stop task',
              from: 'stop'
            }));
          }
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Task not found',
            from: 'stop'
          }));
        }
        
      } else if (data.type === 'view_details') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          ws.send(JSON.stringify({
            type: 'task_details',
            ...task.getDetails()
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Task not found or no longer active'
          }));
        }
      }
      
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid request'
      }));
    }
  });

  ws.on('close', () => {
    // Silent disconnect
  });
});

// Auto-restart system
function setupAutoRestart() {
  setInterval(() => {
    for (let [taskId, task] of activeTasks.entries()) {
      if (task.config.running && !task.healthCheck()) {
        console.log(`🔄 Auto-restarting stuck task: ${taskId}`);
        task.restart();
      }
    }
  }, 60000);
}

setupAutoRestart();

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Terminating gracefully...');
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  process.exit(0);
});
