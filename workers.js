const fs = require('fs');
const path = require('path');
const CodeAnalyzer = require('./codeAnalyzer');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge_base');

class Architect {
    constructor() {
        this.analyzer = new CodeAnalyzer();
    }
    async analyze(frontendPath, backendPath) {
        return await this.analyzer.analyzeCodebase(frontendPath, backendPath);
    }
}

class Navigator {
    constructor(aiClient, ollamaClient, provider) {
        this.ai = aiClient;
        this.ollama = ollamaClient;
        this.provider = provider;
    }

    async identifyInteractiveElements(rawXml) {
        // Strip XML noise for the LLM payload to save context
        const strippedXml = rawXml
            .replace(/<hierarchy[^>]*>/, '')
            .replace(/<\/hierarchy>/, '')
            .replace(/index="\d+"/g, '')
            .replace(/package="[^"]+"/g, '')
            .replace(/checkable="[^"]+"/g, '')
            .replace(/checked="[^"]+"/g, '')
            .replace(/password="[^"]+"/g, '')
            .replace(/long-clickable="[^"]+"/g, '')
            .replace(/focused="[^"]+"/g, '')
            .replace(/focusable="[^"]+"/g, '');

        const prompt = `You are a UI Analysis Expert Agent.
Your task is to analyze this raw Android UI XML dump and identify ALL genuinely interactive elements.
React Native applications often wrap text or icons in a 'ViewGroup' where 'clickable="false"' but the element is actually the intended tap target.

Analyze the XML. Identify every element that a human user would consider interactive (buttons, tabs, feed items, settings rows, icons with descriptions, text links).
For each identified element, output a single line in this EXACT format:
[UI-ELEMENT] bounds="[x1,y1][x2,y2]" | text="element text" | desc="element description" | class="ClassName"

DO NOT output any conversational text. Output ONLY the list of [UI-ELEMENT] lines.

RAW XML:
${strippedXml.substring(0, 15000)}
`;
        try {
            // Force the use of llama3.1:8b with a high context window as requested
            const resp = await this.ollama.generate({
                model: 'llama3.1:8b',
                prompt: prompt,
                options: {
                    temperature: 0.1,
                    num_ctx: 10000,
                    stream: false
                },
            });
            return resp.response.trim();
        } catch (err) {
            console.error('[NAVIGATOR OLLAMA TIMEOUT/ERROR]. Switching to Gemini Pro...', err.message);
            try {
                // If local Ollama hangs/times out with 10k context, fallback instantly to Gemini 2.5 Pro
                const fallbackResp = await this.ai.models.generateContent({
                    model: 'gemini-2.5-pro',
                    contents: prompt,
                    config: { temperature: 0.1 }
                });
                return fallbackResp.text.trim();
            } catch (fallbackErr) {
                console.error('[NAVIGATOR AI FALLBACK ERROR]', fallbackErr.message);
                return null; // Fallback to heuristic parser
            }
        }
    }
}

class VisualDiff {
    constructor(aiClient, provider) {
        this.ai = aiClient;
        this.provider = provider;
    }

    async compareStates(beforeScreenshotBase64, afterScreenshotBase64, actionDescription) {
        if (this.provider !== 'gemini') {
            console.log('[VisualDiff] Local models generally lack reliable vision comparison capabilities. Skipping diff.');
            return { changed: true, reason: 'Visual diff skipped (not using Gemini).' };
        }

        const prompt = `You are an expert UX/UI QA Agent. Compare the two screenshots of a mobile application interface provided.
The first screenshot is the state "BEFORE" an action.
The second screenshot is the state "AFTER" the action: "${actionDescription}".

Did the visual state of the application change in a meaningful way? (e.g., did a new screen open, did a menu appear, did a button state change?)
Ignore minor, non-functional changes like a ticking clock in the status bar or a shifting battery percentage. Focus on the core application interface.

Respond in strict JSON format:
{
    "changed": true|false,
    "reason": "A 1 sentence explanation of what changed or why it appears identical."
}`;

        try {
            console.log('[VisualDiff] Analyzing state transition...');
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: [
                    { text: prompt },
                    { inlineData: { mimeType: "image/png", data: beforeScreenshotBase64 } },
                    { inlineData: { mimeType: "image/png", data: afterScreenshotBase64 } }
                ],
                config: { responseMimeType: "application/json", temperature: 0.1 }
            });
            const result = JSON.parse(response.text.trim());
            return result;
        } catch (err) {
            console.error('[VisualDiff AI ERROR]', err);
            return { changed: true, reason: 'Visual diff failed, assuming change occurred.' };
        }
    }
}

