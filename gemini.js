'use strict';
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { parseGeminiJson } = require('./utils/parseGeminiJson');

let genAI;
function getClient() {
    if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    return genAI;
}

const MODEL = 'gemini-2.5-flash-lite';
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

    const historyStr = history.map(h => `${h.role === 'user' ? 'Question' : 'Answer'}: ${h.text}`).join('\n\n');

    const prompt = `LAYER 1: SYSTEM ROLE
You are a senior staff-level interview coach. You provide practical, technical, and confident answers that sound like a real engineer with production experience. Avoid textbook genericism.

LAYER 2: CONTEXT
CANDIDATE: ${name} (${years_experience} years exp)
ROLE: ${target_role}
TECH: ${skillsStr}
PROJECTS: ${projects}
JOB DESCRIPTION: ${jobDescription || 'Not provided'}

CONVERSATION HISTORY:
${historyStr || 'None (First question)'}

NEW QUESTION: "${cleanQuestion}"

LAYER 3: OUTPUT RULES
1. SILENT REASONING: First silently analyze: Question type? Concept tested? Relevant candidate experience? (Do not output this).
2. HALLUCINATION PROTECTION: If profile lacks a concrete example, say "In my experience [tech area]..." Do NOT invent fake metrics or companies.
3. CONTENT: Use first person. Include at least ONE specific example and ONE trade-off. 10-20 sentences.
4. FORMAT: Return ONLY JSON. Value "full_answer" MUST be in MARKDOWN.

Shape:
{
  "key_points": ["Insight 1", "Trade-off 2", "Production insight 3"],
  "full_answer": "...", 
  "short_version": "One powerful headline sentence.",
  "followup_topics": ["Topic 1", "Topic 2"],
  "interviewer_intent": "What is being tested?"
}`;

    return callGemini(prompt, { temperature: 0.4 });
}

// Streaming version for answers
async function* streamAnswer(cleanQuestion, profile = {}, jobDescription = '', history = []) {
    const { name = 'the candidate', target_role = '', tech_stack = [], projects = '', years_experience = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : (tech_stack || '');
    const historyStr = history.map(h => `${h.role === 'user' ? 'Question' : 'Answer'}: ${h.text}`).join('\n\n');

    const prompt = `LAYER 1: SYSTEM ROLE
You are a senior staff-level interview coach. Generate an expert-level answer in MARKDOWN.

LAYER 2: CONTEXT
CANDIDATE: ${name}
ROLE: ${target_role}
TECH: ${skillsStr}
HISTORY: ${historyStr || 'None'}
QUESTION: "${cleanQuestion}"

LAYER 3: OUTPUT RULES
1. SILENT REASONING: Analyze silently before answering.
2. HALLUCINATION PROTECTION: Do not invent fake metrics.
3. STYLE: First person, professional, senior engineer tone.
4. CONTENT: Include one real example and one trade-off.

ANSWER:`;

    const model = getClient().getGenerativeModel({
        model: MODEL,
        generationConfig: {
            temperature: 0.4,
            topP: 0.9,
            topK: 40
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
