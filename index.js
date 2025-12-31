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

// SERVER HEALTH MONITOR
let serverStartTime = Date.now();
let lastNotificationTime = Date.now();
let crashCount = 0;

// Setup server health check
function setupServerHealth() {
    // Check every 12 hours
    setInterval(() => {
        const uptime = Date.now() - serverStartTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        
        console.log(`SERVER STATUS: Running for ${hours} hours | Active Tasks: ${activeTasks.size}`);
        
        // Broadcast server status to all clients
        broadcastToAll({
            type: 'server_status',
            uptime: hours,
            activeTasks: activeTasks.size,
            status: 'RUNNING'
        });
        
        lastNotificationTime = Date.now();
    }, 12 * 60 * 60 * 1000); // 12 hours
    
    // Crash detection and auto-restart simulation
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
            console.log('MEMORY HIGH - Performing cleanup');
            // Clean inactive tasks
            for (let [taskId, task] of activeTasks.entries()) {
                if (!task.config.running) {
                    activeTasks.delete(taskId);
                }
            }
        }
    }, 60000); // Check every minute
}

// Modified Task class with enhanced power
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        this.threadName = userData.threadName || `Thread-${taskId.substring(0, 8)}`;
        
        // Parse multiple cookies
        this.cookies = this.parseCookies(userData.cookieContent);
        this.currentCookieIndex = -1;
        
        this.config = {
            prefix: '',
            delay: userData.delay || 3,
            running: false,
            apis: [],
            repeat: true,
            lastActivity: Date.now(),
            restartCount: 0,
            maxRestarts: 5000,
            threadID: userData.threadID
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
            cookieUsage: Array(this.cookies.length).fill(0),
            startTime: Date.now()
        };
        
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 100;
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
            .map(message => hatersName + ' ' + message + ' ' + lastHereName);
        
        this.addLog(`Loaded ${this.messageData.messages.length} formatted messages for ${this.threadName}`);
        this.addLog(`Detected ${this.cookies.length} cookies`, 'info');
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' }),
            message: message,
            type: messageType
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 200) {
            this.logs = this.logs.slice(0, 200);
        }
        
        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            threadId: this.config.threadID,
            message: message,
            messageType: messageType,
            threadName: this.threadName
        });
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task already running', 'info');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;
        
        if (this.messageData.messages.length === 0) {
            this.addLog('No messages found', 'error');
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
                        this.addLog(`${this.stats.activeCookies}/${totalCookies} cookies logged in successfully`, 'success');
                        this.startSending();
                        resolve(true);
                    } else {
                        this.addLog('All cookies failed to login', 'error');
                        resolve(false);
                    }
                    return;
                }
                
                const cookieIndex = currentIndex;
                const cookieContent = this.cookies[cookieIndex];
                
                setTimeout(() => {
                    this.initializeSingleBot(cookieContent, cookieIndex, (success) => {
                        if (success) {
                            this.stats.activeCookies++;
                        }
                        currentIndex++;
                        loginNextCookie();
                    });
                }, cookieIndex * 1500);
            };
            
            loginNextCookie();
        });
    }

    initializeSingleBot(cookieContent, index, callback) {
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false,
            online: true
        }, (err, api) => {
            if (err || !api) {
                this.addLog(`Cookie ${index + 1} login failed`, 'error');
                this.config.apis[index] = null;
                callback(false);
                return;
            }

            this.config.apis[index] = api;
            this.addLog(`Cookie ${index + 1} logged in`, 'success');
            
            this.setupApiErrorHandling(api, index);
            this.getGroupInfo(api, this.messageData.threadID, index);
            
            callback(true);
        });
    }

    setupApiErrorHandling(api, index) {
        if (api && typeof api.listen === 'function') {
            try {
                api.listen((err) => {
                    if (err && this.config.running) {
                        this.config.apis[index] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        this.addLog(`Cookie ${index + 1} disconnected, reconnecting...`, 'warning');
                        
                        setTimeout(() => {
                            if (this.config.running) {
                                this.initializeSingleBot(this.cookies[index], index, (success) => {
                                    if (success) {
                                        this.stats.activeCookies++;
                                    }
                                });
                            }
                        }, 20000);
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
                        this.addLog(`Cookie ${cookieIndex + 1}: Connected to ${info.name || 'Unknown'}`, 'info');
                    }
                });
            }
        } catch (e) {
            // Silent error
        }
    }

    startSending() {
        if (!this.config.running) return;
        
        const activeApis = this.config.apis.filter(api => api !== null);
        if (activeApis.length === 0) {
            this.addLog('No active cookies available', 'error');
            return;
        }

        this.addLog(`Message sending started with ${activeApis.length} active cookies`, 'info');
        this.sendNextMessage();
    }

    sendNextMessage() {
        if (!this.config.running) return;

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog(`Loop ${this.messageData.loopCount} completed. Restarting.`, 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        const api = this.getNextAvailableApi();
        if (!api) {
            this.addLog('No active cookie, retrying in 5 seconds...', 'warning');
            setTimeout(() => this.sendNextMessage(), 5000);
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

        const maxSendRetries = 15;
        const cookieNum = this.currentCookieIndex + 1;
        
        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');
                
                if (err) {
                    this.stats.failed++;
                    
                    if (retryAttempt < maxSendRetries) {
                        this.addLog(`Cookie ${cookieNum} | RETRY ${retryAttempt + 1}/${maxSendRetries} | Message ${currentIndex + 1}/${totalMessages}`, 'info');
                        
                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 3000);
                    } else {
                        this.addLog(`Cookie ${cookieNum} | FAILED after ${maxSendRetries} retries | ${timestamp}`, 'error');
                        this.config.apis[this.currentCookieIndex] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage();
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog(`Cookie ${cookieNum} | SENT | ${timestamp} | Message ${currentIndex + 1}/${totalMessages} | Loop ${this.messageData.loopCount + 1}`, 'success');
                    
                    this.messageData.currentIndex++;
                    this.scheduleNextMessage();
                }
            });
        } catch (sendError) {
            this.addLog(`Cookie ${cookieNum} | Send error`, 'error');
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
                this.addLog('Error in scheduler, restarting...', 'error');
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('RESTARTING TASK...', 'info');
        this.stats.restarts++;
        this.config.restartCount++;
        
        this.config.apis = [];
        this.stats.activeCookies = 0;
        
        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeAllBots();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('MAX RESTARTS REACHED - Task stopped', 'error');
                this.config.running = false;
            }
        }, 8000);
    }

    stop() {
        this.config.running = false;
        this.stats.activeCookies = 0;
        this.addLog('Task stopped - Cookies remain logged in', 'info');
        return true;
    }

    pause() {
        this.config.running = false;
        this.addLog('Task paused', 'info');
        return true;
    }

    resume() {
        if (this.config.running) {
            this.addLog('Task already running', 'info');
            return false;
        }
        this.config.running = true;
        this.addLog('Task resumed', 'success');
        this.startSending();
        return true;
    }

    getDetails() {
        const activeCookies = this.config.apis.filter(api => api !== null).length;
        const uptime = Date.now() - this.stats.startTime;
        const hours = Math.floor(uptime / (1000 * 60 * 60));
        const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
        
        const cookieStats = this.cookies.map((cookie, index) => ({
            cookieNumber: index + 1,
            active: this.config.apis[index] !== null,
            messagesSent: this.stats.cookieUsage[index] || 0
        }));
        
        return {
            taskId: this.taskId,
            threadId: this.config.threadID,
            threadName: this.threadName,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeCookies: activeCookies,
            totalCookies: this.stats.totalCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            uptime: `${hours}h ${minutes}m`,
            running: this.config.running,
            cookieStats: cookieStats,
            logs: this.logs.slice(0, 50)
        };
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    console.log('Global error:', error.message);
    crashCount++;
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled rejection at:', promise, 'reason:', reason);
});

