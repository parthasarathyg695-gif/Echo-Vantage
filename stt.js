'use strict';
const WebSocket = require('ws');

function initSTT(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', async (ws) => {
        console.log('🎙  Gateway: Client connected');

        let geminiWs = null;
        let isSetup = false;

        const API_KEY = process.env.GEMINI_API_KEY;
        // v1alpha with snake_case proto fields
        const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

        function connectToGemini() {
            console.log('🔗  Gemini Live: Connecting to API...');
            geminiWs = new WebSocket(GEMINI_URL);

            geminiWs.on('open', () => {
                console.log('🚀  Gemini Live: Connection established');

                // Native audio model REQUIRES audio output — we only use inputTranscription
                const setupMessage = {
                    setup: {
                        model: "models/gemini-2.5-flash-native-audio-latest",
                        generation_config: {
                            response_modalities: ["AUDIO"],
                            speech_config: {
                                voice_config: {
                                    prebuilt_voice_config: {
                                        voice_name: "Puck"
                                    }
                                }
                            }
                        },
                        system_instruction: {
                            parts: [{
                                text: "You are a professional transcription engine focused ONLY on English. Do NOT respond or speak. Just listen and transcribe the audio accurately into English text. Even if you hear technical terms like 'computer vision', transcribe them correctly in English."
                            }]
                        },
                        input_audio_transcription: {}
                    }
                };

                console.log('📤  Sending setup:', JSON.stringify(setupMessage));
                geminiWs.send(JSON.stringify(setupMessage));
            });

            geminiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());

                    if (response.setupComplete) {
                        console.log('✅  Gemini Live: Setup complete');
                        isSetup = true;
                        ws.send(JSON.stringify({ type: 'ready' }));
                        return;
                    }

                    // IGNORE modelTurn text/audio — we only care about inputTranscription
                    // The actual answers come from the separate Gemini text model (gemini.js)

                    // Input transcription
                    if (response.serverContent?.inputTranscription?.text) {
                        ws.send(JSON.stringify({
                            type: 'transcript',
                            text: response.serverContent.inputTranscription.text,
                            isFinal: !response.serverContent.inputTranscription.unstable,
                            source: 'interviewer'
                        }));
                    }

                    if (response.serverContent?.turnComplete) {
                        ws.send(JSON.stringify({ type: 'turn_complete' }));
                    }

                } catch (err) {
                    console.error('❌  Gemini Msg Parse Error:', err.message);
                }
            });

            geminiWs.on('error', (err) => {
                console.error('❌  Gemini Live Error:', err.message);
                ws.send(JSON.stringify({ type: 'error', error: err.message }));
            });

            geminiWs.on('close', (code, reason) => {
                console.log(`🔌  Gemini Live: Connection closed. Code: ${code}, Reason: ${reason || 'No reason'}`);
                isSetup = false;
                geminiWs = null;

                if (code !== 1000) {
                    console.log('🔄  Gemini Live: Attempting to reconnect in 2s...');
                    setTimeout(() => {
                        if (!geminiWs) connectToGemini();
                    }, 2000);
                }
            });
        }

        ws.on('message', (message) => {
            if (Buffer.isBuffer(message)) {
                if (geminiWs && geminiWs.readyState === WebSocket.OPEN && isSetup) {
                    const audioFrame = {
                        realtime_input: {
                            media_chunks: [{
                                mime_type: "audio/pcm;rate=16000",
                                data: message.toString('base64')
                            }]
                        }
                    };
                    geminiWs.send(JSON.stringify(audioFrame));
                }
            } else {
                try {
                    const data = JSON.parse(message.toString());
                    if (data.type === 'start') {
                        if (!geminiWs) connectToGemini();
                    }
                    if (data.type === 'stop') {
                        if (geminiWs) {
                            geminiWs.close(1000);
                            geminiWs = null;
                        }
                    }
                } catch (e) { /* ignore non-JSON */ }
            }
        });

        ws.on('close', () => {
            console.log('🎙  Gateway: Client disconnected');
            if (geminiWs) {
                geminiWs.close(1000);
                geminiWs = null;
            }
        });

        connectToGemini();
    });
}

module.exports = { initSTT };
