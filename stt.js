'use strict';
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');

function initSTT(server) {
    const wss = new WebSocket.Server({ server });
    const speechClient = new speech.SpeechClient();

    wss.on('connection', (ws) => {
        console.log('🎙  Gateway: Client connected');
        let recognizeStream = null;
        let isClientConnected = true;
        let isStarting = false; // Race condition guard

        function startStream() {
            // Guard: prevent double-start from concurrent error+end events
            if (!isClientConnected || isStarting || recognizeStream) return;
            isStarting = true;

            console.log('☁️  Google Cloud STT: Starting stream...');

            const request = {
                config: {
                    encoding: 'LINEAR16',
                    sampleRateHertz: 16000,
                    languageCode: 'en-US',
                    // ta-IN removed — corrupts phoneme mapping for English
                    // model: 'latest_short' is for voice commands. 'latest_long' is for conversational interviews.
                    model: 'latest_long',
                    useEnhanced: true,
                    enableAutomaticPunctuation: true,
                    maxAlternatives: 1,
                    profanityFilter: false, // technical terms sometimes blocked
                    speechContexts: [{
                        phrases: [
                            'AI', 'A.I.', 'A I', 'artificial intelligence',
                            'AI agent', 'A.I. agent', 'AI agents',
                            'LLM', 'large language model',
                            'RAG', 'retrieval augmented generation',
                            'vector database', 'vector store',
                            'embeddings', 'embedding model',
                            'transformer', 'attention mechanism',
                            'fine-tuning', 'fine tune',
                            'neural network', 'machine learning', 'deep learning',
                            'API', 'REST API', 'microservices',
                            'Kubernetes', 'Docker', 'containerization',
                            'what is', 'explain', 'how does', 'describe',
                        ],
                        boost: 30
                    }],
                },
                interimResults: true,
            };

            recognizeStream = speechClient
                .streamingRecognize(request)
                .on('error', (err) => {
                    console.error('❌  GCloud STT Error:', err.message);
                    recognizeStream = null;
                    isStarting = false;
                    if (isClientConnected) {
                        setTimeout(startStream, 500);
                    }
                })
                .on('data', data => {
                    const result = data.results[0];
                    if (result && result.alternatives[0]) {
                        ws.send(JSON.stringify({
                            type: 'transcript',
                            text: result.alternatives[0].transcript,
                            isFinal: result.isFinal,
                            source: 'interviewer',
                            confidence: result.alternatives[0].confidence || null
                        }));

                        if (result.isFinal) {
                            ws.send(JSON.stringify({ type: 'turn_complete' }));
                        }
                    }
                })
                .on('end', () => {
                    console.log('♻  GCloud STT: Stream ended. Rebooting...');
                    recognizeStream = null;
                    isStarting = false; // Reset so next startStream() can proceed
                    if (isClientConnected) {
                        startStream();
                    }
                });

            isStarting = false; // Stream assigned, clear flag
        }

        startStream();

        ws.on('message', (message) => {
            if (Buffer.isBuffer(message)) {
                if (recognizeStream && recognizeStream.writable) {
                    try {
                        recognizeStream.write(message);
                    } catch(e) {}
                }
            } else {
                try {
                    const data = JSON.parse(message.toString());
                    if (data.type === 'start') {
                        if (!recognizeStream) startStream();
                    }
                    if (data.type === 'stop') {
                        isClientConnected = false;
                        if (recognizeStream) {
                            recognizeStream.end();
                            recognizeStream = null;
                        }
                    }
                } catch (e) {}
            }
        });

        ws.on('close', () => {
            console.log('🎙  Gateway: Client disconnected');
            isClientConnected = false;
            if (recognizeStream) {
                recognizeStream.end();
                recognizeStream = null;
            }
        });
    });
}

module.exports = { initSTT };