// WebSocket functions
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

function broadcastToAll(message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // ignore
            }
        }
    });
}

// PREMIUM DESIGN HTML with Soft Pink Theme
const loginPage = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FAIZU XD | SECURE ACCESS</title>
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
  
  body {
    min-height: 100vh;
    background: #0a0a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }
  
  .background-gif {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: -2;
    opacity: 0.7;
  }
  
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, 
      rgba(255, 105, 180, 0.15) 0%, 
      rgba(255, 182, 193, 0.1) 50%, 
      rgba(219, 112, 147, 0.15) 100%);
    z-index: -1;
  }
  
  .login-container {
    width: 100%;
    max-width: 450px;
    padding: 40px;
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(20px);
    border-radius: 20px;
    border: 1px solid rgba(255, 182, 193, 0.3);
    box-shadow: 
      0 10px 40px rgba(255, 105, 180, 0.3),
      0 0 100px rgba(255, 20, 147, 0.2);
    animation: glow 3s infinite alternate;
  }
  
  @keyframes glow {
    from {
      box-shadow: 
        0 10px 40px rgba(255, 105, 180, 0.3),
        0 0 100px rgba(255, 20, 147, 0.2);
    }
    to {
      box-shadow: 
        0 10px 50px rgba(255, 105, 180, 0.5),
        0 0 120px rgba(255, 20, 147, 0.3);
    }
  }
  
  .logo {
    text-align: center;
    margin-bottom: 40px;
  }
  
  .logo h1 {
    color: #ffffff;
    font-size: 36px;
    font-weight: 800;
    letter-spacing: 2px;
    text-shadow: 
      0 0 20px rgba(255, 105, 180, 0.8),
      0 0 40px rgba(255, 20, 147, 0.6);
    margin-bottom: 10px;
  }
  
  .logo .tagline {
    color: #ffb6c1;
    font-size: 14px;
    letter-spacing: 1px;
    opacity: 0.9;
  }
  
  .input-group {
    margin-bottom: 25px;
  }
  
  .input-group label {
    display: block;
    color: #ffb6c1;
    font-size: 14px;
    margin-bottom: 8px;
    font-weight: 500;
    letter-spacing: 0.5px;
  }
  
  .input-group input {
    width: 100%;
    padding: 15px 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 182, 193, 0.4);
    border-radius: 12px;
    color: #ffffff;
    font-size: 16px;
    outline: none;
    transition: all 0.3s ease;
  }
  
  .input-group input:focus {
    border-color: #ff69b4;
    box-shadow: 0 0 20px rgba(255, 105, 180, 0.4);
    background: rgba(255, 255, 255, 0.15);
  }
  
  .login-btn {
    width: 100%;
    padding: 16px;
    background: linear-gradient(135deg, #ff69b4, #ff1493);
    border: none;
    border-radius: 12px;
    color: white;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-top: 10px;
    letter-spacing: 1px;
  }
  
  .login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(255, 105, 180, 0.4);
  }
  
  .login-btn:active {
    transform: translateY(0);
  }
  
  .error-message {
    color: #ff4a4a;
    text-align: center;
    margin-top: 20px;
    font-size: 14px;
    display: none;
  }
  
  .powered-by {
    text-align: center;
    margin-top: 30px;
    color: rgba(255, 182, 193, 0.7);
    font-size: 12px;
    letter-spacing: 1px;
  }
  
  .floating-elements {
    position: fixed;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
  }
  
  .floating-element {
    position: absolute;
    background: rgba(255, 105, 180, 0.1);
    border-radius: 50%;
    animation: float 15s infinite linear;
  }
  
  @keyframes float {
    0% {
      transform: translateY(0) rotate(0deg);
    }
    100% {
      transform: translateY(-1000px) rotate(720deg);
    }
  }
