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

// PASSWORD PROTECTION
const VALID_USERNAME = "Faizu Xd";
const VALID_PASSWORD = "Justfuckaway";

// Active sessions (for password protection)
const activeSessions = new Set();

// Server monitoring
let serverStartTime = Date.now();
let serverUptime = 0;
let serverRestarts = 0;
let lastCrashTime = null;

// Task management
let activeTasks = new Map();

// AUTO CONSOLE CLEAR SETUP
let consoleClearInterval;
function setupConsoleClear() {
    consoleClearInterval = setInterval(() => {
        console.clear();
        const now = new Date();
        console.log(`=== System Refresh ===`);
        console.log(`Time: ${now.toLocaleTimeString()}`);
        console.log(`Active Tasks: ${activeTasks.size}`);
        console.log(`Server Uptime: ${Math.floor((Date.now() - serverStartTime) / 3600000)} hours`);
        console.log(`Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    }, 30 * 60 * 1000);
}

// Server health monitoring
function monitorServerHealth() {
    setInterval(() => {
        serverUptime = Date.now() - serverStartTime;
        
        // Check if server needs restart (every 12 hours)
        if (serverUptime > 12 * 60 * 60 * 1000) {
            broadcastNotification("🔄 Server running for 12+ hours - Still operational");
        }
        
        // Broadcast server status every hour
        if (Math.floor(serverUptime / 3600000) > 0 && 
            Math.floor(serverUptime / 3600000) % 1 === 0) {
            broadcastNotification(`✅ Server operational - Uptime: ${Math.floor(serverUptime / 3600000)} hours`);
        }
    }, 3600000); // Check every hour
}

// Broadcast notifications to all clients
function broadcastNotification(message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.authenticated) {
            try {
                client.send(JSON.stringify({
                    type: 'notification',
                    message: message,
                    timestamp: new Date().toLocaleTimeString()
                }));
            } catch (e) {
                // Silent error
            }
        }
    });
}

// Modified Task class
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        this.taskName = userData.taskName || `Task-${taskId.slice(0, 8)}`;
        
        // Parse multiple cookies
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
            maxRestarts: 1000,
            threadName: "Unknown"
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
            startTime: Date.now(),
            taskName: this.taskName
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
        
        this.addLog(`Loaded ${this.messageData.messages.length} formatted messages`, 'system');
        this.addLog(`Detected ${this.cookies.length} accounts in file`, 'system');
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' }),
            message: message,
            type: messageType,
            taskName: this.taskName
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: messageType,
            taskName: this.taskName
        });
    }

    healthCheck() {
        return Date.now() - this.config.lastActivity < 300000;
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task already active', 'system');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;
        
        if (this.messageData.messages.length === 0) {
            this.addLog('No messages available', 'error');
            this.config.running = false;
            return false;
        }

        this.addLog(`Initializing task with ${this.messageData.messages.length} messages`, 'system');
        return this.initializeAllBots();
    }

    initializeAllBots() {
        return new Promise((resolve) => {
            let currentIndex = 0;
            const totalCookies = this.cookies.length;
            
            const loginNextCookie = () => {
                if (currentIndex >= totalCookies) {
                    if (this.stats.activeCookies > 0) {
                        this.addLog(`${this.stats.activeCookies} accounts ready`, 'success');
                        this.startSending();
                        resolve(true);
                    } else {
                        this.addLog('All accounts failed to initialize', 'error');
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
                }, cookieIndex * 2000);
            };
            
            loginNextCookie();
        });
    }

    initializeSingleBot(cookieContent, index, callback) {
        this.addLog(`Initializing account ${index + 1}...`, 'system');
        
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false,
            online: true
        }, (err, api) => {
            if (err || !api) {
                this.addLog(`Account ${index + 1} initialization failed`, 'error');
                this.config.apis[index] = null;
                callback(false);
                return;
            }

            this.config.apis[index] = api;
            this.addLog(`Account ${index + 1} ready`, 'success');
            
            this.config.apis[index] = api;
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
                        this.addLog(`Account ${index + 1} disconnected, reconnecting...`, 'warning');
                        
                        setTimeout(() => {
                            if (this.config.running) {
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
                        this.config.threadName = info.name || 'Unknown';
                        this.addLog(`Account ${cookieIndex + 1}: Target - ${info.name || 'Unknown'}`, 'system');
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
            this.addLog('No active accounts available', 'error');
            return;
        }

        this.addLog(`Starting with ${activeApis.length} active accounts`, 'system');
        this.sendNextMessage();
    }

    sendNextMessage() {
        if (!this.config.running) return;

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog(`Cycle ${this.messageData.loopCount} completed`, 'system');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        const api = this.getNextAvailableApi();
        if (!api) {
            this.addLog('No active account available, retrying...', 'warning');
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
        const accountNum = this.currentCookieIndex + 1;
        
        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');
                
                if (err) {
                    this.stats.failed++;
                    
                    if (retryAttempt < maxSendRetries) {
                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog(`Account ${accountNum} failed after ${maxSendRetries} attempts`, 'error');
                        this.config.apis[this.currentCookieIndex] = null;
                        this.stats.activeCookies = this.config.apis.filter(api => api !== null).length;
                        
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage();
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog(`Account ${accountNum} | Sent message ${currentIndex + 1}/${totalMessages}`, 'success');
                    
                    this.messageData.currentIndex++;
                    this.scheduleNextMessage();
                }
            });
        } catch (sendError) {
            this.addLog(`Account ${accountNum} critical error`, 'error');
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
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('Restarting task...', 'system');
        this.stats.restarts++;
        this.config.restartCount++;
        
        this.config.apis = [];
        this.stats.activeCookies = 0;
        
        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeAllBots();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('Maximum restarts reached', 'error');
                this.config.running = false;
            }
        }, 10000);
    }

    stop() {
        this.config.running = false;
        this.stats.activeCookies = 0;
        this.addLog('Task paused - Accounts remain active', 'system');
        
        return true;
    }

    resume() {
        if (this.config.running) {
            this.addLog('Task already active', 'system');
            return false;
        }
        
        this.config.running = true;
        this.addLog('Task resumed', 'success');
        this.startSending();
        return true;
    }

    getDetails() {
        const activeCookies = this.config.apis.filter(api => api !== null).length;
        const cookieStats = this.cookies.map((cookie, index) => ({
            accountNumber: index + 1,
            active: this.config.apis[index] !== null,
            messagesSent: this.stats.cookieUsage[index] || 0
        }));
        
        return {
            taskId: this.taskId,
            taskName: this.taskName,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeAccounts: activeCookies,
            totalAccounts: this.stats.totalCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            threadName: this.config.threadName,
            threadID: this.messageData.threadID,
            cookieStats: cookieStats,
            logs: this.logs,
            running: this.config.running,
            uptime: Date.now() - this.stats.startTime,
            delay: this.config.delay
        };
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    lastCrashTime = Date.now();
    broadcastNotification(`System error detected: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
    broadcastNotification(`System warning: Unhandled operation`);
});

// WebSocket broadcast functions
function broadcastToTask(taskId, message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId && client.authenticated) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // ignore
            }
        }
    });
}