class Sentry {
    constructor(projectManager, aiClient, ollamaClient, provider) {
        this.pm = projectManager;
        this.ai = aiClient;
        this.ollama = ollamaClient;
        this.provider = provider;
    }

    async monitorLogsAsync() {
        const feLogs = this.pm.getLatestLogs('frontend', 20);
        const beLogs = this.pm.getLatestLogs('backend', 20);

        if (!feLogs && !beLogs) return null;

        const prompt = `You are the Sentry AI. Analyze these real-time system logs.
Is there a CRITICAL failure (e.g., app crash, 500 error, unhandled exception, network drop) that requires halting the QA process or notifying the user?
Ignore standard warnings, info logs, or handled HTTP responses.
FRONTEND LOGS:\n${feLogs}\n
BACKEND LOGS:\n${beLogs}\n
Output ONLY the text "CRITICAL: " followed by a 1-sentence summary of the error if a major failure occurred. Otherwise, output ONLY the text "ALL_CLEAR".`;

        try {
            let responseText = '';
            if (this.provider === 'ollama') {
                const resp = await this.ollama.generate({
                    model: 'llama3.1:8b',
                    prompt: prompt,
                    options: { temperature: 0.1, stream: false },
                });
                responseText = resp.response.trim();
            } else {
                const resp = await this.ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: { temperature: 0.1 }
                });
                responseText = resp.text.trim();
            }

            if (responseText.startsWith('CRITICAL:')) {
                return responseText;
            }
            return null;
        } catch (err) {
            console.error('[SENTRY AI ERROR]', err);
            return null;
        }
    }
}

class Reporter {
    constructor() {
        this.reportFile = path.join(KNOWLEDGE_DIR, 'bugs_and_issues.md');
    }
    reportBug(mission, details, runLog) {
        const report = `\n## Bug Report: ${new Date().toISOString()}\n**Mission:** ${mission}\n**Details:** ${details}\n**Reproduction Steps:**\n${runLog.map(l => '- ' + l).join('\n')}\n`;
        if (!fs.existsSync(KNOWLEDGE_DIR)) fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        fs.appendFileSync(this.reportFile, report, 'utf8');
    }
}

class Cartographer {
    constructor(aiClient, ollamaClient, aiProvider) {
        this.ai = aiClient;
        this.ollama = ollamaClient;
        this.provider = aiProvider;
    }

    async rewriteKnowledgeBase(blueprintText, socket) {
        socket.emit('agent_message', { sender: 'system', text: '[CARTOGRAPHER] Hard-rewriting knowledge base using new architecture...' });

        const prompt = `You are the Cartographer. You need to reset and rewrite the knowledge base based on the provided Code Blueprint.
Generate the baseline files for our agent. You MUST use exactly these file delimiters format (=== FILE: <filename.md> ===):

=== FILE: discovered_pages.md ===
(List inferred screens from the blueprint)
=== FILE: navigation_flows.md ===
(Predict basic navigation flows between these screens)
=== FILE: reusable_components.md ===
(List the UI components extracted from the blueprint)
=== FILE: bugs_and_issues.md ===
(Leave empty for now)
=== FILE: CONNECT_SYSTEM_DOCUMENTATION.md ===
(A high-level summary of the architecture)

BLUEPRINT:
${blueprintText}

Output the updated markdown segments now:`;

        try {
            const resp = await this.ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: prompt,
                config: { temperature: 0.2 }
            });
            let updatedKnowledge = resp.text.replace(/```markdown\n?/gi, '').replace(/```/gi, '').trim();
            const fileRegex = /===\s*FILE:\s*([a-zA-Z0-9_-]+\.md)\s*===/gi;
            const sections = updatedKnowledge.split(fileRegex);
            let count = 0;

            // Wipe old files
            const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge_base');
            const files = fs.readdirSync(KNOWLEDGE_DIR);
            for (const file of files) {
                if (file.endsWith('.md') && file !== 'code_architecture.md' && file !== 'action_weights.md') {
                    fs.unlinkSync(path.join(KNOWLEDGE_DIR, file));
                }
            }