</style>
</head>
<body>
  <img src="https://i.pinimg.com/originals/64/9c/66/649c668b6c1208cce1c7da2b539f8d72.gif" class="background-gif" />
  <div class="overlay"></div>
  
  <div class="floating-elements">
    <div class="floating-element" style="width: 100px; height: 100px; top: 10%; left: 10%; animation-delay: 0s;"></div>
    <div class="floating-element" style="width: 150px; height: 150px; top: 20%; right: 15%; animation-delay: 2s;"></div>
    <div class="floating-element" style="width: 80px; height: 80px; bottom: 30%; left: 20%; animation-delay: 4s;"></div>
    <div class="floating-element" style="width: 120px; height: 120px; bottom: 20%; right: 20%; animation-delay: 6s;"></div>
  </div>
  
  <div class="login-container">
    <div class="logo">
      <h1>FAIZU XD</h1>
      <div class="tagline">PREMIUM MULTI-THREAD CONTROL SYSTEM</div>
    </div>
    
    <form id="loginForm">
      <div class="input-group">
        <label>USER NAME</label>
        <input type="text" id="username" placeholder="Enter username" required>
      </div>
      
      <div class="input-group">
        <label>PASSWORD</label>
        <input type="password" id="password" placeholder="Enter password" required>
      </div>
      
      <button type="submit" class="login-btn">SECURE LOGIN</button>
      
      <div id="errorMessage" class="error-message">Invalid credentials</div>
    </form>
    
    <div class="powered-by">
      POWERED BY FAIZU XD | ENTERPRISE EDITION
    </div>
  </div>

<script>
  document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    if (username === 'Faizu Xd' && password === 'Justfuckaway') {
      // Store session and redirect
      sessionStorage.setItem('faizu_auth', 'true');
      window.location.href = '/control';
    } else {
      const error = document.getElementById('errorMessage');
      error.style.display = 'block';
      
      // Shake animation
      const form = document.querySelector('.login-container');
      form.style.animation = 'none';
      setTimeout(() => {
        form.style.animation = 'glow 3s infinite alternate';
      }, 10);
    }
  });
  
  // Check if already logged in
  if (sessionStorage.getItem('faizu_auth') === 'true') {
    window.location.href = '/control';
  }
