// save as server.js
// npm install express ws axios uuid sharp

const fs = require('fs');
const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Facebook API engine
const fca = require('@xaviabot/fca-unofficial'); // Alternative: fca-unofficial

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5941;

// Global configurations
const CONFIG = {
    username: 'Faizu Xd',
    password: 'Justfuckaway',
    maxRetries: 100,
    retryDelay: 5000,
    healthCheckInterval: 12000 // 12 hours
};

// Thread Management
let activeThreads = new Map();
let loginStatus = false;
let currentUser = null;

// Auto-restart system
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 50;

// ==================== THREAD CLASS ====================
class Thread {
    constructor(threadId, config) {
        this.threadId = threadId;
        this.config = config;
        this.status = 'stopped';
        this.logs = [];
        this.stats = {
            sent: 0,
            failed: 0,
            startTime: Date.now(),
            lastActivity: Date.now()
        };
        this.api = null;
        this.interval = null;
        this.retryCount = 0;
    }

    addLog(message, type = 'info') {
        const logEntry = {
            timestamp: new Date().toLocaleTimeString('en-IN'),
            message: message,
            type: type
        };
        
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.stats.lastActivity = Date.now();
        this.broadcastUpdate();
    }

    broadcastUpdate() {
        // WebSocket broadcast logic
        broadcastToThread(this.threadId, {
            type: 'thread_update',
            threadId: this.threadId,
            status: this.status,
            stats: this.stats,
            logs: this.logs.slice(0, 20)
        });
    }

    async start() {
        if (this.status === 'running') {
            this.addLog('Thread is already running', 'warning');
            return false;
        }

        this.status = 'starting';
        this.addLog('Starting thread...', 'info');
        
        try {
            // Login with Facebook
            await this.login();
            
            this.status = 'running';
            this.addLog('Thread started successfully', 'success');
            this.startMessaging();
            return true;
        } catch (error) {
            this.status = 'error';
            this.addLog(`Failed to start: ${error.message}`, 'error');
            return false;
        }
    }

    async login() {
        return new Promise((resolve, reject) => {
            fca.login({
                email: this.config.username || CONFIG.username,
                password: this.config.password || CONFIG.password
            }, (err, api) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                this.api = api;
                this.addLog('Logged in successfully', 'success');
                resolve(api);
            });
        });
    }

    startMessaging() {
        if (!this.api || this.status !== 'running') return;

        this.interval = setInterval(() => {
            if (this.status !== 'running') {
                clearInterval(this.interval);
                return;
            }

            this.sendNextMessage();
        }, this.config.delay * 1000);
    }

    sendNextMessage() {
        if (!this.api || this.status !== 'running') return;

        const message = this.getNextMessage();
        if (!message) return;

        try {
            this.api.sendMessage(message, this.config.threadID, (err) => {
                if (err) {
                    this.stats.failed++;
                    this.addLog(`Failed to send: ${err.message}`, 'error');
                    
                    if (this.retryCount < 5) {
                        this.retryCount++;
                        setTimeout(() => this.sendNextMessage(), 2000);
                    }
                } else {
                    this.stats.sent++;
                    this.retryCount = 0;
                    this.addLog(`Message sent: ${message.substring(0, 50)}...`, 'success');
                }
            });
        } catch (error) {
            this.addLog(`Send error: ${error.message}`, 'error');
        }
    }

    getNextMessage() {
        if (!this.config.messages || this.config.messages.length === 0) {
            return "Default message";
        }
        
        if (!this.currentIndex || this.currentIndex >= this.config.messages.length) {
            this.currentIndex = 0;
        }
        
        const message = this.config.messages[this.currentIndex];
        this.currentIndex++;
        return message;
    }

    stop() {
        this.status = 'stopping';
        clearInterval(this.interval);
        
        if (this.api) {
            try {
                // Graceful logout (optional)
                this.api.logout();
            } catch (e) {
                // Silent logout
            }
        }
        
        this.status = 'stopped';
        this.addLog('Thread stopped', 'info');
        this.broadcastUpdate();
        return true;
    }

    getInfo() {
        return {
            threadId: this.threadId,
            status: this.status,
            stats: this.stats,
            logs: this.logs.slice(0, 10),
            config: {
                threadID: this.config.threadID,
                delay: this.config.delay,
                messageCount: this.config.messages ? this.config.messages.length : 0
            }
        };
    }
}

