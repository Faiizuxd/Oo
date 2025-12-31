// save as server.js
// npm install express ws axios w3-fca uuid

const fs = require('fs');
const express = require('express');
const wiegine = require('ws3-fca');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5941;

// NO PERSISTENT STORAGE - MEMORY ONLY
let activeTasks = new Map();
let adminCredentials = { username: "faizu", password: "kingfaizu123" }; // Default credentials

// AUTO CONSOLE CLEAR SETUP
let consoleClearInterval;
function setupConsoleClear() {
    consoleClearInterval = setInterval(() => {
        console.clear();
        console.log(`🔄 Console cleared at: ${new Date().toLocaleTimeString()}`);
        console.log(`🚀 Server running smoothly - ${activeTasks.size} active tasks`);
        console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    }, 30 * 60 * 1000);
}

// Modified Task class to handle multiple cookies
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        
        // Parse multiple cookies from userData
        this.cookies = this.parseCookies(userData.cookieContent);
        this.currentCookieIndex = -1;
        
        this.config = {
            prefix: '',
            delay: userData.delay || 5,
            running: false,
            apis: [],
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
            cookieUsage: Array(this.cookies.length).fill(0)
        };
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 50;
        this.initializeMessages(userData.messageContent, userData.hatersName, userData.lastHereName);
    }

    parseCookies(cookieContent) {
        const cookies = [];
        const lines = cookieContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            try {
                JSON.parse(line);
                cookies.push(line);
            } catch {
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
        if (this.logs.length > 100) this.logs = this.logs.slice(0, 100);
        
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
        return this.initializeAllBots();
    }

    initializeAllBots() {
        return new Promise((resolve) => {
            let currentIndex = 0;
            const totalCookies = this.cookies.length;
            
            const loginNextCookie = () => {
                if (currentIndex >= totalCookies) {
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
                
                setTimeout(() => {
                    this.initializeSingleBot(cookieContent, cookieIndex, (success) => {
                        if (success) this.stats.activeCookies++;
                        currentIndex++;
                        loginNextCookie();
                    });
                }, cookieIndex * 2000);
            };
            
            loginNextCookie();
        });
    }

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
            this.setupApiErrorHandling(api, index);
            this.getGroupInfo(api, this.messageData.threadID, index);
            callback(true);
        });
    }

    setupApiErrorHandling(api, index) {
        if (api && typeof api.listen === 'function') {
            try {
                api.listen((err, event) => {
                    if (err && this.config.running) {
                        this.config.apis[index] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        this.addLog(`⚠️ Cookie ${index + 1} disconnected, will retry`, 'warning');
                        
                        setTimeout(() => {
                            if (this.config.running) {
                                this.addLog(`🔄 Reconnecting Cookie ${index + 1}...`, 'info');
                                this.initializeSingleBot(this.cookies[index], index, (success) => {
                                    if (success) this.stats.activeCookies++;
                                });
                            }
                        }, 30000);
                    }
                });
            } catch (e) {}
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
        } catch (e) {}
    }

    startSending() {
        if (!this.config.running) return;
        const activeApis = this.config.apis.filter(api => api !== null);
        if (activeApis.length === 0) {
            this.addLog('No active cookies available', 'error');
            return;
        }

        this.addLog(`Starting message sending with ${activeApis.length} active cookies`, 'info');
        this.sendNextMessage();
    }

    sendNextMessage() {
        if (!this.config.running) return;

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog(`Loop #${this.messageData.loopCount} completed. Restarting.`, 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        const api = this.getNextAvailableApi();
        if (!api) {
            this.addLog('No active cookie available, retrying in 10 seconds...', 'warning');
            setTimeout(() => this.sendNextMessage(), 10000);
            return;
        }

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    getNextAvailableApi() {
        const totalCookies = this.config.apis.length;
        for (let attempt = 0; attempt < totalCookies; attempt++) {
            this.currentCookieIndex = (this.currentCookieIndex + 1) % totalCookies;
            const api = this.config.apis[this.currentCookieIndex];
            if (api !== null) {
                this.stats.cookieUsage[this.currentCookieIndex]++;
                return api;
            }
        }
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
                        this.config.apis[this.currentCookieIndex] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage();
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog(`✅ Cookie ${cookieNum} | SENT | ${timestamp} | Message ${currentIndex + 1}/${totalMessages} | Loop ${this.messageData.loopCount + 1}`, 'success');
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
        this.stats.activeCookies = 0;
        this.addLog('⏸️ Task stopped by user - IDs remain logged in', 'info');
        this.addLog(`🔢 Total cookies used: ${this.stats.totalCookies}`, 'info');
        this.addLog('🔄 You can use same cookies again without relogin', 'info');
        return true;
    }

    getDetails() {
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

// Global error handlers
process.on('uncaughtException', (error) => {
    console.log('🛡️ Global error handler caught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('🛡️ Global handler caught rejection at:', promise, 'reason:', reason);
});

function broadcastToTask(taskId, message) {
    if (!wss) return;
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {}
        }
    });
}

// Complete HTML with new design
const htmlLoginPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FAIZU MULTI-COOKIE MESSENGER</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Poppins', sans-serif;
  }
  
  :root {
    --primary-pink: #ff4a9e;
    --secondary-pink: #ff7eb9;
    --light-pink: #ffc2e0;
    --dark-pink: #e60073;
    --primary-red: #ff4757;
    --secondary-red: #ff6b81;
    --light-red: #ffcccc;
    --dark-red: #c0392b;
    --bg-dark: #0a0a1a;
    --bg-light: #1a1a3a;
    --text-light: #ffffff;
    --text-glow: #ff4a9e;
  }
  
  body {
    background: linear-gradient(135deg, var(--bg-dark) 0%, #1a0a1a 100%);
    color: var(--text-light);
    min-height: 100vh;
    overflow-x: hidden;
  }
  
  /* Animated Background */
  .animated-bg {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -2;
    background: 
      radial-gradient(circle at 20% 80%, rgba(255, 74, 158, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(255, 71, 87, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 40% 40%, rgba(255, 126, 185, 0.1) 0%, transparent 50%);
    animation: bgPulse 15s ease-in-out infinite alternate;
  }
  
  @keyframes bgPulse {
    0% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.02); }
    100% { opacity: 0.7; transform: scale(1); }
  }
  
  /* Floating Hearts Animation */
  .floating-hearts {
    position: fixed;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
  }
  
  .heart {
    position: absolute;
    color: var(--primary-pink);
    font-size: 20px;
    opacity: 0.3;
    animation: float 15s linear infinite;
  }
  
  @keyframes float {
    0% {
      transform: translateY(100vh) rotate(0deg);
      opacity: 0;
    }
    10% {
      opacity: 0.3;
    }
    90% {
      opacity: 0.3;
    }
    100% {
      transform: translateY(-100px) rotate(360deg);
      opacity: 0;
    }
  }
  
  /* Login Container */
  .login-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 20px;
  }
  
  .login-box {
    background: rgba(26, 10, 26, 0.9);
    border: 2px solid var(--primary-pink);
    border-radius: 20px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 
      0 0 30px rgba(255, 74, 158, 0.4),
      0 0 60px rgba(255, 71, 87, 0.2),
      inset 0 0 20px rgba(255, 74, 158, 0.1);
    backdrop-filter: blur(10px);
    animation: loginGlow 3s ease-in-out infinite alternate;
    position: relative;
    overflow: hidden;
  }
  
  .login-box::before {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(
      45deg,
      transparent 30%,
      rgba(255, 74, 158, 0.1) 50%,
      transparent 70%
    );
    animation: shine 6s infinite linear;
    z-index: -1;
  }
  
  @keyframes loginGlow {
    0% {
      box-shadow: 
        0 0 30px rgba(255, 74, 158, 0.4),
        0 0 60px rgba(255, 71, 87, 0.2);
      border-color: var(--primary-pink);
    }
    50% {
      box-shadow: 
        0 0 40px rgba(255, 74, 158, 0.6),
        0 0 80px rgba(255, 71, 87, 0.3);
      border-color: var(--secondary-pink);
    }
    100% {
      box-shadow: 
        0 0 30px rgba(255, 74, 158, 0.4),
        0 0 60px rgba(255, 71, 87, 0.2);
      border-color: var(--primary-pink);
    }
  }
  
  @keyframes shine {
    0% {
      transform: rotate(0deg) translateX(-100%);
    }
    100% {
      transform: rotate(360deg) translateX(100%);
    }
  }
  
  .login-header {
    text-align: center;
    margin-bottom: 30px;
  }
  
  .login-header h1 {
    font-size: 32px;
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 20px rgba(255, 74, 158, 0.5);
    margin-bottom: 10px;
    animation: titleGlow 2s ease-in-out infinite alternate;
  }
  
  @keyframes titleGlow {
    from {
      text-shadow: 0 0 10px rgba(255, 74, 158, 0.5),
                   0 0 20px rgba(255, 74, 158, 0.3);
    }
    to {
      text-shadow: 0 0 20px rgba(255, 74, 158, 0.7),
                   0 0 30px rgba(255, 74, 158, 0.4),
                   0 0 40px rgba(255, 71, 87, 0.3);
    }
  }
  
  .login-header p {
    color: var(--light-pink);
    font-size: 14px;
    opacity: 0.8;
  }
  
  .login-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .form-group {
    position: relative;
  }
  
  .form-group label {
    display: block;
    margin-bottom: 8px;
    color: var(--light-pink);
    font-size: 14px;
    font-weight: 500;
  }
  
  .form-input {
    width: 100%;
    padding: 15px 20px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 74, 158, 0.3);
    border-radius: 10px;
    color: var(--text-light);
    font-size: 16px;
    transition: all 0.3s ease;
    outline: none;
  }
  
  .form-input:focus {
    border-color: var(--primary-pink);
    box-shadow: 0 0 20px rgba(255, 74, 158, 0.3);
    background: rgba(255, 255, 255, 0.08);
  }
  
  .login-btn {
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    color: white;
    border: none;
    padding: 16px;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-top: 10px;
    position: relative;
    overflow: hidden;
  }
  
  .login-btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    transition: left 0.5s ease;
  }
  
  .login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(255, 74, 158, 0.4);
  }
  
  .login-btn:hover::before {
    left: 100%;
  }
  
  .login-btn:active {
    transform: translateY(0);
  }
  
  .login-footer {
    text-align: center;
    margin-top: 20px;
    color: var(--light-pink);
    font-size: 12px;
    opacity: 0.7;
  }
  
  /* Main Dashboard (Hidden Initially) */
  .dashboard {
    display: none;
    padding: 20px;
  }
  
  .header {
    background: linear-gradient(135deg, 
      rgba(255, 74, 158, 0.15) 0%, 
      rgba(255, 71, 87, 0.15) 100%);
    backdrop-filter: blur(10px);
    border: 2px solid var(--primary-pink);
    border-radius: 15px;
    padding: 20px 30px;
    margin-bottom: 30px;
    position: relative;
    overflow: hidden;
  }
  
  .header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, 
      transparent, 
      var(--primary-pink), 
      var(--primary-red), 
      var(--primary-pink), 
      transparent);
    animation: headerBorder 3s linear infinite;
  }
  
  @keyframes headerBorder {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
  
  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  
  .header-title h1 {
    font-size: 28px;
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 0 15px rgba(255, 74, 158, 0.3);
  }
  
  .header-title p {
    color: var(--light-pink);
    font-size: 14px;
    opacity: 0.8;
  }
  
  .user-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .logout-btn {
    background: linear-gradient(45deg, var(--primary-red), var(--dark-red));
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 14px;
  }
  
  .logout-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 15px rgba(255, 71, 87, 0.4);
  }
  
  /* Control Panels */
  .control-panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 25px;
    margin-bottom: 30px;
  }
  
  .panel {
    background: rgba(26, 10, 26, 0.8);
    border: 2px solid var(--primary-pink);
    border-radius: 15px;
    padding: 25px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    position: relative;
    overflow: hidden;
    transition: all 0.3s ease;
  }
  
  .panel:hover {
    border-color: var(--secondary-pink);
    box-shadow: 0 15px 35px rgba(255, 74, 158, 0.2);
    transform: translateY(-5px);
  }
  
  .panel::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(45deg, 
      transparent 0%, 
      rgba(255, 74, 158, 0.05) 50%, 
      transparent 100%);
    pointer-events: none;
    animation: panelShine 6s linear infinite;
  }
  
  @keyframes panelShine {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  
  .panel-title {
    color: var(--primary-pink);
    font-size: 18px;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 74, 158, 0.3);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .panel-title::before {
    content: '✦';
    color: var(--secondary-pink);
    animation: spin 4s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  .form-row {
    margin-bottom: 20px;
  }
  
  .form-row label {
    display: block;
    color: var(--light-pink);
    margin-bottom: 8px;
    font-size: 14px;
  }
  
  .form-input, .form-textarea, .form-select {
    width: 100%;
    padding: 12px 15px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 74, 158, 0.3);
    border-radius: 8px;
    color: var(--text-light);
    font-size: 14px;
    transition: all 0.3s ease;
    outline: none;
  }
  
  .form-textarea {
    min-height: 100px;
    resize: vertical;
  }
  
  .form-input:focus, .form-textarea:focus, .form-select:focus {
    border-color: var(--primary-pink);
    box-shadow: 0 0 15px rgba(255, 74, 158, 0.2);
    background: rgba(255, 255, 255, 0.08);
  }
  
  .file-upload {
    position: relative;
    border: 2px dashed rgba(255, 74, 158, 0.3);
    border-radius: 8px;
    padding: 20px;
    text-align: center;
    transition: all 0.3s ease;
    cursor: pointer;
  }
  
  .file-upload:hover {
    border-color: var(--primary-pink);
    background: rgba(255, 74, 158, 0.05);
  }
  
  .file-upload input[type="file"] {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    opacity: 0;
    cursor: pointer;
  }
  
  .file-label {
    color: var(--light-pink);
    font-size: 14px;
  }
  
  .form-buttons {
    display: flex;
    gap: 15px;
    margin-top: 25px;
  }
  
  .btn {
    padding: 12px 25px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all 0.3s ease;
    flex: 1;
  }
  
  .btn-primary {
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    color: white;
  }
  
  .btn-secondary {
    background: rgba(255, 74, 158, 0.1);
    color: var(--light-pink);
    border: 1px solid rgba(255, 74, 158, 0.3);
  }
  
  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(255, 74, 158, 0.3);
  }
  
  .btn:active {
    transform: translateY(0);
  }
  
  /* Stats Panel */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 15px;
    margin-top: 20px;
  }
  
  .stat-card {
    background: rgba(255, 74, 158, 0.1);
    border: 1px solid rgba(255, 74, 158, 0.2);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    transition: all 0.3s ease;
  }
  
  .stat-card:hover {
    border-color: var(--primary-pink);
    background: rgba(255, 74, 158, 0.15);
    transform: translateY(-3px);
  }
  
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 5px;
  }
  
  .stat-label {
    font-size: 12px;
    color: var(--light-pink);
    opacity: 0.8;
  }
  
  /* Console Panel */
  .console-panel {
    grid-column: 1 / -1;
  }
  
  .console-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 74, 158, 0.3);
    padding-bottom: 10px;
  }
  
  .console-tab {
    padding: 10px 20px;
    background: rgba(255, 74, 158, 0.1);
    border: 1px solid rgba(255, 74, 158, 0.3);
    border-radius: 8px 8px 0 0;
    color: var(--light-pink);
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 14px;
  }
  
  .console-tab.active {
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    border-color: var(--primary-pink);
    color: white;
  }
  
  .console-tab:hover:not(.active) {
    background: rgba(255, 74, 158, 0.2);
  }
  
  .console-content {
    display: none;
    animation: fadeIn 0.5s ease;
  }
  
  .console-content.active {
    display: block;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  .console-log {
    background: rgba(10, 5, 15, 0.9);
    border: 1px solid rgba(255, 74, 158, 0.2);
    border-radius: 10px;
    padding: 20px;
    height: 300px;
    overflow-y: auto;
    font-family: 'Consolas', monospace;
    font-size: 13px;
    line-height: 1.6;
  }
  
  .log-entry {
    margin-bottom: 10px;
    padding: 8px 12px;
    border-left: 3px solid var(--primary-pink);
    background: rgba(255, 74, 158, 0.05);
    border-radius: 0 5px 5px 0;
    animation: slideIn 0.3s ease;
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  .log-time {
    color: var(--secondary-pink);
    font-size: 11px;
    margin-right: 10px;
  }
  
  .log-message {
    color: var(--text-light);
  }
  
  .log-success .log-message {
    color: #4aff4a;
  }
  
  .log-error .log-message {
    color: var(--primary-red);
  }
  
  .log-warning .log-message {
    color: #ffcc00;
  }
  
  .log-info .log-message {
    color: var(--light-pink);
  }
  
  /* Task ID Display */
  .task-id-display {
    background: linear-gradient(45deg, 
      rgba(255, 74, 158, 0.1), 
      rgba(255, 71, 87, 0.1));
    border: 2px solid var(--primary-pink);
    border-radius: 10px;
    padding: 20px;
    margin-top: 20px;
    text-align: center;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0% { box-shadow: 0 0 10px rgba(255, 74, 158, 0.3); }
    50% { box-shadow: 0 0 20px rgba(255, 74, 158, 0.5); }
    100% { box-shadow: 0 0 10px rgba(255, 74, 158, 0.3); }
  }
  
  .task-id-display h3 {
    color: var(--light-pink);
    margin-bottom: 10px;
  }
  
  .task-id-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--primary-pink);
    word-break: break-all;
    text-shadow: 0 0 10px rgba(255, 74, 158, 0.5);
  }
  
  /* Cookie Stats */
  .cookie-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    margin-top: 15px;
  }
  
  .cookie-stat {
    background: rgba(255, 74, 158, 0.1);
    border: 1px solid rgba(255, 74, 158, 0.3);
    border-radius: 8px;
    padding: 12px;
    text-align: center;
    transition: all 0.3s ease;
  }
  
  .cookie-stat:hover {
    transform: scale(1.05);
    border-color: var(--primary-pink);
  }
  
  .cookie-stat.active {
    border-color: #4aff4a;
    background: rgba(74, 255, 74, 0.1);
  }
  
  .cookie-number {
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-pink);
    margin-bottom: 5px;
  }
  
  .cookie-status {
    font-size: 11px;
    margin-bottom: 3px;
  }
  
  .cookie-status.active {
    color: #4aff4a;
  }
  
  .cookie-status.inactive {
    color: var(--primary-red);
  }
  
  .cookie-count {
    font-size: 10px;
    color: var(--light-pink);
    opacity: 0.8;
  }
  
  /* Responsive Design */
  @media (max-width: 768px) {
    .control-panels {
      grid-template-columns: 1fr;
    }
    
    .header-content {
      flex-direction: column;
      text-align: center;
    }
    
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    
    .form-buttons {
      flex-direction: column;
    }
    
    .console-tabs {
      flex-wrap: wrap;
    }
    
    .login-box {
      padding: 30px 20px;
      margin: 10px;
    }
  }
  
  /* Scrollbar Styling */
  ::-webkit-scrollbar {
    width: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: rgba(255, 74, 158, 0.1);
    border-radius: 4px;
  }
  
  ::-webkit-scrollbar-thumb {
    background: linear-gradient(45deg, var(--primary-pink), var(--primary-red));
    border-radius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(45deg, var(--secondary-pink), var(--secondary-red));
  }
