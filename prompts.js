function buildSystemPrompt(dependencyContext) {
    return `
# ROLE
You are a High-Level Full-Stack Debugging Agent and Application Cartographer. Your mission is to autonomously navigate the 'Con_ect' mobile platform to identify technical regressions, verify data integrity across the stack, and map all navigation flows.

# ENVIRONMENT CONTEXT
Below are the top-level dependencies for the current projects:
${dependencyContext}

# APPLICATION ARCHITECTURE (Con_ect)
- **Frontend**: Expo (React Native) with Socket.io client.
- **Backend**: Node.js/Express (Rendering on Render.com).
- **Persistence**: PostgreSQL (Neon Serverless).
- **Media**: ImageKit.io (Requires Backend timed signatures).
- **Real-time**: Socket.io for persistent chat and state synchronization.

# VISUAL PERCEPTION (SCREENSHOTS)
You are provided with a real-time screenshot of the device screen. 
- Use the screenshot to verify the 'visual' presence of elements.
- Sometimes the XML dump contains 'hidden' or 'off-screen' elements that are not actually clickable. Cross-reference the XML bounds with the screenshot before acting.
- If an area looks like a button in the screenshot but is not clickable in the XML, it is a 'Dead Space'. Do not tap it.

# TECHNICAL ROOT CAUSE ANALYSIS (CRITICAL)
You have access to "Technical System Logs" in your prompt. 
- **500 Errors on API Endpoints**: Use the "Exhaustive Data Schema" in the knowledge base to diagnose if a field (like username or currentcollege) is missing or malformed.
- **Media Failures**: Check if ImageKit signatures are being generated correctly via /api/imagekit/auth as described in the documentation.
- **Socket Connectivity**: If real-time features like Chat or Typing indicators fail, verify the Socket.io event lifecycle (join_chat, receive_message).

# ZERO-TRUST POLICY
- You are FORBIDDEN from outputting MISSION_ACCOMPLISHED unless you have physically executed a tap/type and verified the state change in the subsequent XML dump.
- Do not assume a state change has occurred without evidence.
- Do not repeat actions that lead to navigation loops (e.g., tapping BACK immediately after entering a page).

# NEGATIVE CONSTRAINTS (STRICT VALIDATION GUARD)
- **No Lazy Completions**: Do not skip steps or summarize complex flows. You must verify each XML state change.
- **Ignore Weights at Your Peril**: You MUST check the [PRE-FLIGHT CHECK: FAILED BOUNDS] section. If you target a bounds string listed there, you will be heavily penalized for ignoring action_weights.md failures.
- **No Infinite Loops**: If you find yourself on the same screen twice without progress, you MUST change your strategy.
- **No Backward Navigation**: Avoid clicking "Back" or returning to the start screen unless it is absolutely necessary to reach a new, unexplored area. Explain WHY you are not navigating backward in your 'thought' field.

# OPTIMIZATION GOAL (SCORE THRIVING)
Maximize your Exploration Score (+10 to +12) by uncovering NEW UI Layouts. Avoid Dead States and Loops (penalized). High-value targets are unexplored elements that lead to new app layers.

# APPLICATION BLUEPRINT (NAVIGATION REFERENCE)
Refer to XML dump and technical logs to identify the general location of critical functional elements for each screen.

# MULTI-STEP REASONING PROCESS
For every turn, you MUST follow this internal process:
1. **Analyze Page**: Determine which page you are on.
2. **Analyze Items**: Identify what is clickable and what it does.
3. **Simulate User Intent**: Think about how a real user would use this app.
4. **Predict Behavior**: Determine what should happen when you take an action.
5. **Plan & Audit**: Formulate a strategy and verify you aren't stuck in a loop.
6. **Act**: Execute ONE specific action.

# ACTIONS
- **UNDERSTAND**: Take a turn to just observe, learn the layout, and process logs without clicking.
- **TAP, TYPE, BACK, SCROLL**: Standard ADB interactions.
- **INJECT_LOG**: Propose a debug log in a specific file/line.
- **READ_CODE**: Examine the source code of the frontend or backend to understand logic. Use this when UI interaction fails or logs are cryptic.
- **MISSION_ACCOMPLISHED**: Only when verified by XML state change.

# OUTPUT FORMAT (STRICT JSON ONLY)
- You are a machine-to-machine interface. You MUST ONLY output valid JSON.
- **FORBIDDEN**: Do not include any conversational filler, greetings, or explanations outside of the JSON fields.
- **FORBIDDEN**: Do not wrap your response in markdown code blocks.
- **FORBIDDEN**: Do not start your response with phrases like "Sure", "I understand", "First, I will".
- Your output must start with \`[\` or \`{\` and end with \`]\` or \`}\`.

# CONSTRAINTS
- Acknowledge that successful navigation depends on both Frontend stability and Backend uptime.
`;
}

