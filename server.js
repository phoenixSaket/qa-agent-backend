const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { Ollama } = require('ollama');

const AdbController = require('./adbController');
const { spawn, exec } = require('child_process');
const { buildSystemPrompt, agentSchema, buildKnowledgeUpdatePrompt, buildMainActionPrompt, ACTION_PROMPT_FOOTER } = require('./prompts');



const CodeAnalyzer = require('./codeAnalyzer');
const Supervisor = require('./supervisor');

// --- PROJECT PATHS ---
let FRONTEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect.app';
let BACKEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect-backend';

// Global Code Analyzer
const codeAnalyzer = new CodeAnalyzer();

/**
 * Manages external project processes (Frontend/Backend) and tails their logs.
 */
class ProjectManager {
    constructor(io) {
        this.io = io;
        this.processes = {
            frontend: null,
            backend: null
        };
        this.logBuffers = {
            frontend: [],
            backend: []
        };
        this.MAX_LOGS = 100;
    }

    startProject(type) {
        if (this.processes[type]) {
            this.log(type, `[SYSTEM] ${type} is already running.`);
            this.io.emit('project_state', { type, running: true }); // Always re-emit to sync UI
            return;
        }

        const cwd = type === 'frontend' ? FRONTEND_PATH : BACKEND_PATH;
        const command = 'npm';
        const args = type === 'frontend' ? ['run', 'android'] : ['run', 'dev'];

        this.log(type, `[SYSTEM] Starting ${type} project in ${cwd}...`);

        try {
            const proc = spawn(command, args, {
                cwd,
                shell: true,
                env: { ...process.env, FORCE_COLOR: true }
            });

            this.processes[type] = proc;

            proc.stdout.on('data', (data) => this.log(type, data.toString()));
            proc.stderr.on('data', (data) => this.log(type, `ERROR: ${data.toString()}`));

            proc.on('close', (code) => {
                this.log(type, `[SYSTEM] ${type} process exited with code ${code}`);
                this.processes[type] = null;
                this.io.emit('project_state', { type, running: false });
            });

            this.io.emit('project_state', { type, running: true });
        } catch (err) {
            this.log(type, `[SYSTEM] Failed to start ${type}: ${err.message}`);
        }
    }

    stopProject(type) {
        if (this.processes[type]) {
            this.log(type, `[SYSTEM] Terminating ${type} process...`);
            this.processes[type].kill('SIGINT');
            this.processes[type] = null;
            this.io.emit('project_state', { type, running: false });
        }
    }

    log(type, message) {
        const timestamp = new Date().toLocaleTimeString();
        const formatted = `[${timestamp}] ${message.trim()}`;

        this.logBuffers[type].push(formatted);
        if (this.logBuffers[type].length > this.MAX_LOGS) {
            this.logBuffers[type].shift();
        }

        this.io.emit('project_log', { type, message: formatted });
    }

    getLatestLogs(type, limit = 15) {
        return this.logBuffers[type].slice(-limit).join('\n');
    }

    async readFile(type, filePath) {
        const fullPath = path.join(type === 'frontend' ? FRONTEND_PATH : BACKEND_PATH, filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${fullPath}`);
        }
        // Limit to first 2000 characters to prevent context blowout
        const content = fs.readFileSync(fullPath, 'utf8');
        return content.substring(0, 5000);
    }

    async injectDebugLog(type, filePath, lineNumber, logContent) {
        const fullPath = path.join(type === 'frontend' ? FRONTEND_PATH : BACKEND_PATH, filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${fullPath}`);
        }

        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        lines.splice(lineNumber - 1, 0, `    console.log("[DEBUG_INJECTED] ${logContent}");`);
        fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
        this.log(type, `[SYSTEM] Injected debug log into ${filePath} at line ${lineNumber}`);

        // Restart the project to apply changes
        this.stopProject(type);
        await sleep(2000);
        this.startProject(type);
    }
}

// HITL Confirmation Handler
let hitlResolver = null;
const waitForHITL = () => new Promise(resolve => {
    hitlResolver = resolve;
});

/**
 * Extracts only top-level dependencies and their versions from a package.json file.
 */
function extractTopLevelDependencies(projectPath) {
    const pkgPath = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return `No package.json found at ${projectPath}`;

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = pkg.dependencies || {};
        const devDeps = pkg.devDependencies || {};

        let output = `[PROJECT: ${path.basename(projectPath)}]\nDependencies:\n`;
        Object.entries(deps).forEach(([name, version]) => {
            output += `  - ${name}: ${version}\n`;
        });
        if (Object.keys(devDeps).length > 0) {
            output += `DevDependencies:\n`;
            Object.entries(devDeps).forEach(([name, version]) => {
                output += `  - ${name}: ${version}\n`;
            });
        }
        return output.trim();
    } catch (err) {
        return `Error parsing package.json at ${projectPath}: ${err.message}`;
    }
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const adb = new AdbController();