</style>
</head>
<body>
  <!-- Animated Background -->
  <div class="animated-bg"></div>
  
  <!-- Floating Hearts -->
  <div class="floating-hearts" id="floatingHearts"></div>
  
  <!-- Login Screen -->
  <div class="login-container" id="loginContainer">
    <div class="login-box">
      <div class="login-header">
        <h1>𝕱𝕬𝕴𝕻𝕽𝕴ℕℂ𝕰 𝕸𝕰𝕾𝕾𝕰ℕ𝕲𝕰𝕽</h1>
        <p>Multi-Cookie Conversation System</p>
        <p style="font-size: 12px; margin-top: 5px; color: #ffcccc;">By Faizu • Secure & Powerful</p>
      </div>
      
      <form class="login-form" id="loginForm">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" class="form-input" placeholder="Enter username" required>
        </div>
        
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" class="form-input" placeholder="Enter password" required>
        </div>
        
        <button type="submit" class="login-btn">
          🔐 Login to Dashboard
        </button>
      </form>
      
      <div class="login-footer">
        <p>Secure access • Multiple cookie support • Auto-recovery system</p>
        <p style="margin-top: 10px; font-size: 11px;">v2.0 • Designed with ❤️ by Faizu</p>
      </div>
    </div>
  </div>
  
  <!-- Main Dashboard -->
  <div class="dashboard" id="dashboard">
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <div class="header-title">
          <h1>𝕱𝕬𝕴𝕻𝕽𝕴ℕℂ𝕰 𝕮𝕺ℕ𝕿ℝ𝕺𝕷 𝕻𝕬ℕ𝕰𝕷</h1>
          <p>Multi-Cookie Messenger System | Auto-Recovery Enabled</p>
        </div>
        
        <div class="user-info">
          <span id="welcomeUser">Welcome, Admin!</span>
          <button class="logout-btn" id="logoutBtn">🚪 Logout</button>
        </div>
      </div>
    </div>
    
    <!-- Control Panels -->
    <div class="control-panels">
      <!-- Configuration Panel -->
      <div class="panel config-panel">
        <div class="panel-title">⚙️ Configuration Settings</div>
        
        <div class="form-row">
          <label>Cookie Mode:</label>
          <div style="display: flex; gap: 15px; margin-bottom: 15px;">
            <label style="display: flex; align-items: center; gap: 5px;">
              <input type="radio" name="cookieMode" value="file" checked> Upload File
            </label>
            <label style="display: flex; align-items: center; gap: 5px;">
              <input type="radio" name="cookieMode" value="paste"> Paste Cookies
            </label>
          </div>
        </div>
        
        <div id="cookieFileSection">
          <div class="form-row">
            <label>Upload Cookie File:</label>
            <div class="file-upload">
              <input type="file" id="cookieFile" accept=".txt,.json">
              <div class="file-label">📁 Click to upload cookie file (.txt/.json)</div>
              <small style="color: var(--light-pink); opacity: 0.7; display: block; margin-top: 5px;">
                One cookie per line • Multiple cookies supported
              </small>
            </div>
          </div>
        </div>
        
        <div id="cookiePasteSection" style="display: none;">
          <div class="form-row">
            <label>Paste Cookies:</label>
            <textarea id="cookiePaste" class="form-textarea" 
                      placeholder="Paste cookies here - one per line"></textarea>
          </div>
        </div>
        
        <div class="form-row">
          <label>Hater's Name:</label>
          <input type="text" id="hatersName" class="form-input" 
                 placeholder="Enter hater's name (prefix)">
        </div>
        
        <div class="form-row">
          <label>Last Here Name:</label>
          <input type="text" id="lastHereName" class="form-input" 
                 placeholder="Enter last here name (suffix)">
        </div>
      </div>
      
      <!-- Message Settings Panel -->
      <div class="panel message-panel">
        <div class="panel-title">✉️ Message Settings</div>
        
        <div class="form-row">
          <label>Thread/Group ID:</label>
          <input type="text" id="threadID" class="form-input" 
                 placeholder="Enter target thread/group ID">
        </div>
        
        <div class="form-row">
          <label>Message File:</label>
          <div class="file-upload">
            <input type="file" id="messageFile" accept=".txt">
            <div class="file-label">📄 Click to upload message file (.txt)</div>
            <small style="color: var(--light-pink); opacity: 0.7; display: block; margin-top: 5px;">
              One message per line • Auto-loop enabled
            </small>
          </div>
        </div>
        
        <div class="form-row">
          <label>Delay (seconds):</label>
          <input type="number" id="delay" class="form-input" 
                 value="5" min="1" max="60">
        </div>
        
        <div class="form-buttons">
          <button type="button" id="startBtn" class="btn btn-primary">
            🚀 Start Sending
          </button>
          <button type="button" id="stopBtn" class="btn btn-secondary">
            ⏸️ Stop Task
          </button>
        </div>
      </div>
      
      <!-- Stats Panel -->
      <div class="panel stats-panel">
        <div class="panel-title">📊 Live Statistics</div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" id="statSent">0</div>
            <div class="stat-label">Messages Sent</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="statFailed">0</div>
            <div class="stat-label">Messages Failed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="statActive">0</div>
            <div class="stat-label">Active Cookies</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="statLoops">0</div>
            <div class="stat-label">Loops Completed</div>
          </div>
        </div>
        
        <div id="taskIdDisplay" class="task-id-display" style="display: none;">
          <h3>Your Task ID:</h3>
          <div class="task-id-value" id="currentTaskId"></div>
          <small style="color: var(--light-pink); opacity: 0.7; display: block; margin-top: 5px;">
            Save this ID to stop/view your task later
          </small>
        </div>
      </div>
      
      <!-- Console Panel -->
      <div class="panel console-panel">
        <div class="panel-title">📝 Console Logs</div>
        
        <div class="console-tabs">
          <div class="console-tab active" onclick="switchTab('liveLogs')">Live Logs</div>
          <div class="console-tab" onclick="switchTab('stopTask')">Stop Task</div>
          <div class="console-tab" onclick="switchTab('viewTask')">View Task</div>
        </div>
        
        <!-- Live Logs -->
        <div id="liveLogs" class="console-content active">
          <div class="console-log" id="liveConsole"></div>
        </div>
        
        <!-- Stop Task -->
        <div id="stopTask" class="console-content">
          <div class="form-row">
            <label>Enter Task ID to Stop:</label>
            <input type="text" id="stopTaskId" class="form-input" 
                   placeholder="Paste your task ID here">
          </div>
          <button type="button" id="stopTaskBtn" class="btn btn-primary" style="margin-top: 15px;">
            🛑 Stop This Task
          </button>
          <div id="stopResult" style="margin-top: 15px;"></div>
        </div>
        
        <!-- View Task -->
        <div id="viewTask" class="console-content">
          <div class="form-row">
            <label>Enter Task ID to View:</label>
            <input type="text" id="viewTaskId" class="form-input" 
                   placeholder="Paste your task ID here">
          </div>
          <button type="button" id="viewTaskBtn" class="btn btn-primary" style="margin-top: 15px;">
            👁️ View Task Details
          </button>
          
          <div id="taskDetails" style="display: none; margin-top: 20px;">
            <h4 style="color: var(--light-pink); margin-bottom: 15px;">Task Details:</h4>
            <div id="detailStats" class="stats-grid"></div>
            
            <h4 style="color: var(--light-pink); margin: 20px 0 10px;">Cookie Status:</h4>
            <div id="detailCookies" class="cookie-stats-grid"></div>
            
            <h4 style="color: var(--light-pink); margin: 20px 0 10px;">Recent Logs:</h4>
            <div id="detailLogs" class="console-log" style="height: 150px;"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  // Create floating hearts
  function createFloatingHearts() {
    const container = document.getElementById('floatingHearts');
    for (let i = 0; i < 15; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.innerHTML = '❤';
      heart.style.left = Math.random() * 100 + 'vw';
      heart.style.animationDelay = Math.random() * 15 + 's';
      heart.style.fontSize = (Math.random() * 15 + 10) + 'px';
      container.appendChild(heart);
    }
  }
  
  createFloatingHearts();

  // WebSocket connection
  let socket = null;
  let currentTaskId = null;
  
  // Tab switching
  function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.console-content').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
  }
  
  // Cookie mode toggle
  document.querySelectorAll('input[name="cookieMode"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.value === 'file') {
        document.getElementById('cookieFileSection').style.display = 'block';
        document.getElementById('cookiePasteSection').style.display = 'none';
      } else {
        document.getElementById('cookieFileSection').style.display = 'none';
        document.getElementById('cookiePasteSection').style.display = 'display';
      }
    });
  });
  
  // Login functionality
  document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    // Default credentials
    if (username === 'faizu' && password === 'kingfaizu123') {
      // Hide login, show dashboard
      document.getElementById('loginContainer').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('welcomeUser').textContent = 'Welcome, ' + username + '!';
      
      // Initialize WebSocket connection
      const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(socketProtocol + '//' + location.host);
      
      setupWebSocket();
      
      addLog('✅ Login successful! Welcome to Faizu Messenger System.', 'success');
    } else {
      alert('❌ Invalid credentials! Use: faizu / kingfaizu123');
    }
  });
  
  // Logout functionality
  document.getElementById('logoutBtn').addEventListener('click', function() {
    if (socket) {
      socket.close();
    }
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    addLog('🔒 Logged out successfully.');
  });
  
  // WebSocket setup
  function setupWebSocket() {
    socket.onopen = function() {
      addLog('🔗 Connected to server successfully.', 'success');
    };
    
    socket.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'log') {
          addLog(data.message, data.messageType || 'info');
        } else if (data.type === 'task_started') {
          currentTaskId = data.taskId;
          showTaskId(data.taskId);
          addLog('🚀 Task started successfully! Task ID: ' + data.taskId, 'success');
          addLog('🔢 Multiple cookie support enabled.', 'info');
          addLog('🔄 Auto-recovery system activated.', 'info');
        } else if (data.type === 'task_stopped') {
          if (data.taskId === currentTaskId) {
            hideTaskId();
            addLog('⏹️ Task stopped successfully.', 'info');
            addLog('🔓 Cookies remain logged in - Ready for reuse.', 'success');
          }
        } else if (data.type === 'task_details') {
          displayTaskDetails(data);
        } else if (data.type === 'stats_update') {
          updateStats(data);
        } else if (data.type === 'error') {
          addLog('❌ Error: ' + data.message, 'error');
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
    
    socket.onclose = function() {
      addLog('🔌 Disconnected from server.', 'warning');
    };
    
    socket.onerror = function(error) {
      addLog('⚠️ WebSocket error occurred.', 'error');
    };
  }
  
  // Add log to console
  function addLog(message, type = 'info') {
    const console = document.getElementById('liveConsole');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry log-' + type;
    
    const time = new Date().toLocaleTimeString('en-IN');
    logEntry.innerHTML = '<span class="log-time">[' + time + ']</span>' +
                         '<span class="log-message">' + message + '</span>';
    
    console.appendChild(logEntry);
    console.scrollTop = console.scrollHeight;
  }
  
  // Show task ID
  function showTaskId(taskId) {
    const display = document.getElementById('taskIdDisplay');
    const taskIdElement = document.getElementById('currentTaskId');
    
    taskIdElement.textContent = taskId;
    display.style.display = 'block';
    
    // Update stop task input
    document.getElementById('stopTaskId').value = taskId;
    document.getElementById('viewTaskId').value = taskId;
  }
  
  function hideTaskId() {
    document.getElementById('taskIdDisplay').style.display = 'none';
    document.getElementById('currentTaskId').textContent = '';
  }
  
  // Update stats
  function updateStats(data) {
    document.getElementById('statSent').textContent = data.sent || 0;
    document.getElementById('statFailed').textContent = data.failed || 0;
    document.getElementById('statActive').textContent = data.activeCookies || 0;
    document.getElementById('statLoops').textContent = data.loops || 0;
  }
  
  // Display task details
  function displayTaskDetails(data) {
    const details = document.getElementById('taskDetails');
    details.style.display = 'block';
    
    // Update stats
    const statsGrid = document.getElementById('detailStats');
    statsGrid.innerHTML = \`
      <div class="stat-card">
        <div class="stat-value">\${data.sent || 0}</div>
        <div class="stat-label">Messages Sent</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">\${data.failed || 0}</div>
        <div class="stat-label">Messages Failed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">\${data.activeCookies || 0}</div>
        <div class="stat-label">Active Cookies</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">\${data.totalCookies || 0}</div>
        <div class="stat-label">Total Cookies</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">\${data.loops || 0}</div>
        <div class="stat-label">Loops</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">\${data.restarts || 0}</div>
        <div class="stat-label">Restarts</div>
      </div>
    \`;
    
    // Update cookie stats
    const cookiesGrid = document.getElementById('detailCookies');
    if (data.cookieStats && data.cookieStats.length > 0) {
      cookiesGrid.innerHTML = '';
      data.cookieStats.forEach(cookie => {
        const cookieDiv = document.createElement('div');
        cookieDiv.className = 'cookie-stat ' + (cookie.active ? 'active' : '');
        cookieDiv.innerHTML = \`
          <div class="cookie-number">Cookie \${cookie.cookieNumber}</div>
          <div class="cookie-status \${cookie.active ? 'active' : 'inactive'}">
            \${cookie.active ? '🟢 Active' : '🔴 Inactive'}
          </div>
          <div class="cookie-count">\${cookie.messagesSent || 0} messages</div>
        \`;
        cookiesGrid.appendChild(cookieDiv);
      });
    }
    
    // Update logs
    const logsContainer = document.getElementById('detailLogs');
    logsContainer.innerHTML = '';
    if (data.logs && data.logs.length > 0) {
      data.logs.slice(0, 10).forEach(log => {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry log-' + (log.type || 'info');
        logEntry.innerHTML = '<span class="log-time">[' + log.time + ']</span>' +
                             '<span class="log-message">' + log.message + '</span>';
        logsContainer.appendChild(logEntry);
      });
    }
  }
  
  // Start sending messages
  document.getElementById('startBtn').addEventListener('click', function() {
    const cookieMode = document.querySelector('input[name="cookieMode"]:checked').value;
    let cookieContent = '';
    
    if (cookieMode === 'file') {
      const fileInput = document.getElementById('cookieFile');
      if (fileInput.files.length === 0) {
        addLog('❌ Please select a cookie file.', 'error');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = function(e) {
        cookieContent = e.target.result;
        processStartRequest(cookieContent);
      };
      reader.readAsText(fileInput.files[0]);
    } else {
      cookieContent = document.getElementById('cookiePaste').value;
      if (!cookieContent.trim()) {
        addLog('❌ Please paste cookies in the textarea.', 'error');
        return;
      }
      processStartRequest(cookieContent);
    }
  });
  
  function processStartRequest(cookieContent) {
    const hatersName = document.getElementById('hatersName').value;
    const lastHereName = document.getElementById('lastHereName').value;
    const threadID = document.getElementById('threadID').value;
    const delay = document.getElementById('delay').value;
    
    const messageFile = document.getElementById('messageFile');
    if (messageFile.files.length === 0) {
      addLog('❌ Please select a message file.', 'error');
      return;
    }
    
    if (!hatersName || !lastHereName || !threadID) {
      addLog('❌ Please fill all required fields.', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const messageContent = e.target.result;
      
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'start',
          cookieContent: cookieContent,
          messageContent: messageContent,
          hatersName: hatersName,
          threadID: threadID,
          lastHereName: lastHereName,
          delay: parseInt(delay) || 5,
          cookieMode: document.querySelector('input[name="cookieMode"]:checked').value
        }));
        
        addLog('⏳ Starting task with multiple cookies...', 'info');
      } else {
        addLog('❌ Not connected to server.', 'error');
      }
    };
    reader.readAsText(messageFile.files[0]);
  }
  
  // Stop task
  document.getElementById('stopBtn').addEventListener('click', function() {
    if (currentTaskId && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'stop',
        taskId: currentTaskId
      }));
      addLog('⏳ Stopping current task...', 'info');
    } else {
      addLog('❌ No active task to stop.', 'error');
    }
  });
  
  // Stop specific task
  document.getElementById('stopTaskBtn').addEventListener('click', function() {
    const taskId = document.getElementById('stopTaskId').value.trim();
    if (!taskId) {
      addLog('❌ Please enter a task ID.', 'error');
      return;
    }
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'stop',
        taskId: taskId
      }));
      addLog('⏳ Stopping task: ' + taskId, 'info');
      
      // Show result
      const resultDiv = document.getElementById('stopResult');
      resultDiv.innerHTML = '<div class="log-entry log-info">Request sent to stop task: ' + taskId + '</div>';
      setTimeout(() => {
        resultDiv.innerHTML = '';
      }, 5000);
    }
  });
  
  // View task details
  document.getElementById('viewTaskBtn').addEventListener('click', function() {
    const taskId = document.getElementById('viewTaskId').value.trim();
    if (!taskId) {
      addLog('❌ Please enter a task ID.', 'error');
      return;
    }
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'view_details',
        taskId: taskId
      }));
      addLog('🔍 Fetching details for task: ' + taskId, 'info');
    }
  });
  
  // Input focus effects
  document.querySelectorAll('.form-input, .form-textarea').forEach(input => {
    input.addEventListener('focus', function() {
      this.style.boxShadow = '0 0 15px rgba(255, 74, 158, 0.3)';
      this.style.borderColor = 'var(--primary-pink)';
    });
    
    input.addEventListener('blur', function() {
      this.style.boxShadow = '';
      this.style.borderColor = 'rgba(255, 74, 158, 0.3)';
    });
  });
  
  // Initial log
  setTimeout(() => {
    addLog('🌟 Faizu Messenger System v2.0 loaded successfully.', 'success');
    addLog('🔧 Ready to configure and start tasks.', 'info');
  }, 1000);
</script>
</body>
</html>
`;

// Set up Express server
app.get('/', (req, res) => {
  res.send(htmlLoginPanel);
});

// Login API endpoint
app.post('/api/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (username === adminCredentials.username && password === adminCredentials.password) {
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Faizu Multi-User System running at http://localhost:${PORT}`);
  console.log(`🔐 Login Credentials: faizu / kingfaizu123`);
  console.log(`🎨 Redesigned with Pink/Red Theme`);
  console.log(`✨ Added Login Panel & Smooth Animations`);
  console.log(`🔢 Multiple Cookie Support: ENABLED`);
  
  setupConsoleClear();
});

// WebSocket server
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
          
          // Send initial stats
          ws.send(JSON.stringify({
            type: 'stats_update',
            ...task.getDetails()
          }));
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
            console.log(`🛑 Task stopped: ${data.taskId}`);
          }
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Task not found'
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
            message: 'Task not found'
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
    // Handle disconnect
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down gracefully...');
  if (consoleClearInterval) clearInterval(consoleClearInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Terminating gracefully...');
  if (consoleClearInterval) clearInterval(consoleClearInterval);
  process.exit(0);
});
