'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { parseGeminiJson } = require('./utils/parseGeminiJson');

let genAI;
function getClient() {
    if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI;
}

const MODEL = 'gemini-1.5-flash-latest';
const TIMEOUT_MS = 25000;

// Wrap a promise with a hard timeout
function withTimeout(promise, ms = TIMEOUT_MS) {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timer]);
}

// Core call function — returns { parsed, raw }
async function callGemini(promptParts, config = {}) {
    const model = getClient().getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: config.temperature || 0.4,
            topP: 0.9,
            topK: 40
        }
    });
    const chat = model.startChat({ history: [] });

    const initialPrompt = Array.isArray(promptParts)
        ? promptParts.join('\n')
        : promptParts;

    const sendMessage = async (msg) => {
        const result = await withTimeout(chat.sendMessage(msg));
        return result.response.text();
    };

    const rawText = await sendMessage(initialPrompt);
    return parseGeminiJson(rawText, sendMessage);
}

// ── Clean Question ───────────────────────────────────────────────────────────
async function cleanQuestion(transcript, profile = {}) {
    const { target_role = '', tech_stack = [], projects = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : tech_stack;

    const prompt = `LAYER 1: SYSTEM ROLE
You are a technical interview assistant. Your job is to extract the main interview question from a potentially messy or noisy transcript.

LAYER 2: CONTEXT
- ROLE: ${target_role}
- EXPECTED TECH: ${skillsStr}
- PROJECTS: ${projects}

TRANSCRIPT: ${transcript}

LAYER 3: OUTPUT RULES
- If transcript is noise or empty, return {"incomplete": true}
- If it contains multiple questions, extract the MAIN question only.
- Fix technical terms based on context (e.g., "Gauze in blur" -> "Gaussian blur", "Slacking" -> "LangChain").
- Remove conversational filler.
- Return ONLY JSON: {"clean_question": "string"}`;

    return callGemini(prompt, { temperature: 0.1 });
}

// ── Generate Answer ──────────────────────────────────────────────────────────
async function generateAnswer(cleanQuestion, profile = {}, jobDescription = '', history = []) {
    const { name = 'the candidate', target_role = '', tech_stack = [], projects = '', years_experience = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : (tech_stack || '');

    const historyStr = history.map(h => `${h.role === 'user' ? 'Interviewer' : 'Assistant'}: ${h.text}`).join('\n\n');

    const prompt = `LAYER 1: SYSTEM ROLE
You are a senior staff-level expert practitioner. You provide short, punchy, and domain-precise answers across any field (Engineering, Product, HR, Finance, etc.). Your goal is CLARITY over COMPLETENESS.

LAYER 2: CONTEXT
CANDIDATE: ${name} (${years_experience} years exp)
ROLE: ${target_role}
TECH/SKILLS: ${skillsStr}
EXPERIENCE/PROJECTS: ${projects}
JOB DESCRIPTION: ${jobDescription || 'Not provided'}

CONVERSATION HISTORY:
${historyStr || 'None (First question)'}

NEW QUESTION: "${cleanQuestion}"

LAYER 3: OUTPUT RULES
1. SILENT REASONING: Analyze the domain (Tech? Leadership? Strategy?). Identify core concepts and common misperceptions.
2. BREVITY: 5-10 sentences. Start with the headline answer.
3. ZERO HALLUCINATION: STRICT RULE: Do not invent candidate achievements, specific metrics, or company names not in the context. If data is missing, use practitioner wisdom: "In my experience with [topic]..." or "Standard practice is...".
4. PRECISION: Use exact domain terminology. (e.g., in Tech: Runtime vs Framework; in HR: Policy vs Procedure; in Product: Outcome vs Output).
5. STYLE: First person, professional, senior practitioner tone. Include one real-world principle and one trade-off/constraint.

Return ONLY JSON:
{
  "key_points": ["Punchy insight 1", "Technical/Domain trade-off 2", "Production/Reality insight 3"],
  "full_answer": "...", 
  "short_version": "One high-impact headline sentence.",
  "followup_topics": ["Deep-dive topic 1", "Deep-dive topic 2"],
  "interviewer_intent": "What is the interviewer actually seeking to validate?"
}`;

    return callGemini(prompt, { temperature: 0.4 });
}

// Streaming version for answers
async function* streamAnswer(cleanQuestion, profile = {}, jobDescription = '', history = []) {
    const { name = 'the candidate', target_role = '', tech_stack = [], projects = '', years_experience = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : (tech_stack || '');
    const historyStr = history.map(h => `${h.role === 'user' ? 'Interviewer' : 'Assistant'}: ${h.text}`).join('\n\n');

    const prompt = `Generate a short (5-10 sentences), expert interview answer in MARKDOWN. 
IMPORTANT: Wrap ALL code in \`\`\`language code blocks.

CONTEXT:
CANDIDATE: ${name}
ROLE: ${target_role}
TECH: ${skillsStr}
HISTORY: ${historyStr || 'None'}
QUESTION: "${cleanQuestion}"

RULES:
1. Be technically precise.
2. Use FIRST PERSON.
3. NO HALLUCINATION.
4. Start with the answer immediately.

ANSWER:`;

    const model = getClient().getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: 0.5,
            topP: 0.8
        }
    });
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        yield chunkText;
    }
}

// ── Shorten Answer ───────────────────────────────────────────────────────────
async function shortenAnswer(fullAnswer) {
    const prompt = `LAYER 1: SYSTEM ROLE
You are a concise editor for interview answers.

LAYER 2: CONTEXT
FULL ANSWER: ${fullAnswer}

LAYER 3: OUTPUT RULES
- Shorten to a 20-30 second spoken version.
- Keep the core message.
- Return ONLY JSON: {"short_version": "string"}`;

    return callGemini(prompt, { temperature: 0.2 });
}

// ── Add Personal Example ─────────────────────────────────────────────────────
async function addPersonalExample(fullAnswer, projects) {
    const prompt = `LAYER 1: SYSTEM ROLE
You are an interview coach augmenting answers with personal experience.

LAYER 2: CONTEXT
ANSWER: ${fullAnswer}
CANDIDATE PROJECTS: ${projects}

LAYER 3: OUTPUT RULES
- Weave in a specific example from the projects.
- Keep it natural and under 2 minutes when read aloud.
- Return ONLY JSON: {"augmented_answer": "string"}`;

    return callGemini(prompt, { temperature: 0.4 });
}

// ── Extract Profile ────────────────────────────────────────────────────────
async function extractProfile(resumeText, jdText) {
    const prompt = `LAYER 1: SYSTEM ROLE
You are an expert technical recruiter parsing a resume against a job description.

LAYER 2: CONTEXT
RESUME: ${resumeText}
JD: ${jdText}

LAYER 3: OUTPUT RULES
Extract the definitive profile. Return ONLY JSON.
Shape:
{
  "name": "...",
  "target_role": "...",
  "years_exp": number,
  "tech_stack": ["..."],
  "projects": "2-3 sentence summary"
}`;

    return callGemini(prompt, { temperature: 0.1 });
}

module.exports = { cleanQuestion, generateAnswer, shortenAnswer, addPersonalExample, extractProfile, streamAnswer };