// HTML Control Panel with new design
const htmlControlPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Advanced Multi-Account Messaging System</title>
<style>
  * {
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Arial', sans-serif;
    margin: 0;
    padding: 0;
  }
  
  body {
    background: linear-gradient(135deg, #0c0c1e 0%, #1a1a2e 50%, #16213e 100%);
    color: #e0e0f0;
    min-height: 100vh;
    overflow-x: hidden;
  }
  
  .login-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(12, 12, 30, 0.9), rgba(26, 26, 46, 0.95));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  
  .login-container {
    background: rgba(30, 30, 50, 0.8);
    padding: 40px;
    border-radius: 15px;
    border: 2px solid #ff6b9d;
    box-shadow: 0 0 40px rgba(255, 107, 157, 0.3);
    text-align: center;
    width: 90%;
    max-width: 500px;
    backdrop-filter: blur(10px);
  }
  
  .login-gif {
    width: 150px;
    height: 150px;
    border-radius: 50%;
    margin: 0 auto 20px;
    border: 3px solid #ff6b9d;
    overflow: hidden;
  }
  
  .login-gif img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .login-title {
    color: #ff6b9d;
    font-size: 28px;
    margin-bottom: 10px;
    text-shadow: 0 0 10px rgba(255, 107, 157, 0.5);
  }
  
  .login-subtitle {
    color: #a0a0d0;
    margin-bottom: 30px;
    font-size: 14px;
  }
  
  .login-input {
    width: 100%;
    padding: 15px;
    margin-bottom: 20px;
    background: rgba(40, 40, 60, 0.8);
    border: 2px solid #4a9fff;
    border-radius: 8px;
    color: #fff;
    font-size: 16px;
    transition: all 0.3s ease;
  }
  
  .login-input:focus {
    outline: none;
    border-color: #ff6b9d;
    box-shadow: 0 0 15px rgba(255, 107, 157, 0.5);
    background: rgba(50, 50, 70, 0.9);
  }
  
  .login-btn {
    background: linear-gradient(45deg, #ff6b9d, #4a9fff);
    color: white;
    border: none;
    padding: 15px 40px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
    width: 100%;
    margin-top: 10px;
  }
  
  .login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 10px 20px rgba(255, 107, 157, 0.4);
  }
  
  .login-error {
    color: #ff4a4a;
    margin-top: 15px;
    display: none;
  }
  
  /* Main Interface */
  .main-interface {
    display: none;
    padding: 20px;
  }
  
  .header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    padding: 20px;
    border-radius: 15px;
    border: 2px solid #4a9fff;
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
  }
  
  .header-title {
    font-size: 24px;
    color: #4a9fff;
    font-weight: bold;
  }
  
  .header-stats {
    display: flex;
    gap: 20px;
  }
  
  .stat-item {
    background: rgba(40, 40, 60, 0.8);
    padding: 10px 20px;
    border-radius: 8px;
    border: 1px solid #ff6b9d;
    text-align: center;
  }
  
  .stat-value {
    font-size: 18px;
    color: #ff6b9d;
    font-weight: bold;
  }
  
  .stat-label {
    font-size: 12px;
    color: #a0a0d0;
    margin-top: 5px;
  }
  
  .container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }
  
  .panel {
    background: rgba(30, 30, 50, 0.8);
    border-radius: 15px;
    padding: 25px;
    border: 2px solid;
    backdrop-filter: blur(10px);
  }
  
  .panel.config {
    border-color: #4a9fff;
  }
  
  .panel.console {
    border-color: #ff6b9d;
  }
  
  .panel-title {
    color: #4a9fff;
    font-size: 18px;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid rgba(74, 159, 255, 0.3);
  }
  
  .input-group {
    margin-bottom: 20px;
  }
  
  .input-label {
    display: block;
    color: #ff6b9d;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 500;
  }
  
  .input-field {
    width: 100%;
    padding: 12px;
    background: rgba(40, 40, 60, 0.8);
    border: 2px solid #4a9fff;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    transition: all 0.3s ease;
  }
  
  .input-field:focus {
    outline: none;
    border-color: #ff6b9d;
    box-shadow: 0 0 15px rgba(255, 107, 157, 0.3);
    background: rgba(50, 50, 70, 0.9);
  }
  
  .file-upload {
    background: rgba(40, 40, 60, 0.8);
    border: 2px dashed #4a9fff;
    border-radius: 8px;
    padding: 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .file-upload:hover {
    border-color: #ff6b9d;
    background: rgba(50, 50, 70, 0.9);
  }
  
  .button-group {
    display: flex;
    gap: 15px;
    margin-top: 25px;
  }
  
  .btn {
    padding: 12px 30px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
    flex: 1;
  }
  
  .btn-primary {
    background: linear-gradient(45deg, #4a9fff, #6b5bff);
    color: white;
  }
  
  .btn-secondary {
    background: linear-gradient(45deg, #ff6b9d, #ff8e6b);
    color: white;
  }
  
  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  }
  
  .console-container {
    height: 400px;
    overflow-y: auto;
    background: rgba(20, 20, 40, 0.9);
    border-radius: 10px;
    padding: 15px;
    border: 1px solid rgba(255, 107, 157, 0.2);
  }
  
  .log-entry {
    padding: 10px;
    margin-bottom: 8px;
    border-radius: 6px;
    border-left: 4px solid;
    background: rgba(30, 30, 60, 0.5);
    font-size: 13px;
  }
  
  .log-info {
    border-left-color: #4a9fff;
  }
  
  .log-success {
    border-left-color: #4aff4a;
  }
  
  .log-error {
    border-left-color: #ff4a4a;
  }
  
  .log-system {
    border-left-color: #ff6b9d;
  }
  
  .log-warning {
    border-left-color: #ffcc4a;
  }
  
  .log-time {
    color: #a0a0d0;
    font-size: 11px;
    margin-right: 10px;
  }
  
  .tasks-panel {
    grid-column: 1 / -1;
  }
  
  .tasks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 15px;
    margin-top: 20px;
  }
  
  .task-card {
    background: rgba(40, 40, 60, 0.8);
    border-radius: 10px;
    padding: 15px;
    border: 2px solid #4a9fff;
    transition: all 0.3s ease;
  }
  
  .task-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 10px 25px rgba(74, 159, 255, 0.2);
  }
  
  .task-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
  }
  
  .task-name {
    color: #ff6b9d;
    font-size: 16px;
    font-weight: bold;
  }
  
  .task-status {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: bold;
  }
  
  .status-active {
    background: rgba(74, 255, 74, 0.2);
    color: #4aff4a;
    border: 1px solid #4aff4a;
  }
  
  .status-paused {
    background: rgba(255, 204, 74, 0.2);
    color: #ffcc4a;
    border: 1px solid #ffcc4a;
  }
  
  .task-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 15px;
  }
  
  .task-stat {
    text-align: center;
  }
  
  .task-stat-value {
    color: #4a9fff;
    font-size: 18px;
    font-weight: bold;
  }
  
  .task-stat-label {
    color: #a0a0d0;
    font-size: 11px;
    margin-top: 5px;
  }
  
  .task-actions {
    display: flex;
    gap: 10px;
  }
  
  .task-btn {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  
  .btn-resume {
    background: #4a9fff;
    color: white;
  }
  
  .btn-pause {
    background: #ff6b9d;
    color: white;
  }
  
  .btn-view {
    background: #6b5bff;
    color: white;
  }
  
  .notification-container {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 300px;
    z-index: 1000;
  }
  
  .notification {
    background: rgba(30, 30, 50, 0.95);
    border-radius: 10px;
    padding: 15px;
    margin-bottom: 10px;
    border-left: 5px solid #ff6b9d;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.3s ease;
    border: 1px solid rgba(255, 107, 157, 0.3);
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
  
  .notification-title {
    color: #ff6b9d;
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 5px;
  }
  
  .notification-message {
    color: #e0e0f0;
    font-size: 13px;
  }
  
  .notification-time {
    color: #a0a0d0;
    font-size: 11px;
    margin-top: 5px;
    text-align: right;
  }
  
  .gif-background {
    position: absolute;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.1;
    pointer-events: none;
    z-index: -1;
  }
  
  @media (max-width: 1024px) {
    .container {
      grid-template-columns: 1fr;
    }
    
    .header {
      flex-direction: column;
      gap: 15px;
    }
    
    .header-stats {
      flex-wrap: wrap;
      justify-content: center;
    }
  }
  
  @media (max-width: 768px) {
    .tasks-grid {
      grid-template-columns: 1fr;
    }
    
    .button-group {
      flex-direction: column;
    }
  }
</style>
</head>
<body>
  <!-- Login Screen -->
  <div class="login-overlay" id="loginOverlay">
    <div class="login-container">
      <div class="login-gif">
        <img src="https://i.pinimg.com/originals/64/9c/66/649c668b6c1208cce1c7da2b539f8d72.gif" alt="Login Background">
      </div>
      <h1 class="login-title">System Access</h1>
      <p class="login-subtitle">Enter credentials to continue</p>
      <input type="text" id="loginUsername" class="login-input" placeholder="Username" value="Faizu Xd">
      <input type="password" id="loginPassword" class="login-input" placeholder="Password" value="Justfuckaway">
      <button class="login-btn" onclick="login()">Access System</button>
      <div class="login-error" id="loginError">Invalid credentials</div>
    </div>
  </div>

  <!-- Main Interface -->
  <div class="main-interface" id="mainInterface">
    <!-- GIF Backgrounds -->
    <img class="gif-background" src="https://i.pinimg.com/originals/80/b1/cf/80b1cf27df714a3ba0da909fd3f3f221.gif" alt="Background 1">
    <img class="gif-background" src="https://i.pinimg.com/originals/5e/16/e3/5e16e3ab2987659e0b58baebb227162e.gif" alt="Background 2" style="opacity: 0.05;">

    <div class="header">
      <div class="header-title">Multi-Account Messaging System</div>
      <div class="header-stats">
        <div class="stat-item">
          <div class="stat-value" id="serverUptime">0h</div>
          <div class="stat-label">Uptime</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="activeTasks">0</div>
          <div class="stat-label">Active Tasks</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="totalMessages">0</div>
          <div class="stat-label">Messages</div>
        </div>
      </div>
    </div>

    <div class="container">
      <div class="panel config">
        <div class="panel-title">Task Configuration</div>
        <div class="input-group">
          <label class="input-label">Task Name</label>
          <input type="text" id="taskName" class="input-field" placeholder="Enter task name">
        </div>
        <div class="input-group">
          <label class="input-label">Target Group ID</label>
          <input type="text" id="threadID" class="input-field" placeholder="Enter group ID">
        </div>
        <div class="input-group">
          <label class="input-label">Prefix Name</label>
          <input type="text" id="hatersName" class="input-field" placeholder="Enter prefix name">
        </div>
        <div class="input-group">
          <label class="input-label">Suffix Name</label>
          <input type="text" id="lastHereName" class="input-field" placeholder="Enter suffix name">
        </div>
        <div class="input-group">
          <label class="input-label">Delay (seconds)</label>
          <input type="number" id="delay" class="input-field" value="5" min="1">
        </div>
        <div class="input-group">
          <label class="input-label">Accounts File</label>
          <div class="file-upload" onclick="document.getElementById('cookieFile').click()">
            <input type="file" id="cookieFile" style="display: none" accept=".txt,.json">
            <div>Click to upload accounts file (.txt or .json)</div>
            <small style="color: #a0a0d0">One account per line</small>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Messages File</label>
          <div class="file-upload" onclick="document.getElementById('messageFile').click()">
            <input type="file" id="messageFile" style="display: none" accept=".txt">
            <div>Click to upload messages file (.txt)</div>
            <small style="color: #a0a0d0">One message per line</small>
          </div>
        </div>
        <div class="button-group">
          <button class="btn btn-primary" onclick="startTask()">Start Task</button>
          <button class="btn btn-secondary" onclick="resetForm()">Clear</button>
        </div>
      </div>

      <div class="panel console">
        <div class="panel-title">System Console</div>
        <div class="console-container" id="consoleLogs"></div>
      </div>

      <div class="panel tasks-panel">
        <div class="panel-title">Active Tasks</div>
        <div class="tasks-grid" id="tasksGrid">
          <!-- Task cards will be inserted here -->
        </div>
      </div>
    </div>

    <!-- Notifications Container -->
    <div class="notification-container" id="notificationContainer"></div>
  </div>

<script>
  // Login System
  const VALID_USERNAME = "Faizu Xd";
  const VALID_PASSWORD = "Justfuckaway";

  function login() {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');

    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      document.getElementById('loginOverlay').style.display = 'none';
      document.getElementById('mainInterface').style.display = 'block';
      initializeSystem();
    } else {
      errorDiv.style.display = 'block';
    }
  }

  // Auto login on Enter key
  document.getElementById('loginPassword').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      login();
    }
  });

  // Initialize WebSocket
  const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(socketProtocol + '//' + location.host);
  let currentTasks = new Map();

  // System Functions
  function initializeSystem() {
    updateServerStats();
    setInterval(updateServerStats, 10000);
  }

  function updateServerStats() {
    document.getElementById('activeTasks').textContent = currentTasks.size;
    // These values will be updated via WebSocket
  }

  function startTask() {
    const taskName = document.getElementById('taskName').value.trim();
    const threadID = document.getElementById('threadID').value.trim();
    const hatersName = document.getElementById('hatersName').value.trim();
    const lastHereName = document.getElementById('lastHereName').value.trim();
    const delay = parseInt(document.getElementById('delay').value) || 5;
    const cookieFile = document.getElementById('cookieFile').files[0];
    const messageFile = document.getElementById('messageFile').files[0];

    if (!taskName || !threadID || !hatersName || !lastHereName) {
      showNotification('Please fill all required fields', 'error');
      return;
    }

    if (!cookieFile) {
      showNotification('Please select accounts file', 'error');
      return;
    }

    if (!messageFile) {
      showNotification('Please select messages file', 'error');
      return;
    }

    const cookieReader = new FileReader();
    const msgReader = new FileReader();

    msgReader.onload = function(e) {
      const messageContent = e.target.result;
      cookieReader.readAsText(cookieFile);
      cookieReader.onload = function(ev) {
        const cookieContent = ev.target.result;
        socket.send(JSON.stringify({
          type: 'start',
          taskName: taskName,
          cookieContent: cookieContent,
          messageContent: messageContent,
          hatersName: hatersName,
          threadID: threadID,
          lastHereName: lastHereName,
          delay: delay
        }));
      };
    };

    msgReader.readAsText(messageFile);
  }

  function resetForm() {
    document.getElementById('taskName').value = '';
    document.getElementById('threadID').value = '';
    document.getElementById('hatersName').value = '';
    document.getElementById('lastHereName').value = '';
    document.getElementById('delay').value = '5';
    document.getElementById('cookieFile').value = '';
    document.getElementById('messageFile').value = '';
  }

  function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.innerHTML = \`
      <div class="notification-title">\${type === 'error' ? 'Error' : 'Notification'}</div>
      <div class="notification-message">\${message}</div>
      <div class="notification-time">\${new Date().toLocaleTimeString()}</div>
    \`;
    container.appendChild(notification);
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  function addLog(message, type = 'info', taskName = 'System') {
    const consoleLogs = document.getElementById('consoleLogs');
    const logEntry = document.createElement('div');
    logEntry.className = \`log-entry log-\${type}\`;
    logEntry.innerHTML = \`
      <span class="log-time">\${new Date().toLocaleTimeString()}</span>
      <span style="color: #ff6b9d; font-weight: bold">[\${taskName}]</span>
      \${message}
    \`;
    consoleLogs.appendChild(logEntry);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  function updateTaskCard(taskId, details) {
    let card = document.querySelector(\`[data-task-id="\${taskId}"]\`);
    
    if (!card) {
      const tasksGrid = document.getElementById('tasksGrid');
      card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.taskId = taskId;
      tasksGrid.appendChild(card);
    }

    card.innerHTML = \`
      <div class="task-header">
        <div class="task-name">\${details.taskName}</div>
        <div class="task-status \${details.running ? 'status-active' : 'status-paused'}">
          \${details.running ? 'ACTIVE' : 'PAUSED'}
        </div>
      </div>
      <div class="task-stats">
        <div class="task-stat">
          <div class="task-stat-value">\${details.sent}</div>
          <div class="task-stat-label">Sent</div>
        </div>
        <div class="task-stat">
          <div class="task-stat-value">\${details.activeAccounts}</div>
          <div class="task-stat-label">Active</div>
        </div>
        <div class="task-stat">
          <div class="task-stat-value">\${details.loops}</div>
          <div class="task-stat-label">Cycles</div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-btn btn-\${details.running ? 'pause' : 'resume'}" 
                onclick="toggleTask('\${taskId}')">
          \${details.running ? 'Pause' : 'Resume'}
        </button>
        <button class="task-btn btn-view" onclick="viewTaskDetails('\${taskId}')">
          Details
        </button>
      </div>
    \`;
  }

  function toggleTask(taskId) {
    socket.send(JSON.stringify({
      type: 'toggle',
      taskId: taskId
    }));
  }

  function viewTaskDetails(taskId) {
    socket.send(JSON.stringify({
      type: 'view_details',
      taskId: taskId
    }));
  }

  // WebSocket Handlers
  socket.onopen = function() {
    addLog('Connected to server', 'system');
  };

  socket.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      
      switch(data.type) {
        case 'log':
          addLog(data.message, data.messageType, data.taskName);
          break;
          
        case 'task_started':
          addLog(\`Task started: \${data.taskName}\`, 'success');
          showNotification(\`Task "\${data.taskName}" started successfully\`);
          break;
          
        case 'task_updated':
          currentTasks.set(data.taskId, data);
          updateTaskCard(data.taskId, data);
          break;
          
        case 'task_stopped':
          currentTasks.delete(data.taskId);
          const card = document.querySelector(\`[data-task-id="\${data.taskId}"]\`);
          if (card) card.remove();
          addLog(\`Task stopped: \${data.taskName}\`, 'system');
          showNotification(\`Task "\${data.taskName}" stopped\`);
          break;
          
        case 'notification':
          showNotification(data.message, 'info');
          break;
          
        case 'server_stats':
          document.getElementById('serverUptime').textContent = data.uptime;
          document.getElementById('totalMessages').textContent = data.totalMessages;
          break;
          
        case 'task_details':
          showTaskDetailsModal(data);
          break;
          
        case 'error':
          showNotification(data.message, 'error');
          addLog(\`Error: \${data.message}\`, 'error');
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  socket.onclose = function() {
    addLog('Disconnected from server', 'error');
    showNotification('Connection lost - Reconnecting...', 'error');
    setTimeout(() => {
      location.reload();
    }, 5000);
  };

  socket.onerror = function(error) {
    console.error('WebSocket error:', error);
  };

  function showTaskDetailsModal(details) {
    // Create a modal to show task details
    const modal = document.createElement('div');
    modal.style.cssText = \`
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
    \`;
    
    modal.innerHTML = \`
      <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 15px;
        padding: 30px;
        width: 90%;
        max-width: 800px;
        border: 2px solid #ff6b9d;
        max-height: 80vh;
        overflow-y: auto;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2 style="color: #ff6b9d;">Task Details: \${details.taskName}</h2>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                  style="background: #ff4a4a; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">
            Close
          </button>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 20px;">
          <div style="background: rgba(40, 40, 60, 0.8); padding: 15px; border-radius: 10px; border: 1px solid #4a9fff;">
            <div style="color: #4a9fff; font-size: 14px; margin-bottom: 5px;">Target Group</div>
            <div style="color: white; font-size: 16px;">\${details.threadName}</div>
          </div>
          <div style="background: rgba(40, 40, 60, 0.8); padding: 15px; border-radius: 10px; border: 1px solid #ff6b9d;">
            <div style="color: #ff6b9d; font-size: 14px; margin-bottom: 5px;">Group ID</div>
            <div style="color: white; font-size: 16px;">\${details.threadID}</div>
          </div>
        </div>
        
        <div style="margin-bottom: 20px;">
          <h3 style="color: #4a9fff; margin-bottom: 10px;">Account Statistics</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;">
            \${details.cookieStats.map(account => \`
              <div style="background: rgba(40, 40, 60, 0.8); padding: 10px; border-radius: 8px; border: 1px solid \${account.active ? '#4aff4a' : '#ff4a4a'}">
                <div style="color: \${account.active ? '#4aff4a' : '#ff4a4a'}; font-weight: bold; margin-bottom: 5px;">
                  Account \${account.accountNumber}
                </div>
                <div style="color: #a0a0d0; font-size: 12px;">
                  Status: \${account.active ? 'Active' : 'Inactive'}
                </div>
                <div style="color: #ff6b9d; font-size: 14px; margin-top: 5px;">
                  Messages: \${account.messagesSent}
                </div>
              </div>
            \`).join('')}
          </div>
        </div>
        
        <div>
          <h3 style="color: #ff6b9d; margin-bottom: 10px;">Recent Activity</h3>
          <div style="background: rgba(20, 20, 40, 0.9); border-radius: 10px; padding: 15px; max-height: 200px; overflow-y: auto;">
            \${details.logs.slice(0, 10).map(log => \`
              <div style="padding: 8px; border-bottom: 1px solid rgba(255, 107, 157, 0.1); color: \${getLogColor(log.type)}; font-size: 12px;">
                <span style="color: #a0a0d0;">[\${log.time}]</span> \${log.message}
              </div>
            \`).join('')}
          </div>
        </div>
      </div>
    \`;
    
    document.body.appendChild(modal);
  }

  function getLogColor(type) {
    const colors = {
      'info': '#4a9fff',
      'success': '#4aff4a',
      'error': '#ff4a4a',
      'system': '#ff6b9d',
      'warning': '#ffcc4a'
    };
    return colors[type] || '#ffffff';
  }

  // Auto-focus username field
  window.onload = function() {
    document.getElementById('loginUsername').focus();
  };
</script>
</body>
</html>
`;