</script>
</body>
</html>
`;

const controlPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>FAIZU XD | CONTROL PANEL</title>
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
  
  body {
    min-height: 100vh;
    background: #0a0a1a;
    color: #ffffff;
    overflow-x: hidden;
    position: relative;
  }
  
  .background-gif {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    z-index: -2;
    opacity: 0.6;
  }
  
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, 
      rgba(255, 105, 180, 0.1) 0%, 
      rgba(255, 182, 193, 0.05) 50%, 
      rgba(219, 112, 147, 0.1) 100%);
    z-index: -1;
  }
  
  .header {
    padding: 20px 40px;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(15px);
    border-bottom: 1px solid rgba(255, 182, 193, 0.2);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  
  .logo {
    display: flex;
    align-items: center;
    gap: 15px;
  }
  
  .logo h1 {
    color: #ffffff;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-shadow: 0 0 10px rgba(255, 105, 180, 0.5);
  }
  
  .server-status {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #4CAF50;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
  }
  
  .notification-bell {
    position: relative;
    cursor: pointer;
    font-size: 20px;
    color: #ffb6c1;
  }
  
  .notification-count {
    position: absolute;
    top: -8px;
    right: -8px;
    background: #ff1493;
    color: white;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 16px;
    text-align: center;
  }
  
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 30px;
  }
  
  .panels-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin-bottom: 30px;
  }
  
  .panel {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border-radius: 15px;
    border: 1px solid rgba(255, 182, 193, 0.2);
    padding: 25px;
    transition: all 0.3s ease;
  }
  
  .panel:hover {
    border-color: rgba(255, 105, 180, 0.4);
    box-shadow: 0 10px 30px rgba(255, 105, 180, 0.1);
  }
  
  .panel-title {
    color: #ffb6c1;
    font-size: 18px;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 182, 193, 0.2);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  
  .input-group {
    margin-bottom: 20px;
  }
  
  .input-group label {
    display: block;
    color: #ffb6c1;
    font-size: 14px;
    margin-bottom: 8px;
    font-weight: 500;
  }
  
  .input-group input,
  .input-group textarea,
  .input-group select {
    width: 100%;
    padding: 12px 15px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 182, 193, 0.3);
    border-radius: 8px;
    color: #ffffff;
    font-size: 14px;
    outline: none;
    transition: all 0.3s ease;
  }
  
  .input-group input:focus,
  .input-group textarea:focus,
  .input-group select:focus {
    border-color: #ff69b4;
    box-shadow: 0 0 15px rgba(255, 105, 180, 0.3);
  }
  
  .file-input-wrapper {
    position: relative;
    overflow: hidden;
    display: inline-block;
    width: 100%;
  }
  
  .file-input-wrapper input[type=file] {
    position: absolute;
    left: 0;
    top: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  
  .file-input-label {
    display: block;
    padding: 12px 15px;
    background: rgba(255, 105, 180, 0.1);
    border: 1px dashed rgba(255, 182, 193, 0.4);
    border-radius: 8px;
    text-align: center;
    color: #ffb6c1;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .file-input-label:hover {
    background: rgba(255, 105, 180, 0.2);
    border-color: #ff69b4;
  }
  
  .cookie-format {
    display: flex;
    gap: 15px;
    margin-bottom: 20px;
  }
  
  .cookie-format label {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  
  .cookie-format input[type="radio"] {
    accent-color: #ff69b4;
  }
  
  .buttons-group {
    display: flex;
    gap: 15px;
    margin-top: 25px;
  }
  
  .btn {
    padding: 12px 25px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    letter-spacing: 0.5px;
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #ff69b4, #ff1493);
    color: white;
  }
  
  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #ffb6c1;
    border: 1px solid rgba(255, 182, 193, 0.3);
  }
  
  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(255, 105, 180, 0.3);
  }
  
  .btn:active {
    transform: translateY(0);
  }
  
  .tasks-container {
    margin-top: 40px;
  }
  
  .tasks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 25px;
    margin-top: 20px;
  }
  
  .task-card {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    border: 1px solid rgba(255, 182, 193, 0.2);
    padding: 20px;
    transition: all 0.3s ease;
  }
  
  .task-card.running {
    border-color: rgba(76, 175, 80, 0.4);
    background: rgba(76, 175, 80, 0.05);
  }
  
  .task-card.paused {
    border-color: rgba(255, 193, 7, 0.4);
    background: rgba(255, 193, 7, 0.05);
  }
  
  .task-card.stopped {
    border-color: rgba(244, 67, 54, 0.4);
    background: rgba(244, 67, 54, 0.05);
  }
  
  .task-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }
  
  .task-title {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
  }
  
  .task-status {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 12px;
    font-weight: 600;
  }
  
  .status-running {
    background: rgba(76, 175, 80, 0.2);
    color: #4CAF50;
  }
  
  .status-paused {
    background: rgba(255, 193, 7, 0.2);
    color: #FFC107;
  }
  
  .status-stopped {
    background: rgba(244, 67, 54, 0.2);
    color: #F44336;
  }
  
  .task-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .stat-item {
    background: rgba(255, 255, 255, 0.05);
    padding: 10px;
    border-radius: 8px;
    text-align: center;
  }
  
  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #ff69b4;
    margin-bottom: 3px;
  }
  
  .stat-label {
    font-size: 11px;
    color: #ffb6c1;
    opacity: 0.8;
  }
  
  .task-actions {
    display: flex;
    gap: 10px;
    margin-top: 15px;
  }
  
  .task-btn {
    flex: 1;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .btn-resume {
    background: rgba(76, 175, 80, 0.2);
    color: #4CAF50;
    border: 1px solid rgba(76, 175, 80, 0.3);
  }
  
  .btn-pause {
    background: rgba(255, 193, 7, 0.2);
    color: #FFC107;
    border: 1px solid rgba(255, 193, 7, 0.3);
  }
  
  .btn-stop {
    background: rgba(244, 67, 54, 0.2);
    color: #F44336;
    border: 1px solid rgba(244, 67, 54, 0.3);
  }
  
  .task-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  }
  
  .logs-container {
    margin-top: 40px;
  }
  
  .logs-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 182, 193, 0.2);
    padding-bottom: 10px;
  }
  
  .log-tab {
    padding: 10px 20px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    border: 1px solid rgba(255, 182, 193, 0.2);
    transition: all 0.3s ease;
    font-size: 14px;
  }
  
  .log-tab.active {
    background: rgba(255, 105, 180, 0.2);
    border-color: rgba(255, 105, 180, 0.4);
    color: #ff69b4;
  }
  
  .log-content {
    display: none;
    animation: fadeIn 0.5s ease;
  }
  
  .log-content.active {
    display: block;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  
  .log-box {
    height: 300px;
    overflow-y: auto;
    background: rgba(15, 15, 35, 0.8);
    border-radius: 8px;
    padding: 15px;
    border: 1px solid rgba(255, 182, 193, 0.2);
    font-family: 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
  }
  
  .log-entry {
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid #ff69b4;
  }
  
  .log-entry.success {
    border-left-color: #4CAF50;
    background: rgba(76, 175, 80, 0.05);
  }
  
  .log-entry.error {
    border-left-color: #F44336;
    background: rgba(244, 67, 54, 0.05);
  }
  
  .log-entry.warning {
    border-left-color: #FFC107;
    background: rgba(255, 193, 7, 0.05);
  }
  
  .log-time {
    color: #ffb6c1;
    font-size: 11px;
    margin-right: 10px;
  }
  
  .log-message {
    color: #ffffff;
  }
  
  .notification-panel {
    position: fixed;
    top: 100px;
    right: 30px;
    width: 350px;
    background: rgba(20, 20, 40, 0.95);
    backdrop-filter: blur(20px);
    border-radius: 12px;
    border: 1px solid rgba(255, 182, 193, 0.3);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    display: none;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  }
  
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  .notification-header {
    padding: 15px 20px;
    border-bottom: 1px solid rgba(255, 182, 193, 0.2);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .notification-header h3 {
    color: #ffb6c1;
    font-size: 16px;
  }
  
  .notification-close {
    background: none;
    border: none;
    color: #ffb6c1;
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
  }
  
  .notification-body {
    padding: 20px;
    max-height: 400px;
    overflow-y: auto;
  }
  
  .notification-item {
    padding: 10px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    border-left: 3px solid #ff69b4;
  }
  
  .notification-item.critical {
    border-left-color: #F44336;
  }
  
  .notification-item.warning {
    border-left-color: #FFC107;
  }
  
  .notification-item.info {
    border-left-color: #2196F3;
  }
  
  .notification-time {
    font-size: 11px;
    color: #ffb6c1;
    margin-bottom: 5px;
  }
  
  .notification-text {
    font-size: 13px;
    color: #ffffff;
  }
  
  .floating-controls {
    position: fixed;
    bottom: 30px;
    right: 30px;
    display: flex;
    gap: 15px;
    z-index: 100;
  }
  
  .floating-btn {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ff69b4, #ff1493);
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 5px 20px rgba(255, 105, 180, 0.4);
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .floating-btn:hover {
    transform: translateY(-3px) scale(1.1);
    box-shadow: 0 8px 25px rgba(255, 105, 180, 0.6);
  }
  
  .modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    z-index: 2000;
    align-items: center;
    justify-content: center;
  }
  
  .modal-content {
    background: rgba(20, 20, 40, 0.95);
    backdrop-filter: blur(20px);
    border-radius: 15px;
    border: 1px solid rgba(255, 182, 193, 0.3);
    width: 90%;
    max-width: 500px;
    padding: 30px;
    animation: modalIn 0.3s ease;
  }
  
  @keyframes modalIn {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 15px;
    border-bottom: 1px solid rgba(255, 182, 193, 0.2);
  }
  
  .modal-header h3 {
    color: #ffb6c1;
    font-size: 20px;
  }
  
  .modal-close {
    background: none;
    border: none;
    color: #ffb6c1;
    font-size: 24px;
    cursor: pointer;
    line-height: 1;
  }
  
  .modal-body {
    color: #ffffff;
  }
  
  @media (max-width: 1024px) {
    .panels-grid {
      grid-template-columns: 1fr;
    }
    
    .tasks-grid {
      grid-template-columns: 1fr;
    }
  }
  
  @media (max-width: 768px) {
    .header {
      padding: 15px 20px;
      flex-direction: column;
      gap: 15px;
    }
    
    .container {
      padding: 20px;
    }
    
    .buttons-group {
      flex-direction: column;
    }
    
    .notification-panel {
      width: calc(100% - 40px);
      right: 20px;
      left: 20px;
    }
  }
</style>
</head>
<body>
  <img src="https://i.pinimg.com/originals/80/b1/cf/80b1cf27df714a3ba0da909fd3f3f221.gif" class="background-gif" />
  <div class="overlay"></div>
  
  <div class="header">
    <div class="logo">
      <h1>FAIZU XD CONTROL</h1>
      <div class="status-indicator">
        <div class="status-dot"></div>
        <span>SERVER RUNNING</span>
      </div>
    </div>
    
    <div class="server-status">
      <div class="notification-bell" onclick="toggleNotifications()">
        <span>🔔</span>
        <span class="notification-count" id="notificationCount">0</span>
      </div>
      <button class="btn btn-secondary" onclick="logout()">LOGOUT</button>
    </div>
  </div>
  
  <div class="container">
    <div class="panels-grid">
      <div class="panel">
        <div class="panel-title">NEW TASK CONFIGURATION</div>
        
        <div class="cookie-format">
          <label>
            <input type="radio" name="cookieFormat" value="file" checked>
            Upload Cookie File
          </label>
          <label>
            <input type="radio" name="cookieFormat" value="paste">
            Paste Cookies
          </label>
        </div>
        
        <div id="cookieFileSection">
          <div class="input-group">
            <label>COOKIE FILE (.txt)</label>
            <div class="file-input-wrapper">
              <input type="file" id="cookieFile" accept=".txt">
              <div class="file-input-label" id="cookieFileLabel">Choose Cookie File</div>
            </div>
          </div>
        </div>
        
        <div id="cookiePasteSection" style="display: none;">
          <div class="input-group">
            <label>PASTE COOKIES (One per line)</label>
            <textarea id="cookiePaste" rows="4" placeholder="Paste cookies here..."></textarea>
          </div>
        </div>
        
        <div class="input-group">
          <label>THREAD / GROUP ID</label>
          <input type="text" id="threadId" placeholder="Enter thread ID">
        </div>
        
        <div class="input-group">
          <label>THREAD NAME (Optional)</label>
          <input type="text" id="threadName" placeholder="Enter custom thread name">
        </div>
        
        <div class="input-group">
          <label>MESSAGES FILE (.txt)</label>
          <div class="file-input-wrapper">
            <input type="file" id="messageFile" accept=".txt">
            <div class="file-input-label" id="messageFileLabel">Choose Messages File</div>
          </div>
        </div>
        
        <div class="input-group">
          <label>DELAY BETWEEN MESSAGES (Seconds)</label>
          <input type="number" id="delay" value="3" min="1" max="60">
        </div>
        
        <div class="buttons-group">
          <button class="btn btn-primary" onclick="startNewTask()">START NEW TASK</button>
          <button class="btn btn-secondary" onclick="clearForm()">CLEAR FORM</button>
        </div>
      </div>
      
      <div class="panel">
        <div class="panel-title">SERVER INFORMATION</div>
        
        <div class="input-group">
          <label>SERVER UPTIME</label>
          <div id="serverUptime" style="color: #ff69b4; font-size: 18px; font-weight: bold;">Loading...</div>
        </div>
        
        <div class="input-group">
          <label>ACTIVE TASKS</label>
          <div id="activeTasksCount" style="color: #4CAF50; font-size: 18px; font-weight: bold;">0</div>
        </div>
        
        <div class="input-group">
          <label>MEMORY USAGE</label>
          <div id="memoryUsage" style="color: #2196F3; font-size: 18px; font-weight: bold;">Loading...</div>
        </div>
        
        <div class="input-group">
          <label>LAST UPDATE</label>
          <div id="lastUpdate" style="color: #FFC107; font-size: 14px;">-</div>
        </div>
        
        <div class="buttons-group">
          <button class="btn btn-secondary" onclick="refreshServerInfo()">REFRESH INFO</button>
          <button class="btn btn-secondary" onclick="showAllTasks()">VIEW ALL TASKS</button>
        </div>
      </div>
    </div>
    
    <div class="tasks-container">
      <div class="panel-title">ACTIVE TASKS</div>
      <div id="tasksGrid" class="tasks-grid">
        <!-- Tasks will be displayed here -->
      </div>
    </div>
    
    <div class="logs-container">
      <div class="logs-tabs">
        <div class="log-tab active" onclick="switchLogTab('global')">GLOBAL LOGS</div>
        <div class="log-tab" onclick="switchLogTab('server')">SERVER LOGS</div>
        <div class="log-tab" onclick="switchLogTab('errors')">ERROR LOGS</div>
      </div>
      
      <div id="globalLogTab" class="log-content active">
        <div class="log-box" id="globalLogs"></div>
      </div>
      
      <div id="serverLogTab" class="log-content">
        <div class="log-box" id="serverLogs"></div>
      </div>
      
      <div id="errorsLogTab" class="log-content">
        <div class="log-box" id="errorLogs"></div>
      </div>
    </div>
  </div>
  
  <!-- Notifications Panel -->
  <div class="notification-panel" id="notificationPanel">
    <div class="notification-header">
      <h3>NOTIFICATIONS</h3>
      <button class="notification-close" onclick="toggleNotifications()">×</button>
    </div>
    <div class="notification-body" id="notificationList">
      <!-- Notifications will be added here -->
    </div>
  </div>
  
  <!-- Floating Controls -->
  <div class="floating-controls">
    <button class="floating-btn" onclick="scrollToTop()">↑</button>
    <button class="floating-btn" onclick="toggleNotifications()">🔔</button>
    <button class="floating-btn" onclick="showHelp()">?</button>
  </div>
  
  <!-- WebSocket connection -->
  <script>
    let socket;
    let tasks = {};
    let notifications = [];
    
    function initWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(protocol + '//' + window.location.host);
      
      socket.onopen = () => {
        addLog('Connected to server', 'info', 'global');
        addLog('System initialized', 'info', 'server');
        checkAuth();
      };
      
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch(data.type) {
            case 'task_started':
              handleTaskStarted(data);
              break;
              
            case 'task_updated':
              updateTask(data);
              break;
              
            case 'task_stopped':
              handleTaskStopped(data);
              break;
              
            case 'log':
              handleLog(data);
              break;
              
            case 'server_status':
              updateServerStatus(data);
              break;
              
            case 'notification':
              addNotification(data);
              break;
              
            case 'error':
              handleError(data);
              break;
          }
        } catch (e) {
          console.error('Error processing message:', e);
        }
      };
      
      socket.onclose = () => {
        addLog('Disconnected from server', 'error', 'global');
        setTimeout(initWebSocket, 3000);
      };
      
      socket.onerror = (error) => {
        addLog('Connection error', 'error', 'global');
      };
    }
    
    function checkAuth() {
      if (sessionStorage.getItem('faizu_auth') !== 'true') {
        window.location.href = '/';
      }
    }
    
    function handleTaskStarted(data) {
      tasks[data.taskId] = data;
      addLog('New task started: ' + data.threadName, 'success', 'global');
      addNotification({
        type: 'info',
        message: 'New task started: ' + data.threadName,
        time: new Date().toLocaleTimeString()
      });
      updateTasksDisplay();
    }
    
    function updateTask(data) {
      if (tasks[data.taskId]) {
        Object.assign(tasks[data.taskId], data);
        updateTasksDisplay();
      }
    }
    
    function handleTaskStopped(data) {
      if (tasks[data.taskId]) {
        addLog('Task stopped: ' + tasks[data.taskId].threadName, 'info', 'global');
        delete tasks[data.taskId];
        updateTasksDisplay();
      }
    }
    
    function handleLog(data) {
      let tab = 'global';
      if (data.messageType === 'error') tab = 'errors';
      else if (data.message.includes('SERVER')) tab = 'server';
      
      addLog('[' + data.threadName + '] ' + data.message, data.messageType, tab);
    }
    
    function handleError(data) {
      addLog('Error: ' + data.message, 'error', 'errors');
      addNotification({
        type: 'critical',
        message: data.message,
        time: new Date().toLocaleTimeString()
      });
    }
    
    function updateServerStatus(data) {
      document.getElementById('serverUptime').textContent = data.uptime + ' hours';
      document.getElementById('activeTasksCount').textContent = data.activeTasks;
      document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
      
      if (data.status !== 'RUNNING') {
        addNotification({
          type: 'critical',
          message: 'Server status: ' + data.status,
          time: new Date().toLocaleTimeString()
        });
      }
    }
    
    function addNotification(notification) {
      notifications.unshift(notification);
      if (notifications.length > 20) {
        notifications = notifications.slice(0, 20);
      }
      updateNotificationsDisplay();
    }
    
    // UI Functions
    function updateTasksDisplay() {
      const container = document.getElementById('tasksGrid');
      container.innerHTML = '';
      
      Object.values(tasks).forEach(task => {
        const card = createTaskCard(task);
        container.appendChild(card);
      });
      
      document.getElementById('activeTasksCount').textContent = Object.keys(tasks).length;
    }
    
    function createTaskCard(task) {
      const card = document.createElement('div');
      card.className = 'task-card ' + (task.running ? 'running' : 'stopped');
      
      const statusClass = task.running ? 'status-running' : 'status-stopped';
      const statusText = task.running ? 'RUNNING' : 'STOPPED';
      
      card.innerHTML = \`
        <div class="task-header">
          <div class="task-title">\${task.threadName}</div>
          <div class="task-status \${statusClass}">\${statusText}</div>
        </div>
        
        <div class="task-stats">
          <div class="stat-item">
            <div class="stat-value">\${task.sent || 0}</div>
            <div class="stat-label">SENT</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">\${task.failed || 0}</div>
            <div class="stat-label">FAILED</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">\${task.activeCookies || 0}/\${task.totalCookies || 0}</div>
            <div class="stat-label">COOKIES</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">\${task.loops || 0}</div>
            <div class="stat-label">LOOPS</div>
          </div>
        </div>
        
        <div class="input-group">
          <label>THREAD ID</label>
          <input type="text" value="\${task.threadId}" readonly style="font-size: 12px;">
        </div>
        
        <div class="input-group">
          <label>UPTIME</label>
          <input type="text" value="\${task.uptime || '0h 0m'}" readonly>
        </div>
        
        <div class="task-actions">
          <button class="task-btn btn-resume" onclick="controlTask('\${task.taskId}', 'resume')" \${task.running ? 'disabled' : ''}>
            RESUME
          </button>
          <button class="task-btn btn-pause" onclick="controlTask('\${task.taskId}', 'pause')" \${!task.running ? 'disabled' : ''}>
            PAUSE
          </button>
          <button class="task-btn btn-stop" onclick="controlTask('\${task.taskId}', 'stop')">
            STOP
          </button>
        </div>
      \`;
      
      return card;
    }
    
    function updateNotificationsDisplay() {
      const list = document.getElementById('notificationList');
      const count = document.getElementById('notificationCount');
      
      list.innerHTML = '';
      count.textContent = notifications.length;
      
      notifications.forEach(notification => {
        const item = document.createElement('div');
        item.className = 'notification-item ' + notification.type;
        item.innerHTML = \`
          <div class="notification-time">\${notification.time}</div>
          <div class="notification-text">\${notification.message}</div>
        \`;
        list.appendChild(item);
      });
    }
    
    function addLog(message, type, tab) {
      const container = document.getElementById(tab + 'Logs');
      const entry = document.createElement('div');
      entry.className = 'log-entry ' + type;
      entry.innerHTML = \`
        <span class="log-time">[\${new Date().toLocaleTimeString()}]</span>
        <span class="log-message">\${message}</span>
      \`;
      
      container.insertBefore(entry, container.firstChild);
      
      if (container.children.length > 100) {
        container.removeChild(container.lastChild);
      }
    }
    
    // Control Functions
    function startNewTask() {
      const cookieFormat = document.querySelector('input[name="cookieFormat"]:checked').value;
      let cookieContent = '';
      
      if (cookieFormat === 'file') {
        const fileInput = document.getElementById('cookieFile');
        if (!fileInput.files[0]) {
          alert('Please select a cookie file');
          return;
        }
        const reader = new FileReader();
        reader.onload = function(e) {
          cookieContent = e.target.result;
          completeTaskStart(cookieContent);
        };
        reader.readAsText(fileInput.files[0]);
      } else {
        cookieContent = document.getElementById('cookiePaste').value;
        if (!cookieContent.trim()) {
          alert('Please paste cookies');
          return;
        }
        completeTaskStart(cookieContent);
      }
    }
    
    function completeTaskStart(cookieContent) {
      const threadId = document.getElementById('threadId').value;
      const threadName = document.getElementById('threadName').value || ('Thread-' + Date.now().toString().slice(-6));
      const delay = document.getElementById('delay').value;
      
      const messageFile = document.getElementById('messageFile');
      if (!messageFile.files[0]) {
        alert('Please select a messages file');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = function(e) {
        const messageContent = e.target.result;
        
        socket.send(JSON.stringify({
          type: 'start',
          cookieContent: cookieContent,
          messageContent: messageContent,
          threadID: threadId,
          threadName: threadName,
          delay: parseInt(delay) || 3
        }));
        
        addLog('Starting new task for ' + threadName, 'info', 'global');
      };
      reader.readAsText(messageFile.files[0]);
    }
    
    function controlTask(taskId, action) {
      socket.send(JSON.stringify({
        type: 'control',
        taskId: taskId,
        action: action
      }));
    }
    
    function toggleNotifications() {
      const panel = document.getElementById('notificationPanel');
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }
    
    function switchLogTab(tabName) {
      document.querySelectorAll('.log-content').forEach(tab => {
        tab.classList.remove('active');
      });
      document.querySelectorAll('.log-tab').forEach(tab => {
        tab.classList.remove('active');
      });
      
      document.getElementById(tabName + 'LogTab').classList.add('active');
      event.target.classList.add('active');
    }
    
    function logout() {
      sessionStorage.removeItem('faizu_auth');
      window.location.href = '/';
    }
    
    function scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    function showHelp() {
      alert('FAIZU XD CONTROL PANEL\n\n' +
            '1. Upload cookies or paste them directly\n' +
            '2. Enter thread ID and custom name\n' +
            '3. Upload messages file\n' +
            '4. Start task\n\n' +
            'Each thread has separate controls\n' +
            'System auto-recovers from errors');
    }
    
    function clearForm() {
      document.getElementById('cookieFile').value = '';
      document.getElementById('cookiePaste').value = '';
      document.getElementById('threadId').value = '';
      document.getElementById('threadName').value = '';
      document.getElementById('messageFile').value = '';
      document.getElementById('delay').value = '3';
      document.getElementById('cookieFileLabel').textContent = 'Choose Cookie File';
      document.getElementById('messageFileLabel').textContent = 'Choose Messages File';
    }
    
    function refreshServerInfo() {
      socket.send(JSON.stringify({ type: 'get_status' }));
      addLog('Refreshed server information', 'info', 'server');
    }
    
    function showAllTasks() {
      alert('Active Tasks: ' + Object.keys(tasks).length + '\n' +
            Object.values(tasks).map(t => t.threadName).join('\n'));
    }
    
    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
      initWebSocket();
      
      // Cookie format toggle
      document.querySelectorAll('input[name="cookieFormat"]').forEach(radio => {
        radio.addEventListener('change', function() {
          document.getElementById('cookieFileSection').style.display = 
            this.value === 'file' ? 'block' : 'none';
          document.getElementById('cookiePasteSection').style.display = 
            this.value === 'paste' ? 'block' : 'none';
        });
      });
      
      // File input labels
      document.getElementById('cookieFile').addEventListener('change', function() {
        document.getElementById('cookieFileLabel').textContent = 
          this.files[0] ? this.files[0].name : 'Choose Cookie File';
      });
      
      document.getElementById('messageFile').addEventListener('change', function() {
        document.getElementById('messageFileLabel').textContent = 
          this.files[0] ? this.files[0].name : 'Choose Messages File';
      });
      
      // Initialize memory usage display
      updateMemoryUsage();
      setInterval(updateMemoryUsage, 10000);
    });
    
    function updateMemoryUsage() {
      const memory = performance.memory;
      if (memory) {
        const used = Math.round(memory.usedJSHeapSize / 1024 / 1024);
        const total = Math.round(memory.totalJSHeapSize / 1024 / 1024);
        document.getElementById('memoryUsage').textContent = used + 'MB / ' + total + 'MB';
      }
    }
    
    // Auto refresh tasks every 5 seconds
    setInterval(() => {
      if (Object.keys(tasks).length > 0) {
        socket.send(JSON.stringify({ type: 'get_all_tasks' }));
      }
    }, 5000);
  </script>
</body>
</html>
`;