// Initialize both clients
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ollama = new Ollama();
const projectManager = new ProjectManager(io);

// Read the provider from the .env file, default to gemini if not found
const aiProvider = process.env.AI_PROVIDER || 'gemini';

// Utility to pause execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- APP KNOWLEDGE BASE & WEIGHTING ---
const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge_base');
const WEIGHTS_FILE = path.join(KNOWLEDGE_DIR, 'action_weights.md');

// Ensure knowledge directory exists
if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

// Memory map binding UI hashes to a Set of locally proven failed/dead-end DOM action bounds
const stateDeadEnds = new Map();

function loadWeights() {
    if (fs.existsSync(WEIGHTS_FILE)) {
        return fs.readFileSync(WEIGHTS_FILE, 'utf8');
    }
    return '';
}

function appendWeight(score, reason) {
    const entry = `* [Score: ${score > 0 ? '+' : ''}${score}] ${reason}`;
    if (!fs.existsSync(WEIGHTS_FILE)) {
        fs.writeFileSync(WEIGHTS_FILE, entry + '\n', 'utf8');
        return;
    }

    let lines = fs.readFileSync(WEIGHTS_FILE, 'utf8').split('\n').filter(l => l.trim().length > 0);

    // Deduplication logic: If the new entry matches the exact reason footprint of the last entry, increment a multiplier instead!
    if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const baseLastLine = lastLine.replace(/\s\(x\d+\)$/, '');

        if (baseLastLine === entry) {
            const match = lastLine.match(/\(x(\d+)\)$/);
            const count = match ? parseInt(match[1]) + 1 : 2;
            lines[lines.length - 1] = `${baseLastLine} (x${count})`;
            fs.writeFileSync(WEIGHTS_FILE, lines.join('\n') + '\n', 'utf8');
            return;
        }
    }

    lines.push(entry);
    if (lines.length > 30) {
        lines = lines.slice(lines.length - 30); // Keep last 30 to respect context windows
    }
    fs.writeFileSync(WEIGHTS_FILE, lines.join('\n') + '\n', 'utf8');
}

function loadKnowledge() {
    let combinedKnowledge = "";
    if (fs.existsSync(KNOWLEDGE_DIR)) {
        const files = fs.readdirSync(KNOWLEDGE_DIR);
        for (const file of files) {
            // Include everything except action_weights (which is loaded separately via loadWeights)
            if (file.endsWith('.md') && file !== 'action_weights.md') {
                const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
                combinedKnowledge += `\n### FILE: ${file} ###\n${content}\n`;
            }
        }
    }
    return combinedKnowledge.trim();
}

// Global recording mode state and macro queue
let isRecordingMode = false;
let userActionQueue = [];
let pendingMacroSteps = [];

function parseMacroPlan(planText) {
    // Attempt to extract JSON array if the agent returns nested steps
    try {
        const match = planText.match(/\[.*\]/s);
        if (match) return JSON.parse(match[0]);
    } catch (e) { }
    return null;
}

/**
 * Pre-processes the raw UI XML dump into a simplified flat list.
 * Strips all noise (empty containers, redundant attributes) and only keeps
 * elements that have text, content-desc, or are clickable.
 * This makes it dramatically easier for the LLM to parse and extract bounds.
 */
function simplifyXml(rawXml) {
    const elements = [];
    // Regex to match individual <node ... /> or <node ...> tags
    const nodeRegex = /<node\s+([^>]+?)\/?>/g;
    let match;

    while ((match = nodeRegex.exec(rawXml)) !== null) {
        const attrs = match[1];

        // Extract key attributes
        const text = (attrs.match(/text="([^"]*)"/) || [])[1] || '';
        const contentDesc = (attrs.match(/content-desc="([^"]*)"/) || [])[1] || '';
        const bounds = (attrs.match(/bounds="([^"]*)"/) || [])[1] || '';
        const clickable = (attrs.match(/clickable="([^"]*)"/) || [])[1] || 'false';
        const className = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
        const selected = (attrs.match(/selected="([^"]*)"/) || [])[1] || 'false';
        const scrollable = (attrs.match(/scrollable="([^"]*)"/) || [])[1] || 'false';

        // Only keep elements that are meaningful:
        // - Has visible text
        // - Has a content description (accessibility label)
        // - Is clickable (interactive)
        const hasText = text.length > 0;
        const hasDesc = contentDesc.length > 0;
        const isClickable = clickable === 'true';
        const isScrollable = scrollable === 'true';

        if (!hasText && !hasDesc && !isClickable && !isScrollable) continue;

        // Build a clean, readable line
        const parts = [];
        if (hasText) parts.push(`text="${text}"`);
        // Clean content-desc: remove leading ", " prefix that React Native adds
        const cleanDesc = contentDesc.replace(/^,\s*/, '').trim();
        if (cleanDesc.length > 0) parts.push(`desc="${cleanDesc}"`);
        if (isClickable) parts.push('clickable=true');
        if (isScrollable) parts.push('scrollable=true');
        if (selected === 'true') parts.push('selected=true');
        // Short class name (just the last part)
        const shortClass = className.split('.').pop();
        parts.push(`class="${shortClass}"`);
        parts.push(`bounds="${bounds}"`);

        elements.push(parts.join(' | '));
    }

    return elements.join('\n');
}