// Set up Express server
app.get('/', (req, res) => {
  res.send(htmlControlPanel);
});

// API endpoints for task management
app.post('/api/tasks/:taskId/toggle', (req, res) => {
  const taskId = req.params.taskId;
  const task = activeTasks.get(taskId);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  
  if (task.config.running) {
    task.stop();
    res.json({ status: 'paused', taskId });
  } else {
    task.resume();
    res.json({ status: 'resumed', taskId });
  }
});

app.get('/api/server/stats', (req, res) => {
  let totalMessages = 0;
  activeTasks.forEach(task => {
    totalMessages += task.stats.sent;
  });
  
  res.json({
    uptime: Math.floor((Date.now() - serverStartTime) / 3600000) + 'h',
    activeTasks: activeTasks.size,
    totalMessages: totalMessages,
    serverRestarts: serverRestarts,
    lastCrash: lastCrashTime ? new Date(lastCrashTime).toLocaleString() : null
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`=== System Initialized ===`);
  console.log(`Server running on port: ${PORT}`);
  console.log(`Access: http://localhost:${PORT}`);
  console.log(`System protected - Requires credentials`);
  console.log(`Multi-account support: Enabled`);
  console.log(`Auto-recovery: Enabled`);
  console.log(`Notification system: Active`);
  console.log(`================================`);
  
  setupConsoleClear();
  monitorServerHealth();
  serverStartTime = Date.now();
});

// Set up WebSocket server
let wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.authenticated = false;
  ws.taskId = null;
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Handle login
      if (!ws.authenticated && data.type === 'login') {
        if (data.username === VALID_USERNAME && data.password === VALID_PASSWORD) {
          ws.authenticated = true;
          ws.send(JSON.stringify({ type: 'login_success' }));
          broadcastNotification(`New connection established`);
          return;
        } else {
          ws.send(JSON.stringify({ type: 'login_failed' }));
          ws.close();
          return;
        }
      }

      if (!ws.authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        ws.close();
        return;
      }

      // Handle authenticated requests
      switch(data.type) {
        case 'start':
          handleStartTask(ws, data);
          break;
          
        case 'toggle':
          handleToggleTask(ws, data.taskId);
          break;
          
        case 'view_details':
          handleViewDetails(ws, data.taskId);
          break;
      }
      
    } catch (err) {
      console.error('Error processing message:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid request format'
      }));
    }
  });

  ws.on('close', () => {
    // Silent disconnect
  });
});

