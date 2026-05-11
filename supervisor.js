const fs = require('fs');
const path = require('path');
const { Architect, Navigator, Sentry, Reporter, Cartographer } = require('./workers');
const { buildSystemPrompt, agentSchema, buildKnowledgeUpdatePrompt, buildMainActionPrompt, ACTION_PROMPT_FOOTER } = require('./prompts');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge_base');
const WEIGHTS_FILE = path.join(KNOWLEDGE_DIR, 'action_weights.md');

const FRONTEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect.app';
const BACKEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect-backend';

// Utility to pause execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class Supervisor {
    constructor(io, socket, adb, projectManager, ai, ollama, aiProvider, simplifyXml, hitlResolverFn) {
        this.io = io;
        this.socket = socket;
        this.adb = adb;
        this.projectManager = projectManager;
        this.ai = ai;
        this.ollama = ollama;
        this.aiProvider = aiProvider;
        this.simplifyXml = simplifyXml;
        this.waitForHITL = hitlResolverFn;

        // Initialize Specialized Workers
        this.architect = new Architect();
        this.navigator = new Navigator(ai, ollama, aiProvider);
        this.sentry = new Sentry(projectManager, ai, ollama, aiProvider);
        this.reporter = new Reporter();
        this.cartographer = new Cartographer(ai, ollama, aiProvider);

        this.visitedStates = new Set();
        this.stateDeadEnds = new Map();
        this.runLog = [];
    }

    loadWeights() {
        if (fs.existsSync(WEIGHTS_FILE)) {
            return fs.readFileSync(WEIGHTS_FILE, 'utf8');
        }
        return '';
    }

    appendWeight(score, reason) {
        const entry = `* [Score: ${score > 0 ? '+' : ''}${score}] ${reason}`;
        if (!fs.existsSync(WEIGHTS_FILE)) {
            fs.writeFileSync(WEIGHTS_FILE, entry + '\n', 'utf8');
            return;
        }

        let lines = fs.readFileSync(WEIGHTS_FILE, 'utf8').split('\n').filter(l => l.trim().length > 0);

        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            const baseLastLine = lastLine.replace(/\s\\(x\\d+\\)$/, '');

            if (baseLastLine === entry) {
                const match = lastLine.match(/\\(x(\\d+)\\)$/);
                const count = match ? parseInt(match[1]) + 1 : 2;
                lines[lines.length - 1] = `${baseLastLine} (x${count})`;
                fs.writeFileSync(WEIGHTS_FILE, lines.join('\n') + '\n', 'utf8');
                return;
            }
        }

        lines.push(entry);
        if (lines.length > 30) {
            lines = lines.slice(lines.length - 30);
        }
        fs.writeFileSync(WEIGHTS_FILE, lines.join('\n') + '\n', 'utf8');
    }

    loadKnowledge() {
        let combinedKnowledge = "";
        if (fs.existsSync(KNOWLEDGE_DIR)) {
            const files = fs.readdirSync(KNOWLEDGE_DIR);
            for (const file of files) {
                if (file.endsWith('.md') && file !== 'action_weights.md') {
                    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
                    combinedKnowledge += `\n### FILE: ${file} ###\n${content}\n`;
                }
            }
        }
        return combinedKnowledge.trim();
    }

    /**
     * Extracts only top-level dependencies and their versions from a package.json file.
     */
    extractTopLevelDependencies(projectPath) {
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

    async runMission(mission) {
        this.runLog = [];
        try {
            this.socket.isAgentRunning = true;
            this.socket.emit('agent_message', { sender: 'user', text: mission });
            this.socket.emit('agent_message', { sender: 'agent', text: `Mission Accepted: "${mission}". Engaging Supervisor Loop...` });

            const frontendDeps = this.extractTopLevelDependencies(FRONTEND_PATH);
            const backendDeps = this.extractTopLevelDependencies(BACKEND_PATH);
            const dependencyContext = `FRONTEND:\n${frontendDeps}\n\nBACKEND:\n${backendDeps}`;

            this.socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Ensuring tech infrastructure is active...' });
            this.projectManager.startProject('frontend');
            this.projectManager.startProject('backend');
            await sleep(5000); 

            this.socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Loading environment context...' });
            const SYSTEM_PROMPT = buildSystemPrompt(dependencyContext);

            // Proactive Code Scanning by Architect on boot
            if (!fs.existsSync(path.join(KNOWLEDGE_DIR, 'code_architecture.md'))) {
                this.socket.emit('agent_message', { sender: 'system', text: '[ARCHITECT] Performing initial codebase scan. Building architectural blueprint...' });
                try {
                    await this.architect.analyze(FRONTEND_PATH, BACKEND_PATH);
                    this.socket.emit('agent_message', { sender: 'system', text: '[ARCHITECT] Initial codebase map generated in knowledge core.' });
                } catch (e) {
                    this.socket.emit('agent_message', { sender: 'system', text: `[ARCHITECT] Warning: Failed to scan codebase - ${e.message}` });
                }
            }

            this.visitedStates.clear();
            let previousUiState = null;
            let lastActionData = null;
            let actionHistory = [];
            let consecutiveBlockedAttempts = 0;
            let sessionBlacklist = new Set();
            let lastPlan = "No previous plan established.";
            let pendingMacroSteps = [];

            let missionComplete = false;
            let stepCount = 0;
            const MAX_STEPS = 30;

            this.socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Fetching device screen properties...' });
            const deviceDetails = await this.adb.getDeviceDetails();
            this.socket.emit('agent_message', { sender: 'system', text: `[SYSTEM] Device: <strong>${deviceDetails.resolution}</strong> (${deviceDetails.width}x${deviceDetails.height})` });

            // --- SUPERVISOR LOOP (THINK -> PLAN -> EXECUTE) ---
            while (!missionComplete && stepCount < MAX_STEPS && this.socket.isAgentRunning) {
                stepCount++;
                try {
                    this.socket.emit('agent_message', { sender: 'system', text: `<strong>━━━ Step ${stepCount}/${MAX_STEPS} ━━━</strong>` });
                    
                    // The Sentry continuously monitors for errors asynchronously utilizing a separate LLM
                    const sentryAlertPromise = this.sentry.monitorLogsAsync();

                    // --- SUPERVISOR: THINK PHASE ---
                    // Determine if the mission is purely analytical (Architect) or requires UI interaction (Navigator).
                    const analyticalKeywords = ['analyze code', 'scan code', 'examine codebase', 'explain logic', 'codebase analysis'];
                    const interactiveKeywords = ['login', 'click', 'type', 'open', 'test', 'run', 'navigate', 'find', 'search', 'use user details'];

                    const missionLower = mission.toLowerCase();
                    const isAnalytical = analyticalKeywords.some(kw => missionLower.includes(kw));
                    const isInteractive = interactiveKeywords.some(kw => missionLower.includes(kw));

                    // Only short-circuit to Architect if it's purely analytical and we haven't started UI steps yet
                    const isUnderstanding = isAnalytical && !isInteractive && stepCount === 1;
                    
                    if (isUnderstanding) {
                        this.socket.emit('agent_message', { sender: 'system', text: '[SUPERVISOR] Delegating to Architect for codebase analysis (Purely Analytical Mission).' });
                        const blueprint = await this.architect.analyze(FRONTEND_PATH, BACKEND_PATH);
                        this.socket.emit('agent_message', { sender: 'system', text: `[ARCHITECT] Analysis complete. Returning technical summary.` });
                        this.runLog.push(`[Step ${stepCount}] Architect Code Analysis: ${blueprint.substring(0, 500)}...`);
                        missionComplete = true; 
                        continue;
                    }

                    // UI Fetch (Navigator context)
                    this.socket.emit('agent_message', { sender: 'system', text: '[SYSTEM] Fetching UI XML dump and screenshot...' });
                    const xml = await this.adb.getUiDump();
                    const screenshotPath = await this.adb.takeScreenshot(`step_${stepCount}`);
                    const screenshotBase64 = fs.readFileSync(screenshotPath).toString('base64');

                    if (!this.socket.isAgentRunning) break;

                    const sentryAlert = await sentryAlertPromise;
                    if (sentryAlert) {
                        this.socket.emit('agent_message', { sender: 'system', text: `[SENTRY ALERT] ${sentryAlert}` });
                    }

                    this.socket.emit('ui_dump', { xml: xml });
                    this.socket.emit('agent_screenshot', { base64: screenshotBase64 });

                    this.socket.emit('agent_message', { sender: 'system', text: '[NAVIGATOR] Analyzing raw UI elements to map deep interactive targets...' });
                    let simplifiedUi = await this.navigator.identifyInteractiveElements(xml);

                    if (!simplifiedUi || simplifiedUi.length < 50 || !simplifiedUi.includes('[UI-ELEMENT]')) {
                        this.socket.emit('agent_message', { sender: 'system', text: '[NAVIGATOR] AI Analysis failed or returned empty. Falling back to heuristic XML parser.' });
                        simplifiedUi = this.simplifyXml(xml);
                    }

                    // --- SUPERVISOR: MEMORY INTEGRATION (Pre-Plan phase) ---
                    const actionWeights = this.loadWeights();
                    // Load the existing knowledge base
                    const currentKnowledge = this.loadKnowledge(); 

                    // Heuristic Evaluation of Previous Action
                    if (lastActionData) {
                        let score = 0;
                        let reason = "";
                        const actionName = lastActionData.action || 'UNKNOWN';
                        const targetStr = lastActionData.targetBounds || 'None';

                        if (simplifiedUi === previousUiState) {
                            if (actionName.includes("SCROLL")) {
                                score = -8; reason = `Action '${actionName}' hit a physical scroll boundary.`;
                            } else if (actionName === "BACK") {
                                score = -5; reason = `Action 'BACK' failed to navigate.`;
                            } else {
                                score = -10; reason = `Action '${actionName}' at ${targetStr} produced ZERO changes.`;
                            }
                        } else if (this.visitedStates.has(simplifiedUi)) {
                            score = -5; reason = `Action '${actionName}' at ${targetStr} returned to PREVIOUSLY VISITED state.`;
                        } else {
                            if (actionName.includes("SCROLL")) {
                                score = +12; reason = `Action '${actionName}' extrapolated new UI bounds!`;
                            } else {
                                score = +10; reason = `Action '${actionName}' at ${targetStr} shifted into NEW layout!`;
                            }
                        }

                        if (targetStr !== 'None' && targetStr !== '' && previousUiState && !previousUiState.includes(targetStr)) {
                            score = -15; reason = `Action '${actionName}' failed! The target bounds ${targetStr} were HALLUCINATED.`;
                        }
                        this.appendWeight(score, reason);

                        if (score <= -5 && previousUiState && targetStr !== 'None' && targetStr !== '') {
                            if (!this.stateDeadEnds.has(previousUiState)) this.stateDeadEnds.set(previousUiState, new Set());
                            this.stateDeadEnds.get(previousUiState).add(targetStr);
                            if (lastActionData.x !== undefined && lastActionData.y !== undefined) {
                                this.stateDeadEnds.get(previousUiState).add(`${lastActionData.x},${lastActionData.y}`);
                            }
                        }
                    }

                    this.visitedStates.add(simplifiedUi);
                    previousUiState = simplifiedUi;

                    let filteredUi = simplifiedUi;
                    let forbiddenContext = "";
                    if (this.stateDeadEnds.has(simplifiedUi)) {
                        let deadSet = this.stateDeadEnds.get(simplifiedUi);
                        const lines = simplifiedUi.split('\n');
                        filteredUi = lines.filter(line => {
                            for (let deadItem of deadSet) {
                                if (line.includes(deadItem)) return false;
                            }
                            return true;
                        }).join('\n');

                        if (filteredUi !== simplifiedUi) {
                            const deadList = Array.from(deadSet);
                            forbiddenContext = `\n[TECHNICAL ADVISORY: ${deadList.length} ELEMENTS FILTERED]\nThe system has removed non-responsive elements. DO NOT attempt to interact with: ${deadList.slice(0, 3).join(', ')}...`;
                        }
                    }

                    let nudgeContext = "";
                    if (consecutiveBlockedAttempts >= 2) {
                        const validLines = filteredUi.split('\n').filter(l => l.includes('bounds='));
                        if (validLines.length > 0) {
                            const recommendations = validLines.slice(0, 3).map(l => {
                                const match = l.match(/text="([^"]*)"|desc="([^"]*)"/);
                                const bounds = l.match(/bounds="([^"]*)"/);
                                return `- Target: ${match ? (match[1] || match[2]) : 'Element'} at ${bounds ? bounds[1] : 'unknown'}`;
                            }).join('\n');
                            nudgeContext = `\n[CRITICAL NUDGE: RECOMMENDED TARGETS]\nYou are currently stuck. THE SYSTEM STRONGLY RECOMMENDS attempting to interact with one of these NEW elements:\n${recommendations}\n`;
                        }
                    }

                    let failureAnalysisContext = "";
                    if (actionHistory.length > 0) {
                        const historySummary = actionHistory.map((a, i) => `${i + 1}. ${a}`).join('\n');
                        failureAnalysisContext = `\n[AGENT TRAJECTORY HISTORY]\n${historySummary}\n[PREVIOUS INTENTION/PLAN]: ${lastPlan}\n`;
                        if (consecutiveBlockedAttempts > 0) {
                            failureAnalysisContext += `\n[CRITICAL ALERT: STUCK IN REPETITION LOOP]\nYou have attempted to interact with the SAME area ${consecutiveBlockedAttempts + 1} times.\n`;
                        }
                    }

                    // --- SUPERVISOR: PLAN PHASE ---
                    let decision = null;
                    let rawJsonStr = "";

                    if (pendingMacroSteps.length > 0) {
                        decision = pendingMacroSteps.shift();
                        this.socket.emit('agent_message', { sender: 'system', text: `[MACRO] Automatically executing planned step: ${decision.action}...` });
                    } else {
                        let filteredWeights = actionWeights ? actionWeights.split('\n').filter(l => !l.includes('Score: -')).join('\n') : '';
                        let prompt = buildMainActionPrompt(deviceDetails.resolution, nudgeContext, failureAnalysisContext, filteredUi, forbiddenContext, mission, filteredWeights);
                        
                        const feLogs = this.projectManager.getLatestLogs('frontend', 15);
                        const beLogs = this.projectManager.getLatestLogs('backend', 15);
                        let techLogsContext = "";
                        if (feLogs || beLogs) {
                            techLogsContext = "\nCURRENT TECHNICAL SYSTEM LOGS:\n";
                            if (feLogs) techLogsContext += `--- FRONTEND ---\n${feLogs}\n`;
                            if (beLogs) techLogsContext += `--- BACKEND ---\n${beLogs}\n`;
                        }

                        let recentContext = `\nSTEP-BY-STEP REASONING CHAIN:\n${this.runLog.slice(-10).join('\n')}\n=========================================\n`;
                        prompt += techLogsContext + recentContext;

                        // Vector-less RAG: Only inject knowledge if agent is stuck
                        if (currentKnowledge && consecutiveBlockedAttempts > 0) {
                            prompt += `\nAPP KNOWLEDGE BASE (Injected due to Stuck State):\n${currentKnowledge.substring(0, 1000)}...\n=========================================\n`;
                        }

                        prompt += ACTION_PROMPT_FOOTER;

                        let dynamicSystemPrompt = SYSTEM_PROMPT;
                        if (sessionBlacklist.size > 0) {
                            dynamicSystemPrompt += `\n\n# CRITICAL: SESSION BLACKLIST\nThe following UI bounds have been PROVEN non-responsive. You are FORBIDDEN from using them:\n- ${Array.from(sessionBlacklist).join('\n- ')}`;
                        }

                        this.socket.emit('agent_message', { sender: 'system', text: `[SYSTEM] Sending prompt to AI...` });
                        this.socket.emit('full_prompt', { step: stepCount, prompt: prompt, system: stepCount === 1 || sessionBlacklist.size > 0 ? dynamicSystemPrompt : null });

                        let accumulatedResponse = "";
                        if (this.aiProvider === 'ollama') {
                            const response = await this.ollama.generate({
                                model: 'llama3.1:8b',
                                system: dynamicSystemPrompt,
                                prompt: prompt + "\nNOTE: Screenshot provided via UI only.",
                                format: agentSchema,
                                stream: true,
                                options: { temperature: 0.4, top_p: 0.95 },
                            });
                            for await (const part of response) {
                                if (!this.socket.isAgentRunning) break;
                                accumulatedResponse += part.response;
                                this.socket.emit('agent_thinking', { chunk: part.response, step: stepCount });
                            }
                            rawJsonStr = accumulatedResponse;
                            console.log(`\n--- [RAW LLM RESPONSE (Step ${stepCount})] ---\n${rawJsonStr}\n--- [END RAW RESPONSE] ---\n`);
                        } else {
                            const result = await this.ai.models.generateContentStream({
                                model: 'gemini-2.5-pro',
                                contents: [
                                    { text: prompt },
                                    { inlineData: { mimeType: "image/png", data: screenshotBase64 } }
                                ],
                                config: {
                                    systemInstruction: SYSTEM_PROMPT,
                                    responseMimeType: "application/json",
                                    responseSchema: agentSchema,
                                    temperature: 0.0
                                }
                            });
                            for await (const chunk of result.stream) {
                                if (!this.socket.isAgentRunning) break;
                                const chunkText = chunk.text();
                                accumulatedResponse += chunkText;
                                this.socket.emit('agent_thinking', { chunk: chunkText, step: stepCount });
                            }
                            rawJsonStr = accumulatedResponse;
                            console.log(`\n--- [RAW LLM RESPONSE (Step ${stepCount})] ---\n${rawJsonStr}\n--- [END RAW RESPONSE] ---\n`);
                        }

                        if (!this.socket.isAgentRunning) break;

                        const parsed = JSON.parse(rawJsonStr);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            decision = parsed.shift();
                            pendingMacroSteps = parsed;
                        } else if (Array.isArray(parsed) && parsed.length === 0) {
                            break;
                        } else {
                            decision = parsed;
                        }
                    }

                    lastPlan = decision.plan || "No plan stated.";

                    // --- SUPERVISOR: EXECUTE PHASE ---
                    const currentAction = `${decision.action}:${decision.targetBounds || decision.text || ''}`;
                    if (actionHistory.length > 0) {
                        const lastAction = actionHistory[actionHistory.length - 1];
                        if (decision.action === 'BACK' && lastAction.startsWith('TAP')) {
                            this.appendWeight(-15, `Navigation Loop Intercepted: Rejected BACK immediately after TAP without progress.`);
                            this.runLog.push(`[SYSTEM REJECTED] Action BACK was rejected as a navigation loop.`);
                            consecutiveBlockedAttempts++;
                            continue;
                        }
                        if (actionHistory.includes(currentAction)) {
                            this.appendWeight(-10, `Duplicate Action Intercepted: Rejected repeating '${currentAction}'.`);
                            this.runLog.push(`[SYSTEM REJECTED] Action ${currentAction} was rejected as a duplicate.`);
                            consecutiveBlockedAttempts++;
                            continue;
                        }
                    }
                    actionHistory.push(currentAction);
                    if (actionHistory.length > 5) actionHistory.shift();

                    if (previousUiState && this.stateDeadEnds.has(previousUiState)) {
                        const deadSet = this.stateDeadEnds.get(previousUiState);
                        const coordKey = `${decision.x},${decision.y}`;
                        const isBoundsBlocked = decision.targetBounds && deadSet.has(decision.targetBounds);
                        const isCoordBlocked = deadSet.has(coordKey);

                        if (isBoundsBlocked || isCoordBlocked) {
                            this.appendWeight(-20, `Agent Validation Guard! Attempted blocked bounds/coords.`);
                            consecutiveBlockedAttempts++;
                            if (decision.targetBounds) sessionBlacklist.add(decision.targetBounds);

                            if (consecutiveBlockedAttempts >= 3) {
                                for (let i = 0; i < this.runLog.length; i++) {
                                    if (this.runLog[i].includes(decision.targetBounds)) {
                                        this.runLog[i] = `[Step SCRUBBED] Previous failed attempt at a blocked coordinate.`;
                                    }
                                }
                                this.visitedStates.clear();
                                this.runLog.push(`[SYSTEM RESET] CRITICAL: You are trapped. The system has SCRUBBED your memory.`);
                                consecutiveBlockedAttempts = 0;
                            } else {
                                this.runLog.push(`[SYSTEM REJECTED] Action is hard-blocked.`);
                            }
                            await sleep(1500);
                            continue;
                        }
                    }
                    consecutiveBlockedAttempts = 0;

                    if (decision.targetBounds && decision.targetBounds.length > 0 && decision.targetBounds !== '[]') {
                        // Check if the bounds match the full screen resolution approximately, indicating a hallucination
                        if (decision.targetBounds.includes(`0,0`) || decision.targetBounds.includes(`0, 0`)) {
                             const matchWidthHeight = decision.targetBounds.match(/(\\d+)[,\\]\\]?\s*\\]?$/);
                             if (matchWidthHeight && parseInt(matchWidthHeight[1], 10) >= deviceDetails.width - 100) {
                                 this.appendWeight(-25, `Hallucination Guard! Attempted to use generic full-screen bounds: ${decision.targetBounds}`);
                                 this.runLog.push(`[SYSTEM REJECTED] Target bounds are too generic/full-screen. You MUST target specific UI elements.`);
                                 continue;
                             }
                        }

                        const boundsMatch = decision.targetBounds.match(/\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]/);
                        if (boundsMatch) {
                            const bx1 = parseInt(boundsMatch[1], 10);
                            const by1 = parseInt(boundsMatch[2], 10);
                            const bx2 = parseInt(boundsMatch[3], 10);
                            const by2 = parseInt(boundsMatch[4], 10);
                            decision.x = Math.round((bx1 + bx2) / 2);
                            decision.y = Math.round((by1 + by2) / 2);
                        }
                        if (!filteredUi.includes(decision.targetBounds)) {
                            this.appendWeight(-25, `Hallucination Guard! Attempted to target invisible bounds.`);
                            this.runLog.push(`[SYSTEM REJECTED] Target bounds do not exist in current UI.`);
                            continue;
                        }
                    } else if (decision.targetBounds === '[]' || decision.targetBounds === '[0, 0, 1080, 1920]' || decision.targetBounds === '[0, 0, 1280, 720]') {
                        this.appendWeight(-25, `Hallucination Guard! Attempted to target invalid generic bounds.`);
                        this.runLog.push(`[SYSTEM REJECTED] Target bounds are invalid. Pick exact bounds from the list or use UNDERSTAND with empty bounds.`);
                        continue;
                    }

                    this.socket.emit('highlight_target', { bounds: decision.targetBounds });
                    this.socket.emit('agent_message', {
                        sender: 'agent',
                        text: `<strong>Page:</strong> ${decision.current_page_analysis} <br> <strong>Intent:</strong> ${decision.user_intent} <br> <strong>Plan:</strong> ${decision.plan} <br> <strong>Expected:</strong> ${decision.expected_behavior} <br> <strong>Audit:</strong> ${decision.reasoning_audit} <br> <strong>Bounds:</strong> ${decision.targetBounds || 'N/A'} -> <strong>Action:</strong> ${decision.action}`
                    });

                    this.runLog.push(`[Step ${stepCount}] Page: ${decision.current_page_analysis}`);
                    this.runLog.push(`[Step ${stepCount}] Clickable: ${decision.clickable_items_analysis}`);
                    this.runLog.push(`[Step ${stepCount}] Intent: ${decision.user_intent}`);
                    this.runLog.push(`[Step ${stepCount}] Expected: ${decision.expected_behavior}`);
                    this.runLog.push(`[Step ${stepCount}] Plan: ${decision.plan}`);
                    this.runLog.push(`[Step ${stepCount}] Audit: ${decision.reasoning_audit}`);
                    this.runLog.push(`[Step ${stepCount}] Action: ${decision.action} at (${decision.x}, ${decision.y}) bounds=${decision.targetBounds || 'N/A'}`);

                    const thoughtText = decision.plan ? decision.plan.toLowerCase() : "";
                    if (decision.action === 'MISSION_ACCOMPLISHED' && (thoughtText.includes('tap') || thoughtText.includes('click') || thoughtText.includes('navigate to'))) {
                        await sleep(2000);
                        stepCount--; 
                        continue; 
                    }

                    lastActionData = { action: decision.action, targetBounds: decision.targetBounds || 'None', x: decision.x, y: decision.y };

                    let agentAction = decision.action ? decision.action.toUpperCase() : 'UNKNOWN';
                    if (agentAction === 'CLICK') agentAction = 'TAP';
                    if (agentAction === 'PRESS') agentAction = 'TAP';
                    if (agentAction === 'INPUT') agentAction = 'TYPE';

                    switch (agentAction) {
                        case 'TAP':
                            if (decision.x === undefined || decision.y === undefined || (decision.x === 0 && decision.y === 0)) break;
                            await this.adb.tap(decision.x, decision.y);
                            await sleep(2000);
                            break;
                        case 'DOUBLE_TAP':
                            if (decision.x === undefined || decision.y === undefined || (decision.x === 0 && decision.y === 0)) break;
                            await this.adb.doubleTap(decision.x, decision.y);
                            await sleep(2000);
                            break;
                        case 'LONG_PRESS':
                            if (decision.x === undefined || decision.y === undefined || (decision.x === 0 && decision.y === 0)) break;
                            await this.adb.longPress(decision.x, decision.y);
                            await sleep(2000);
                            break;
                        case 'TYPE':
                            await this.adb.type(decision.text || "");
                            await sleep(2000);
                            break;
                        case 'BACK':
                            await this.adb.goBack();
                            await sleep(2000);
                            break;
                        case 'SCROLL_DOWN':
                            await this.adb.scrollDown();
                            await sleep(2000);
                            break;
                        case 'SCROLL_UP':
                            await this.adb.scrollUp();
                            await sleep(2000);
                            break;
                        case 'INJECT_LOG':
                            const injection = decision.logInjection;
                            if (injection && injection.filePath && injection.lineNumber && injection.content && injection.project) {
                                this.socket.emit('agent_message', {
                                    sender: 'system',
                                    text: `[HITL] Agent wants to inject debug log into <strong>${injection.project}/${injection.filePath}</strong> at line <strong>${injection.lineNumber}</strong>: <br> <em>"${injection.content}"</em> <br> Confirm? (Y/N)`
                                });
                                const confirmed = await this.waitForHITL();
                                if (confirmed) {
                                    await this.projectManager.injectDebugLog(injection.project, injection.filePath, injection.lineNumber, injection.content);
                                    await sleep(5000); 
                                } else {
                                    this.runLog.push(`[HITL REJECTED] Log injection into ${injection.filePath} was rejected by user.`);
                                }
                            } else {
                                this.runLog.push(`[SYSTEM REJECTED] Your INJECT_LOG action was malformed.`);
                                await sleep(1500);
                                continue;
                            }
                            break;
                        case 'READ_CODE':
                            const codeReq = decision.codeAnalysis;
                            if (codeReq && codeReq.filePath && codeReq.project) {
                                try {
                                    const code = await this.projectManager.readFile(codeReq.project, codeReq.filePath);
                                    this.runLog.push(`[Step ${stepCount}] READ_CODE Output (${codeReq.filePath}):\n${code}`);

                                    // Push directly to Cartographer so it updates the map
                                    await this.cartographer.updateKnowledge(
                                        `Analyzed codebase logic for ${codeReq.filePath}`,
                                        this.loadKnowledge(),
                                        [`Action: READ_CODE`, `Code snippet:\n${code.substring(0, 1000)}`],
                                        this.socket,
                                        buildKnowledgeUpdatePrompt
                                    );
                                } catch (err) {
                                    this.runLog.push(`[Step ${stepCount}] READ_CODE Failed: ${err.message}`);
                                }
                            }
                            break;
                        case 'UNDERSTAND':
                            this.runLog.push(`[Step ${stepCount}] UNDERSTAND: AI analyzed screen and logs, deferring action to learn.`);
                            await sleep(2000);
                            break;
                        case 'MISSION_ACCOMPLISHED':
                            if (decision.x !== undefined && decision.y !== undefined && (decision.x !== 0 || decision.y !== 0)) {
                                await this.adb.tap(decision.x, decision.y);
                                await sleep(2000);
                                break;
                            }
                            if (decision.text !== undefined) {
                                await this.adb.type(decision.text || "");
                                await sleep(2000);
                                break;
                            }
                            missionComplete = true;
                            this.socket.emit('agent_message', { sender: 'system', text: `<strong>Mission Accomplished!</strong> Completed in ${stepCount} steps.` });
                            break;
                        case 'BUG_DETECTED':
                            missionComplete = true;
                            const screenshot = await this.adb.takeScreenshot('BUG');
                            this.reporter.reportBug(mission, `Bug detected at step ${stepCount}. Screenshot saved to ${screenshot}`, this.runLog);
                            this.socket.emit('agent_message', { sender: 'system', text: `BUG DETECTED. Execution halted. Captured state to: ${screenshot}` });
                            break;
                        default:
                            this.appendWeight(-15, `Agent hallucinated an illegal Action format: ${agentAction}!`);
                            this.aiProvider === 'gemini' && await sleep(2000);
                            break;
                    }

                    if (!missionComplete && this.aiProvider === 'gemini') {
                        await sleep(12000);
                    }

                } catch (error) {
                    if (error.message && (error.message.includes('429') || error.status === 429)) {
                        await sleep(15000);
                        stepCount--;
                        continue;
                    } else if (error instanceof SyntaxError) {
                        this.appendWeight(-20, `Agent returned unparseable syntax! Must output STRICT compliant JSON.`);
                        continue;
                    } else {
                        console.error("Supervisor Loop Error:", error);
                        break;
                    }
                }
            }

            if (stepCount >= MAX_STEPS && !missionComplete) {
                this.appendWeight(-50, `Global Flow Failure! Agent reached maximum allowed limits.`);
            }

        } catch (globalError) {
            console.error("Global Mission Error:", globalError);
            this.socket.emit('agent_message', { sender: 'system', text: `Fatal Mission Error: ${globalError.message}` });
        } finally {
            this.socket.isAgentRunning = false;
            this.socket.emit('agent_message', { sender: 'system', text: `[SYSTEM] Mission concluded and environment sync completed.` });

            // Post-Mission Knowledge Base Update via Cartographer
            const currentKnowledge = this.loadKnowledge();
            await this.cartographer.updateKnowledge(mission, currentKnowledge, this.runLog, this.socket, buildKnowledgeUpdatePrompt);
        }
    }
}

module.exports = Supervisor;