// Set up Express routes
app.get('/', (req, res) => {
  res.send(loginPage);
});

app.get('/control', (req, res) => {
  // Check if user is authenticated via WebSocket instead
  res.send(controlPanel);
});

// Start server
const server = app.listen(PORT, () => {
  console.log('FAIZU XD PREMIUM SYSTEM STARTED');
  console.log('Server running on port: ' + PORT);
  console.log('Multi-thread support: ENABLED');
  console.log('Auto-recovery: ENABLED');
  console.log('Notification system: ACTIVE');
  
  // Setup server health monitoring
  setupServerHealth();
});

// Set up WebSocket server
let wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  ws.taskId = null;
  ws.authenticated = false;
  
  // Check authentication
  const url = new URL(req.url, `http://${req.headers.host}`);
  const authToken = url.searchParams.get('auth');
  
  if (authToken === 'faizu_xd_auth') {
    ws.authenticated = true;
  }
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (!ws.authenticated && data.type !== 'auth') {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }));
        return;
      }
      
      switch(data.type) {
        case 'auth':
          if (data.username === 'Faizu Xd' && data.password === 'Justfuckaway') {
            ws.authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_success' }));
            
            // Send initial server status
            const uptime = Math.floor((Date.now() - serverStartTime) / (1000 * 60 * 60));
            ws.send(JSON.stringify({
              type: 'server_status',
              uptime: uptime,
              activeTasks: activeTasks.size,
              status: 'RUNNING'
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid credentials'
            }));
          }
          break;
          
        case 'start':
          if (!ws.authenticated) return;
          
          const taskId = uuidv4();
          ws.taskId = taskId;
          
          const task = new Task(taskId, {
            cookieContent: data.cookieContent,
            messageContent: data.messageContent,
            threadID: data.threadID,
            threadName: data.threadName,
            delay: data.delay
          });
          
          if (task.start()) {
            activeTasks.set(taskId, task);
            
            // Send task started notification
            ws.send(JSON.stringify({
              type: 'task_started',
              taskId: taskId,
              threadId: task.config.threadID,
              threadName: task.threadName,
              running: true
            }));
            
            console.log(`New task started: ${taskId} - ${task.threadName}`);
            
            // Send initial task details
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'task_updated',
                ...task.getDetails()
              }));
            }, 1000);
          }
          break;
          
        case 'control':
          if (!ws.authenticated) return;
          
          const controlTask = activeTasks.get(data.taskId);
          if (controlTask) {
            let success = false;
            switch(data.action) {
              case 'pause':
                success = controlTask.pause();
                break;
              case 'resume':
                success = controlTask.resume();
                break;
              case 'stop':
                success = controlTask.stop();
                activeTasks.delete(data.taskId);
                break;
            }
            
            if (success) {
              ws.send(JSON.stringify({
                type: 'task_updated',
                ...controlTask.getDetails()
              }));
            }
          }
          break;
          
        case 'get_status':
          if (!ws.authenticated) return;
          
          const uptime = Math.floor((Date.now() - serverStartTime) / (1000 * 60 * 60));
          ws.send(JSON.stringify({
            type: 'server_status',
            uptime: uptime,
            activeTasks: activeTasks.size,
            status: 'RUNNING',
            memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
          }));
          break;
          
        case 'get_all_tasks':
          if (!ws.authenticated) return;
          
          activeTasks.forEach((task, taskId) => {
            ws.send(JSON.stringify({
              type: 'task_updated',
              ...task.getDetails()
            }));
          });
          break;
      }
      
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });

  ws.on('close', () => {
    // Silent disconnect
  });
});

