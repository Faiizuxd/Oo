// save as server.js
// npm install express ws axios w3-fca uuid

const fs = require('fs');
const express = require('express');
const wiegine = require('w3-fca'); // CHANGED: w3-fca instead of fca-mafiya
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
<title>T3RROR SYSTEM</title>
<style>
  * {
    box-sizing: border-box;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  }
  html, body {
    height: 100%;
    margin: 0;
    background: #0a0a0a;
    color: #e0e0e0;
  }
  
  body {
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
    overflow-y: auto;
    position: relative;
  }
  
  .banner-container {
    width: 100%;
    height: 150px;
    overflow: hidden;
    position: relative;
    border-bottom: 3px solid #ff4444;
    box-shadow: 0 5px 20px rgba(255, 68, 68, 0.3);
  }
  
  .banner-gif {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: brightness(0.7) contrast(1.2);
  }
  
  .logo-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2;
    text-align: center;
  }
  
  .logo-text {
    font-size: 36px;
    font-weight: 900;
    color: #ffffff;
    text-shadow: 0 0 15px #ff4444, 0 0 25px #ff4444, 0 0 35px #ff4444;
    letter-spacing: 3px;
    animation: logoGlow 2s infinite alternate;
    background: rgba(0, 0, 0, 0.7);
    padding: 10px 30px;
    border-radius: 10px;
    border: 2px solid #ff4444;
  }
  
  @keyframes logoGlow {
    0% {
      text-shadow: 0 0 10px #ff4444, 0 0 20px #ff4444;
    }
    100% {
      text-shadow: 0 0 20px #ff4444, 0 0 30px #ff4444, 0 0 40px #ff4444;
    }
  }
  
  header {
    padding: 15px 22px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 2px solid #ff4444;
    background: linear-gradient(135deg, 
      rgba(255, 68, 68, 0.2) 0%, 
      rgba(68, 68, 255, 0.2) 50%, 
      rgba(148, 0, 211, 0.2) 100%);
    backdrop-filter: blur(12px);
    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.8);
    position: relative;
    overflow: hidden;
  }
  
  header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      radial-gradient(circle at 20% 80%, rgba(255, 68, 68, 0.3) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(68, 68, 255, 0.3) 0%, transparent 50%),
      radial-gradient(circle at 40% 40%, rgba(148, 0, 211, 0.2) 0%, transparent 50%);
    z-index: -1;
    animation: headerPulse 4s ease-in-out infinite;
  }
  
  @keyframes headerPulse {
    0%, 100% {
      opacity: 0.5;
    }
    50% {
      opacity: 0.8;
    }
  }
  
  header h1 {
    margin: 0;
    font-size: 22px;
    color: #ffffff;
    text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
    font-weight: 700;
    letter-spacing: 1px;
    position: relative;
    padding: 5px 15px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 5px;
    border: 1px solid #ff4444;
  }
  
  header .sub {
    font-size: 12px;
    color: #ffffff;
    margin-left: auto;
    text-shadow: 0 0 3px rgba(255, 255, 255, 0.3);
    font-weight: 500;
    letter-spacing: 0.5px;
    background: rgba(0, 0, 0, 0.7);
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(5px);
  }

  .container {
    max-width: 1200px;
    margin: 20px auto;
    padding: 20px;
  }
  
  .panel {
    background: rgba(30, 30, 30, 0.9);
    border: 2px solid #ff4444;
    padding: 25px;
    border-radius: 0;
    margin-bottom: 20px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    position: relative;
    overflow: hidden;
  }
  
  .panel::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, #ff4444, #4444ff, #9400d3, #ff4444);
    z-index: -1;
    animation: borderRotate 3s linear infinite;
  }
  
  @keyframes borderRotate {
    0% {
      filter: hue-rotate(0deg);
    }
    100% {
      filter: hue-rotate(360deg);
    }
  }

  label {
    font-size: 14px;
    color: #ff8888;
    font-weight: 600;
    margin-bottom: 8px;
    display: block;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    border: 1px solid rgba(255, 68, 68, 0.3);
    padding: 20px;
    background: rgba(20, 20, 20, 0.5);
    margin: 15px 0;
  }
  
  .full {
    grid-column: 1 / 3;
  }
  
  input[type="text"], input[type="number"], textarea, select, .fake-file {
    width: 100%;
    padding: 14px;
    border-radius: 0;
    border: 2px solid #4444ff;
    background: rgba(40, 40, 40, 0.9);
    color: #ffffff;
    outline: none;
    transition: all 0.3s ease;
    font-size: 14px;
    font-weight: 500;
    box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.5);
  }
  
  input:focus, textarea:focus {
    box-shadow: 0 0 20px rgba(255, 68, 68, 0.9), inset 0 2px 5px rgba(0, 0, 0, 0.5);
    border-color: #ff4444;
    background: rgba(50, 50, 50, 0.9);
    transform: translateY(-2px);
  }

  .fake-file {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  
  input[type=file] {
    display: block;
  }
  
  .controls {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
    margin-top: 25px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 68, 68, 0.3);
  }

  button {
    padding: 15px 30px;
    border-radius: 0;
    border: 2px solid #ff4444;
    cursor: pointer;
    background: linear-gradient(45deg, #222222, #444444);
    color: #ffffff;
    font-weight: 700;
    box-shadow: 0 8px 25px rgba(255, 68, 68, 0.5);
    transition: all 0.3s ease;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 1px;
    position: relative;
    overflow: hidden;
  }
  
  button::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 68, 68, 0.3), transparent);
    transition: left 0.5s;
  }
  
  button:hover::before {
    left: 100%;
  }
  
  button:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(255, 68, 68, 0.7);
    background: linear-gradient(45deg, #333333, #555555);
    border-color: #ff8888;
  }
  
  button:active {
    transform: translateY(0);
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .log {
    height: 300px;
    overflow: auto;
    background: rgba(10, 10, 10, 0.95);
    border-radius: 0;
    padding: 20px;
    font-family: 'Consolas', monospace;
    color: #ff8888;
    border: 2px solid #4444ff;
    font-size: 13px;
    line-height: 1.5;
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.8);
  }
  
  .task-id-box {
    background: linear-gradient(45deg, #222222, #333333);
    padding: 25px;
    border-radius: 0;
    margin: 20px 0;
    border: 3px solid #ff4444;
    text-align: center;
    animation: pulse 2s infinite;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8);
    position: relative;
    overflow: hidden;
  }
  
  .task-id-box::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, transparent, #ff4444, transparent);
    animation: scan 2s linear infinite;
  }
  
  @keyframes scan {
    0% {
      left: -100%;
    }
    100% {
      left: 100%;
    }
  }
  
  @keyframes pulse {
    0%, 100% {
      box-shadow: 0 0 20px #ff4444;
    }
    50% {
      box-shadow: 0 0 40px #ff4444, 0 0 60px #4444ff;
    }
  }
  
  .task-id {
    font-size: 20px;
    font-weight: bold;
    color: #ffffff;
    word-break: break-all;
    text-shadow: 0 0 10px rgba(255, 68, 68, 0.7);
    font-family: 'Courier New', monospace;
    padding: 10px;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid #4444ff;
  }
  
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 15px;
    margin: 20px 0;
    padding: 20px;
    background: rgba(20, 20, 20, 0.8);
    border: 2px solid #4444ff;
  }
  
  .stat-box {
    background: linear-gradient(135deg, #222222, #2a2a2a);
    padding: 20px;
    border-radius: 0;
    text-align: center;
    border: 2px solid #ff4444;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.6);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .stat-box:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 25px rgba(255, 68, 68, 0.6);
  }
  
  .stat-value {
    font-size: 28px;
    font-weight: bold;
    color: #ff4444;
    text-shadow: 0 0 10px rgba(255, 68, 68, 0.7);
    font-family: 'Courier New', monospace;
  }
  
  .stat-label {
    font-size: 11px;
    color: #ff8888;
    margin-top: 8px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .message-item {
    border-left: 4px solid #ff4444;
    padding-left: 15px;
    margin: 10px 0;
    background: rgba(30, 30, 30, 0.8);
    padding: 12px;
    border-radius: 0;
    transition: all 0.3s ease;
    border-right: 1px solid rgba(255, 68, 68, 0.2);
    border-top: 1px solid rgba(255, 68, 68, 0.1);
    border-bottom: 1px solid rgba(255, 68, 68, 0.1);
  }
  
  .message-item:hover {
    background: rgba(40, 40, 40, 0.9);
    transform: translateX(5px);
  }
  
  .success {
    color: #44ff44;
    border-left-color: #44ff44;
  }
  
  .error {
    color: #ff4444;
    border-left-color: #ff4444;
  }
  
  .info {
    color: #4444ff;
    border-left-color: #4444ff;
  }
  
  .warning {
    color: #ffaa44;
    border-left-color: #ffaa44;
  }
  
  .console-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 2px solid #ff4444;
    padding-bottom: 10px;
  }
  
  .console-tab {
    padding: 15px 30px;
    background: linear-gradient(135deg, #222222, #2a2a2a);
    border-radius: 0;
    cursor: pointer;
    border: 2px solid #4444ff;
    transition: all 0.3s ease;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
  }
  
  .console-tab:hover {
    background: linear-gradient(135deg, #2a2a2a, #333333);
    border-color: #ff4444;
  }
  
  .console-tab.active {
    background: linear-gradient(45deg, #ff4444, #4444ff);
    box-shadow: 0 0 20px rgba(255, 68, 68, 0.7);
    border-color: #ffffff;
  }
  
  .console-content {
    display: none;
  }
  
  .console-content.active {
    display: block;
    animation: slideIn 0.5s ease;
  }
  
  @keyframes slideIn {
    from { 
      opacity: 0;
      transform: translateY(20px);
    }
    to { 
      opacity: 1;
      transform: translateY(0);
    }
  }

  small {
    color: #ff8888;
    font-size: 11px;
    display: block;
    margin-top: 5px;
    font-style: italic;
  }
  
  .multi-cookie-info {
    background: linear-gradient(45deg, rgba(68, 68, 255, 0.1), rgba(148, 0, 211, 0.1));
    padding: 20px;
    border-radius: 0;
    border: 2px solid #4444ff;
    margin: 20px 0;
    position: relative;
    overflow: hidden;
  }
  
  .multi-cookie-info::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(45deg, transparent, rgba(255, 68, 68, 0.1), transparent);
    animation: shimmer 3s infinite;
  }
  
  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
  
  .multi-cookie-info h4 {
    color: #4444ff;
    margin-top: 0;
    font-size: 18px;
    text-transform: uppercase;
    letter-spacing: 1px;
    position: relative;
    z-index: 1;
  }
  
  .cookie-opts {
    display: flex;
    gap: 20px;
    margin: 15px 0;
    padding: 15px;
    background: rgba(20, 20, 20, 0.7);
    border: 1px solid #4444ff;
  }
  
  .cookie-opts label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: #ffffff;
  }
  
  .cookie-opts input[type="radio"] {
    accent-color: #ff4444;
    transform: scale(1.2);
  }
  
  h3 {
    color: #ff8888;
    margin-top: 0;
    border-bottom: 2px solid rgba(255, 68, 68, 0.3);
    padding-bottom: 15px;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-size: 20px;
  }
  
  .cookie-stats {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    margin-top: 20px;
  }
  
  .cookie-stat-item {
    background: linear-gradient(135deg, #222222, #2a2a2a);
    padding: 15px;
    border-radius: 0;
    border: 2px solid #4444ff;
    text-align: center;
    transition: all 0.3s ease;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
  }
  
  .cookie-stat-item.active {
    border-color: #44ff44;
    background: linear-gradient(135deg, #1a2a1a, #223322);
    box-shadow: 0 0 15px rgba(68, 255, 68, 0.5);
  }
  
  .cookie-stat-item.inactive {
    border-color: #ff4444;
    background: linear-gradient(135deg, #2a1a1a, #332222);
    box-shadow: 0 0 15px rgba(255, 68, 68, 0.3);
  }
  
  .cookie-number {
    font-size: 18px;
    font-weight: bold;
    color: #ff4444;
    font-family: 'Courier New', monospace;
  }
  
  .cookie-status {
    font-size: 12px;
    margin-top: 8px;
    text-transform: uppercase;
    font-weight: bold;
  }
  
  .cookie-active {
    color: #44ff44;
  }
  
  .cookie-inactive {
    color: #ff4444;
  }
  
  .cookie-messages {
    font-size: 11px;
    color: #ff8888;
    margin-top: 5px;
  }
  
  @media (max-width: 768px) {
    .row {
      grid-template-columns: 1fr;
    }
    .full {
      grid-column: auto;
    }
    .stats {
      grid-template-columns: 1fr 1fr;
    }
    .cookie-stats {
      grid-template-columns: 1fr 1fr;
    }
    .console-tabs {
      flex-wrap: wrap;
    }
    header {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
    header .sub {
      margin-left: 0;
      width: 100%;
    }
    .logo-text {
      font-size: 24px;
      padding: 8px 20px;
    }
    .banner-container {
      height: 120px;
    }
  }
  
  .special-feature {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    background: linear-gradient(45deg, #ff4444, #4444ff);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 0 30px rgba(255, 68, 68, 0.7);
    animation: float 3s ease-in-out infinite;
    z-index: 1000;
    border: 2px solid white;
  }
  
  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }
  
  .special-feature:hover {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
  
  .decorative-border {
    position: absolute;
    pointer-events: none;
  }
  
  .border-top {
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #ff4444, #4444ff, #9400d3, #ff4444);
    animation: borderFlow 5s linear infinite;
  }
  
  @keyframes borderFlow {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 100% 50%;
    }
  }
  
  .matrix-rain {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
    opacity: 0.1;
    background: linear-gradient(transparent 90%, rgba(0, 255, 0, 0.1));
  }
</style>
</head>
<body>
  <div class="matrix-rain" id="matrixRain"></div>
  <div class="decorative-border border-top"></div>
  
  <div class="banner-container">
    <img src="https://i.pinimg.com/originals/80/b1/cf/80b1cf27df714a3ba0da909fd3f3f221.gif" 
         alt="System Banner" 
         class="banner-gif"
         onerror="this.style.display='none'">
    <div class="logo-overlay">
      <div class="logo-text"></div>
    </div>
  </div>
  
  <header>
    <h1>T3RROR RULEX</h1>
    <div class="sub"></div>
    <div class="sub"></div>
  </header>

  <div class="container">
    <!-- Main Configuration Panel -->
    <div class="panel">
      <div class="multi-cookie-info">
        <h4>MULTIPLE COOKIE SUPPORT</h4>
        <p style="color: #ffffff; font-size: 13px; margin: 8px 0;">
          <strong>Powered by :</strong>  Faiizu Xd
        </p>
        <p style="color: #ff8888; font-size: 12px; margin: 8px 0;">
          <br> 
        </p>
      </div>
      
      <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; margin: 20px 0;">
        <div style="flex: 1; min-width: 300px;">
          <div>
            <strong style="color: #ff8888">Cookie Input Method:</strong>
            <div class="cookie-opts">
              <label><input type="radio" name="cookie-mode" value="file" checked> Upload File</label>
              <label><input type="radio" name="cookie-mode" value="paste"> Direct Paste</label>
            </div>
          </div>

          <div id="cookie-file-wrap">
            <label for="cookie-file">Cookie File Upload</label>
            <input id="cookie-file" type="file" accept=".txt,.json">
            <small></small>
          </div>

          <div id="cookie-paste-wrap" style="display: none; margin-top: 15px">
            <label for="cookie-paste">Direct Cookie Input</label>
            <textarea id="cookie-paste" rows="6" placeholder="Enter cookies - one per line"></textarea>
            <small></small>
          </div>
        </div>

        <div style="flex: 1; min-width: 260px">
          <label for="haters-name">Prefix Name</label>
          <input id="haters-name" type="text" placeholder="Enter prefix name">
          <small>added before each message</small>

          <label for="thread-id">Target Thread ID</label>
          <input id="thread-id" type="text" placeholder="Enter thread/group ID">
          <small> Alll messages where you need to send</small>

          <label for="last-here-name">Suffix Name</label>
          <input id="last-here-name" type="text" placeholder="Enter suffix name">
          <small>added after each message</small>

          <div style="margin-top: 15px">
            <label for="delay">Message Delay</label>
            <input id="delay" type="number" value="5" min="1">
            <small>Seconds between each message</small>
          </div>
        </div>
      </div>

      <div class="row">
        <div class="full">
          <label for="message-file">Messages Content File</label>
          <input id="message-file" type="file" accept=".txt">
          <small>Text file messages, one per line</small>
        </div>

        <div class="full" style="margin-top: 20px">
          <div class="controls">
            <button id="start-btn">START</button>
            <div style="margin-left: auto; align-self: center; color: #ff8888; font-weight: bold;" id="status">Terror Rulex</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Console Panel with Tabs -->
    <div class="panel">
      <div class="console-tabs">
        <div class="console-tab active" onclick="switchConsoleTab('log')">SYSTEM LOGS</div>
        <div class="console-tab" onclick="switchConsoleTab('stop')">STOP TASK</div>
        <div class="console-tab" onclick="switchConsoleTab('view')">TASK DETAILS</div>
      </div>

      <!-- Live Console Logs Tab -->
      <div id="log-tab" class="console-content active">
        <div class="log" id="log-container"></div>
      </div>

      <!-- Stop Task Tab -->
      <div id="stop-tab" class="console-content">
        <h3>Task Termination</h3>
        <label for="stop-task-id">Task Identification</label>
        <input id="stop-task-id" type="text" placeholder="Enter task ID">
        <div class="controls" style="margin-top: 20px">
          <button id="stop-btn">TERMINATE TASK</button>
        </div>
        <div id="stop-result" style="margin-top: 20px; display: none;"></div>
        <div style="margin-top: 20px; padding: 15px; background: rgba(30, 30, 50, 0.7); border-radius: 0; border: 2px solid #4444ff;">
          <strong style="color: #ff8888">SECURITY NOTICE:</strong>
          <div style="color: #ffcccc; font-size: 13px; margin-top: 8px;">
            Cookies remain active after task termination<br>
            Same credentials can be reused without re-authentication<br>
            Secure session management system
          </div>
        </div>
      </div>

      <!-- View Task Details Tab -->
      <div id="view-tab" class="console-content">
        <h3>Task Monitoring</h3>
        <label for="view-task-id">Task Identification</label>
        <input id="view-task-id" type="text" placeholder="Enter task ID">
        <div class="controls" style="margin-top: 20px">
          <button id="view-btn">VIEW DETAILS</button>
        </div>
        
        <div id="task-details" style="display: none; margin-top: 25px">
          <div class="task-id-box">
            <div style="margin-bottom: 10px; color: #ffffff">TASK IDENTIFICATION</div>
            <div class="task-id" id="detail-task-id"></div>
          </div>
          
          <div class="stats">
            <div class="stat-box">
              <div class="stat-value" id="detail-sent">0</div>
              <div class="stat-label">Messages Sent</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-failed">0</div>
              <div class="stat-label">Messages Failed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-active-cookies">0</div>
              <div class="stat-label">Active Cookies</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-total-cookies">0</div>
              <div class="stat-label">Total Cookies</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-loops">0</div>
              <div class="stat-label">Loops Completed</div>
            </div>
            <div class="stat-box">
              <div class="stat-value" id="detail-restarts">0</div>
              <div class="stat-label">System Restarts</div>
            </div>
          </div>
          
          <h4 style="color: #ff8888; margin-top: 25px">Cookie Status:</h4>
          <div class="cookie-stats" id="detail-cookie-stats"></div>
          
          <h4 style="color: #ff8888; margin-top: 25px">Recent Activity:</h4>
          <div class="log" id="detail-log" style="height: 200px"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="special-feature" onclick="showSpecialMessage()">
    VIP
  </div>

<script>
  // Matrix rain effect
  function createMatrixRain() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('matrixRain');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    
    container.appendChild(canvas);
    
    const chars = '01';
    const charArray = chars.split('');
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops = [];
    
    for(let i = 0; i < columns; i++) {
      drops[i] = 1;
    }
    
    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.fillStyle = '#0F0';
      ctx.font = fontSize + 'px monospace';
      
      for(let i = 0; i < drops.length; i++) {
        const text = charArray[Math.floor(Math.random() * charArray.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        
        if(drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }
    
    setInterval(draw, 35);
    
    window.addEventListener('resize', function() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }
  
  createMatrixRain();

  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(socketProtocol + '//' + location.host);

  const logContainer = document.getElementById('log-container');
  const statusDiv = document.getElementById('status');
  const startBtn = document.getElementById('start-btn');
  const stopBtn = document.getElementById('stop-btn');
  const viewBtn = document.getElementById('view-btn');
  const stopResultDiv = document.getElementById('stop-result');

  const cookieFileInput = document.getElementById('cookie-file');
  const cookiePaste = document.getElementById('cookie-paste');
  const hatersNameInput = document.getElementById('haters-name');
  const threadIdInput = document.getElementById('thread-id');
  const lastHereNameInput = document.getElementById('last-here-name');
  const delayInput = document.getElementById('delay');
  const messageFileInput = document.getElementById('message-file');
  const stopTaskIdInput = document.getElementById('stop-task-id');
  const viewTaskIdInput = document.getElementById('view-task-id');

  const cookieFileWrap = document.getElementById('cookie-file-wrap');
  const cookiePasteWrap = document.getElementById('cookie-paste-wrap');

  let currentTaskId = null;

  function addLog(text, type = 'info') {
    const d = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.className = 'message-item ' + type;
    div.innerHTML = '<span style="color: #ff8888">[' + d + ']</span> ' + text;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function showStopResult(message, type = 'info') {
    stopResultDiv.style.display = 'block';
    stopResultDiv.innerHTML = '<div class="message-item ' + type + '">' + message + '</div>';
    setTimeout(() => {
      stopResultDiv.style.display = 'none';
    }, 5000);
  }

  // Silent WebSocket connection
  socket.onopen = () => {
    // Silent connection - no display
  };
  
  socket.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      
      if (data.type === 'log') {
        addLog(data.message, data.messageType || 'info');
      } else if (data.type === 'task_started') {
        currentTaskId = data.taskId;
        showTaskIdBox(data.taskId);
        addLog('Task started successfully with ID: ' + data.taskId, 'success');
        addLog('Multiple Cookie Support: ACTIVE', 'info');
        addLog('Auto-recovery system: ENABLED', 'info');
        addLog('Secure session management: ACTIVE', 'info');
      } else if (data.type === 'task_stopped') {
        if (data.taskId === currentTaskId) {
          addLog('Task termination completed', 'info');
          addLog('Sessions preserved - Ready for reuse', 'success');
          hideTaskIdBox();
        }
        showStopResult('Task terminated successfully! Sessions preserved.', 'success');
      } else if (data.type === 'task_details') {
        displayTaskDetails(data);
      } else if (data.type === 'error') {
        addLog('System Error: ' + data.message, 'error');
        if (data.from === 'stop') {
          showStopResult('Error: ' + data.message, 'error');
        }
      }
    } catch (e) {
      // Silent error handling
    }
  };
  
  socket.onclose = () => {
    // Silent disconnect
  };
  
  socket.onerror = (e) => {
    // Silent error
  };

  function showTaskIdBox(taskId) {
    const existingBox = document.querySelector('.task-id-box');
    if (existingBox) existingBox.remove();
    
    const box = document.createElement('div');
    box.className = 'task-id-box';
    box.innerHTML = '<div style="margin-bottom: 10px; color: #ffffff">TASK IDENTIFICATION</div><div class="task-id">' + taskId + '</div><div style="margin-top: 10px; font-size: 12px; color: #ff8888">Save this ID for task management</div><div style="margin-top: 5px; font-size: 11px; color: #44ff44">Multi-Cookie: ENABLED</div><div style="margin-top: 5px; font-size: 11px; color: #4444ff">Session Safety: ACTIVE</div>';
    
    document.querySelector('.panel').insertBefore(box, document.querySelector('.panel .row'));
  }
  
  function hideTaskIdBox() {
    const box = document.querySelector('.task-id-box');
    if (box) box.remove();
  }

  function switchConsoleTab(tabName) {
    document.querySelectorAll('.console-content').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
  }

  // Cookie mode toggle
  document.querySelectorAll('input[name="cookie-mode"]').forEach(r => {
    r.addEventListener('change', (ev) => {
      if (ev.target.value === 'file') {
        cookieFileWrap.style.display = 'block';
        cookiePasteWrap.style.display = 'none';
      } else {
        cookieFileWrap.style.display = 'none';
        cookiePasteWrap.style.display = 'block';
      }
    });
  });

  // Special feature
  function showSpecialMessage() {
    addLog('VIP FEATURE: Advanced monitoring activated', 'warning');
    addLog('System performance optimized', 'success');
    addLog('Security protocols enhanced', 'info');
    
    // Visual effect
    document.querySelector('.special-feature').style.background = 'linear-gradient(45deg, #44ff44, #4444ff)';
    setTimeout(() => {
      document.querySelector('.special-feature').style.background = 'linear-gradient(45deg, #ff4444, #4444ff)';
    }, 1000);
  }

  startBtn.addEventListener('click', () => {
    const cookieMode = document.querySelector('input[name="cookie-mode"]:checked').value;
    
    if (cookieMode === 'file' && cookieFileInput.files.length === 0) {
      addLog('Please select cookie file or switch to paste mode.', 'error');
      return;
    }
    if (cookieMode === 'paste' && cookiePaste.value.trim().length === 0) {
      addLog('Please enter cookies in the text area.', 'error');
      return;
    }
    if (!hatersNameInput.value.trim()) {
      addLog('Please enter Prefix Name', 'error');
      return;
    }
    if (!threadIdInput.value.trim()) {
      addLog('Please enter Thread ID', 'error');
      return;
    }
    if (!lastHereNameInput.value.trim()) {
      addLog('Please enter Suffix Name', 'error');
      return;
    }
    if (messageFileInput.files.length === 0) {
      addLog('Please select messages file', 'error');
      return;
    }

    const cookieReader = new FileReader();
    const msgReader = new FileReader();

    const startSend = (cookieContent, messageContent) => {
      const lines = cookieContent.split('\n').filter(line => line.trim().length > 0).length;
       addLog(`Detected ${lines} cookies in input`, 'info');
      socket.send(JSON.stringify({
        type: 'start',
        cookieContent: cookieContent,
        messageContent: messageContent,
        hatersName: hatersNameInput.value.trim(),
        threadID: threadIdInput.value.trim(),
        lastHereName: lastHereNameInput.value.trim(),
        delay: parseInt(delayInput.value) || 5,
        cookieMode: cookieMode
      }));
      
      statusDiv.textContent = 'Status: STARTING SYSTEM';
    };

    msgReader.onload = (e) => {
      const messageContent = e.target.result;
      if (cookieMode === 'paste') {
        startSend(cookiePaste.value, messageContent);
      } else {
        cookieReader.readAsText(cookieFileInput.files[0]);
        cookieReader.onload = (ev) => {
          startSend(ev.target.result, messageContent);
        };
        cookieReader.onerror = () => addLog('File read error', 'error');
      }
    };
    msgReader.readAsText(messageFileInput.files[0]);
  });

  stopBtn.addEventListener('click', () => {
    const taskId = stopTaskIdInput.value.trim();
    if (!taskId) {
      showStopResult('Please enter Task ID', 'error');
      return;
    }
    socket.send(JSON.stringify({type: 'stop', taskId: taskId}));
    showStopResult('Terminating task... Sessions will be preserved', 'info');
  });

  viewBtn.addEventListener('click', () => {
    const taskId = viewTaskIdInput.value.trim();
    if (!taskId) {
      addLog('Please enter Task ID', 'error');
      return;
    }
    socket.send(JSON.stringify({type: 'view_details', taskId: taskId}));
  });

  function displayTaskDetails(data) {
    document.getElementById('task-details').style.display = 'block';
    document.getElementById('detail-task-id').textContent = data.taskId;
    document.getElementById('detail-sent').textContent = data.sent || 0;
    document.getElementById('detail-failed').textContent = data.failed || 0;
    document.getElementById('detail-active-cookies').textContent = data.activeCookies || 0;
    document.getElementById('detail-total-cookies').textContent = data.totalCookies || 0;
    document.getElementById('detail-loops').textContent = data.loops || 0;
    document.getElementById('detail-restarts').textContent = data.restarts || 0;
    
    const cookieStatsContainer = document.getElementById('detail-cookie-stats');
    cookieStatsContainer.innerHTML = '';
    
    if (data.cookieStats && data.cookieStats.length > 0) {
      data.cookieStats.forEach(cookie => {
        const div = document.createElement('div');
        div.className = `cookie-stat-item ${cookie.active ? 'active' : 'inactive'}`;
        div.innerHTML = `
          <div class="cookie-number">Cookie ${cookie.cookieNumber}</div>
          <div class="cookie-status ${cookie.active ? 'cookie-active' : 'cookie-inactive'}">
            ${cookie.active ? 'ACTIVE' : 'INACTIVE'}
          </div>
          <div class="cookie-messages">Messages: ${cookie.messagesSent}</div>
        `;
        cookieStatsContainer.appendChild(div);
      });
    }
    
    const logContainer = document.getElementById('detail-log');
    logContainer.innerHTML = '';
    
    if (data.logs && data.logs.length > 0) {
      data.logs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'message-item ' + (log.type || 'info');
        div.innerHTML = '<span style="color: #ff8888">[' + log.time + ']</span> ' + log.message;
        logContainer.appendChild(div);
      });
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }

  // Input focus effects
  document.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('focus', function() {
      this.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.9)';
      this.style.borderColor = '#ff4444';
    });
    
    input.addEventListener('blur', function() {
      this.style.boxShadow = 'inset 0 2px 5px rgba(0, 0, 0, 0.5)';
      this.style.borderColor = '#4444ff';
    });
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
  console.log(`Faizu  Multi-User System running at http://localhost:${PORT}`);
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