function handleStartTask(ws, data) {
  const taskId = uuidv4();
  ws.taskId = taskId;
  
  const task = new Task(taskId, {
    taskName: data.taskName,
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
      taskId: taskId,
      taskName: task.taskName
    }));
    
    // Broadcast initial task update
    broadcastTaskUpdate(taskId);
    
    console.log(`Task created: ${task.taskName} | Accounts: ${task.stats.totalCookies}`);
  }
}

function handleToggleTask(ws, taskId) {
  const task = activeTasks.get(taskId);
  if (!task) {
    ws.send(JSON.stringify({ type: 'error', message: 'Task not found' }));
    return;
  }
  
  if (task.config.running) {
    task.stop();
  } else {
    task.resume();
  }
  
  broadcastTaskUpdate(taskId);
}

function handleViewDetails(ws, taskId) {
  const task = activeTasks.get(taskId);
  if (!task) {
    ws.send(JSON.stringify({ type: 'error', message: 'Task not found' }));
    return;
  }
  
  ws.send(JSON.stringify({
    type: 'task_details',
    ...task.getDetails()
  }));
}

function broadcastTaskUpdate(taskId) {
  const task = activeTasks.get(taskId);
  if (!task || !wss) return;
  
  const details = task.getDetails();
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) {
      try {
        client.send(JSON.stringify({
          type: 'task_updated',
          ...details
        }));
      } catch (e) {
        // Silent error
      }
    }
  });
}

