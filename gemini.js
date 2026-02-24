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
async function callGemini(promptParts) {
    const model = getClient().getGenerativeModel({ model: MODEL });
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

// Streaming version for answers
async function* streamAnswer(cleanQuestion, profile = {}, jobDescription = '') {
    const { name = 'the candidate', target_role = '', tech_stack = [], projects = '', years_experience = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : (tech_stack || '');
    const roleContext = jobDescription
        ? `targeting a role described in the JD below`
        : (target_role ? `targeting a ${target_role} role` : '');

    const prompt = `You are a world-class interview coach generating an expert-level answer for ${name}${roleContext ? `, ${roleContext}` : ''}${years_experience ? ` with ${years_experience} years of experience` : ''}.

CANDIDATE: ${name}
${target_role ? `PROFILE ROLE: ${target_role}` : ''}
EXPERIENCE: ${years_experience || 'Not specified'} years
TECH STACK: ${skillsStr || 'Not specified'}
PROJECTS: ${projects || 'Not specified'}
${jobDescription ? `\nJOB DESCRIPTION:\n${jobDescription}\n` : ''}

QUESTION: "${cleanQuestion}"

Generate an EXPERT-LEVEL answer in **MARKDOWN FORMAT**. Use:
- **Bold** for key terms
- Bullet points and numbered lists
- \`inline code\` for technical terms
- Fenced code blocks (\`\`\`language) for code examples
- 10-20 sentences, written in FIRST PERSON ("I", "my", "I've built")
- Sound like a confident senior engineer — NOT a textbook
- Include specific real-world examples and trade-offs
- For coding questions: include full working code in fenced code blocks

ANSWER:`;

    const model = getClient().getGenerativeModel({ model: MODEL });
    const result = await model.generateContentStream(prompt);

    for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        yield chunkText;
    }
}

// ── Clean Question ───────────────────────────────────────────────────────────
async function cleanQuestion(transcript, profile = {}) {
    const { target_role = '', tech_stack = [], projects = '' } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : tech_stack;

    const prompt = `Return ONLY valid JSON. No explanation. No markdown. No comments. ONLY JSON.

If the transcript is just a fragment, noise, or a previous question repeated, return:
{"incomplete": true}

Otherwise, identify the interview question and rewrite it to be clean and professional.

CONTEXT (Use this to CORRECT misheard technical terms):
- ROLE: ${target_role}
- EXPECTED TECH: ${skillsStr}
- PROJECTS: ${projects}

SPECIFIC CORRECTIONS:
- "Gauze in blur" or "Gosh in blur" -> "Gaussian blur"
- "Lider" or "Lighter" -> "LIDAR"
- "Slam" -> "SLAM"
- "Roads" -> "ROS" (if context is technical)
- "Slacking" or "Lang Lang Qin" -> "LangChain"

STRATEGY:
- If a word sounds like a technical term from the CONTEXT or CV/AD domain but is slightly wrong, CORRECT it.
- If it's a "What is the difference" type question, ensure both concepts are clear.
- Remove filler words and conversational noise.

Transcript: ${transcript}

Return EXACTLY this shape:
{"clean_question": "string"}`;

    return callGemini(prompt);
}

// ── Generate Answer ──────────────────────────────────────────────────────────
async function generateAnswer(cleanQuestion, profile = {}, jobDescription = '') {
    const { name = 'the candidate', target_role = '', tech_stack = [], projects = '', years_experience = '', skills = null } = profile;
    const skillsStr = Array.isArray(tech_stack) ? tech_stack.join(', ') : (tech_stack || '');
    const skillsDetail = skills ? JSON.stringify(skills) : '';
    // Use target_role from profile as fallback, but JD is the primary source
    const roleContext = jobDescription
        ? `targeting a role described in the JD below`
        : (target_role ? `targeting a ${target_role} role` : '');

    const prompt = `Return ONLY valid JSON. No markdown. No code fences. No comments. ONLY raw JSON.

You are a world-class interview coach generating a spoken answer for ${name}${roleContext ? `, ${roleContext}` : ''}${years_experience ? ` with ${years_experience} years of experience` : ''}.

━━━ CONTEXT ━━━
CANDIDATE: ${name}
${target_role ? `PROFILE ROLE: ${target_role}` : ''}
EXPERIENCE: ${years_experience || 'Not specified'} years
TECH STACK: ${skillsStr || 'Not specified'}
${skillsDetail ? `DETAILED SKILLS: ${skillsDetail}` : ''}
PROJECTS: ${projects || 'Not specified'}
${jobDescription ? `\n━━━ JOB DESCRIPTION (THE ROLE BEING INTERVIEWED FOR) ━━━\n${jobDescription}\n` : ''}
━━━ INTERVIEW QUESTION ━━━
"${cleanQuestion}"

━━━ INSTRUCTIONS ━━━

Generate an EXPERT-LEVEL answer that demonstrates deep mastery of the subject. This is not a surface-level response — it should sound like a Staff Engineer or Principal Engineer answering with years of battle-tested experience.

LENGTH: Be thorough. A great interview answer is 10-20 sentences. Do NOT cut corners. Cover the topic with real depth — multiple examples, edge cases, trade-offs, and production insights. The candidate needs to impress, not just answer.

ANSWER STRATEGY BY QUESTION TYPE:

1. **Behavioral questions** ("Tell me about...", "Describe a time...", "What's your experience with..."):
   - Use the STAR method naturally but go DEEP (Situation → Task → Action → Result)
   - Reference REAL projects and technologies from the candidate's profile
   - Include SPECIFIC metrics and outcomes ("reduced p99 latency from 800ms to 120ms", "scaled the service to handle 50K RPS", "cut deployment time by 70%")
   - Describe the TECHNICAL DECISIONS you made and WHY
   - Mention challenges you faced and how you overcame them
   - Show leadership: how you influenced the team, mentored others, drove alignment

2. **Technical questions** ("How does X work?", "What is Y?", "Explain Z"):
   - Start with a clear, precise explanation showing you understand the fundamentals
   - Then go deeper: internals, edge cases, common pitfalls
   - Add production insights: "In a system I built, I found that..."
   - Discuss trade-offs: "You could also use X, but Y is better when..."
   - Mention real-world failure scenarios you've handled
   - Reference how the candidate's own tech stack relates to the answer
   - Show you know both the theory AND the messy real-world implementation

3. **System design / Architecture questions**:
   - Clarify requirements and constraints first
   - Walk through your approach step by step: data model, APIs, storage, caching, scaling
   - Reference technologies from the candidate's stack with specific reasoning
   - Discuss trade-offs at each layer (consistency vs availability, latency vs throughput)
   - Mention monitoring, observability, and failure handling
   - Share relevant experience: "I've built something similar at..."

4. **"Tell me about yourself"**:
   - Strong opening: current role and what you're known for
   - 2-3 impressive achievements with specific impact
   - Technical philosophy and what drives you
   - Why this role excites you specifically
   - End with enthusiasm and forward momentum

5. **Coding questions** ("Write a function...", "Implement...", "How would you code...", "Solve this problem..."):
   - ALWAYS include working code in the appropriate language (Python, JavaScript, Java, C++, etc.)
   - If no language is specified, use the candidate's primary language from their tech stack, or Python as default
   - Write clean, production-quality code — not pseudo-code
   - Include comments explaining key logic
   - Discuss time and space complexity (Big O)
   - Mention edge cases and how your code handles them
   - If there are multiple approaches, mention the brute force first, then optimize
   - Explain your thought process: "First I'd think about...", "The key observation is..."

6. **DSA / Algorithm questions** ("Find the...", "Given an array...", "Binary tree..."):
   - Start by clarifying the problem and constraints
   - Walk through your approach step by step
   - Write the FULL working code — not fragments
   - Analyze time complexity (O notation) and space complexity
   - Discuss alternative approaches and why you chose this one
   - Mention edge cases: empty input, single element, duplicates, negative numbers

TONE & STYLE:
- First person ONLY ("I", "my", "I've built", "In my experience")
- Sound like a confident senior engineer in a real conversation — NOT a textbook
- Use natural transitions ("What made this particularly challenging was...", "The key insight I had was...", "One thing most people miss here is...")
- Be SPECIFIC — never say "several projects" when you can say "the real-time analytics pipeline I built at my last role"
- Show intellectual curiosity and engineering judgment
- Demonstrate you think about edge cases, failure modes, and production realities
- Weave in the candidate's actual skills and projects naturally throughout

DEPTH REQUIREMENTS:
- Every answer must include at least ONE specific real-world example from the candidate's experience
- Technical answers must mention at least ONE trade-off or alternative approach
- Include at least ONE insight that shows you've gone beyond the obvious answer
- For every claim, add a "because..." or "the reason is..." to show reasoning

BAD: "I have experience with microservices."
GOOD: "I migrated a monolithic Node.js application to a microservices architecture using Docker and Kubernetes. The biggest challenge was handling distributed transactions across services — I implemented the Saga pattern with an event-driven approach using Kafka, which reduced our data inconsistency incidents from roughly 15 per week to near zero. The trade-off was increased operational complexity, so I also set up comprehensive distributed tracing with Jaeger to make debugging cross-service issues manageable."

If the question is unintelligible, gibberish, or not a real question, return:
{"needs_clarification": true}

Otherwise return EXACTLY this JSON shape:
{
  "key_points": ["Deep insight 1", "Technical trade-off 2", "Production insight 3", "Advanced consideration 4"],
  "full_answer": "The complete expert-level answer in MARKDOWN FORMAT. Use bold for key terms, bullet points for lists, inline code for technical terms, fenced code blocks with language for code examples, numbered lists for steps. Must be 10-20 sentences, first person, natural and conversational. For coding questions include full working code in a fenced code block.",
  "short_version": "One powerful sentence — the headline answer.",
  "followup_topics": ["Likely follow-up 1", "Likely follow-up 2", "Deep-dive area 3"],
  "interviewer_intent": "What the interviewer is really testing"
}`;

    return callGemini(prompt);
}

// ── Shorten Answer ───────────────────────────────────────────────────────────
async function shortenAnswer(fullAnswer) {
    const prompt = `Return ONLY valid JSON. No explanation. No markdown. No comments. ONLY JSON.

Shorten the following interview answer to a 20–30 second spoken version.
Keep the core message. Remove examples if needed for brevity.

Return: {"short_version": ""}

ANSWER: ${fullAnswer}`;

    return callGemini(prompt);
}

// ── Add Personal Example ─────────────────────────────────────────────────────
async function addPersonalExample(fullAnswer, projects) {
    const prompt = `Return ONLY valid JSON. No explanation. No markdown. No comments. ONLY JSON.

Augment the following interview answer by weaving in a specific personal example from these projects: ${projects}

Keep the augmented answer natural, spoken-friendly, and under 2 minutes when read aloud.

Return: {"augmented_answer": ""}

ANSWER: ${fullAnswer}`;

    return callGemini(prompt);
}

// ── Extract Profile ────────────────────────────────────────────────────────
async function extractProfile(resumeText, jdText) {
    const prompt = `Return ONLY valid JSON. No explanation. No markdown. No comments. ONLY JSON.

You are an expert technical recruiter and resume parser.
I will provide you with a candidate's RESUME and a JOB DESCRIPTION (JD).
Your task is to merge this information to extract a definitive profile for the candidate tailored to this specific job.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}

Extract the following information and output EXACTLY this JSON shape:
{
  "name": "First Name Last Name",
  "target_role": "The job title they are applying for based on the JD",
  "years_exp": 5,
  "tech_stack": ["Skill 1", "Skill 2"],
  "projects": "A 2-3 sentence summary of their most impressive, relevant projects or achievements from the resume."
}`;

    return callGemini(prompt);
}

module.exports = { cleanQuestion, generateAnswer, shortenAnswer, addPersonalExample, extractProfile, streamAnswer };
