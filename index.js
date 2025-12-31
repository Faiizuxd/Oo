// save as server.js
// npm install express ws w3-fca uuid

const express = require('express');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5941;

// Store active tasks
let activeTasks = new Map();

// Server monitoring
let serverStartTime = Date.now();

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple Task class
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.threadName = userData.threadName || `Thread-${taskId.substring(0, 6)}`;
        this.threadID = userData.threadID;
        this.delay = userData.delay || 5;
        this.cookieContent = userData.cookieContent;
        this.messageContent = userData.messageContent;
        
        this.config = {
            running: false,
            pause: false,
            delay: this.delay
        };
        
        this.stats = {
            sent: 0,
            failed: 0,
            loops: 0,
            startTime: Date.now()
        };
        
        this.logs = [];
        this.addLog('Task created: ' + this.threadName, 'info');
    }
    
    addLog(message, type = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString(),
            message: message,
            type: type
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 50) this.logs = this.logs.slice(0, 50);
        
        // Broadcast log to WebSocket clients
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: type,
            threadName: this.threadName
        });
    }
    
    start() {
        if (this.config.running) {
            this.addLog('Task already running', 'warning');
            return false;
        }
        
        this.config.running = true;
        this.config.pause = false;
        this.addLog('Task started successfully', 'success');
        this.addLog('Thread ID: ' + this.threadID, 'info');
        this.addLog('Delay: ' + this.delay + ' seconds', 'info');
        
        // Simulate message sending (for demo)
        this.simulateSending();
        return true;
    }
    
    simulateSending() {
        if (!this.config.running || this.config.pause) return;
        
        // Simulate sending message
        this.stats.sent++;
        
        if (this.stats.sent % 10 === 0) {
            this.stats.loops++;
            this.addLog('Completed loop ' + this.stats.loops, 'info');
        }
        
        this.addLog('Message sent to ' + this.threadID, 'success');
        
        // Continue sending
        setTimeout(() => {
            if (this.config.running && !this.config.pause) {
                this.simulateSending();
            }
        }, this.delay * 1000);
    }
    
    pause() {
        if (!this.config.running) {
            this.addLog('Task not running', 'warning');
            return false;
        }
        this.config.pause = true;
        this.addLog('Task paused', 'info');
        return true;
    }
    
    resume() {
        if (!this.config.running) {
            this.addLog('Task not running', 'warning');
            return false;
        }
        this.config.pause = false;
        this.addLog('Task resumed', 'success');
        this.simulateSending();
        return true;
    }
    
    stop() {
        this.config.running = false;
        this.config.pause = false;
        this.addLog('Task stopped', 'info');
        return true;
    }
    
    getDetails() {
        const uptime = Date.now() - this.stats.startTime;
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);
        
        return {
            taskId: this.taskId,
            threadName: this.threadName,
            threadId: this.threadID,
            sent: this.stats.sent,
            failed: this.stats.failed,
            loops: this.stats.loops,
            uptime: `${hours}h ${minutes}m`,
            running: this.config.running,
            paused: this.config.pause,
            logs: this.logs.slice(0, 20)
        };
    }
}

// HTML Pages
const loginHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>FAIZU XD | LOGIN</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-box {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.2);
            width: 100%;
            max-width: 400px;
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        .input-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            color: #666;
        }
        input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
        }
        button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 10px;
        }
        button:hover {
            opacity: 0.9;
        }
        .error {
            color: red;
            text-align: center;
            margin-top: 10px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="login-box">
        <h1>FAIZU XD</h1>
        <form id="loginForm">
            <div class="input-group">
                <label>Username</label>
                <input type="text" id="username" required>
            </div>
            <div class="input-group">
                <label>Password</label>
                <input type="password" id="password" required>
            </div>
            <button type="submit">LOGIN</button>
            <div id="error" class="error">Invalid credentials</div>
        </form>
    </div>
    
    <script>
        document.getElementById('loginForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            if (username === 'Faizu Xd' && password === 'Justfuckaway') {
                localStorage.setItem('faizu_auth', 'true');
                window.location.href = '/control';
            } else {
                document.getElementById('error').style.display = 'block';
            }
        });
    </script>