// Broadcast server stats periodically
setInterval(() => {
  if (!wss) return;
  
  let totalMessages = 0;
  activeTasks.forEach(task => {
    totalMessages += task.stats.sent;
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.authenticated) {
      try {
        client.send(JSON.stringify({
          type: 'server_stats',
          uptime: Math.floor((Date.now() - serverStartTime) / 3600000) + 'h',
          totalMessages: totalMessages,
          activeTasks: activeTasks.size
        }));
      } catch (e) {
        // Silent error
      }
    }
  });
}, 10000);

// Auto-restart system
function setupAutoRestart() {
  setInterval(() => {
    activeTasks.forEach((task, taskId) => {
      if (task.config.running && !task.healthCheck()) {
        console.log(`Auto-restarting task: ${task.taskName}`);
        task.restart();
        broadcastNotification(`Task "${task.taskName}" auto-restarted`);
      }
    });
  }, 60000);
}

setupAutoRestart();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('=== System Shutdown ===');
  broadcastNotification('System shutting down...');
  
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

process.on('SIGTERM', () => {
  console.log('=== System Termination ===');
  broadcastNotification('System terminating...');
  
  if (consoleClearInterval) {
    clearInterval(consoleClearInterval);
  }
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

// Crash recovery
process.on('exit', (code) => {
  lastCrashTime = Date.now();
  serverRestarts++;
  console.log(`Process exiting with code: ${code}`);
  console.log(`Total restarts: ${serverRestarts}`);
});