app.use(express.static(path.join(__dirname, 'public')));

// --- FRONTEND UI ROUTES ---
app.get('/api/scan-codebase', async (req, res) => {
    try {
        const blueprint = await codeAnalyzer.analyzeCodebase(FRONTEND_PATH, BACKEND_PATH);
        res.json({ success: true, blueprint });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/knowledge-files', (req, res) => {
    if (fs.existsSync(KNOWLEDGE_DIR)) {
        const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md'));
        res.json({ files });
    } else {
        res.json({ files: [] });
    }
});

// TEMPORARY DEBUG ROUTE
app.get('/api/debug-sos-inject', async (req, res) => {
    try {
        await projectManager.injectDebugLog('backend', 'src/api/sos.ts', 10, 'Received alert request: ' + JSON.stringify(req.body));
        res.send('SOS Debug log injected successfully!');
    } catch (err) {
        res.status(500).send('Injection failed: ' + err.message);
    }
});

app.get('/api/knowledge-files/:filename', (req, res) => {
    const filePath = path.join(KNOWLEDGE_DIR, req.params.filename);
    if (fs.existsSync(filePath) && filePath.startsWith(KNOWLEDGE_DIR)) {
        res.send(fs.readFileSync(filePath, 'utf8'));
    } else {
        res.status(404).send('File not found.');
    }
});

const startProjects = () => {
    projectManager.startProject('frontend');
    projectManager.startProject('backend');
};

io.on('connection', (socket) => {
    console.log('🟢 Web UI Connected');
    socket.emit('agent_message', { sender: 'system', text: `Agent Orchestrator initialized. Active Brain: [${aiProvider.toUpperCase()}]` });
    // Handle stopping the agent execution
    socket.on('stop_agent', () => {
        socket.isAgentRunning = false;
        socket.emit('agent_message', { sender: 'system', text: `[SYSTEM] Agent execution forcibly stopped by user.` });
    });

    // Emulator Recording Mode Toggle
    socket.on('toggle_recording_mode', (isRecording) => {
        isRecordingMode = isRecording;
        socket.emit('agent_message', { sender: 'system', text: `[SYSTEM] Recording mode is now ${isRecording ? 'ON' : 'OFF'}` });
    });

    // Emulator Manual Action (HITL Tracking)
    socket.on('emulator_action', async (data) => {
        try {
            if (!isRecordingMode) {
                // Just pass through if not recording
                if (data.action === 'tap') await adb.tap(data.x, data.y);
                if (data.action === 'type') await adb.type(data.text);
                return;
            }

            // Recording Mode Logic
            socket.emit('agent_message', { sender: 'system', text: `[RECORDING] Capturing Before-State...` });
            const beforeXml = await adb.getUiDump();

            // Execute Action
            if (data.action === 'tap') await adb.tap(data.x, data.y);
            if (data.action === 'type') await adb.type(data.text);

            await sleep(2500); // Wait for transition

            socket.emit('agent_message', { sender: 'system', text: `[RECORDING] Capturing After-State... Generating Rule.` });
            const afterXml = await adb.getUiDump();

            const transitionRulePrompt = `You are observing a human recording a UI test.
ACTION EXECUTED: ${data.action} at [${data.x}, ${data.y}] ${data.text ? `with text "${data.text}"` : ''}

Analyze the changes. Output a definitive rule about what this action does in 1 sentence.
E.g., "Clicking at [x,y] navigates from the Login screen to the Dashboard."`;

            const ruleResp = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: transitionRulePrompt
            });
            const rule = ruleResp.text;

            // Save to knowledge base
            const ruleFile = path.join(KNOWLEDGE_DIR, 'user_flows.md');
            fs.appendFileSync(ruleFile, `\n- [RECORDED RULE] ${rule}`, 'utf8');
            socket.emit('agent_message', { sender: 'system', text: `[RECORDING] Learned: ${rule}` });
        } catch (globalError) {
            console.error("Emulator Action Error:", globalError);
            socket.emit('agent_message', { sender: 'system', text: `[FATAL] action error: ${globalError.message}` });
        }
    });

    socket.on('request_knowledge', () => {
        const knowledge = loadKnowledge();
        socket.emit('knowledge_data', knowledge);
    });

    socket.on('hitl_response', (confirmed) => {
        if (hitlResolver) {
            hitlResolver(confirmed);
            hitlResolver = null;
        }
    });

    socket.on('user_command', async (mission) => {
        const supervisor = new Supervisor(
            io, 
            socket, 
            adb, 
            projectManager, 
            ai, 
            ollama, 
            aiProvider, 
            simplifyXml, 
            waitForHITL
        );
        await supervisor.runMission(mission);
    });

    socket.on('disconnect', () => {
        console.log('🔴 Web UI Disconnected');
        if (streamingInterval) {
            clearInterval(streamingInterval);
            streamingInterval = null;
        }
    });

    let streamingInterval = null;
    let isFetchingFrame = false;
    socket.on('start_emulator_stream', () => {
        if (streamingInterval) return;
        socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Emulator stream started.' });
        streamingInterval = setInterval(async () => {
            if (isFetchingFrame) return; // Prevent concurrent ADB calls backing up
            isFetchingFrame = true;
            try {
                // To keep it semi-realtime, we bypass the heavy `takeScreenshot` logic and just pipe it
                const timestamp = Date.now();
                const filepath = path.join(__dirname, 'temp_captures', `stream_${timestamp}.png`);
                await adb._runAdb(`exec-out screencap -p > "${filepath}"`);

                const screenshotBase64 = fs.readFileSync(filepath).toString('base64');
                socket.emit('agent_screenshot', { base64: screenshotBase64 });

                // Cleanup immediately
                fs.unlinkSync(filepath);
            } catch (err) {
                console.error("Stream error:", err.message);
            } finally {
                isFetchingFrame = false;
            }
        }, 1000); // 1 FPS for simplicity/stability to avoid crashing adb
    });

    socket.on('stop_emulator_stream', () => {
        if (streamingInterval) {
            clearInterval(streamingInterval);
            streamingInterval = null;
            socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Emulator stream stopped.' });
        }
    });

    // --- EXTERNAL PROJECT MANAGEMENT EVENTS ---
    socket.on('set_paths', (paths) => {
        if (paths.frontend) FRONTEND_PATH = paths.frontend;
        if (paths.backend) BACKEND_PATH = paths.backend;
        console.log(`📂 Paths updated - Frontend: ${FRONTEND_PATH}, Backend: ${BACKEND_PATH}`);
        io.emit('paths_updated', { frontend: FRONTEND_PATH, backend: BACKEND_PATH });
    });

    socket.on('browse_directory', (type) => {
        console.log(`📡 Received browse_directory event for: ${type}`);
        const script = `osascript -e 'POSIX path of (choose folder with prompt "Select ${type} Project Folder")'`;
        console.log(`💻 Executing: ${script}`);
        exec(script, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Browse error: ${error.message}`);
                if (stderr) console.error(`❌ Stderr: ${stderr}`);
                return;
            }
            const selectedPath = stdout.trim();
            console.log(`✅ Selected path: ${selectedPath}`);
            if (selectedPath) {
                if (type === 'frontend') FRONTEND_PATH = selectedPath;
                if (type === 'backend') BACKEND_PATH = selectedPath;
                io.emit('paths_updated', { frontend: FRONTEND_PATH, backend: BACKEND_PATH });
                console.log(`📂 ${type} path updated via browser: ${selectedPath}`);
            }
        });
    });

    socket.on('start_project', (type) => projectManager.startProject(type));
    socket.on('stop_project', (type) => projectManager.stopProject(type));
    socket.on('get_project_states', () => {
        socket.emit('project_state', { type: 'frontend', running: !!projectManager.processes.frontend });
        socket.emit('project_state', { type: 'backend', running: !!projectManager.processes.backend });
    });

    // Send initial paths
    socket.emit('paths_updated', { frontend: FRONTEND_PATH, backend: BACKEND_PATH });
});

// Allow PORT to be overridden via environment variable
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

function startServer(port) {
    const srv = server.listen(port, () => {
        console.log(`🚀 Orchestrator running at http://localhost:${port}`);
    });
    srv.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ Port ${port} is in use, trying next port...`);
            // Try next port recursively
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
            process.exit(1);
        }
    });
}

startServer(PORT);