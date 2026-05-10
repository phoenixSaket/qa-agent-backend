const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

class CodeAnalyzer {
    constructor(aiProviderConfig) {
        this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        this.KNOWLEDGE_DIR = path.join(__dirname, 'knowledge_base');
        
        if (!fs.existsSync(this.KNOWLEDGE_DIR)) {
            fs.mkdirSync(this.KNOWLEDGE_DIR, { recursive: true });
        }
    }

    _walkDir(dir, filterExts = ['.js', '.jsx', '.ts', '.tsx'], fileList = []) {
        if (!fs.existsSync(dir)) return fileList;
        
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const stat = fs.statSync(path.join(dir, file));
            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
                    this._walkDir(path.join(dir, file), filterExts, fileList);
                }
            } else {
                if (filterExts.includes(path.extname(file))) {
                    fileList.push(path.join(dir, file));
                }
            }
        }
        return fileList;
    }

    async analyzeCodebase(frontendPath, backendPath) {
        console.log('[CodeAnalyzer] Starting full codebase analysis...');
        const feFiles = this._walkDir(path.join(frontendPath, 'src'));
        const beFiles = this._walkDir(path.join(backendPath, 'src'));

        let combinedCodeSample = "=== FRONTEND STRUCTURE & KEY FILES ===\n";
        feFiles.slice(0, 15).forEach(f => {
            const shortPath = f.replace(frontendPath, '');
            combinedCodeSample += `\n--- ${shortPath} ---\n${fs.readFileSync(f, 'utf8').substring(0, 1500)}\n`;
        });

        combinedCodeSample += "\n=== BACKEND STRUCTURE & KEY FILES ===\n";
        beFiles.slice(0, 15).forEach(f => {
            const shortPath = f.replace(backendPath, '');
            combinedCodeSample += `\n--- ${shortPath} ---\n${fs.readFileSync(f, 'utf8').substring(0, 1500)}\n`;
        });

        const prompt = `You are a high-level system architect. Analyze the provided frontend and backend source code chunks.
Your goal is to build a high-level map of the Application's Architecture that will be used by an autonomous QA agent.

Identify:
1. Core UI Screens and components (Frontend).
2. Key API endpoints and state controllers (Backend).
3. Data relationships between the frontend UI and the backend API.

Produce a Markdown document strictly summarizing the 'Application Code Blueprint'. Output nothing but the markdown.

CODE:
${combinedCodeSample.substring(0, 40000)} // Truncated to avoid context limits
`;

        try {
            console.log('[CodeAnalyzer] Sent codebase chunks to LLM for parsing...');
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            const outputText = response.text.replace(/^```markdown/gi, '').replace(/```$/gi, '').trim();
            const outPath = path.join(this.KNOWLEDGE_DIR, 'code_architecture.md');
            fs.writeFileSync(outPath, outputText, 'utf8');
            console.log(`[CodeAnalyzer] Successfully generated code blueprint at ${outPath}`);
            return outputText;
        } catch (err) {
            console.error('[CodeAnalyzer] Failed to generate structure:', err);
            throw err;
        }
    }
}

module.exports = CodeAnalyzer;
