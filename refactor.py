import sys

with open('server.js', 'r') as f:
    content = f.read()

# 1. Require
content = content.replace(
    "const { spawn } = require('child_process');",
    "const { spawn } = require('child_process');\nconst { buildSystemPrompt, agentSchema, buildKnowledgeUpdatePrompt, buildMainActionPrompt, ACTION_PROMPT_FOOTER } = require('./prompts');"
)

# 2. Remove buildSystemPrompt and agentSchema
start_idx = content.find("function buildSystemPrompt(dependencyContext)")
end_idx = content.find("app.use(express.static(path.join(__dirname, 'public')));")
if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + "\n" + content[end_idx:]

# 3. Replace knowledge
k_start = content.find("const knowledgeUpdatePrompt = `You are a Cartography")
k_end = content.find("Output the updated markdown segments now:`;") + len("Output the updated markdown segments now:`;")
if k_start != -1 and k_end != -1:
    content = content[:k_start] + "const knowledgeUpdatePrompt = buildKnowledgeUpdatePrompt(currentKnowledge, mission, runLog);" + content[k_end:]

# 4. Replace prompt 1
p1_start = content.find("let prompt = `[DEVICE SCREEN RESOLUTION:")
p1_end = content.find("=========================================\n`;") + len("=========================================\n`;")
if p1_start != -1 and p1_end != -1:
    content = content[:p1_start] + "let prompt = buildMainActionPrompt(deviceDetails.resolution, nudgeContext, failureAnalysisContext, filteredUi, forbiddenContext, mission);" + content[p1_end:]

# 5. Replace prompt 2
p2_start = content.find("prompt += `\nSCENARIO CONTEXT:")
p2_end = content.find("What is your next action?`;") + len("What is your next action?`;")
if p2_start != -1 and p2_end != -1:
    content = content[:p2_start] + "prompt += ACTION_PROMPT_FOOTER;" + content[p2_end:]

with open('server.js', 'w') as f:
    f.write(content)

print("Done")
