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

// Task class (same as before)
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
                const parsed = JSON.parse(line);
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
            
            this.config.apis[index] = api;
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

// WebSocket broadcast functions
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

// UPDATED HTML CONTROL PANEL - PINK NEON DESIGN
const htmlControlPanel = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PINK NEON MESSENGER</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        :root {
            --primary-pink: #ff00ff;
            --neon-pink: #ff14ff;
            --deep-pink: #ff0090;
            --hot-pink: #ff1493;
            --soft-pink: #ff66b2;
            --dark-bg: #0a0014;
            --darker-bg: #05000a;
            --panel-bg: rgba(20, 0, 30, 0.85);
            --text-glow: 0 0 10px var(--primary-pink), 0 0 20px var(--primary-pink);
            --box-glow: 0 0 15px var(--primary-pink), 0 0 30px var(--deep-pink);
            --heavy-shadow: 0 10px 40px rgba(255, 0, 255, 0.3);
        }

        body {
            background: linear-gradient(135deg, var(--darker-bg) 0%, #1a002a 50%, #2a0040 100%);
            color: #ffe6f2;
            min-height: 100vh;
            overflow-x: hidden;
            position: relative;
        }

        /* Neon Background Effects */
        .neon-bg {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            overflow: hidden;
        }

        .neon-grid {
            position: absolute;
            width: 200%;
            height: 200%;
            background-image: 
                linear-gradient(rgba(255, 20, 255, 0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 20, 255, 0.1) 1px, transparent 1px);
            background-size: 50px 50px;
            animation: gridMove 40s linear infinite;
            transform: perspective(500px) rotateX(60deg);
        }

        @keyframes gridMove {
            0% { transform: perspective(500px) rotateX(60deg) translateY(0); }
            100% { transform: perspective(500px) rotateX(60deg) translateY(50px); }
        }

        .floating-neon {
            position: absolute;
            border-radius: 50%;
            filter: blur(40px);
            opacity: 0.4;
            animation: float 15s infinite ease-in-out;
        }

        .floating-neon:nth-child(1) {
            width: 300px;
            height: 300px;
            background: var(--primary-pink);
            top: 10%;
            left: 10%;
            animation-delay: 0s;
        }

        .floating-neon:nth-child(2) {
            width: 400px;
            height: 400px;
            background: var(--hot-pink);
            top: 60%;
            right: 10%;
            animation-delay: 5s;
        }

        .floating-neon:nth-child(3) {
            width: 250px;
            height: 250px;
            background: var(--deep-pink);
            bottom: 10%;
            left: 20%;
            animation-delay: 10s;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-30px) scale(1.1); }
        }

        /* Header with Heavy Effects */
        header {
            background: linear-gradient(90deg, 
                rgba(255, 0, 255, 0.2) 0%, 
                rgba(255, 20, 147, 0.3) 50%, 
                rgba(255, 0, 144, 0.2) 100%);
            backdrop-filter: blur(15px);
            border-bottom: 3px solid var(--primary-pink);
            box-shadow: var(--box-glow), var(--heavy-shadow);
            padding: 25px 40px;
            position: relative;
            overflow: hidden;
            z-index: 10;
        }

        header::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
            animation: shine 3s infinite;
        }

        @keyframes shine {
            0% { left: -100%; }
            100% { left: 100%; }
        }

        .header-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 20px;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 20px;
        }

        .logo-icon {
            font-size: 3rem;
            color: var(--primary-pink);
            text-shadow: var(--text-glow);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }

        .logo-text h1 {
            font-size: 2.8rem;
            background: linear-gradient(45deg, var(--primary-pink), var(--soft-pink), var(--hot-pink));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: var(--text-glow);
            letter-spacing: 2px;
            font-weight: 800;
        }

        .logo-text .tagline {
            font-size: 1rem;
            color: #ffb3d9;
            margin-top: 5px;
            text-shadow: 0 0 5px var(--soft-pink);
        }

        .status-badges {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .badge {
            background: rgba(255, 0, 255, 0.2);
            border: 1px solid var(--primary-pink);
            border-radius: 20px;
            padding: 8px 18px;
            font-size: 0.9rem;
            color: #ffccff;
            text-shadow: 0 0 5px var(--primary-pink);
            box-shadow: 0 0 10px rgba(255, 0, 255, 0.3);
            animation: badgeGlow 3s infinite alternate;
        }

        @keyframes badgeGlow {
            0% { box-shadow: 0 0 10px rgba(255, 0, 255, 0.3); }
            100% { box-shadow: 0 0 15px rgba(255, 0, 255, 0.6), 0 0 25px rgba(255, 20, 147, 0.4); }
        }

        /* Main Container */
        .container {
            max-width: 1400px;
            margin: 30px auto;
            padding: 0 20px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
        }

        @media (max-width: 1100px) {
            .container {
                grid-template-columns: 1fr;
            }
        }

        /* Panels with Heavy Effects */
        .panel {
            background: var(--panel-bg);
            backdrop-filter: blur(10px);
            border: 2px solid var(--primary-pink);
            border-radius: 20px;
            padding: 30px;
            box-shadow: var(--box-glow), var(--heavy-shadow);
            transition: all 0.4s ease;
            position: relative;
            overflow: hidden;
        }

        .panel:hover {
            transform: translateY(-5px);
            box-shadow: 0 0 25px var(--primary-pink), 0 0 50px rgba(255, 0, 255, 0.4);
        }

        .panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 5px;
            background: linear-gradient(90deg, var(--primary-pink), var(--hot-pink), var(--primary-pink));
            animation: borderFlow 3s linear infinite;
        }

        @keyframes borderFlow {
            0% { background-position: 0% 50%; }
            100% { background-position: 100% 50%; }
        }

        .panel-title {
            font-size: 1.8rem;
            color: var(--primary-pink);
            margin-bottom: 25px;
            text-shadow: var(--text-glow);
            display: flex;
            align-items: center;
            gap: 15px;
        }

        .panel-title i {
            font-size: 2rem;
            animation: spin 10s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Form Elements */
        .form-group {
            margin-bottom: 25px;
            position: relative;
        }

        .form-label {
            display: block;
            margin-bottom: 10px;
            color: #ffb3d9;
            font-size: 1.1rem;
            font-weight: 600;
            text-shadow: 0 0 5px var(--soft-pink);
        }

        .form-input, .form-textarea, .form-select {
            width: 100%;
            padding: 15px 20px;
            background: rgba(40, 0, 60, 0.8);
            border: 2px solid var(--soft-pink);
            border-radius: 12px;
            color: #fff;
            font-size: 1rem;
            transition: all 0.3s ease;
            box-shadow: 0 0 10px rgba(255, 102, 178, 0.2);
        }

        .form-input:focus, .form-textarea:focus, .form-select:focus {
            outline: none;
            border-color: var(--primary-pink);
            box-shadow: 0 0 20px var(--primary-pink);
            transform: scale(1.02);
        }

        .form-textarea {
            min-height: 120px;
            resize: vertical;
        }

        /* Radio Buttons */
        .radio-group {
            display: flex;
            gap: 30px;
            margin: 15px 0;
        }

        .radio-option {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            padding: 10px 20px;
            border-radius: 10px;
            background: rgba(255, 0, 255, 0.1);
            transition: all 0.3s ease;
        }

        .radio-option:hover {
            background: rgba(255, 0, 255, 0.2);
            transform: translateY(-3px);
        }

        .radio-option input[type="radio"] {
            appearance: none;
            width: 22px;
            height: 22px;
            border: 2px solid var(--primary-pink);
            border-radius: 50%;
            position: relative;
            cursor: pointer;
        }

        .radio-option input[type="radio"]:checked {
            background: var(--primary-pink);
            box-shadow: 0 0 10px var(--primary-pink);
        }

        .radio-option input[type="radio"]:checked::after {
            content: '';
            position: absolute;
            top: 4px;
            left: 4px;
            width: 10px;
            height: 10px;
            background: white;
            border-radius: 50%;
        }

        /* File Input Styling */
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
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            padding: 20px;
            background: linear-gradient(45deg, rgba(255, 0, 255, 0.2), rgba(255, 20, 147, 0.3));
            border: 2px dashed var(--primary-pink);
            border-radius: 12px;
            color: #ffccff;
            font-size: 1.1rem;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .file-input-label:hover {
            background: linear-gradient(45deg, rgba(255, 0, 255, 0.3), rgba(255, 20, 147, 0.4));
            transform: scale(1.02);
            box-shadow: 0 0 20px rgba(255, 0, 255, 0.4);
        }

        /* Buttons */
        .btn {
            padding: 18px 35px;
            font-size: 1.2rem;
            font-weight: 700;
            border: none;
            border-radius: 15px;
            cursor: pointer;
            transition: all 0.4s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            text-transform: uppercase;
            letter-spacing: 1px;
            position: relative;
            overflow: hidden;
            z-index: 1;
        }

        .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            transition: 0.5s;
            z-index: -1;
        }

        .btn:hover::before {
            left: 100%;
        }

        .btn-primary {
            background: linear-gradient(45deg, var(--primary-pink), var(--hot-pink));
            color: white;
            box-shadow: 0 0 20px var(--primary-pink);
        }

        .btn-primary:hover {
            transform: translateY(-5px) scale(1.05);
            box-shadow: 0 0 30px var(--primary-pink), 0 0 50px rgba(255, 0, 255, 0.5);
        }

        .btn-secondary {
            background: linear-gradient(45deg, #6a11cb, #2575fc);
            color: white;
            box-shadow: 0 0 20px #2575fc;
        }

        .btn-secondary:hover {
            transform: translateY(-5px) scale(1.05);
            box-shadow: 0 0 30px #2575fc, 0 0 50px rgba(37, 117, 252, 0.5);
        }

        .btn-danger {
            background: linear-gradient(45deg, #ff416c, #ff4b2b);
            color: white;
            box-shadow: 0 0 20px #ff416c;
        }

        .btn-danger:hover {
            transform: translateY(-5px) scale(1.05);
            box-shadow: 0 0 30px #ff416c, 0 0 50px rgba(255, 65, 108, 0.5);
        }

        /* Console Log */
        .console-log {
            height: 400px;
            background: rgba(10, 0, 20, 0.9);
            border-radius: 15px;
            padding: 20px;
            overflow-y: auto;
            border: 1px solid var(--primary-pink);
            box-shadow: inset 0 0 20px rgba(255, 0, 255, 0.2);
            margin-bottom: 20px;
        }

        .log-entry {
            padding: 12px 15px;
            margin-bottom: 10px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.05);
            border-left: 4px solid var(--primary-pink);
            animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .log-entry.success {
            border-left-color: #00ff88;
            background: rgba(0, 255, 136, 0.1);
        }

        .log-entry.error {
            border-left-color: #ff0040;
            background: rgba(255, 0, 64, 0.1);
        }

        .log-entry.warning {
            border-left-color: #ffcc00;
            background: rgba(255, 204, 0, 0.1);
        }

        .log-time {
            color: #ff66b2;
            font-size: 0.9rem;
            margin-right: 15px;
        }

        /* Tabs */
        .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 25px;
            border-bottom: 2px solid rgba(255, 0, 255, 0.3);
            padding-bottom: 10px;
        }

        .tab {
            padding: 15px 30px;
            background: rgba(255, 0, 255, 0.1);
            border: none;
            border-radius: 10px 10px 0 0;
            color: #ffb3d9;
            font-size: 1.1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .tab.active {
            background: linear-gradient(45deg, var(--primary-pink), var(--hot-pink));
            color: white;
            box-shadow: 0 0 15px var(--primary-pink);
        }

        .tab:hover:not(.active) {
            background: rgba(255, 0, 255, 0.2);
            transform: translateY(-3px);
        }

        /* Task ID Display */
        .task-id-display {
            background: linear-gradient(45deg, rgba(255, 0, 255, 0.2), rgba(255, 20, 147, 0.3));
            border: 2px solid var(--primary-pink);
            border-radius: 15px;
            padding: 25px;
            margin: 25px 0;
            text-align: center;
            animation: pulseGlow 2s infinite alternate;
        }

        @keyframes pulseGlow {
            0% { box-shadow: 0 0 20px rgba(255, 0, 255, 0.3); }
            100% { box-shadow: 0 0 40px rgba(255, 0, 255, 0.6), 0 0 60px rgba(255, 20, 147, 0.4); }
        }

        .task-id {
            font-size: 2rem;
            font-weight: 800;
            color: var(--primary-pink);
            text-shadow: var(--text-glow);
            word-break: break-all;
            margin: 15px 0;
        }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 25px 0;
        }

        .stat-card {
            background: rgba(255, 0, 255, 0.1);
            border: 1px solid var(--primary-pink);
            border-radius: 15px;
            padding: 25px;
            text-align: center;
            transition: all 0.4s ease;
            position: relative;
            overflow: hidden;
        }

        .stat-card:hover {
            transform: translateY(-10px) scale(1.05);
            box-shadow: 0 0 30px var(--primary-pink);
        }

        .stat-value {
            font-size: 3rem;
            font-weight: 800;
            color: var(--primary-pink);
            text-shadow: var(--text-glow);
            margin-bottom: 10px;
        }

        .stat-label {
            font-size: 1rem;
            color: #ffb3d9;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* Cookie Stats */
        .cookie-stats {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }

        .cookie-stat {
            background: rgba(40, 0, 60, 0.8);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 2px solid transparent;
            transition: all 0.3s ease;
        }

        .cookie-stat.active {
            border-color: #00ff88;
            background: rgba(0, 255, 136, 0.1);
        }

        .cookie-stat.inactive {
            border-color: #ff0040;
            background: rgba(255, 0, 64, 0.1);
        }

        .cookie-stat:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 20px rgba(255, 0, 255, 0.2);
        }

        /* Scrollbar Styling */
        ::-webkit-scrollbar {
            width: 12px;
        }

        ::-webkit-scrollbar-track {
            background: rgba(20, 0, 30, 0.8);
            border-radius: 10px;
        }

        ::-webkit-scrollbar-thumb {
            background: linear-gradient(45deg, var(--primary-pink), var(--hot-pink));
            border-radius: 10px;
            box-shadow: 0 0 10px var(--primary-pink);
        }

        ::-webkit-scrollbar-thumb:hover {
            background: linear-gradient(45deg, var(--hot-pink), var(--primary-pink));
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .logo-text h1 {
                font-size: 2rem;
            }
            
            .container {
                padding: 0 15px;
            }
            
            .panel {
                padding: 20px;
            }
            
            .stats-grid {
                grid-template-columns: 1fr 1fr;
            }
            
            .btn {
                padding: 15px 25px;
                font-size: 1rem;
            }
        }

        /* Footer */
        footer {
            text-align: center;
            padding: 30px;
            margin-top: 50px;
            border-top: 1px solid rgba(255, 0, 255, 0.3);
            color: #ffb3d9;
            font-size: 0.9rem;
            text-shadow: 0 0 5px var(--soft-pink);
        }

        /* Floating Particles */
        .particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: -1;
        }

        .particle {
            position: absolute;
            background: var(--primary-pink);
            border-radius: 50%;
            animation: floatParticle linear infinite;
        }

        @keyframes floatParticle {
            0% {
                transform: translateY(100vh) rotate(0deg);
                opacity: 0;
            }
            10% {
                opacity: 1;
            }
            90% {
                opacity: 1;
            }
            100% {
                transform: translateY(-100px) rotate(360deg);
                opacity: 0;
            }
        }
    </style>
