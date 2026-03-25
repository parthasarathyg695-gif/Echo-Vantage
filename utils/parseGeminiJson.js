'use strict';

/**
 * Parses Gemini output as JSON with retry logic.
 *
 * Strategy:
 * 1. Strip markdown code fences
 * 2. JSON.parse
 * 3. If fail → re-prompt Gemini "Return ONLY valid JSON"
 * 4. Retry up to 2 times total, then throw GeminiParseError
 */

class GeminiParseError extends Error {
    constructor(message, raw) {
        super(message);
        this.name = 'GeminiParseError';
        this.raw = raw;
    }
}

function stripFences(text) {
    if (!text) return '';
    // Try to extract the first full { ... } or [ ... ] block to ignore conversational filler
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
        return jsonMatch[0];
    }
    return text.trim();
}

async function parseGeminiJson(rawText, repromptFn, attempt = 0) {
    const MAX_RETRIES = 2;

    const cleaned = stripFences(rawText);

    try {
        return { parsed: JSON.parse(cleaned), raw: rawText };
    } catch (_) {
        if (attempt >= MAX_RETRIES) {
            throw new GeminiParseError(
                `Gemini returned invalid JSON after ${MAX_RETRIES + 1} attempts`,
                rawText
            );
        }

        console.warn(`⚠️  JSON parse failed (attempt ${attempt + 1}), retrying Gemini...`);

        // Re-prompt Gemini
        const retryRaw = await repromptFn(
            'Your previous response contained invalid JSON. Return ONLY valid JSON. No explanation. No markdown. No comments. Just the JSON object.'
        );

        return parseGeminiJson(retryRaw, repromptFn, attempt + 1);
    }
}

module.exports = { parseGeminiJson, stripFences, GeminiParseError };