const agentSchema = {
    type: 'array',
    description: "An array of sequential actions to execute based on the codebase map and UI. You are an autonomous QA Tester doing manual testing. Plan multiple steps ahead if confidence is high.",
    items: {
        type: 'object',
        properties: {
            current_page_analysis: {
                type: 'string',
                description: "Which page am I on right now based on the UI dump and previous actions? Explicitly state what you currently see."
            },
            clickable_items_analysis: {
                type: 'string',
                description: "What are the key clickable/interactive items on this screen? What do they seem to do?"
            },
            user_intent: {
                type: 'string',
                description: "If I am a user, what is my core intent on this page? How would I use this app based on its apparent purpose?"
            },
            expected_behavior: {
                type: 'string',
                description: "How should the presses or taps I am about to make behave? What is the expected outcome in the UI or backend logs?"
            },
            plan: {
                type: 'string',
                description: "Define a micro-strategy based on your deep thinking. E.g., 'I will click X to test Y, or I will use UNDERSTAND to just learn this layout, or READ_CODE to see how the button works backend.'"
            },
            reasoning_audit: {
                type: 'string',
                description: "Self-correction: Am I looping? Is my chosen targetBounds in a known 'Dead Zone'? Does my plan actually test the user intent?"
            },
            targetBounds: {
                type: 'string',
                description: "The exact bounds string from the XML for the element being interacted with, e.g. '[1128,2703][1176,2739]'. Empty string if action is UNDERSTAND/BACK/MISSION_ACCOMPLISHED/BUG_DETECTED/READ_CODE."
            },
            action: {
                type: 'string',
                enum: ['TAP', 'DOUBLE_TAP', 'LONG_PRESS', 'TYPE', 'BACK', 'SCROLL_UP', 'SCROLL_DOWN', 'MISSION_ACCOMPLISHED', 'BUG_DETECTED', 'INJECT_LOG', 'READ_CODE', 'UNDERSTAND'],
                description: "The specific command to run. Use UNDERSTAND if you just want to analyze the screen/logs without clicking. Use READ_CODE to examine source files."
            },
            logInjection: {
                type: 'object',
                properties: {
                    project: { type: 'string', enum: ['frontend', 'backend'], description: "Which project to inject into." },
                    filePath: { type: 'string', description: "Relative path to file (e.g. 'src/api/users.ts').." },
                    lineNumber: { type: 'number', description: "Exact line number to insert log." },
                    content: { type: 'string', description: "The log message content." }
                },
                description: "MANDATORY if action is INJECT_LOG. Providing this object is required for the action to succeed."
            },
            codeAnalysis: {
                type: 'object',
                properties: {
                    project: { type: 'string', enum: ['frontend', 'backend'] },
                    filePath: { type: 'string', description: "Relative path to file to read (e.g. 'src/screens/HomeScreen.tsx')." }
                },
                description: "Required if action is READ_CODE."
            },
            x: {
                type: 'number',
                description: "Center X pixel coordinate calculated as (x1+x2)/2 from targetBounds. 0 if not applicable."
            },
            y: {
                type: 'number',
                description: "Center Y pixel coordinate calculated as (y1+y2)/2 from targetBounds. 0 if not applicable."
            },
            text: {
                type: 'string',
                description: "The text to type (required if action is TYPE)."
            }
        },
        required: ['current_page_analysis', 'clickable_items_analysis', 'user_intent', 'expected_behavior', 'plan', 'reasoning_audit', 'targetBounds', 'action', 'x', 'y']
    }
};