            for (let i = 1; i < sections.length; i += 2) {
                const filename = sections[i].trim();
                const content = sections[i+1] ? sections[i+1].trim() : '';
                if (filename.endsWith('.md') && content.length > 0) {
                    fs.writeFileSync(path.join(KNOWLEDGE_DIR, filename), content, 'utf8');
                    count++;
                }
            }
            socket.emit('agent_message', { sender: 'system', text: `[CARTOGRAPHER] Hard-rewrite complete. Saved ${count} baseline modular files.` });
        } catch(e) {
            console.error('[CARTOGRAPHER REWRITE ERROR]', e);
        }
    }

    async updateKnowledge(mission, currentKnowledge, runLog, socket, buildPromptFn) {
        try {
            const hasBug = runLog.some(l => l.includes('Action: BUG_DETECTED'));
            if (hasBug) {
                const successfulTaps = runLog.filter(l => l.includes('Action: TAP')).map(t => t.split('Action: ')[1]);
                if (successfulTaps.length > 0) {
                    runLog.push(`\n[RETRO-STEPS FOR REPRODUCTION]: ${successfulTaps.join(' -> ')}`);
                }
            }

            socket.emit('agent_message', { sender: 'system', text: 'Updating app knowledge base with Cartographer...' });
            const prompt = buildPromptFn(currentKnowledge, mission, runLog);

            let updatedKnowledge = '';
            try {
                if (this.provider === 'ollama') {
                    const resp = await this.ollama.generate({
                        model: 'llama3.1:8b',
                        prompt: prompt,
                        options: { temperature: 0.4, stream: false },
                    });
                    updatedKnowledge = resp.response;
                } else {
                    const resp = await this.ai.models.generateContent({
                        model: 'gemini-2.5-pro',
                        contents: prompt,
                        config: { temperature: 0.3 }
                    });
                    updatedKnowledge = resp.text;
                }
            } catch (llmError) {
                console.error('--- [CARTOGRAPHER LLM FETCH ERROR] ---');
                console.error(llmError); // Log full error object for debugging
                console.error('---------------------------------------');
                throw new Error(`LLM Generation Failed: ${llmError.message}`);
            }

            updatedKnowledge = updatedKnowledge.replace(/```markdown\n?/gi, '').replace(/```/gi, '').trim();

            if (updatedKnowledge.length > 50) {
                // More robust parsing: look for lines exactly like '=== FILE: filename.md ==='
                const fileRegex = /===\s*FILE:\s*([a-zA-Z0-9_-]+\.md)\s*===/gi;
                const sections = updatedKnowledge.split(fileRegex);
                let count = 0;

                // sections[0] is text before first delimiter, sections[1] is first filename, sections[2] is content, etc.
                for (let i = 1; i < sections.length; i += 2) {
                    const filename = sections[i].trim();
                    const content = sections[i+1] ? sections[i+1].trim() : '';

                    if (filename.endsWith('.md') && content.length > 0) {
                        const targetPath = path.join(KNOWLEDGE_DIR, filename);
                        fs.writeFileSync(targetPath, content, 'utf8');
                        count++;
                    }
                }
                socket.emit('agent_message', { sender: 'system', text: `Cartographer updated <strong>${count} distinct Modular MD files</strong> in the knowledge core.` });
                return updatedKnowledge;
            } else {
                socket.emit('agent_message', { sender: 'system', text: 'Knowledge update too short, skipping save to prevent data loss.' });
                return currentKnowledge;
            }
        } catch (err) {
            console.error('Cartographer mission update failure:', err);
            socket.emit('agent_message', { sender: 'system', text: `Cartographer could not update knowledge base: ${err.message}` });
            return currentKnowledge;
        }
    }
}

class Trainer {
    constructor(aiClient, provider) {
        this.ai = aiClient;
        this.provider = provider;
    }

    async extractTutorial(runLog) {
        if (this.provider !== 'gemini' || runLog.length < 3) return;

        const prompt = `You are a Training Agent. Review this test log and extract a basic "tutorial" step-by-step for a first-time user.
LOG:
${runLog.join('\\n')}

Output a single bulleted list of user actions. (e.g. "- User taps Home", "- User scrolls down")`;

        try {
            const resp = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { temperature: 0.2 }
            });
            const tutorial = resp.text.trim();
            const tutorialPath = path.join(__dirname, 'knowledge_base', 'exploration_tutorials.md');
            fs.appendFileSync(tutorialPath, `\n## Tutorial generated on ${new Date().toISOString()}\n${tutorial}\n`, 'utf8');
        } catch(e) {
            console.error('[TRAINER ERROR]', e);
        }
    }
}

module.exports = { Architect, Navigator, Sentry, Reporter, Cartographer, VisualDiff, Trainer };
