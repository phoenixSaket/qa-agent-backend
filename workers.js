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
    constructor(projectManager) {
        this.pm = projectManager;
    }
    monitorLogs() {
        const feLogs = this.pm.getLatestLogs('frontend', 20);
        const beLogs = this.pm.getLatestLogs('backend', 20);
        const errors = [];
        if (feLogs.includes('ERROR') || feLogs.includes('500') || feLogs.includes('FATAL')) {
            errors.push('Frontend Error/500 status detected in logBuffers.');
        }
        if (beLogs.includes('ERROR') || beLogs.includes('500') || beLogs.includes('FATAL') || beLogs.includes('socket fail')) {
            errors.push('Backend Error/socket failure detected in logBuffers.');
        }
        return errors.length > 0 ? errors.join(' | ') : null;
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
                        model: 'gemma2:2b', // Using a standard gemma model
                        prompt: prompt,
                        options: { temperature: 0.4, stream: false },
                    });
                    updatedKnowledge = resp.response;
                } else {
                    const resp = await this.ai.models.generateContent({
                        model: 'gemini-1.5-flash', // Corrected model name
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

            updatedKnowledge = updatedKnowledge.replace(/^```markdown\n?/gi, '').replace(/^```\n?/gi, '').replace(/\n?```$/gi, '').trim();

            if (updatedKnowledge.length > 50) {
                const sections = updatedKnowledge.split('=== FILE: ');
                let count = 0;
                for (const section of sections) {
                    if (!section.trim()) continue;
                    const lines = section.split('\n');
                    let filename = lines[0].replace('===', '').trim();
                    const content = lines.slice(1).join('\n').trim();
                    if (filename && filename.endsWith('.md')) {
                        // Native File System writing
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
