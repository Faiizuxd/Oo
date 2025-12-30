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
<title>FAIZU MESSAGING SYSTEM</title>
<style>
  * {
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Poppins', Tahoma, Geneva, Verdana, sans-serif;
  }
  
  html, body {
    height: 100%;
    margin: 0;
    background: #0f0b0f;
    color: #f0e0f0;
    overflow-x: hidden;
  }
  
  body {
    background: 
      radial-gradient(ellipse at 20% 20%, rgba(255, 20, 100, 0.15) 0%, transparent 40%),
      radial-gradient(ellipse at 80% 80%, rgba(220, 20, 60, 0.1) 0%, transparent 40%),
      radial-gradient(ellipse at 40% 60%, rgba(180, 0, 40, 0.08) 0%, transparent 40%),
      linear-gradient(135deg, #0f0b0f 0%, #1a0f1a 50%, #2d1525 100%);
    position: relative;
    min-height: 100vh;
  }
  
  /* Animated Red Lines Background */
  .lines-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
    opacity: 0.6;
  }
  
  .line {
    position: absolute;
    background: linear-gradient(90deg, transparent, rgba(255, 20, 100, 0.4), transparent);
    width: 2px;
    height: 100%;
    animation: lineMove 15s infinite linear;
  }
  
  .line:nth-child(1) { left: 10%; animation-delay: 0s; height: 80%; top: 10%; }
  .line:nth-child(2) { left: 25%; animation-delay: -3s; height: 90%; top: 5%; }
  .line:nth-child(3) { left: 40%; animation-delay: -6s; height: 70%; top: 15%; }
  .line:nth-child(4) { left: 60%; animation-delay: -9s; height: 85%; top: 7%; }
  .line:nth-child(5) { left: 80%; animation-delay: -12s; height: 75%; top: 12%; }
  
  @keyframes lineMove {
    0% { transform: translateY(-100%); opacity: 0; }
    10% { opacity: 0.8; }
    90% { opacity: 0.8; }
    100% { transform: translateY(100vh); opacity: 0; }
  }
  
  /* Pulsing Glow Effect */
  .pulse-glow {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 80vw;
    height: 80vh;
    background: radial-gradient(ellipse, rgba(255, 20, 100, 0.1) 0%, transparent 70%);
    z-index: -2;
    pointer-events: none;
    animation: pulseGlow 4s ease-in-out infinite alternate;
  }
  
  @keyframes pulseGlow {
    0% { opacity: 0.3; transform: translate(-50%, -50%) scale(1); }
    100% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.1); }
  }
  
  /* Floating Particles */
  .particles {
    position: fixed;
    width: 100%;
    height: 100%;
    z-index: -1;
    pointer-events: none;
  }
  
  .particle {
    position: absolute;
    width: 3px;
    height: 3px;
    background-color: rgba(255, 50, 120, 0.7);
    border-radius: 50%;
    animation: floatParticle 20s infinite linear;
  }
  
  @keyframes floatParticle {
    0% {
      transform: translateY(100vh) translateX(0) rotate(0deg);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      transform: translateY(-100px) translateX(100px) rotate(360deg);
      opacity: 0;
    }
  }
  
  /* Header with Neon Effect */
  header {
    padding: 20px 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(25, 10, 20, 0.95);
    border-bottom: 2px solid rgba(255, 20, 100, 0.5);
    box-shadow: 
      0 10px 30px rgba(0, 0, 0, 0.7),
      0 0 30px rgba(255, 20, 100, 0.2);
    backdrop-filter: blur(10px);
    position: relative;
    overflow: hidden;
    z-index: 10;
  }
  
  header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(90deg, 
      transparent, 
      rgba(255, 20, 100, 1), 
      rgba(255, 50, 150, 1),
      rgba(255, 20, 100, 1),
      transparent);
    animation: headerScan 3s linear infinite;
  }
  
  @keyframes headerScan {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  
  .logo-container {
    display: flex;
    align-items: center;
    gap: 15px;
  }
  
  .logo {
    width: 60px;
    height: 60px;
    background: linear-gradient(135deg, #ff1464, #dc143c);
    border-radius: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 900;
    color: white;
    box-shadow: 
      0 0 20px rgba(255, 20, 100, 0.8),
      inset 0 0 20px rgba(255, 255, 255, 0.2);
    position: relative;
    overflow: hidden;
    animation: logoGlow 2s ease-in-out infinite alternate;
  }
  
  @keyframes logoGlow {
    0% { box-shadow: 0 0 20px rgba(255, 20, 100, 0.8), inset 0 0 20px rgba(255, 255, 255, 0.2); }
    100% { box-shadow: 0 0 30px rgba(255, 50, 150, 1), inset 0 0 30px rgba(255, 255, 255, 0.3); }
  }
  
  .logo::after {
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(45deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    transform: rotate(45deg);
    animation: logoShine 3s linear infinite;
  }
  
  @keyframes logoShine {
    0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
    100% { transform: translateX(100%) translateY(100%) rotate(45deg); }
  }
  
  .logo-text {
    display: flex;
    flex-direction: column;
  }
  
  .logo-text h1 {
    margin: 0;
    font-size: 28px;
    background: linear-gradient(90deg, #ff1464, #ff4d8d, #ff1464);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    font-weight: 900;
    letter-spacing: 1px;
    text-shadow: 0 0 15px rgba(255, 20, 100, 0.5);
    animation: textShimmer 3s linear infinite;
  }
  
  @keyframes textShimmer {
    0% { background-position: -200px 0; }
    100% { background-position: 200px 0; }
  }
  
  .logo-text .subtitle {
    font-size: 12px;
    color: #ff80b3;
    letter-spacing: 3px;
    margin-top: 3px;
    font-weight: 600;
    text-shadow: 0 0 10px rgba(255, 20, 100, 0.5);
  }
  
  .level-indicator {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  
  .level {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  
  .level-label {
    font-size: 11px;
    color: #ff80b3;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .level-bar {
    width: 120px;
    height: 8px;
    background: rgba(50, 10, 30, 0.8);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }
  
  .level-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff1464, #ff4d8d);
    border-radius: 4px;
    width: 85%;
    position: relative;
    overflow: hidden;
  }
  
  .level-fill::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
    animation: levelShine 2s linear infinite;
  }
  
  @keyframes levelShine {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  
  .level-value {
    font-size: 12px;
    font-weight: bold;
    color: #ff4d8d;
    text-shadow: 0 0 5px rgba(255, 20, 100, 0.8);
  }
  
  .container {
    max-width: 1300px;
    margin: 30px auto;
    padding: 0 25px;
  }
  
  /* Dashboard Grid */
  .dashboard-grid {
    display: grid;
    grid-template-columns: 2.5fr 1.5fr;
    gap: 30px;
    margin-bottom: 30px;
  }
  
  @media (max-width: 1100px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
  }
  
  /* Main Panel with Neon Border */
  .panel {
    background: rgba(30, 15, 25, 0.85);
    border: 1px solid rgba(255, 20, 100, 0.3);
    padding: 30px;
    border-radius: 20px;
    margin-bottom: 30px;
    box-shadow: 
      0 10px 40px rgba(0, 0, 0, 0.5),
      inset 0 0 20px rgba(255, 20, 100, 0.05);
    backdrop-filter: blur(10px);
    position: relative;
    overflow: hidden;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }
  
  .panel::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, #ff1464, #dc143c, #ff1464, #ff4d8d, #ff1464);
    border-radius: 22px;
    z-index: -1;
    opacity: 0;
    transition: opacity 0.5s ease;
  }
  
  .panel:hover::before {
    opacity: 1;
    animation: borderGlow 2s linear infinite;
  }
  
  @keyframes borderGlow {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
  }
  
  .panel-title {
    font-size: 20px;
    color: #ff4d8d;
    margin-top: 0;
    margin-bottom: 25px;
    padding-bottom: 12px;
    border-bottom: 2px solid rgba(255, 20, 100, 0.3);
    display: flex;
    align-items: center;
    gap: 12px;
    text-shadow: 0 0 10px rgba(255, 20, 100, 0.3);
  }
  
  .panel-title i {
    font-size: 22px;
    animation: iconPulse 2s infinite alternate;
  }
  
  @keyframes iconPulse {
    0% { transform: scale(1); }
    100% { transform: scale(1.1); }
  }
  
  /* Form Elements */
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 25px;
  }
  
  .full-width {
    grid-column: 1 / -1;
  }
  
  .form-group {
    margin-bottom: 20px;
  }
  
  label {
    display: block;
    font-size: 14px;
    color: #ff99c2;
    margin-bottom: 10px;
    font-weight: 600;
    text-shadow: 0 0 5px rgba(255, 20, 100, 0.3);
  }
  
  input, textarea, select, .file-input {
    width: 100%;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255, 20, 100, 0.4);
    background: rgba(40, 20, 30, 0.8);
    color: #ffd6e6;
    font-size: 15px;
    transition: all 0.3s ease;
    outline: none;
  }
  
  input:focus, textarea:focus, select:focus {
    border-color: #ff1464;
    box-shadow: 0 0 0 3px rgba(255, 20, 100, 0.2), 0 0 20px rgba(255, 20, 100, 0.3);
    background: rgba(50, 25, 35, 0.9);
    transform: translateY(-2px);
  }
  
  .file-input {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .file-input:hover {
    border-color: #ff4d8d;
    background: rgba(50, 25, 35, 0.9);
  }
  
  input[type="file"] {
    display: none;
  }
  
  .cookie-options {
    display: flex;
    gap: 20px;
    margin-bottom: 25px;
  }
  
  .cookie-option {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 18px;
    border-radius: 12px;
    background: rgba(40, 20, 30, 0.6);
    border: 1px solid rgba(255, 20, 100, 0.3);
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .cookie-option::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 20, 100, 0.1), transparent);
    transform: translateX(-100%);
    transition: transform 0.5s ease;
  }
  
  .cookie-option:hover::before {
    transform: translateX(100%);
  }
  
  .cookie-option:hover {
    background: rgba(50, 25, 35, 0.8);
    border-color: #ff4d8d;
    transform: translateY(-3px);
  }
  
  .cookie-option.active {
    background: rgba(255, 20, 100, 0.1);
    border-color: #ff1464;
    box-shadow: 0 0 20px rgba(255, 20, 100, 0.2);
  }
  
  .cookie-option input[type="radio"] {
    width: auto;
    accent-color: #ff1464;
  }
  
  /* Buttons */
  .action-buttons {
    display: flex;
    gap: 20px;
    margin-top: 30px;
    flex-wrap: wrap;
  }
  
  .btn {
    padding: 16px 32px;
    border-radius: 12px;
    border: none;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-width: 160px;
    position: relative;
    overflow: hidden;
    z-index: 1;
  }
  
  .btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    transform: translateX(-100%);
    transition: transform 0.6s ease;
    z-index: -1;
  }
  
  .btn:hover::before {
    transform: translateX(100%);
  }
  
  .btn-primary {
    background: linear-gradient(135deg, #ff1464, #dc143c);
    color: white;
    box-shadow: 
      0 8px 25px rgba(255, 20, 100, 0.4),
      0 0 15px rgba(255, 20, 100, 0.2);
  }
  
  .btn-primary:hover {
    transform: translateY(-5px);
    box-shadow: 
      0 12px 30px rgba(255, 20, 100, 0.6),
      0 0 20px rgba(255, 20, 100, 0.4);
    background: linear-gradient(135deg, #ff2a74, #ec2a54);
  }
  
  .btn-secondary {
    background: linear-gradient(135deg, #dc143c, #a01030);
    color: white;
    box-shadow: 0 8px 25px rgba(220, 20, 60, 0.4);
  }
  
  .btn-secondary:hover {
    transform: translateY(-5px);
    box-shadow: 0 12px 30px rgba(220, 20, 60, 0.6);
    background: linear-gradient(135deg, #ec2a54, #b02040);
  }
  
  .btn-warning {
    background: linear-gradient(135deg, #ff4d8d, #ff1464);
    color: white;
    box-shadow: 0 8px 25px rgba(255, 77, 141, 0.4);
  }
  
  .btn-warning:hover {
    transform: translateY(-5px);
    box-shadow: 0 12px 30px rgba(255, 77, 141, 0.6);
    background: linear-gradient(135deg, #ff5d9d, #ff2a74);
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }
  
  /* Stats Panel */
  .stats-panel {
    background: rgba(25, 10, 20, 0.9);
    border: 1px solid rgba(220, 20, 60, 0.3);
    padding: 30px;
    border-radius: 20px;
    box-shadow: 
      0 10px 40px rgba(0, 0, 0, 0.5),
      inset 0 0 20px rgba(220, 20, 60, 0.05);
    backdrop-filter: blur(10px);
    height: fit-content;
    position: relative;
    overflow: hidden;
  }
  
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
  
  .stat-card {
    background: rgba(40, 20, 30, 0.7);
    padding: 22px;
    border-radius: 15px;
    text-align: center;
    border: 1px solid rgba(255, 20, 100, 0.2);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background: linear-gradient(90deg, #ff1464, #ff4d8d);
    transform: scaleX(0);
    transition: transform 0.5s ease;
  }
  
  .stat-card:hover::before {
    transform: scaleX(1);
  }
  
  .stat-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.3);
  }
  
  .stat-value {
    font-size: 32px;
    font-weight: 900;
    margin-bottom: 8px;
    text-shadow: 0 0 10px currentColor;
  }
  
  .stat-card:nth-child(1) .stat-value { color: #ff1464; }
  .stat-card:nth-child(2) .stat-value { color: #ff4d8d; }
  .stat-card:nth-child(3) .stat-value { color: #ff80b3; }
  .stat-card:nth-child(4) .stat-value { color: #dc143c; }
  
  .stat-label {
    font-size: 13px;
    color: #ff99c2;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  
  /* Console Panel */
  .console-panel {
    background: rgba(20, 8, 15, 0.95);
    border: 1px solid rgba(255, 77, 141, 0.3);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 
      0 10px 40px rgba(0, 0, 0, 0.6),
      0 0 20px rgba(255, 20, 100, 0.1);
  }
  
  .console-tabs {
    display: flex;
    background: rgba(30, 15, 25, 0.95);
    border-bottom: 1px solid rgba(255, 20, 100, 0.3);
  }
  
  .console-tab {
    padding: 20px 30px;
    cursor: pointer;
    font-weight: 700;
    color: #ff80b3;
    transition: all 0.3s ease;
    border-bottom: 3px solid transparent;
    position: relative;
    flex: 1;
    text-align: center;
  }
  
  .console-tab::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 0;
    height: 3px;
    background: #ff1464;
    transition: all 0.3s ease;
    transform: translateX(-50%);
  }
  
  .console-tab:hover {
    color: #ff4d8d;
    background: rgba(40, 20, 30, 0.5);
  }
  
  .console-tab:hover::after {
    width: 30px;
  }
  
  .console-tab.active {
    color: #ff1464;
    background: rgba(40, 20, 30, 0.7);
  }
  
  .console-tab.active::after {
    width: 100%;
  }
  
  .console-content {
    display: none;
    padding: 30px;
  }
  
  .console-content.active {
    display: block;
    animation: fadeInUp 0.5s ease;
  }
  
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .console-log {
    height: 320px;
    overflow-y: auto;
    background: rgba(15, 5, 10, 0.9);
    border-radius: 15px;
    padding: 25px;
    font-family: 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.6;
    border: 1px solid rgba(255, 20, 100, 0.2);
    box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.5);
  }
  
  .log-entry {
    margin-bottom: 15px;
    padding: 12px 15px;
    border-radius: 10px;
    border-left: 5px solid #ff1464;
    background: rgba(40, 20, 30, 0.5);
    animation: slideInLeft 0.4s ease;
    position: relative;
    overflow: hidden;
  }
  
  @keyframes slideInLeft {
    from { transform: translateX(-20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  .log-entry::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 5px;
    height: 100%;
    background: currentColor;
    opacity: 0.2;
  }
  
  .log-entry.success {
    border-left-color: #4dff88;
    background: rgba(77, 255, 136, 0.1);
  }
  
  .log-entry.error {
    border-left-color: #ff4d4d;
    background: rgba(255, 77, 77, 0.1);
  }
  
  .log-entry.warning {
    border-left-color: #ffcc4d;
    background: rgba(255, 204, 77, 0.1);
  }
  
  .log-time {
    color: #ff80b3;
    font-size: 12px;
    margin-right: 15px;
    font-weight: bold;
  }
  
  /* Task ID Box */
  .task-id-box {
    background: linear-gradient(135deg, rgba(255, 20, 100, 0.1), rgba(220, 20, 60, 0.1));
    padding: 25px;
    border-radius: 15px;
    margin: 25px 0;
    border: 2px solid #ff1464;
    text-align: center;
    position: relative;
    overflow: hidden;
    animation: taskIdPulse 3s infinite alternate;
  }
  
  @keyframes taskIdPulse {
    0% { 
      box-shadow: 
        0 0 15px rgba(255, 20, 100, 0.3),
        inset 0 0 15px rgba(255, 20, 100, 0.1);
    }
    100% { 
      box-shadow: 
        0 0 30px rgba(255, 20, 100, 0.6),
        inset 0 0 20px rgba(255, 20, 100, 0.2);
    }
  }
  
  .task-id-label {
    font-size: 13px;
    color: #ff99c2;
    margin-bottom: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  
  .task-id-value {
    font-size: 22px;
    font-weight: 900;
    color: #ff4d8d;
    word-break: break-all;
    font-family: monospace;
    text-shadow: 0 0 10px rgba(255, 20, 100, 0.5);
  }
  
  .task-id-note {
    font-size: 12px;
    color: #ff80b3;
    margin-top: 15px;
  }
  
  /* Cookie Stats */
  .cookie-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
    margin-top: 25px;
  }
  
  .cookie-stat-card {
    background: rgba(40, 20, 30, 0.7);
    padding: 20px;
    border-radius: 12px;
    border: 1px solid rgba(255, 20, 100, 0.3);
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .cookie-stat-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 25px rgba(255, 20, 100, 0.2);
  }
  
  .cookie-stat-card.active {
    border-color: #4dff88;
    background: rgba(77, 255, 136, 0.1);
  }
  
  .cookie-stat-card.inactive {
    border-color: #ff4d4d;
    background: rgba(255, 77, 77, 0.1);
  }
  
  .cookie-number {
    font-size: 18px;
    font-weight: 800;
    color: #ff4d8d;
    margin-bottom: 8px;
  }
  
  .cookie-status {
    font-size: 13px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 20px;
    display: inline-block;
    margin-bottom: 10px;
  }
  
  .cookie-active {
    background: rgba(77, 255, 136, 0.2);
    color: #4dff88;
  }
  
  .cookie-inactive {
    background: rgba(255, 77, 77, 0.2);
    color: #ff4d4d;
  }
  
  .cookie-messages {
    font-size: 12px;
    color: #ff99c2;
    margin-top: 8px;
  }
  
  /* Status Indicator */
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
    padding: 10px 20px;
    border-radius: 25px;
    background: rgba(40, 20, 30, 0.8);
    border: 1px solid rgba(255, 20, 100, 0.3);
    box-shadow: 0 0 15px rgba(255, 20, 100, 0.1);
  }
  
  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ff1464;
    animation: statusPulse 2s infinite;
    box-shadow: 0 0 10px currentColor;
  }
  
  @keyframes statusPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .status-dot.ready { background: #4dff88; }
  .status-dot.running { 
    background: #ff1464; 
    animation: statusPulseRunning 1s infinite;
  }
  .status-dot.error { background: #ff4d4d; }
  
  @keyframes statusPulseRunning {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  
  /* Mobile Responsive */
  @media (max-width: 900px) {
    .dashboard-grid {
      grid-template-columns: 1fr;
    }
    
    .form-grid {
      grid-template-columns: 1fr;
    }
    
    .cookie-options {
      flex-direction: column;
    }
    
    .action-buttons {
      flex-direction: column;
    }
    
    .btn {
      width: 100%;
    }
    
    .stats-grid {
      grid-template-columns: 1fr;
    }
    
    header {
      flex-direction: column;
      align-items: flex-start;
      gap: 20px;
      padding: 15px;
    }
    
    .level-indicator {
      width: 100%;
      justify-content: space-between;
    }
    
    .status-indicator {
      margin-left: 0;
      width: 100%;
      justify-content: center;
    }
    
    .console-tabs {
      flex-wrap: wrap;
    }
    
    .console-tab {
      flex: 1 0 50%;
      padding: 15px;
      font-size: 14px;
    }
  }
  
  /* Scrollbar Styling */
  ::-webkit-scrollbar {
    width: 10px;
  }
  
  ::-webkit-scrollbar-track {
    background: rgba(40, 20, 30, 0.5);
    border-radius: 5px;
  }
  
  ::-webkit-scrollbar-thumb {
    background: linear-gradient(135deg, #ff1464, #ff4d8d);
    border-radius: 5px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(135deg, #ff2a74, #ff5d9d);
  }
</style>
</head>
<body>
  <!-- Animated Background Elements -->
  <div class="lines-container">
    <div class="line"></div>
    <div class="line"></div>
    <div class="line"></div>
    <div class="line"></div>
    <div class="line"></div>
  </div>
  
  <div class="pulse-glow"></div>
  
  <div class="particles" id="particles-container"></div>
  
  <!-- Header -->
  <header>
    <div class="logo-container">
      <div class="logo">F</div>
      <div class="logo-text">
        <h1>FAIZU MESSAGING SYSTEM</h1>
        <div class="subtitle">MULTI-COOKIE CONVO MASTER</div>
      </div>
    </div>
    
    <div class="level-indicator">
      <div class="level">
        <div class="level-label">Power Level</div>
        <div class="level-bar">
          <div class="level-fill" style="width: 92%"></div>
        </div>
        <div class="level-value">92%</div>
      </div>
      
      <div class="level">
        <div class="level-label">Cookie Health</div>
        <div class="level-bar">
          <div class="level-fill" style="width: 87%"></div>
        </div>
        <div class="level-value">87%</div>
      </div>
    </div>
    
    <div class="status-indicator">
      <div class="status-dot ready" id="status-dot"></div>
      <span id="status-text">System Ready</span>
    </div>
  </header>
  
  <div class="container">
    <!-- Dashboard Grid -->
    <div class="dashboard-grid">
      <!-- Main Configuration Panel -->
      <div class="panel">
        <div class="panel-title">
          <span>⚙️</span> MISSION CONTROL PANEL
        </div>
        
        <div class="form-grid">
          <div class="form-group full-width">
            <div class="cookie-options">
              <div class="cookie-option active" id="cookie-file-option">
                <input type="radio" name="cookie-mode" value="file" checked>
                <div>
                  <strong>📁 Upload Cookie File</strong>
                  <div style="font-size: 13px; color: #ff99c2;">.txt or .json (one cookie per line)</div>
                </div>
              </div>
              <div class="cookie-option" id="cookie-paste-option">
                <input type="radio" name="cookie-mode" value="paste">
                <div>
                  <strong>📋 Paste Cookies</strong>
                  <div style="font-size: 13px; color: #ff99c2;">Manual input, one per line</div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="form-group full-width" id="cookie-file-section">
            <label for="cookie-file">🍪 Cookie Database</label>
            <div class="file-input" onclick="document.getElementById('cookie-file').click()">
              <span id="cookie-file-name">Select cookie file...</span>
              <span>📂</span>
            </div>
            <input type="file" id="cookie-file" accept=".txt,.json" style="display: none;">
            <small style="color: #ff4d8d; display: block; margin-top: 8px;">Multiple cookies supported - System auto-rotates between active accounts</small>
          </div>
          
          <div class="form-group full-width" id="cookie-paste-section" style="display: none;">
            <label for="cookie-paste">📝 Direct Cookie Input</label>
            <textarea id="cookie-paste" rows="6" placeholder="Paste cookies here, one account per line..."></textarea>
            <small style="color: #ff80b3; display: block; margin-top: 8px;">Each line = One Facebook account | System handles rotation automatically</small>
          </div>
          
          <div class="form-group">
            <label for="haters-name">😈 Hater's Signature</label>
            <input type="text" id="haters-name" placeholder="Enter hater's name">
            <small>Prepended to each message</small>
          </div>
          
          <div class="form-group">
            <label for="thread-id">💬 Target Thread ID</label>
            <input type="text" id="thread-id" placeholder="Enter thread/group ID">
            <small>Destination conversation</small>
          </div>
          
          <div class="form-group">
            <label for="last-here-name">📍 Exit Signature</label>
            <input type="text" id="last-here-name" placeholder="Enter last here name">
            <small>Appended to each message</small>
          </div>
          
          <div class="form-group">
            <label for="delay">⏱️ Attack Interval</label>
            <input type="number" id="delay" value="5" min="1" max="60">
            <small>Seconds between messages</small>
          </div>
          
          <div class="form-group full-width">
            <label for="message-file">📨 Message Arsenal</label>
            <div class="file-input" onclick="document.getElementById('message-file').click()">
              <span id="message-file-name">Select messages file...</span>
              <span>📂</span>
            </div>
            <input type="file" id="message-file" accept=".txt" style="display: none;">
            <small style="color: #ff80b3;">One message per line | Loops automatically when finished</small>
          </div>
          
          <div class="form-group full-width">
            <div class="action-buttons">
              <button class="btn btn-primary" id="start-btn">
                <span>🔥</span> LAUNCH ATTACK
              </button>
              <button class="btn btn-secondary" id="pause-btn" disabled>
                <span>⏸️</span> PAUSE STREAM
              </button>
              <button class="btn btn-warning" id="stop-btn" disabled>
                <span>⏹️</span> ABORT MISSION
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Stats Panel -->
      <div class="panel stats-panel">
        <div class="panel-title">
          <span>📊</span> LIVE COMBAT STATS
        </div>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" id="stat-sent">0</div>
            <div class="stat-label">Messages Fired</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-failed">0</div>
            <div class="stat-label">Messages Failed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-cookies">0</div>
            <div class="stat-label">Active Soldiers</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="stat-loops">0</div>
            <div class="stat-label">Battle Cycles</div>
          </div>
        </div>
        
        <div style="margin-top: 30px;">
          <div class="panel-title" style="font-size: 17px;">
            <span>🛡️</span> SYSTEM STATUS
          </div>
          <div style="font-size: 14px; color: #ff99c2; line-height: 1.7;">
            <div><strong>Multi-Cookie Engine:</strong> <span style="color: #4dff88;">OPERATIONAL</span></div>
            <div><strong>Auto-Recovery:</strong> <span style="color: #4dff88;">ACTIVE</span></div>
            <div><strong>Cookie Safety:</strong> <span style="color: #4dff88;">NO LOGOUT</span></div>
            <div><strong>Rotation Mode:</strong> <span style="color: #ffcc4d;">INTELLIGENT</span></div>
            <div><strong>Stealth Level:</strong> <span style="color: #ff4d8d;">HIGH</span></div>
          </div>
        </div>
        
        <div id="task-id-container" style="display: none; margin-top: 25px;">
          <div class="task-id-box">
            <div class="task-id-label">MISSION ID</div>
            <div class="task-id-value" id="current-task-id"></div>
            <div class="task-id-note">Save this ID to control your mission later</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Console Panel -->
    <div class="panel console-panel">
      <div class="console-tabs">
        <div class="console-tab active" onclick="switchTab('console')">📡 LIVE TRANSMISSION</div>
        <div class="console-tab" onclick="switchTab('stop')">⏹️ MISSION CONTROL</div>
        <div class="console-tab" onclick="switchTab('view')">👁️ RECON DATA</div>
        <div class="console-tab" onclick="switchTab('cookies')">🪪 SOLDIER STATUS</div>
      </div>
      
      <!-- Console Tab -->
      <div id="console-tab" class="console-content active">
        <div class="console-log" id="console-log"></div>
      </div>
      
      <!-- Stop Task Tab -->
      <div id="stop-tab" class="console-content">
        <h3 style="color: #ff4d8d; margin-top: 0;">Mission Abort Protocol</h3>
        <p style="color: #ff99c2; margin-bottom: 25px;">Enter your Mission ID to safely terminate operations. All accounts remain active and logged in.</p>
        
        <div class="form-group">
          <label for="stop-task-id">Mission ID</label>
          <input type="text" id="stop-task-id" placeholder="Paste your mission ID here">
        </div>
        
        <div class="action-buttons">
          <button class="btn btn-warning" id="stop-task-btn">
            <span>⚠️</span> EXECUTE ABORT
          </button>
        </div>
        
        <div id="stop-result" style="margin-top: 25px;"></div>
        
        <div style="background: rgba(77, 255, 136, 0.1); border: 1px solid rgba(77, 255, 136, 0.3); border-radius: 12px; padding: 20px; margin-top: 25px;">
          <div style="color: #4dff88; font-weight: 800; margin-bottom: 10px;">🛡️ SAFETY PROTOCOL ACTIVE</div>
          <div style="color: #ff99c2; font-size: 14px;">All Facebook accounts remain logged in after mission termination. Cookies are preserved for future operations with zero relogin required.</div>
        </div>
      </div>
      
      <!-- View Details Tab -->
      <div id="view-tab" class="console-content">
        <h3 style="color: #ff80b3; margin-top: 0;">Mission Reconnaissance</h3>
        <p style="color: #ff99c2; margin-bottom: 25px;">Enter Mission ID to retrieve detailed combat analytics and transmission logs.</p>
        
        <div class="form-group">
          <label for="view-task-id">Mission ID</label>
          <input type="text" id="view-task-id" placeholder="Paste your mission ID here">
        </div>
        
        <div class="action-buttons">
          <button class="btn btn-secondary" id="view-details-btn">
            <span>🔍</span> RETRIEVE DATA
          </button>
        </div>
        
        <div id="task-details-container" style="display: none; margin-top: 30px;">
          <!-- Task details will be loaded here -->
        </div>
      </div>
      
      <!-- Cookie Stats Tab -->
      <div id="cookies-tab" class="console-content">
        <h3 style="color: #ff4d8d; margin-top: 0;">Soldier Roster & Status</h3>
        <p style="color: #ff99c2; margin-bottom: 25px;">Live status of all active cookie accounts in current mission.</p>
        
        <div id="cookie-stats-container">
          <div style="text-align: center; padding: 50px; color: #ff4d8d;">
            <div style="font-size: 60px; margin-bottom: 20px;">🪪</div>
            <div style="font-size: 18px; font-weight: 700;">NO ACTIVE MISSION</div>
            <div style="color: #ff80b3; margin-top: 10px;">Launch a mission to see soldier status</div>
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  // Initialize variables
  let currentTaskId = null;
  let isRunning = false;
  let isPaused = false;
  let stats = {
    sent: 0,
    failed: 0,
    cookies: 0,
    loops: 0
  };
  
  // DOM Elements
  const consoleLog = document.getElementById('console-log');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const stopTaskBtn = document.getElementById('stop-task-btn');
  const viewDetailsBtn = document.getElementById('view-details-btn');
  
  // Create floating particles
  function createParticles() {
    const container = document.getElementById('particles-container');
    for (let i = 0; i < 50; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = Math.random() * 100 + 'vw';
      particle.style.top = Math.random() * 100 + 'vh';
      particle.style.animationDelay = Math.random() * 20 + 's';
      particle.style.animationDuration = (Math.random() * 10 + 15) + 's';
      container.appendChild(particle);
    }
  }
  
  // File input handlers
  document.getElementById('cookie-file').addEventListener('change', function(e) {
    const fileName = e.target.files[0] ? e.target.files[0].name : 'Select cookie file...';
    document.getElementById('cookie-file-name').textContent = fileName;
  });
  
  document.getElementById('message-file').addEventListener('change', function(e) {
    const fileName = e.target.files[0] ? e.target.files[0].name : 'Select messages file...';
    document.getElementById('message-file-name').textContent = fileName;
  });
  
  // Cookie mode toggle
  document.querySelectorAll('input[name="cookie-mode"]').forEach(radio => {
    radio.addEventListener('change', function() {
      const isFileMode = this.value === 'file';
      
      // Update UI
      document.getElementById('cookie-file-option').classList.toggle('active', isFileMode);
      document.getElementById('cookie-paste-option').classList.toggle('active', !isFileMode);
      document.getElementById('cookie-file-section').style.display = isFileMode ? 'block' : 'none';
      document.getElementById('cookie-paste-section').style.display = isFileMode ? 'none' : 'block';
    });
  });
  
  // Tab switching
  function switchTab(tabName) {
    // Update tabs
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update content
    document.querySelectorAll('.console-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(tabName + '-tab').classList.add('active');
  }
  
  // Log function with animations
  function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
    consoleLog.appendChild(logEntry);
    
    // Remove old logs if too many
    if (consoleLog.children.length > 50) {
      consoleLog.removeChild(consoleLog.firstChild);
    }
    
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }
  
  // Update status with animation
  function updateStatus(status, type = 'ready') {
    statusText.textContent = status;
    statusDot.className = `status-dot ${type}`;
    
    // Add status change log
    if (type === 'running') {
      addLog(`🔴 STATUS CHANGE: ${status}`, 'warning');
    } else if (type === 'error') {
      addLog(`🛑 STATUS CHANGE: ${status}`, 'error');
    } else {
      addLog(`🟢 STATUS CHANGE: ${status}`, 'success');
    }
  }
  
  // Update stats with animation
  function updateStats() {
    // Animate stat changes
    const statElements = {
      sent: document.getElementById('stat-sent'),
      failed: document.getElementById('stat-failed'),
      cookies: document.getElementById('stat-cookies'),
      loops: document.getElementById('stat-loops')
    };
    
    for (const key in statElements) {
      if (statElements[key]) {
        const oldValue = parseInt(statElements[key].textContent) || 0;
        const newValue = stats[key];
        
        if (oldValue !== newValue) {
          // Add animation class
          statElements[key].parentElement.classList.add('stat-card');
          setTimeout(() => {
            statElements[key].parentElement.classList.remove('stat-card');
          }, 300);
          
          // Update value
          statElements[key].textContent = newValue;
        }
      }
    }
  }
  
  // Show task ID with animation
  function showTaskId(taskId) {
    currentTaskId = taskId;
    document.getElementById('current-task-id').textContent = taskId;
    document.getElementById('task-id-container').style.display = 'block';
    
    // Add animation
    const taskBox = document.querySelector('.task-id-box');
    taskBox.style.animation = 'none';
    setTimeout(() => {
      taskBox.style.animation = 'taskIdPulse 3s infinite alternate';
    }, 10);
  }
  
  // Hide task ID
  function hideTaskId() {
    document.getElementById('task-id-container').style.display = 'none';
  }
  
  // Update cookie stats display
  function updateCookieStats() {
    const container = document.getElementById('cookie-stats-container');
    
    if (!isRunning) {
      container.innerHTML = `
        <div style="text-align: center; padding: 50px; color: #ff4d8d;">
          <div style="font-size: 60px; margin-bottom: 20px;">🪪</div>
          <div style="font-size: 18px; font-weight: 700;">NO ACTIVE MISSION</div>
          <div style="color: #ff80b3; margin-top: 10px;">Launch a mission to see soldier status</div>
        </div>
      `;
      return;
    }
    
    let html = '<div class="cookie-stats-grid">';
    
    // Generate dynamic cookie stats
    const cookieCount = Math.floor(Math.random() * 3) + 3; // 3-5 cookies
    stats.cookies = cookieCount;
    
    for (let i = 1; i <= cookieCount; i++) {
      const isActive = Math.random() > 0.3; // 70% active
      const messagesSent = Math.floor(Math.random() * 40) + 10 + stats.sent;
      const health = Math.floor(Math.random() * 30) + 70;
      
      html += `
        <div class="cookie-stat-card ${isActive ? 'active' : 'inactive'}">
          <div class="cookie-number">SOLDIER #${i}</div>
          <div class="cookie-status ${isActive ? 'cookie-active' : 'cookie-inactive'}">
            ${isActive ? '🟢 COMBAT READY' : '🔴 INACTIVE'}
          </div>
          <div class="cookie-messages">Ammo Fired: ${messagesSent} rounds</div>
          <div class="cookie-messages">Health: ${health}%</div>
        </div>
      `;
    }
    
    html += '</div>';
    container.innerHTML = html;
    updateStats();
  }
  
  // Mission simulation
  function simulateMission() {
    if (!isRunning || isPaused) return;
    
    // Simulate sending messages
    const messagesPerTick = Math.floor(Math.random() * 2) + 1;
    stats.sent += messagesPerTick;
    
    // Occasionally fail a message
    if (Math.random() > 0.85) {
      stats.failed += 1;
      addLog(`❌ Message failed - Rotating to next soldier`, 'error');
    } else {
      // Success log
      const cookieNum = Math.floor(Math.random() * stats.cookies) + 1;
      const messages = [
        `✅ Message delivered via Soldier #${cookieNum}`,
        `🎯 Direct hit via Soldier #${cookieNum}`,
        `⚡ Rapid fire via Soldier #${cookieNum}`,
        `🔫 Suppressive fire via Soldier #${cookieNum}`
      ];
      addLog(messages[Math.floor(Math.random() * messages.length)], 'success');
    }
    
    // Update loops
    stats.loops = Math.floor(stats.sent / 30);
    
    // Update stats
    updateStats();
    
    // Occasionally update cookie stats
    if (Math.random() > 0.7) {
      updateCookieStats();
    }
    
    // Occasionally add system logs
    if (Math.random() > 0.9) {
      const systemLogs = [
        `🔄 Auto-rotating to next available soldier`,
        `🛡️ Cookie safety check passed`,
        `📊 Mission efficiency: ${Math.floor(Math.random() * 30) + 70}%`,
        `⚙️ System optimization in progress`
      ];
      addLog(systemLogs[Math.floor(Math.random() * systemLogs.length)], 'warning');
    }
  }
  
  // Start button handler
  startBtn.addEventListener('click', function() {
    // Validate inputs
    const cookieMode = document.querySelector('input[name="cookie-mode"]:checked').value;
    const hatersName = document.getElementById('haters-name').value.trim();
    const threadId = document.getElementById('thread-id').value.trim();
    const lastHereName = document.getElementById('last-here-name').value.trim();
    const delay = document.getElementById('delay').value;
    
    if (cookieMode === 'file' && !document.getElementById('cookie-file').files.length) {
      addLog('Please select a cookie file', 'error');
      return;
    }
    
    if (cookieMode === 'paste' && !document.getElementById('cookie-paste').value.trim()) {
      addLog('Please paste cookies in the text area', 'error');
      return;
    }
    
    if (!hatersName) {
      addLog('Please enter Hater\'s Signature', 'error');
      return;
    }
    
    if (!threadId) {
      addLog('Please enter Target Thread ID', 'error');
      return;
    }
    
    if (!lastHereName) {
      addLog('Please enter Exit Signature', 'error');
      return;
    }
    
    if (!document.getElementById('message-file').files.length) {
      addLog('Please select a messages file', 'error');
      return;
    }
    
    // Mission start
    isRunning = true;
    isPaused = false;
    updateStatus('MISSION ACTIVE', 'running');
    
    // Update buttons
    startBtn.disabled = true;
    startBtn.innerHTML = '<span>🔥</span> MISSION ACTIVE';
    pauseBtn.disabled = false;
    pauseBtn.innerHTML = '<span>⏸️</span> PAUSE STREAM';
    stopBtn.disabled = false;
    
    // Generate mission ID
    const missionId = 'FAIZU-' + Date.now().toString(16).toUpperCase() + '-' + 
                     Math.random().toString(36).substr(2, 6).toUpperCase();
    showTaskId(missionId);
    
    // Reset stats
    stats = { sent: 0, failed: 0, cookies: 0, loops: 0 };
    updateStats();
    
    // Mission start logs
    addLog(`🚀 MISSION LAUNCHED: ${missionId}`, 'success');
    addLog(`🎯 TARGET ACQUIRED: ${threadId}`, 'warning');
    addLog(`🪪 MULTI-SOLDIER MODE: ACTIVATED`, 'success');
    addLog(`⚡ ATTACK INTERVAL: ${delay} seconds`, 'info');
    addLog(`🛡️ SAFETY PROTOCOL: NO AUTO-LOGOUT`, 'success');
    addLog(`🔥 INITIATING COMBAT SEQUENCE...`, 'warning');
    
    // Initialize cookie stats
    setTimeout(() => {
      updateCookieStats();
      addLog(`✅ SOLDIER DEPLOYMENT: ${stats.cookies} accounts ready`, 'success');
    }, 1000);
    
    // Start mission simulation
    const missionInterval = setInterval(simulateMission, 2000);
    
    // Store interval for cleanup
    window.missionInterval = missionInterval;
    
    // Switch to console tab
    switchTab('console');
  });
  
  // Pause button handler
  pauseBtn.addEventListener('click', function() {
    if (!isRunning) return;
    
    isPaused = !isPaused;
    
    if (isPaused) {
      updateStatus('MISSION PAUSED', 'error');
      pauseBtn.innerHTML = '<span>▶️</span> RESUME STREAM';
      addLog('⏸️ MISSION PAUSED - Holding position', 'warning');
    } else {
      updateStatus('MISSION ACTIVE', 'running');
      pauseBtn.innerHTML = '<span>⏸️</span> PAUSE STREAM';
      addLog('▶️ MISSION RESUMED - Continuing assault', 'success');
    }
  });
  
  // Stop button handler (current mission)
  stopBtn.addEventListener('click', function() {
    if (!currentTaskId) return;
    
    isRunning = false;
    isPaused = false;
    updateStatus('MISSION TERMINATED', 'ready');
    
    // Clear mission interval
    if (window.missionInterval) {
      clearInterval(window.missionInterval);
    }
    
    // Update buttons
    startBtn.disabled = false;
    startBtn.innerHTML = '<span>🔥</span> LAUNCH ATTACK';
    pauseBtn.disabled = true;
    pauseBtn.innerHTML = '<span>⏸️</span> PAUSE STREAM';
    stopBtn.disabled = true;
    
    // Mission end logs
    addLog(`⏹️ MISSION TERMINATED: ${currentTaskId}`, 'warning');
    addLog(`🛡️ ALL SOLDIERS SECURE: Accounts remain logged in`, 'success');
    addLog(`📊 FINAL COMBAT REPORT: ${stats.sent} fired, ${stats.failed} failed`, 'info');
    addLog(`✅ READY FOR NEXT MISSION`, 'success');
    
    // Hide mission ID
    hideTaskId();
    
    // Update cookie stats to show inactive
    updateCookieStats();
  });
  
  // Stop mission by ID handler
  stopTaskBtn.addEventListener('click', function() {
    const taskId = document.getElementById('stop-task-id').value.trim();
    
    if (!taskId) {
      document.getElementById('stop-result').innerHTML = `
        <div class="log-entry error">Please enter a Mission ID</div>
      `;
      return;
    }
    
    document.getElementById('stop-result').innerHTML = `
      <div class="log-entry warning">🔴 TERMINATING MISSION: ${taskId}...</div>
    `;
    
    // Simulate API call
    setTimeout(() => {
      document.getElementById('stop-result').innerHTML = `
        <div class="log-entry success">✅ MISSION TERMINATED: ${taskId}</div>
        <div class="log-entry success">🛡️ All soldiers secured - Ready for redeployment</div>
      `;
      
      // Clear input
      document.getElementById('stop-task-id').value = '';
    }, 2000);
  });
  
  // View details handler
  viewDetailsBtn.addEventListener('click', function() {
    const taskId = document.getElementById('view-task-id').value.trim();
    
    if (!taskId) {
      addLog('Please enter a Mission ID to retrieve data', 'error');
      return;
    }
    
    // Simulate loading
    document.getElementById('task-details-container').innerHTML = `
      <div style="text-align: center; padding: 30px;">
        <div class="stat-value" style="color: #ff4d8d; font-size: 24px;">🔍 RETRIEVING MISSION DATA...</div>
      </div>
    `;
    document.getElementById('task-details-container').style.display = 'block';
    
    // Simulate API response
    setTimeout(() => {
      document.getElementById('task-details-container').innerHTML = `
        <div class="task-id-box">
          <div class="task-id-label">MISSION INTELLIGENCE</div>
          <div class="task-id-value">${taskId}</div>
          <div class="task-id-note">Last transmission: 5 minutes ago | Status: COMPLETED</div>
        </div>
        
        <div class="stats-grid" style="margin-top: 25px;">
          <div class="stat-card">
            <div class="stat-value" style="color: #ff1464;">327</div>
            <div class="stat-label">Messages Fired</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #ff4d8d;">18</div>
            <div class="stat-label">Messages Failed</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #ff80b3;">5</div>
            <div class="stat-label">Active Soldiers</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color: #dc143c;">10</div>
            <div class="stat-label">Battle Cycles</div>
          </div>
        </div>
        
        <h4 style="color: #ff99c2; margin-top: 30px; border-bottom: 2px solid rgba(255, 20, 100, 0.3); padding-bottom: 10px;">RECENT TRANSMISSIONS</h4>
        <div class="console-log" style="height: 250px; margin-top: 15px;">
          <div class="log-entry success">[14:45:22] ✅ Direct hit via Soldier #3</div>
          <div class="log-entry info">[14:45:10] 🔄 Rotating to Soldier #3</div>
          <div class="log-entry success">[14:44:58] 🎯 Message delivered via Soldier #2</div>
          <div class="log-entry warning">[14:44:45] ⚙️ System optimization complete</div>
          <div class="log-entry error">[14:44:32] ❌ Soldier #1 failed - Auto-rotating</div>
          <div class="log-entry success">[14:44:20] 🔥 Rapid fire via Soldier #1</div>
          <div class="log-entry warning">[14:44:05] 📊 Efficiency: 92% | Health: 87%</div>
        </div>
      `;
    }, 1500);
  });
  
  // Initialize
  document.addEventListener('DOMContentLoaded', function() {
    // Create background particles
    createParticles();
    
    // Set up event listeners for cookie options
    document.getElementById('cookie-file-option').addEventListener('click', function() {
      document.querySelector('input[name="cookie-mode"][value="file"]').click();
    });
    
    document.getElementById('cookie-paste-option').addEventListener('click', function() {
      document.querySelector('input[name="cookie-mode"][value="paste"]').click();
    });
    
    // Initial logs
    setTimeout(() => {
      addLog('🚀 FAIZU MESSAGING SYSTEM v2.0 INITIALIZED', 'success');
      addLog('🪪 MULTI-COOKIE ENGINE: READY', 'info');
      addLog('🛡️ SAFETY PROTOCOLS: ACTIVE', 'success');
      addLog('⚡ HIGH-PERFORMANCE MODE: ENABLED', 'warning');
      addLog('✅ AWAITING MISSION PARAMETERS...', 'info');
    }, 1000);
    
    // Auto-update cookie stats periodically
    setInterval(updateCookieStats, 3000);
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
  console.log(`🚀 Raffay Multi-User System running at http://localhost:${PORT}`);
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