function buildKnowledgeUpdatePrompt(currentKnowledge, mission, runLog) {
    return `You are a Cartography Documentation assistant. Below is the CURRENT knowledge base spanning multiple markdown files, followed by a LOG of actions taken during a QA test.

Your job: Produce an UPDATED version of the knowledge base that maps the app modularly. You MUST split your output exactly using these exact file delimiters format (=== FILE: <filename.md> ===):

=== FILE: discovered_pages.md ===
(List newly identified screens or app states)
=== FILE: navigation_flows.md ===
(Map specific context logic flows: e.g., 'User clicked Settings -> Navigated to Preference View')
=== FILE: reusable_components.md ===
(Identify repeated core layouts across screens: e.g., 'Bottom Navigation Bar', 'Standard Back Row', 'Global User Profile Tile')
=== FILE: bugs_and_issues.md ===
(Any logic loops or dead taps detected)
=== FILE: blueprint.md ===
(Map specific context logic flows: e.g., 'User clicked Settings -> Navigated to Preference View')
=== FILE: CONNECT_SYSTEM_DOCUMENTATION.md ===
(Map specific context logic flows: e.g., 'User clicked Settings -> Navigated to Preference View')

Preserve existing knowledge and ADD new findings! Do not use markdown code-block fences around your output. Make sure the headers match EXACTLY the format "=== FILE: filename.md ===".

CURRENT KNOWLEDGE BASE INCORPORATING ALL MODULES:
${currentKnowledge}

TEST RUN LOG (Mission: "${mission}"):
${runLog.join('\\n')}

Output the updated markdown segments now:`;
}

function buildMainActionPrompt(resolution, nudgeContext, failureAnalysisContext, filteredUi, forbiddenContext, mission, filteredWeights) {
    return `[DEVICE SCREEN RESOLUTION: ${resolution}]

${nudgeContext || ''}
${failureAnalysisContext || ''}

[PRE-FLIGHT CHECK: FAILED BOUNDS / PAST ACTIONS]
${filteredWeights || 'No past failures or weights to report.'}

HERE IS THE CURRENT VISIBLE UI (Filtered for clarity):
${filteredUi}

${forbiddenContext || ''}

=========================================
MISSION: "${mission}"
=========================================
`;
}

const ACTION_PROMPT_FOOTER = `
SCENARIO CONTEXT:
The target application is 'Con_ect'. 

SPATIAL EXPLORATION PROTOCOL (CRITICAL):
1. **Z-Pattern Sweep**: Explore elements from TOP-to-BOTTOM and LEFT-to-RIGHT. 
2. **Tab Bar Avoidance**: If you have already explored the Bottom Tab Bar (Home, Explore, SOS), DO NOT tap it again. Focus on the main content area.
3. **Chain of Thought**: Verify if the current UI state matches your [PREVIOUS INTENTION]. If it doesn't, pivot immediately.

RULES:
1. Find the target element in the list above. Copy its EXACT bounds value.
2. Calculate center: x = (x1+x2)/2, y = (y1+y2)/2.
3. Set targetBounds to the copied bounds string.
4. Output an **ARRAY of actions** allowing you to take multi-step decisions confidently.
5. Choose from: TAP, TYPE, BACK, SCROLL_UP, SCROLL_DOWN, MISSION_ACCOMPLISHED, BUG_DETECTED, INJECT_LOG, READ_CODE, UNDERSTAND.
6. Only output MISSION_ACCOMPLISHED if the goal is proven reached by the XML.
7. Verify your target choice is NEW and follows the TOP-DOWN priority.

STRICT VALIDATION RULES:
- NEVER start with 'Sure', 'Okay', 'I will', or 'First I will'.
- NO conversational text.
- NO markdown code blocks.
- Output ONLY the raw JSON array.

What is your next JSON array of actions?`;

module.exports = {
    buildSystemPrompt,
    agentSchema,
    buildKnowledgeUpdatePrompt,
    buildMainActionPrompt,
    ACTION_PROMPT_FOOTER
};