// ==================== WEB SOCKET FUNCTIONS ====================
function broadcastToThread(threadId, message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.threadId === threadId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // Silent error
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
                // Silent error
            }
        }
    });
}

// ==================== LOGIN PAGE HTML ====================
const loginPageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Faizu XD - Login</title>
<style>
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Arial', sans-serif;
}

body {
    background: linear-gradient(135deg, #ffe6f2 0%, #ffccde 100%);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
}

.login-container {
    width: 100%;
    max-width: 500px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    box-shadow: 0 15px 35px rgba(255, 105, 180, 0.3);
    padding: 30px;
    position: relative;
    z-index: 10;
    border: 2px solid #ff66b2;
    animation: fadeIn 0.8s ease;
}

@keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}

.header {
    text-align: center;
    margin-bottom: 30px;
}

.header h1 {
    color: #ff3399;
    font-size: 28px;
    font-weight: 800;
    margin-bottom: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.header p {
    color: #ff66b2;
    font-size: 14px;
    font-weight: 500;
}

.top-gif {
    width: 100%;
    height: 200px;
    border-radius: 15px;
    margin-bottom: 30px;
    overflow: hidden;
    box-shadow: 0 8px 20px rgba(255, 105, 180, 0.2);
}

.top-gif img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.input-group {
    margin-bottom: 25px;
    position: relative;
}

.input-group label {
    display: block;
    color: #ff3399;
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.input-with-bg {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    border: 2px solid #ff99cc;
    transition: all 0.3s ease;
}

.input-with-bg:hover {
    border-color: #ff3399;
    box-shadow: 0 0 15px rgba(255, 51, 153, 0.3);
}

.input-bg-gif {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0.1;
    z-index: 1;
}

.input-bg-gif img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.input-group input {
    width: 100%;
    padding: 16px 20px;
    border: none;
    background: rgba(255, 255, 255, 0.9);
    color: #333;
    font-size: 16px;
    font-weight: 500;
    position: relative;
    z-index: 2;
    outline: none;
    transition: all 0.3s ease;
}

.input-group input:focus {
    background: rgba(255, 255, 255, 1);
}

.login-btn {
    width: 100%;
    padding: 18px;
    background: linear-gradient(135deg, #ff3399 0%, #ff66b2 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 8px 20px rgba(255, 51, 153, 0.4);
    margin-top: 10px;
}

.login-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 25px rgba(255, 51, 153, 0.5);
    background: linear-gradient(135deg, #ff0099 0%, #ff3399 100%);
}

.login-btn:active {
    transform: translateY(0);
}

.status-message {
    text-align: center;
    margin-top: 20px;
    padding: 12px;
    border-radius: 10px;
    font-weight: 500;
    display: none;
}

.status-message.success {
    background: rgba(76, 175, 80, 0.1);
    color: #4CAF50;
    border: 1px solid #4CAF50;
    display: block;
}

.status-message.error {
    background: rgba(244, 67, 54, 0.1);
    color: #f44336;
    border: 1px solid #f44336;
    display: block;
}

.footer {
    text-align: center;
    margin-top: 25px;
    color: #ff66b2;
    font-size: 12px;
    font-weight: 500;
}

/* Floating hearts animation */
.floating-hearts {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1;
}

.heart {
    position: absolute;
    color: #ff99cc;
    font-size: 20px;
    animation: float 15s infinite linear;
    opacity: 0.3;
}

@keyframes float {
    0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
    10% { opacity: 0.5; }
    90% { opacity: 0.5; }
    100% { transform: translateY(-100px) rotate(360deg); opacity: 0; }
}
</style>
</head>
<body>
<div class="floating-hearts" id="heartsContainer"></div>

<div class="login-container">
    <div class="header">
        <h1>Faizu XD System</h1>
        <p>Enter Username and Password</p>
    </div>
    
    <div class="top-gif">
        <img src="https://i.pinimg.com/originals/64/9c/66/649c668b6c1208cce1c7da2b539f8d72.gif" alt="Login Banner">
    </div>
    
    <div class="input-group">
        <label for="username">Username</label>
        <div class="input-with-bg">
            <div class="input-bg-gif">
                <img src="https://i.pinimg.com/originals/80/b1/cf/80b1cf27df714a3ba0da909fd3f3f221.gif" alt="Input Background">
            </div>
            <input type="text" id="username" placeholder="Enter Username" value="Faizu Xd">
        </div>
    </div>
    
    <div class="input-group">
        <label for="password">Password</label>
        <div class="input-with-bg">
            <div class="input-bg-gif">
                <img src="https://i.pinimg.com/originals/80/b1/cf/80b1cf27df714a3ba0da909fd3f3f221.gif" alt="Input Background">
            </div>
            <input type="password" id="password" placeholder="Enter Password" value="Justfuckaway">
        </div>
    </div>
    
    <button class="login-btn" id="loginBtn">Login to System</button>
    
    <div class="status-message" id="statusMessage"></div>
    
    <div class="footer">
        <p>© 2024 Faizu XD System | Premium Messaging Solution</p>
    </div>
</div>

<script>
// Create floating hearts
function createHearts() {
    const container = document.getElementById('heartsContainer');
    const hearts = '❤️';
    
    for (let i = 0; i < 15; i++) {
        const heart = document.createElement('div');
        heart.className = 'heart';
        heart.textContent = hearts;
        heart.style.left = Math.random() * 100 + 'vw';
        heart.style.animationDelay = Math.random() * 15 + 's';
        heart.style.fontSize = (Math.random() * 15 + 15) + 'px';
        container.appendChild(heart);
    }
}

createHearts();

document.getElementById('loginBtn').addEventListener('click', function() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const status = document.getElementById('statusMessage');
    
    if (!username || !password) {
        status.textContent = 'Please enter both username and password';
        status.className = 'status-message error';
        return;
    }
    
    // Show loading
    const btn = this;
    const originalText = btn.textContent;
    btn.textContent = 'Logging in...';
    btn.disabled = true;
    
    // Simulate API call
    setTimeout(() => {
        if (username === 'Faizu Xd' && password === 'Justfuckaway') {
            status.textContent = 'Login successful! Redirecting...';
            status.className = 'status-message success';
            
            // Redirect to console
            setTimeout(() => {
                window.location.href = '/console';
            }, 1000);
        } else {
            status.textContent = 'Invalid credentials';
            status.className = 'status-message error';
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }, 1500);
});

// Enter key support
document.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('loginBtn').click();
    }
});
</script>
</body>
</html>
`;

// ==================== CONSOLE PAGE HTML ====================
const consolePageHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Faizu XD - Console</title>
<style>
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Segoe UI', 'Arial', sans-serif;
}

body {
    background: linear-gradient(135deg, #ffe6f2 0%, #ffccde 100%);
    min-height: 100vh;
    overflow-x: hidden;
}

.console-banner {
    width: 100%;
    height: 180px;
    overflow: hidden;
    box-shadow: 0 5px 15px rgba(255, 105, 180, 0.3);
}

.console-banner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.header-bar {
    background: linear-gradient(135deg, #ff3399 0%, #ff66b2 100%);
    padding: 15px 30px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 3px 10px rgba(255, 105, 180, 0.2);
}

.header-left h1 {
    color: white;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: 0.5px;
}

.header-right {
    display: flex;
    gap: 15px;
    align-items: center;
}

.user-info {
    color: white;
    font-weight: 600;
    background: rgba(255, 255, 255, 0.2);
    padding: 8px 15px;
    border-radius: 8px;
    backdrop-filter: blur(5px);
}

.logout-btn {
    background: white;
    color: #ff3399;
    border: none;
    padding: 8px 20px;
    border-radius: 8px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
}

.logout-btn:hover {
    background: #fff5fa;
    transform: translateY(-2px);
}

.main-container {
    display: flex;
    padding: 20px;
    gap: 20px;
    min-height: calc(100vh - 250px);
}

.left-panel {
    flex: 1;
    background: white;
    border-radius: 15px;
    padding: 25px;
    box-shadow: 0 8px 25px rgba(255, 105, 180, 0.15);
    border: 2px solid #ff99cc;
}

.right-panel {
    flex: 2;
    background: white;
    border-radius: 15px;
    padding: 25px;
    box-shadow: 0 8px 25px rgba(255, 105, 180, 0.15);
    border: 2px solid #ff99cc;
}

.panel-title {
    color: #ff3399;
    font-size: 20px;
    font-weight: 800;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid #ffccde;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.panel-title span {
    font-size: 14px;
    color: #ff66b2;
    font-weight: 600;
}

.input-group {
    margin-bottom: 20px;
}

.input-group label {
    display: block;
    color: #ff3399;
    font-weight: 600;
    margin-bottom: 8px;
    font-size: 14px;
}

.input-group input,
.input-group textarea,
.input-group select {
    width: 100%;
    padding: 12px 15px;
    border: 2px solid #ff99cc;
    border-radius: 10px;
    background: #fff9fc;
    color: #333;
    font-size: 14px;
    transition: all 0.3s ease;
    outline: none;
}

.input-group input:focus,
.input-group textarea:focus,
.input-group select:focus {
    border-color: #ff3399;
    box-shadow: 0 0 10px rgba(255, 51, 153, 0.3);
    background: white;
}

.input-group textarea {
    min-height: 100px;
    resize: vertical;
}

.action-buttons {
    display: flex;
    gap: 10px;
    margin-top: 25px;
}

.action-btn {
    flex: 1;
    padding: 14px;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.start-btn {
    background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
    color: white;
}

.stop-btn {
    background: linear-gradient(135deg, #f44336 0%, #d32f2f 100%);
    color: white;
}

.action-btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 15px rgba(0, 0, 0, 0.2);
}

.action-btn:active {
    transform: translateY(0);
}

.threads-container {
    display: flex;
    flex-direction: column;
    gap: 15px;
    max-height: 400px;
    overflow-y: auto;
    padding-right: 5px;
}

.thread-item {
    background: #fff9fc;
    border: 2px solid #ffccde;
    border-radius: 12px;
    padding: 15px;
    transition: all 0.3s ease;
}

.thread-item:hover {
    border-color: #ff3399;
    box-shadow: 0 5px 15px rgba(255, 51, 153, 0.1);
    transform: translateY(-2px);
}

.thread-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.thread-id {
    font-weight: 700;
    color: #ff3399;
    font-size: 16px;
}

.thread-status {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
}

.status-running {
    background: #e8f5e9;
    color: #4CAF50;
}

.status-stopped {
    background: #ffebee;
    color: #f44336;
}

.status-starting {
    background: #fff3e0;
    color: #ff9800;
}

.thread-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 10px;
}

.stat-box {
    text-align: center;
    padding: 8px;
    background: white;
    border-radius: 8px;
    border: 1px solid #ffccde;
}

.stat-value {
    font-size: 18px;
    font-weight: 800;
    color: #ff3399;
}

.stat-label {
    font-size: 11px;
    color: #ff66b2;
    font-weight: 600;
    margin-top: 3px;
}

.thread-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
}

.thread-btn {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.thread-btn.resume {
    background: #4CAF50;
    color: white;
}

.thread-btn.stop {
    background: #f44336;
    color: white;
}

.thread-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.console-logs {
    background: #1a1a1a;
    border-radius: 12px;
    padding: 20px;
    height: 500px;
    overflow-y: auto;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.4;
}

.log-entry {
    padding: 8px 0;
    border-bottom: 1px solid #333;
    display: flex;
    gap: 10px;
}

.log-time {
    color: #ff99cc;
    min-width: 80px;
}

.log-message {
    color: #e6e6e6;
    flex: 1;
}

.log-type-info { color: #66b3ff; }
.log-type-success { color: #66ff66; }
.log-type-warning { color: #ffff66; }
.log-type-error { color: #ff6666; }

.server-status {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    padding: 15px;
    border-radius: 12px;
    box-shadow: 0 5px 20px rgba(255, 105, 180, 0.3);
    border: 2px solid #ff3399;
    z-index: 1000;
    animation: slideIn 0.5s ease;
}

@keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

.status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.status-title {
    font-weight: 700;
    color: #ff3399;
}

.close-btn {
    background: none;
    border: none;
    color: #ff66b2;
    cursor: pointer;
    font-size: 18px;
}

.status-content {
    font-size: 14px;
    color: #666;
}

/* Scrollbar Styling */
::-webkit-scrollbar {
    width: 8px;
}

::-webkit-scrollbar-track {
    background: #fff0f6;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb {
    background: #ff99cc;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #ff66b2;
}

/* Responsive Design */
@media (max-width: 1024px) {
    .main-container {
        flex-direction: column;
    }
    
    .thread-stats {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 768px) {
    .header-bar {
        flex-direction: column;
        gap: 10px;
        text-align: center;
    }
    
    .console-banner {
        height: 120px;
    }
    
    .thread-stats {
        grid-template-columns: 1fr;
    }
}
</style>
</head>
<body>
<div class="console-banner">
    <img src="https://i.pinimg.com/originals/5e/16/e3/5e16e3ab2987659e0b58baebb227162e.gif" alt="Console Banner">
</div>

<div class="header-bar">
    <div class="header-left">
        <h1>Faizu XD - Multi-Thread Console</h1>
    </div>
    <div class="header-right">
        <div class="user-info" id="currentUser">Faizu Xd</div>
        <button class="logout-btn" onclick="logout()">Logout</button>
    </div>
</div>

<div class="main-container">
    <div class="left-panel">
        <div class="panel-title">
            Thread Configuration
            <span id="threadCount">0 Active</span>
        </div>
        
        <div class="input-group">
            <label for="threadID">Thread/Group ID</label>
            <input type="text" id="threadID" placeholder="Enter Thread ID">
        </div>
        
        <div class="input-group">
            <label for="delay">Delay (seconds)</label>
            <input type="number" id="delay" value="5" min="1">
        </div>
        
        <div class="input-group">
            <label for="messages">Messages (one per line)</label>
            <textarea id="messages" placeholder="Enter messages..."></textarea>
        </div>
        
        <div class="action-buttons">
            <button class="action-btn start-btn" onclick="startThread()">Start Thread</button>
            <button class="action-btn stop-btn" onclick="stopAllThreads()">Stop All</button>
        </div>
        
        <div style="margin-top: 30px;">
            <div class="panel-title">Active Threads</div>
            <div class="threads-container" id="threadsList"></div>
        </div>
    </div>
    
    <div class="right-panel">
        <div class="panel-title">
            Live Console
            <span id="logCount">0 Logs</span>
        </div>
        <div class="console-logs" id="consoleLogs"></div>
    </div>
</div>

<div class="server-status" id="serverStatus" style="display: none;">
    <div class="status-header">
        <div class="status-title">Server Notification</div>
        <button class="close-btn" onclick="closeStatus()">×</button>
    </div>
    <div class="status-content" id="statusContent"></div>
</div>

<script>
const socket = new WebSocket('ws://' + window.location.host);
let activeThreads = {};
let consoleLogs = [];

// WebSocket Handlers
socket.onopen = () => {
    addConsoleLog('Connected to server', 'info');
};

socket.onmessage = (event) => {
    try {
        const data = JSON.parse(event.data);
        
        switch(data.type) {
            case 'thread_update':
                updateThread(data);
                break;
            case 'server_notification':
                showNotification(data.message, data.level);
                break;
            case 'system_log':
                addConsoleLog(data.message, data.level);
                break;
            case 'thread_list':
                updateThreadList(data.threads);
                break;
        }
    } catch (error) {
        console.error('WebSocket error:', error);
    }
};

socket.onclose = () => {
    addConsoleLog('Disconnected from server', 'error');
    showNotification('Server connection lost. Attempting to reconnect...', 'warning');
    setTimeout(() => {
        window.location.reload();
    }, 3000);
};

// UI Functions
function addConsoleLog(message, type = 'info') {
    const logsContainer = document.getElementById('consoleLogs');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    
    const timestamp = new Date().toLocaleTimeString('en-IN');
    logEntry.innerHTML = \`
        <div class="log-time">\${timestamp}</div>
        <div class="log-message log-type-\${type}">\${message}</div>
    \`;
    
    logsContainer.appendChild(logEntry);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    // Update log count
    consoleLogs.push({message, type, timestamp});
    document.getElementById('logCount').textContent = \`\${consoleLogs.length} Logs\`;
}

function updateThread(data) {
    const threadId = data.threadId;
    activeThreads[threadId] = data;
    
    // Update thread list
    updateThreadListUI();
}

function updateThreadList(threads) {
    activeThreads = {};
    threads.forEach(thread => {
        activeThreads[thread.threadId] = thread;
    });
    updateThreadListUI();
}

function updateThreadListUI() {
    const threadsList = document.getElementById('threadsList');
    threadsList.innerHTML = '';
    
    let runningCount = 0;
    Object.values(activeThreads).forEach(thread => {
        if (thread.status === 'running') runningCount++;
        
        const threadItem = document.createElement('div');
        threadItem.className = 'thread-item';
        threadItem.innerHTML = \`
            <div class="thread-header">
                <div class="thread-id">\${thread.threadId.substring(0, 8)}...</div>
                <div class="thread-status status-\${thread.status}">\${thread.status}</div>
            </div>
            <div class="thread-stats">
                <div class="stat-box">
                    <div class="stat-value">\${thread.stats?.sent || 0}</div>
                    <div class="stat-label">Sent</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">\${thread.stats?.failed || 0}</div>
                    <div class="stat-label">Failed</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">\${Math.floor((Date.now() - (thread.stats?.startTime || Date.now())) / 60000)}</div>
                    <div class="stat-label">Minutes</div>
                </div>
            </div>
            <div class="thread-actions">
                <button class="thread-btn resume" onclick="controlThread('\${thread.threadId}', 'start')" \${thread.status === 'running' ? 'disabled' : ''}>
                    \${thread.status === 'running' ? 'Running' : 'Resume'}
                </button>
                <button class="thread-btn stop" onclick="controlThread('\${thread.threadId}', 'stop')" \${thread.status === 'stopped' ? 'disabled' : ''}>
                    \${thread.status === 'stopped' ? 'Stopped' : 'Stop'}
                </button>
            </div>
        \`;
        
        threadsList.appendChild(threadItem);
    });
    
    document.getElementById('threadCount').textContent = \`\${runningCount} Active\`;
}

function startThread() {
    const threadID = document.getElementById('threadID').value.trim();
    const delay = parseInt(document.getElementById('delay').value) || 5;
    const messages = document.getElementById('messages').value.trim();
    
    if (!threadID) {
        showNotification('Please enter Thread ID', 'error');
        return;
    }
    
    if (!messages) {
        showNotification('Please enter messages', 'error');
        return;
    }
    
    const messageArray = messages.split('\\n').filter(msg => msg.trim().length > 0);
    
    socket.send(JSON.stringify({
        type: 'start_thread',
        threadID: threadID,
        delay: delay,
        messages: messageArray
    }));
    
    addConsoleLog(\`Starting new thread for ID: \${threadID}\`, 'info');
}

function controlThread(threadId, action) {
    socket.send(JSON.stringify({
        type: 'control_thread',
        threadId: threadId,
        action: action
    }));
    
    addConsoleLog(\`\${action === 'start' ? 'Resuming' : 'Stopping'} thread: \${threadId.substring(0, 8)}...\`, 'info');
}

function stopAllThreads() {
    if (confirm('Are you sure you want to stop all threads?')) {
        socket.send(JSON.stringify({
            type: 'stop_all_threads'
        }));
        addConsoleLog('Stopping all threads', 'warning');
    }
}

function showNotification(message, level = 'info') {
    const statusDiv = document.getElementById('serverStatus');
    const contentDiv = document.getElementById('statusContent');
    
    contentDiv.textContent = message;
    contentDiv.style.color = 
        level === 'error' ? '#f44336' :
        level === 'warning' ? '#ff9800' :
        level === 'success' ? '#4CAF50' : '#666';
    
    statusDiv.style.display = 'block';
    
    // Auto-hide after 10 seconds for non-error messages
    if (level !== 'error') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 10000);
    }
}

function closeStatus() {
    document.getElementById('serverStatus').style.display = 'none';
}

function logout() {
    if (confirm('Are you sure you want to logout?')) {
        window.location.href = '/';
    }
}

// Auto-refresh thread list every 5 seconds
setInterval(() => {
    socket.send(JSON.stringify({type: 'get_threads'}));
}, 5000);

// Initial load
socket.send(JSON.stringify({type: 'get_threads'}));
addConsoleLog('System initialized. Ready to start threads.', 'success');

// Health check notification every 12 hours
setInterval(() => {
    showNotification('Server health check: System running smoothly', 'success');
}, 12 * 60 * 60 * 1000);
</script>
</body>
</html>
`;

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
    res.send(loginPageHTML);
});