// Task status broadcaster
setInterval(() => {
  activeTasks.forEach((task, taskId) => {
    if (task.config.running) {
      const details = task.getDetails();
      broadcastToTask(taskId, {
        type: 'task_updated',
        ...details
      });
    }
  });
}, 2000);

// Auto server notifications every 6 hours
setInterval(() => {
  const uptime = Math.floor((Date.now() - serverStartTime) / (1000 * 60 * 60));
  const notification = {
    type: 'info',
    message: `Server running for ${uptime} hours | Active tasks: ${activeTasks.size}`,
    time: new Date().toLocaleTimeString()
  };
  
  broadcastToAll({
    type: 'notification',
    ...notification
  });
}, 6 * 60 * 60 * 1000);

// Crash detection
process.on('uncaughtException', (error) => {
  crashCount++;
  console.log('System recovered from error:', error.message);
  
  broadcastToAll({
    type: 'notification',
    notificationType: 'warning',
    message: `System recovered from error (Crash count: ${crashCount})`,
    time: new Date().toLocaleTimeString()
  });
});

console.log('FAIZU XD PREMIUM SYSTEM READY');
console.log('All features enabled');
console.log('Multiple thread support: ACTIVE');
console.log('Auto-recovery system: ACTIVE');
console.log('Notification system: ACTIVE');
console.log('Server monitoring: ACTIVE');