</head>
<body>
    <!-- Background Effects -->
    <div class="neon-bg">
        <div class="neon-grid"></div>
        <div class="floating-neon"></div>
        <div class="floating-neon"></div>
        <div class="floating-neon"></div>
    </div>
    
    <!-- Floating Particles -->
    <div class="particles" id="particles"></div>

    <!-- Header -->
    <header>
        <div class="header-content">
            <div class="logo">
                <div class="logo-icon">
                    <i class="fas fa-bolt"></i>
                </div>
                <div class="logo-text">
                    <h1>PINK NEON MESSENGER</h1>
                    <div class="tagline">Multi-Cookie Power • Auto-Recovery • Heavy Design</div>
                </div>
            </div>
            <div class="status-badges">
                <div class="badge" id="status-badge">
                    <i class="fas fa-circle"></i> Ready
                </div>
                <div class="badge">
                    <i class="fas fa-shield-alt"></i> Secure
                </div>
                <div class="badge">
                    <i class="fas fa-bolt"></i> Fast
                </div>
            </div>
        </div>
    </header>

    <!-- Main Container -->
    <div class="container">
        <!-- Left Panel: Configuration -->
        <div class="panel">
            <h2 class="panel-title">
                <i class="fas fa-cogs"></i> Configuration Panel
            </h2>
            
            <div class="form-group">
                <label class="form-label">Cookie Source</label>
                <div class="radio-group">
                    <label class="radio-option">
                        <input type="radio" name="cookie-source" value="file" checked>
                        <i class="fas fa-file-upload"></i> Upload File
                    </label>
                    <label class="radio-option">
                        <input type="radio" name="cookie-source" value="paste">
                        <i class="fas fa-paste"></i> Paste Cookies
                    </label>
                </div>
            </div>

            <div id="file-upload-section">
                <div class="form-group">
                    <label class="form-label">Cookie File (.txt/.json)</label>
                    <div class="file-input-wrapper">
                        <input type="file" id="cookie-file" accept=".txt,.json">
                        <div class="file-input-label" id="file-label">
                            <i class="fas fa-cloud-upload-alt"></i>
                            <span>Click to upload cookie file</span>
                        </div>
                    </div>
                    <small style="color: #ff99cc; display: block; margin-top: 10px;">
                        <i class="fas fa-info-circle"></i> One cookie per line. Multiple cookies supported.
                    </small>
                </div>
            </div>

            <div id="paste-section" style="display: none;">
                <div class="form-group">
                    <label class="form-label">Paste Cookies</label>
                    <textarea class="form-textarea" id="cookie-paste" 
                        placeholder="Paste cookies here, one per line..."></textarea>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">Hater's Name</label>
                <input type="text" class="form-input" id="haters-name" 
                    placeholder="Enter hater's name">
            </div>

            <div class="form-group">
                <label class="form-label">Thread/Group ID</label>
                <input type="text" class="form-input" id="thread-id" 
                    placeholder="Enter thread/group ID">
            </div>

            <div class="form-group">
                <label class="form-label">Last Here Name</label>
                <input type="text" class="form-input" id="last-here-name" 
                    placeholder="Enter last here name">
            </div>

            <div class="form-group">
                <label class="form-label">Delay (Seconds)</label>
                <input type="number" class="form-input" id="delay" value="5" min="1">
            </div>

            <div class="form-group">
                <label class="form-label">Messages File (.txt)</label>
                <div class="file-input-wrapper">
                    <input type="file" id="message-file" accept=".txt">
                    <div class="file-input-label" id="message-file-label">
                        <i class="fas fa-file-alt"></i>
                        <span>Click to upload messages file</span>
                    </div>
                </div>
                <small style="color: #ff99cc; display: block; margin-top: 10px;">
                    <i class="fas fa-info-circle"></i> One message per line. Messages will loop automatically.
                </small>
            </div>

            <button class="btn btn-primary" id="start-btn">
                <i class="fas fa-rocket"></i> Start Sending
            </button>
        </div>

        <!-- Right Panel: Console & Controls -->
        <div class="panel">
            <div class="tabs">
                <button class="tab active" data-tab="console">Console</button>
                <button class="tab" data-tab="stop">Stop Task</button>
                <button class="tab" data-tab="view">View Details</button>
            </div>

            <!-- Console Tab -->
            <div class="tab-content active" id="console-tab">
                <h3 class="panel-title">
                    <i class="fas fa-terminal"></i> Live Console
                </h3>
                <div class="console-log" id="console-log"></div>
                
                <div class="task-id-display" id="task-id-display" style="display: none;">
                    <h3>Your Task ID</h3>
                    <div class="task-id" id="task-id-value"></div>
                    <p style="color: #ff99cc; margin-top: 10px;">
                        <i class="fas fa-exclamation-triangle"></i> Save this ID to manage your task later
                    </p>
                </div>
            </div>

            <!-- Stop Tab -->
            <div class="tab-content" id="stop-tab">
                <h3 class="panel-title">
                    <i class="fas fa-stop-circle"></i> Stop Task
                </h3>
                <div class="form-group">
                    <label class="form-label">Task ID</label>
                    <input type="text" class="form-input" id="stop-task-id" 
                        placeholder="Enter your task ID">
                </div>
                <button class="btn btn-danger" id="stop-btn">
                    <i class="fas fa-stop"></i> Stop Task
                </button>
                <div id="stop-result" style="margin-top: 20px;"></div>
            </div>

            <!-- View Details Tab -->
            <div class="tab-content" id="view-tab">
                <h3 class="panel-title">
                    <i class="fas fa-chart-bar"></i> Task Details
                </h3>
                <div class="form-group">
                    <label class="form-label">Task ID</label>
                    <input type="text" class="form-input" id="view-task-id" 
                        placeholder="Enter your task ID">
                </div>
                <button class="btn btn-secondary" id="view-btn">
                    <i class="fas fa-eye"></i> View Details
                </button>
                
                <div id="task-details" style="display: none; margin-top: 30px;">
                    <div class="stats-grid" id="stats-grid"></div>
                    
                    <h4 style="color: var(--primary-pink); margin: 25px 0 15px;">
                        <i class="fas fa-cookie-bite"></i> Cookie Statistics
                    </h4>
                    <div class="cookie-stats" id="cookie-stats"></div>
                    
                    <h4 style="color: var(--primary-pink); margin: 25px 0 15px;">
                        <i class="fas fa-history"></i> Recent Logs
                    </h4>
                    <div class="console-log" id="detail-logs" style="height: 200px;"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- Footer -->
    <footer>
        <p>PINK NEON MESSENGER • Advanced Multi-Cookie System • Built with 💖</p>
        <p style="margin-top: 10px; font-size: 0.8rem;">
            <i class="fas fa-lock"></i> Secure • <i class="fas fa-sync-alt"></i> Auto-Recovery • 
            <i class="fas fa-bolt"></i> High Performance
        </p>
    </footer>

    <script>
        // Initialize WebSocket
        const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(socketProtocol + '//' + location.host);
        
        // DOM Elements
        const elements = {
            cookieFile: document.getElementById('cookie-file'),
            cookiePaste: document.getElementById('cookie-paste'),
            hatersName: document.getElementById('haters-name'),
            threadId: document.getElementById('thread-id'),
            lastHereName: document.getElementById('last-here-name'),
            delay: document.getElementById('delay'),
            messageFile: document.getElementById('message-file'),
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            viewBtn: document.getElementById('view-btn'),
            stopTaskId: document.getElementById('stop-task-id'),
            viewTaskId: document.getElementById('view-task-id'),
            consoleLog: document.getElementById('console-log'),
            fileUploadSection: document.getElementById('file-upload-section'),
            pasteSection: document.getElementById('paste-section'),
            fileLabel: document.getElementById('file-label'),
            messageFileLabel: document.getElementById('message-file-label'),
            taskIdDisplay: document.getElementById('task-id-display'),
            taskIdValue: document.getElementById('task-id-value'),
            statusBadge: document.getElementById('status-badge')
        };
        
        let currentTaskId = null;
        
        // Initialize particles
        function initParticles() {
            const particlesContainer = document.getElementById('particles');
            const particleCount = 50;
            
            for (let i = 0; i < particleCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                
                const size = Math.random() * 5 + 2;
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;
                particle.style.left = `${Math.random() * 100}vw`;
                particle.style.animationDuration = `${Math.random() * 10 + 10}s`;
                particle.style.animationDelay = `${Math.random() * 5}s`;
                
                particlesContainer.appendChild(particle);
            }
        }
        
        // Tab Switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                // Remove active class from all tabs and tab contents
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                
                // Add active class to clicked tab
                this.classList.add('active');
                
                // Show corresponding content
                const tabId = this.getAttribute('data-tab');
                document.getElementById(`${tabId}-tab`).classList.add('active');
            });
        });
        
        // Cookie source toggle
        document.querySelectorAll('input[name="cookie-source"]').forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'file') {
                    elements.fileUploadSection.style.display = 'block';
                    elements.pasteSection.style.display = 'none';
                } else {
                    elements.fileUploadSection.style.display = 'none';
                    elements.pasteSection.style.display = 'block';
                }
            });
        });
        
        // File input labels
        elements.cookieFile.addEventListener('change', function() {
            if (this.files.length > 0) {
                elements.fileLabel.innerHTML = 
                    `<i class="fas fa-check-circle"></i> ${this.files[0].name}`;
            }
        });
        
        elements.messageFile.addEventListener('change', function() {
            if (this.files.length > 0) {
                elements.messageFileLabel.innerHTML = 
                    `<i class="fas fa-check-circle"></i> ${this.files[0].name}`;
            }
        });
        
        // Add log to console
        function addLog(message, type = 'info', showTime = true) {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry ${type}`;
            
            const time = showTime ? 
                `<span class="log-time">[${new Date().toLocaleTimeString()}]</span>` : '';
            
            let icon = 'fa-info-circle';
            if (type === 'success') icon = 'fa-check-circle';
            if (type === 'error') icon = 'fa-exclamation-circle';
            if (type === 'warning') icon = 'fa-exclamation-triangle';
            
            logEntry.innerHTML = `
                ${time}
                <i class="fas ${icon}"></i>
                ${message}
            `;
            
            elements.consoleLog.appendChild(logEntry);
            elements.consoleLog.scrollTop = elements.consoleLog.scrollHeight;
            
            // Update status badge
            if (type === 'success') {
                elements.statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> Active';
                elements.statusBadge.style.background = 'rgba(0, 255, 136, 0.2)';
                elements.statusBadge.style.borderColor = '#00ff88';
            } else if (type === 'error') {
                elements.statusBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error';
                elements.statusBadge.style.background = 'rgba(255, 0, 64, 0.2)';
                elements.statusBadge.style.borderColor = '#ff0040';
            }
        }
        
        // Show task ID
        function showTaskId(taskId) {
            currentTaskId = taskId;
            elements.taskIdValue.textContent = taskId;
            elements.taskIdDisplay.style.display = 'block';
            addLog(`Task started with ID: ${taskId}`, 'success');
            
            // Copy to clipboard notification
            setTimeout(() => {
                addLog('Click on the Task ID to copy it to clipboard', 'info');
            }, 1000);
        }
        
        // Copy task ID on click
        elements.taskIdValue.addEventListener('click', function() {
            navigator.clipboard.writeText(this.textContent).then(() => {
                const originalText = this.textContent;
                this.textContent = 'Copied!';
                setTimeout(() => {
                    this.textContent = originalText;
                }, 2000);
            });
        });
        
        // Start button handler
        elements.startBtn.addEventListener('click', async function() {
            const cookieSource = document.querySelector('input[name="cookie-source"]:checked').value;
            
            // Validation
            if (cookieSource === 'file' && !elements.cookieFile.files.length) {
                addLog('Please select a cookie file', 'error');
                return;
            }
            
            if (cookieSource === 'paste' && !elements.cookiePaste.value.trim()) {
                addLog('Please paste cookies in the textarea', 'error');
                return;
            }
            
            if (!elements.hatersName.value.trim()) {
                addLog('Please enter Hater\\'s Name', 'error');
                return;
            }
            
            if (!elements.threadId.value.trim()) {
                addLog('Please enter Thread/Group ID', 'error');
                return;
            }
            
            if (!elements.lastHereName.value.trim()) {
                addLog('Please enter Last Here Name', 'error');
                return;
            }
            
            if (!elements.messageFile.files.length) {
                addLog('Please select a messages file', 'error');
                return;
            }
            
            // Disable button and show loading
            this.disabled = true;
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
            
            try {
                // Read message file
                const messageFile = elements.messageFile.files[0];
                const messageContent = await readFileAsText(messageFile);
                
                // Read cookie content
                let cookieContent;
                if (cookieSource === 'file') {
                    const cookieFile = elements.cookieFile.files[0];
                    cookieContent = await readFileAsText(cookieFile);
                } else {
                    cookieContent = elements.cookiePaste.value;
                }
                
                // Count cookies
                const cookieCount = cookieContent.split('\\n').filter(line => line.trim()).length;
                addLog(`Detected ${cookieCount} cookies`, 'info');
                
                // Send start request
                socket.send(JSON.stringify({
                    type: 'start',
                    cookieContent: cookieContent,
                    messageContent: messageContent,
                    hatersName: elements.hatersName.value.trim(),
                    threadID: elements.threadId.value.trim(),
                    lastHereName: elements.lastHereName.value.trim(),
                    delay: parseInt(elements.delay.value) || 5
                }));
                
            } catch (error) {
                addLog(`Error reading files: ${error.message}`, 'error');
                this.disabled = false;
                this.innerHTML = '<i class="fas fa-rocket"></i> Start Sending';
            }
        });
        
        // Stop button handler
        elements.stopBtn.addEventListener('click', function() {
            const taskId = elements.stopTaskId.value.trim();
            if (!taskId) {
                showResult('Please enter a Task ID', 'error');
                return;
            }
            
            socket.send(JSON.stringify({
                type: 'stop',
                taskId: taskId
            }));
            
            showResult('Stopping task...', 'info');
        });
        
        // View button handler
        elements.viewBtn.addEventListener('click', function() {
            const taskId = elements.viewTaskId.value.trim();
            if (!taskId) {
                addLog('Please enter a Task ID', 'error');
                return;
            }
            
            socket.send(JSON.stringify({
                type: 'view_details',
                taskId: taskId
            }));
        });
        
        // File reader helper
        function readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = e => reject(e);
                reader.readAsText(file);
            });
        }
        
        // Show result message
        function showResult(message, type = 'info') {
            const resultDiv = document.getElementById('stop-result');
            resultDiv.innerHTML = `
                <div class="log-entry ${type}">
                    <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                    ${message}
                </div>
            `;
            
            setTimeout(() => {
                resultDiv.innerHTML = '';
            }, 5000);
        }
        
        // Display task details
        function displayTaskDetails(data) {
            const detailsDiv = document.getElementById('task-details');
            detailsDiv.style.display = 'block';
            
            // Update stats grid
            const statsGrid = document.getElementById('stats-grid');
            statsGrid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${data.sent || 0}</div>
                    <div class="stat-label">Messages Sent</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.failed || 0}</div>
                    <div class="stat-label">Messages Failed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.activeCookies || 0}/${data.totalCookies || 0}</div>
                    <div class="stat-label">Active Cookies</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${data.loops || 0}</div>
                    <div class="stat-label">Loops Completed</div>
                </div>
            `;
            
            // Update cookie stats
            const cookieStatsDiv = document.getElementById('cookie-stats');
            cookieStatsDiv.innerHTML = '';
            
            if (data.cookieStats && data.cookieStats.length > 0) {
                data.cookieStats.forEach(cookie => {
                    const statDiv = document.createElement('div');
                    statDiv.className = `cookie-stat ${cookie.active ? 'active' : 'inactive'}`;
                    statDiv.innerHTML = `
                        <div style="font-size: 1.2rem; font-weight: bold; color: ${cookie.active ? '#00ff88' : '#ff0040'}">
                            Cookie ${cookie.cookieNumber}
                        </div>
                        <div style="margin: 10px 0; font-size: 2rem; font-weight: bold;">
                            ${cookie.messagesSent || 0}
                        </div>
                        <div style="color: #ff99cc; font-size: 0.9rem;">
                            ${cookie.active ? '🟢 ACTIVE' : '🔴 INACTIVE'}
                        </div>
                    `;
                    cookieStatsDiv.appendChild(statDiv);
                });
            }
            
            // Update logs
            const detailLogs = document.getElementById('detail-logs');
            detailLogs.innerHTML = '';
            
            if (data.logs && data.logs.length > 0) {
                data.logs.slice(0, 20).forEach(log => {
                    const logEntry = document.createElement('div');
                    logEntry.className = `log-entry ${log.type || 'info'}`;
                    logEntry.innerHTML = `
                        <span class="log-time">[${log.time}]</span>
                        ${log.message}
                    `;
                    detailLogs.appendChild(logEntry);
                });
            }
        }
        
        // WebSocket message handler
        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'log':
                        addLog(data.message, data.messageType || 'info');
                        break;
                        
                    case 'task_started':
                        showTaskId(data.taskId);
                        elements.startBtn.disabled = false;
                        elements.startBtn.innerHTML = '<i class="fas fa-rocket"></i> Start Sending';
                        break;
                        
                    case 'task_stopped':
                        if (data.taskId === currentTaskId) {
                            elements.taskIdDisplay.style.display = 'none';
                            addLog('Task stopped successfully', 'info');
                        }
                        showResult('Task stopped successfully', 'success');
                        break;
                        
                    case 'task_details':
                        displayTaskDetails(data);
                        break;
                        
                    case 'error':
                        addLog(`Error: ${data.message}`, 'error');
                        if (data.from === 'stop') {
                            showResult(data.message, 'error');
                        }
                        break;
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        // WebSocket connection handlers
        socket.onopen = () => {
            addLog('Connected to server', 'success');
        };
        
        socket.onclose = () => {
            addLog('Disconnected from server', 'error');
            elements.statusBadge.innerHTML = '<i class="fas fa-unlink"></i> Disconnected';
            elements.statusBadge.style.background = 'rgba(255, 0, 64, 0.2)';
            elements.statusBadge.style.borderColor = '#ff0040';
        };
        
        socket.onerror = (error) => {
            addLog('WebSocket error', 'error');
        };
        
        // Initialize particles on load
        window.addEventListener('load', () => {
            initParticles();
            addLog('Pink Neon Messenger initialized', 'success');
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
    console.log(`🚀 Pink Neon Messenger running at http://localhost:${PORT}`);
    console.log(`🎨 Heavy Pink Design • Multi-Cookie Support • Auto Recovery`);
    console.log(`⚡ Using w3-fca engine for Facebook API`);
    console.log(`💾 Memory Only Mode • No file storage`);
    
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