</body>
</html>
`;

const controlHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>FAIZU XD | CONTROL PANEL</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            background: #f0f2f5;
            color: #333;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header h1 {
            font-size: 24px;
        }
        .container {
            max-width: 1200px;
            margin: 20px auto;
            padding: 0 20px;
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }
        .panel {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .panel h2 {
            color: #667eea;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0f2f5;
        }
        .input-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            color: #666;
            font-weight: bold;
        }
        input, textarea, select {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        textarea {
            height: 100px;
            resize: vertical;
        }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            margin-right: 10px;
        }
        .btn-primary {
            background: #667eea;
            color: white;
        }
        .btn-success {
            background: #48bb78;
            color: white;
        }
        .btn-warning {
            background: #ed8936;
            color: white;
        }
        .btn-danger {
            background: #f56565;
            color: white;
        }
        .btn:hover {
            opacity: 0.9;
        }
        .tasks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .task-card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .task-title {
            font-size: 18px;
            font-weight: bold;
            color: #667eea;
        }
        .task-status {
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }
        .status-running {
            background: #c6f6d5;
            color: #22543d;
        }
        .status-paused {
            background: #fed7d7;
            color: #742a2a;
        }
        .status-stopped {
            background: #e2e8f0;
            color: #4a5568;
        }
        .task-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 15px;
        }
        .stat-box {
            text-align: center;
            padding: 10px;
            background: #f7fafc;
            border-radius: 5px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }
        .stat-label {
            font-size: 12px;
            color: #718096;
        }
        .task-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        .logs {
            margin-top: 30px;
        }
        .log-box {
            height: 300px;
            overflow-y: auto;
            background: #1a202c;
            color: #cbd5e0;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
            font-size: 12px;
        }
        .log-entry {
            margin-bottom: 5px;
            padding: 5px;
            border-left: 3px solid #667eea;
        }
        .log-success {
            border-left-color: #48bb78;
            color: #9ae6b4;
        }
        .log-error {
            border-left-color: #f56565;
            color: #fc8181;
        }
        .log-info {
            border-left-color: #4299e1;
            color: #90cdf4;
        }
        .log-warning {
            border-left-color: #ed8936;
            color: #fbd38d;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>FAIZU XD CONTROL PANEL</h1>
        <div>
            <button class="btn btn-danger" onclick="logout()">LOGOUT</button>
        </div>
    </div>
    
    <div class="container">
        <div class="grid">
            <div class="panel">
                <h2>CREATE NEW TASK</h2>
                <div class="input-group">
                    <label>Thread/Group ID</label>
                    <input type="text" id="threadId" placeholder="Enter thread ID">
                </div>
                <div class="input-group">
                    <label>Thread Name</label>
                    <input type="text" id="threadName" placeholder="Enter thread name">
                </div>
                <div class="input-group">
                    <label>Delay (seconds)</label>
                    <input type="number" id="delay" value="5" min="1">
                </div>
                <div class="input-group">
                    <label>Cookies (one per line)</label>
                    <textarea id="cookies" placeholder="Paste cookies here..."></textarea>
                </div>
                <div class="input-group">
                    <label>Messages (one per line)</label>
                    <textarea id="messages" placeholder="Paste messages here..."></textarea>
                </div>
                <button class="btn btn-primary" onclick="startTask()">START TASK</button>
            </div>
            
            <div class="panel">
                <h2>SERVER STATUS</h2>
                <div class="input-group">
                    <label>Server Uptime</label>
                    <div id="uptime" style="color: #667eea; font-size: 18px; font-weight: bold;">Loading...</div>
                </div>
                <div class="input-group">
                    <label>Active Tasks</label>
                    <div id="activeTasks" style="color: #48bb78; font-size: 18px; font-weight: bold;">0</div>
                </div>
                <div class="input-group">
                    <label>Total Messages Sent</label>
                    <div id="totalMessages" style="color: #ed8936; font-size: 18px; font-weight: bold;">0</div>
                </div>
                <button class="btn btn-success" onclick="refreshStatus()">REFRESH STATUS</button>
            </div>
        </div>
        
        <div class="panel">
            <h2>ACTIVE TASKS</h2>
            <div id="tasksContainer" class="tasks-grid">
                <!-- Tasks will appear here -->
            </div>
        </div>
        
        <div class="panel logs">
            <h2>SYSTEM LOGS</h2>
            <div id="systemLogs" class="log-box">
                <!-- Logs will appear here -->
            </div>
        </div>
    </div>
    
    <script>
        let socket;
        let tasks = {};
        
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(protocol + '//' + window.location.host);
            
            socket.onopen = () => {
                addLog('Connected to server', 'success');
                authenticate();
                loadTasks();
            };
            
            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            };
            
            socket.onclose = () => {
                addLog('Disconnected from server', 'error');
                setTimeout(connectWebSocket, 3000);
            };
            
            socket.onerror = (error) => {
                addLog('Connection error', 'error');
            };
        }
        
        function handleMessage(data) {
            switch(data.type) {
                case 'auth_success':
                    addLog('Authentication successful', 'success');
                    break;
                    
                case 'task_started':
                    tasks[data.taskId] = data;
                    addLog('Task started: ' + data.threadName, 'success');
                    updateTasksDisplay();
                    break;
                    
                case 'task_updated':
                    tasks[data.taskId] = data;
                    updateTasksDisplay();
                    break;
                    
                case 'task_stopped':
                    delete tasks[data.taskId];
                    addLog('Task stopped: ' + data.threadName, 'info');
                    updateTasksDisplay();
                    break;
                    
                case 'log':
                    addLog('[' + data.threadName + '] ' + data.message, data.messageType);
                    break;
                    
                case 'server_status':
                    updateServerStatus(data);
                    break;
                    
                case 'error':
                    addLog('Error: ' + data.message, 'error');
                    break;
            }
        }
        
        function authenticate() {
            socket.send(JSON.stringify({
                type: 'auth',
                username: 'Faizu Xd',
                password: 'Justfuckaway'
            }));
        }
        
        function startTask() {
            const threadId = document.getElementById('threadId').value;
            const threadName = document.getElementById('threadName').value || 'Thread-' + Date.now();
            const delay = document.getElementById('delay').value;
            const cookies = document.getElementById('cookies').value;
            const messages = document.getElementById('messages').value;
            
            if (!threadId) {
                alert('Please enter thread ID');
                return;
            }
            if (!cookies) {
                alert('Please enter cookies');
                return;
            }
            if (!messages) {
                alert('Please enter messages');
                return;
            }
            
            socket.send(JSON.stringify({
                type: 'start',
                threadID: threadId,
                threadName: threadName,
                delay: parseInt(delay),
                cookieContent: cookies,
                messageContent: messages
            }));
            
            // Clear form
            document.getElementById('threadId').value = '';
            document.getElementById('threadName').value = '';
            document.getElementById('cookies').value = '';
            document.getElementById('messages').value = '';
        }
        
        function updateTasksDisplay() {
            const container = document.getElementById('tasksContainer');
            container.innerHTML = '';
            
            Object.values(tasks).forEach(task => {
                const card = createTaskCard(task);
                container.appendChild(card);
            });
            
            document.getElementById('activeTasks').textContent = Object.keys(tasks).length;
            
            // Calculate total messages
            let total = 0;
            Object.values(tasks).forEach(task => {
                total += task.sent || 0;
            });
            document.getElementById('totalMessages').textContent = total;
        }
        
        function createTaskCard(task) {
            const div = document.createElement('div');
            div.className = 'task-card';
            
            const statusClass = task.running ? 'status-running' : 
                              task.paused ? 'status-paused' : 'status-stopped';
            const statusText = task.running ? 'RUNNING' : 
                             task.paused ? 'PAUSED' : 'STOPPED';
            
            div.innerHTML = \`
                <div class="task-header">
                    <div class="task-title">\${task.threadName}</div>
                    <div class="task-status \${statusClass}">\${statusText}</div>
                </div>
                <div class="task-stats">
                    <div class="stat-box">
                        <div class="stat-value">\${task.sent || 0}</div>
                        <div class="stat-label">SENT</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">\${task.failed || 0}</div>
                        <div class="stat-label">FAILED</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">\${task.loops || 0}</div>
                        <div class="stat-label">LOOPS</div>
                    </div>
                </div>
                <div style="margin: 10px 0; font-size: 12px; color: #666;">
                    Thread ID: \${task.threadId}<br>
                    Uptime: \${task.uptime || '0h 0m'}
                </div>
                <div class="task-actions">
                    \${task.running ? 
                        '<button class="btn btn-warning" onclick="controlTask(\\'' + task.taskId + '\\', \\'pause\\')">PAUSE</button>' :
                        '<button class="btn btn-success" onclick="controlTask(\\'' + task.taskId + '\\', \\'resume\\')">RESUME</button>'
                    }
                    <button class="btn btn-danger" onclick="controlTask('${task.taskId}', 'stop')">STOP</button>
                </div>
            \`;
            
            return div;
        }
        
        function controlTask(taskId, action) {
            socket.send(JSON.stringify({
                type: 'control',
                taskId: taskId,
                action: action
            }));
        }
        
        function loadTasks() {
            socket.send(JSON.stringify({
                type: 'get_all_tasks'
            }));
        }
        
        function updateServerStatus(data) {
            document.getElementById('uptime').textContent = data.uptime + ' hours';
            document.getElementById('activeTasks').textContent = data.activeTasks;
        }
        
        function refreshStatus() {
            socket.send(JSON.stringify({
                type: 'get_status'
            }));
            addLog('Status refreshed', 'info');
        }
        
        function addLog(message, type = 'info') {
            const container = document.getElementById('systemLogs');
            const div = document.createElement('div');
            div.className = 'log-entry log-' + type;
            div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }
        
        function logout() {
            localStorage.removeItem('faizu_auth');
            window.location.href = '/';
        }
        
        // Initialize
        if (!localStorage.getItem('faizu_auth')) {
            window.location.href = '/';
        } else {
            connectWebSocket();
            setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        }
    </script>
</body>
</html>
`;

