const { buildSystemPrompt } = require('./prompts');
const FRONTEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect.app';
const BACKEND_PATH = '/Users/admin/Desktop/Projects/Connect/connect-backend';
const dependencyContext = `FRONTEND:\n\nBACKEND:`;
try {
    const SYSTEM_PROMPT = buildSystemPrompt(dependencyContext);
    console.log("buildSystemPrompt SUCCESS");
} catch(e) {
    console.error("ERROR:", e);
}
