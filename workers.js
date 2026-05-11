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
    // Navigator acts as the agent deciding UI/ADB interactions. 
    // Handled in Supervisor currently, but we can encapsulate its role here if needed.
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
                    model: 'gemma2:2b',
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
                        model: 'gemma2:2b',
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

module.exports = { Architect, Navigator, Sentry, Reporter, Cartographer };