// Routes
app.get('/', (req, res) => {
    res.send(loginHTML);
});

app.get('/control', (req, res) => {
    res.send(controlHTML);
});

app.get('/status', (req, res) => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 3600000);
    res.json({
        status: 'running',
        uptime: uptime,
        activeTasks: activeTasks.size,
        timestamp: new Date().toISOString()
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`FAIZU XD SERVER STARTED`);
    console.log(`Port: ${PORT}`);
    console.log(`Login URL: http://localhost:${PORT}`);
    console.log(`Username: Faizu Xd`);
    console.log(`Password: Justfuckaway`);
    console.log(`Server is ready and working perfectly!`);
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

function broadcastToTask(taskId, message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            client.send(JSON.stringify(message));
        }
    });
}

function broadcastToAll(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

wss.on('connection', (ws) => {
    ws.taskId = null;
    ws.authenticated = false;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'auth') {
                if (message.username === 'Faizu Xd' && message.password === 'Justfuckaway') {
                    ws.authenticated = true;
                    ws.send(JSON.stringify({ type: 'auth_success' }));
                    
                    // Send server status
                    const uptime = Math.floor((Date.now() - serverStartTime) / 3600000);
                    ws.send(JSON.stringify({
                        type: 'server_status',
                        uptime: uptime,
                        activeTasks: activeTasks.size
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Invalid credentials'
                    }));
                }
                return;
            }
            
            if (!ws.authenticated && message.type !== 'ping') {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Authentication required'
                }));
                return;
            }
            
            switch(message.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                    
                case 'start':
                    const taskId = uuidv4();
                    ws.taskId = taskId;
                    
                    const task = new Task(taskId, {
                        threadID: message.threadID,
                        threadName: message.threadName,
                        delay: message.delay,
                        cookieContent: message.cookieContent,
                        messageContent: message.messageContent
                    });
                    
                    if (task.start()) {
                        activeTasks.set(taskId, task);
                        
                        ws.send(JSON.stringify({
                            type: 'task_started',
                            taskId: taskId,
                            threadId: task.threadID,
                            threadName: task.threadName,
                            running: true
                        }));
                        
                        console.log(`Task started: ${taskId} - ${task.threadName}`);
                    }
                    break;
                    
                case 'control':
                    const controlTask = activeTasks.get(message.taskId);
                    if (controlTask) {
                        switch(message.action) {
                            case 'pause':
                                controlTask.pause();
                                break;
                            case 'resume':
                                controlTask.resume();
                                break;
                            case 'stop':
                                controlTask.stop();
                                activeTasks.delete(message.taskId);
                                ws.send(JSON.stringify({
                                    type: 'task_stopped',
                                    taskId: message.taskId,
                                    threadName: controlTask.threadName
                                }));
                                break;
                        }
                        
                        if (message.action !== 'stop') {
                            ws.send(JSON.stringify({
                                type: 'task_updated',
                                ...controlTask.getDetails()
                            }));
                        }
                    }
                    break;
                    
                case 'get_status':
                    const uptime = Math.floor((Date.now() - serverStartTime) / 3600000);
                    ws.send(JSON.stringify({
                        type: 'server_status',
                        uptime: uptime,
                        activeTasks: activeTasks.size
                    }));
                    break;
                    
                case 'get_all_tasks':
                    activeTasks.forEach((task, taskId) => {
                        ws.send(JSON.stringify({
                            type: 'task_updated',
                            ...task.getDetails()
                        }));
                    });
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Update tasks status periodically
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

// Server health check
setInterval(() => {
    console.log(`Server running - Uptime: ${Math.floor((Date.now() - serverStartTime) / 3600000)}h, Tasks: ${activeTasks.size}`);
}, 60000);

console.log('Server setup complete!');
console.log('All systems are working properly.');