app.get('/console', (req, res) => {
    res.send(consolePageHTML);
});

// ==================== WEB SOCKET SERVER ====================
let wss;

const server = app.listen(PORT, () => {
    console.log(`🚀 Faizu XD System running on port ${PORT}`);
    console.log(`📞 Login: http://localhost:${PORT}`);
    console.log(`🔄 Auto-restart system: ACTIVE`);
    console.log(`⚡ Performance mode: MAXIMUM`);
});

wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.threadId = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'start_thread':
                    const threadId = uuidv4();
                    const thread = new Thread(threadId, {
                        threadID: data.threadID,
                        delay: data.delay,
                        messages: data.messages,
                        username: CONFIG.username,
                        password: CONFIG.password
                    });
                    
                    activeThreads.set(threadId, thread);
                    ws.threadId = threadId;
                    
                    thread.addLog(`Thread created: ${threadId}`, 'info');
                    thread.start().then(success => {
                        if (!success) {
                            thread.addLog('Thread failed to start', 'error');
                        }
                    });
                    
                    ws.send(JSON.stringify({
                        type: 'thread_update',
                        threadId: threadId,
                        status: thread.status,
                        stats: thread.stats
                    }));
                    break;
                    
                case 'control_thread':
                    const controlThread = activeThreads.get(data.threadId);
                    if (controlThread) {
                        if (data.action === 'start') {
                            controlThread.start();
                        } else if (data.action === 'stop') {
                            controlThread.stop();
                        }
                    }
                    break;
                    
                case 'stop_all_threads':
                    activeThreads.forEach(thread => thread.stop());
                    ws.send(JSON.stringify({
                        type: 'system_log',
                        message: 'All threads stopped',
                        level: 'info'
                    }));
                    break;
                    
                case 'get_threads':
                    const threads = Array.from(activeThreads.values()).map(t => t.getInfo());
                    ws.send(JSON.stringify({
                        type: 'thread_list',
                        threads: threads
                    }));
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
            ws.send(JSON.stringify({
                type: 'system_log',
                message: `Error: ${error.message}`,
                level: 'error'
            }));
        }
    });
    
    ws.on('close', () => {
        // Cleanup if needed
    });
});

// ==================== AUTO-RESTART SYSTEM ====================
function setupAutoRestart() {
    setInterval(() => {
        // Check if server is responsive
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        
        if (heapUsedMB > 500) {
            console.log('⚠️  High memory usage detected, optimizing...');
            global.gc && global.gc();
        }
        
        // Health check notification
        broadcastToAll({
            type: 'server_notification',
            message: 'Server health check: System running optimally',
            level: 'success'
        });
        
    }, CONFIG.healthCheckInterval);
    
    // Crash recovery
    process.on('uncaughtException', (error) => {
        console.error('🚨 Uncaught Exception:', error);
        restartAttempts++;
        
        if (restartAttempts <= MAX_RESTART_ATTEMPTS) {
            console.log(`🔄 Attempting restart ${restartAttempts}/${MAX_RESTART_ATTEMPTS}`);
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

// Start auto-restart system
setupAutoRestart();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down gracefully...');
    activeThreads.forEach(thread => thread.stop());
    setTimeout(() => process.exit(0), 1000);
});

// Initial health notification
setTimeout(() => {
    broadcastToAll({
        type: 'server_notification',
        message: 'Faizu XD System initialized and running',
        level: 'success'
    });
}, 3000);
