const fs = require('fs');

let content = fs.readFileSync('server.js', 'utf8');

// 1. Require
content = content.replace(
    "const { spawn } = require('child_process');",
    "const { spawn } = require('child_process');\nconst { buildSystemPrompt, agentSchema, buildKnowledgeUpdatePrompt, buildMainActionPrompt, ACTION_PROMPT_FOOTER } = require('./prompts');"
);

// 2. Remove buildSystemPrompt and agentSchema
let start_idx = content.indexOf("function buildSystemPrompt(dependencyContext)");
let end_idx = content.indexOf("app.use(express.static(path.join(__dirname, 'public')));");
if (start_idx !== -1 && end_idx !== -1) {
    content = content.substring(0, start_idx) + "\n" + content.substring(end_idx);
}

// 3. Replace knowledge
let k_start = content.indexOf("const knowledgeUpdatePrompt = `You are a Cartography");
let k_end = content.indexOf("Output the updated markdown segments now:`;");
if (k_start !== -1 && k_end !== -1) {
    content = content.substring(0, k_start) + "const knowledgeUpdatePrompt = buildKnowledgeUpdatePrompt(currentKnowledge, mission, runLog);" + content.substring(k_end + "Output the updated markdown segments now:`;".length);
}

// 4. Replace prompt 1
let p1_start = content.indexOf("let prompt = `[DEVICE SCREEN RESOLUTION:");
let p1_end = content.indexOf("=========================================\n`;");
if (p1_start !== -1 && p1_end !== -1) {
    content = content.substring(0, p1_start) + "let prompt = buildMainActionPrompt(deviceDetails.resolution, nudgeContext, failureAnalysisContext, filteredUi, forbiddenContext, mission);" + content.substring(p1_end + "=========================================\n`;".length);
}

// 5. Replace prompt 2
let p2_start = content.indexOf("prompt += `\nSCENARIO CONTEXT:");
let p2_end = content.indexOf("What is your next action?`;");
if (p2_start !== -1 && p2_end !== -1) {
    content = content.substring(0, p2_start) + "prompt += ACTION_PROMPT_FOOTER;" + content.substring(p2_end + "What is your next action?`;".length);
}

fs.writeFileSync('server.js', content, 'utf8');
console.log("Done");
