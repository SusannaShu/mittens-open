/**
 * usePendantBridge -- Bridges pendant events into the existing chat/pipeline system.
 *
 * Mounted at the app root (_layout.tsx) so it runs regardless of active tab.
 *
 * IMPORTANT: All pendant imports are lazy (inside useEffect) to avoid
 * crashing the app if native modules (BLE, TCP) fail to initialize.
 * This ensures the app always boots even if pendant code has issues.
 */

import { useEffect, useRef } from 'react';

interface PendantBridgeOptions {
  addMessage?: (msg: any) => void;
  scrollToEnd?: () => void;
}

export function usePendantBridge(options?: PendantBridgeOptions) {
  const processingRef = useRef(false);

  useEffect(() => {
    let unsubDoubleTap: (() => void) | undefined;
    let unsubSingleTap: (() => void) | undefined;
    let unsubMotion: (() => void) | undefined;

    // Fully lazy initialization -- all imports happen inside this async block
    const init = async () => {
      try {
        // Lazy imports to avoid crash on app boot
        const { getPendantService } = require('../../services/pendant/pendantService');
        const { getBrain } = require('../../brain/selector');
        const { speak } = require('../../services/ai/voiceService');

        const service = getPendantService();

        // Initialize pendant service (starts HTTP server, loads saved device)
        await service.initialize();
        console.log('[PendantBridge] Initialized');

        // Expose test function globally for dev console
        if (__DEV__) {
          (global as any).testPendantTap = () => service.simulateDoubleTap(5000);
          console.log('[PendantBridge] Call global.testPendantTap() to simulate');
        }

        // Initialize pendant store (lazy)
        const pendantStore = require('../../services/pendant/pendantStore');
        await pendantStore.initPendantStore();

        // ─── Double Tap: Audio + optional frame -> Brain -> TTS ───
        unsubDoubleTap = service.onDoubleTap(async (audioPath: string, framePath?: string) => {
          if (processingRef.current) {
            console.log('[PendantBridge] Already processing, skipping');
            return;
          }
          processingRef.current = true;

          console.log('[PendantBridge] Double-tap received, audio:', audioPath.slice(-30));

          // Check if there's a pending mittensAsk -- route response to ask resolver
          try {
            const { hasPendingAsk, resolveAsk } = require('../../services/ambient/mittensAsk');
            if (hasPendingAsk()) {
              console.log('[PendantBridge] Pending ask detected -- routing to resolveAsk');
              // Transcribe the response
              const { transcribeAudioFile } = require('../../services/ai/voiceService');
              const transcript = await transcribeAudioFile(audioPath);
              if (transcript) {
                resolveAsk(transcript);
              }
              processingRef.current = false;
              return;
            }
          } catch { /* mittensAsk not loaded */ }

          // Save to pendant store for UI display
          const captureId = pendantStore.addCapture({
            type: 'DOUBLE_TAP' as const,
            timestamp: Date.now(),
            framePath,
            audioPath,
          });

          try {
            if (options?.addMessage) {
              options.addMessage({
                id: `pendant-${Date.now()}`,
                role: 'user',
                text: '[Pendant] Voice message',
                audio: audioPath,
                timestamp: new Date(),
                source: 'pendant',
              });
              options.scrollToEnd?.();
            }

            const brain = await getBrain();
            let responseText: string;

            if (brain.supportsAudio && audioPath) {
              // Gemini 4 E2B / E4B -- native audio understanding, no STT needed
              const prompt = [
                'The user tapped their Mittens pendant and spoke this voice message.',
                'Listen to the audio and respond naturally and concisely.',
                'Be helpful, warm, and direct. Keep your response short (1-2 sentences).',
                framePath ? 'A photo was also captured -- consider what you see.' : '',
              ].filter(Boolean).join(' ');

              console.log('[PendantBridge] Using native audio brain:', brain.name);
              responseText = await brain.audio(prompt, audioPath);
            } else if (audioPath) {
              // Transcribe the audio using iOS/Android native STT fallback
              console.log('[PendantBridge] Brain lacks native audio, transcribing via voiceService...');
              const { transcribeAudioFile } = require('../../services/ai/voiceService');
              const transcript = await transcribeAudioFile(audioPath);
              console.log('[PendantBridge] Transcript:', transcript);

              if (!transcript && !framePath) {
                throw new Error('Could not hear anything and no photo was captured.');
              }

              const prompt = [
                transcript ? `The user tapped their pendant and said: "${transcript}"` : 'The user tapped their pendant but no speech was clearly heard.',
                framePath && brain.supportsVision ? 'A photo was also captured, consider it in your response.' : '',
                'Respond naturally, warmly, and concisely (1-2 sentences).',
              ].filter(Boolean).join(' ');

              if (framePath && brain.supportsVision) {
                console.log('[PendantBridge] Using vision + transcribed text:', brain.name);
                responseText = await brain.vision(prompt, [framePath]);
              } else {
                console.log('[PendantBridge] Using text-only brain:', brain.name);
                responseText = await brain.text(prompt);
              }
            } else if (framePath && brain.supportsVision) {
              // Vision-only fallback (no audio at all)
              const prompt = [
                'The user tapped their Mittens pendant.',
                'A photo was captured -- describe what you see and provide helpful context.',
                'Be warm and concise (1-2 sentences).',
              ].join(' ');

              console.log('[PendantBridge] Using vision-only brain:', brain.name);
              responseText = await brain.vision(prompt, [framePath]);
            } else {
              // Text-only fallback
              responseText = 'I received your pendant capture but my current brain lacks vision and audio capabilities.';
              console.log('[PendantBridge] No audio/vision capabilities');
            }

            console.log('[PendantBridge] Response:', responseText?.slice(0, 80));

            // Update pendant store with brain response
            pendantStore.updateCapture(captureId, {
              brainResponse: responseText,
              processed: true,
            });

            if (options?.addMessage) {
              options.addMessage({
                id: `m-${Date.now()}`,
                role: 'mittens',
                text: responseText,
                timestamp: new Date(),
                source: 'pendant',
              });
              options.scrollToEnd?.();
            }

            if (responseText) {
              speak(responseText);
            }

            // Save to DB (non-blocking)
            try {
              const { getDataProvider } = require('../../providers/providerFactory');
              const dataProvider = await getDataProvider();
              await dataProvider.saveMessage({
                role: 'user',
                text: '[Pendant] Voice message',
                metadata: { source: 'pendant', audioPath },
              });
              await dataProvider.saveMessage({
                role: 'mittens',
                text: responseText,
                metadata: { source: 'pendant' },
              });
            } catch {
              // DB save failure is non-blocking
            }

          } catch (err: any) {
            console.error('[PendantBridge] Processing failed:', err?.message || err);
            // Mark as processed even on failure so UI doesn't show "Pending..." forever
            pendantStore.updateCapture(captureId, { processed: true });
            try { speak("Sorry, I couldn't process that. Try again."); } catch {}
          } finally {
            processingRef.current = false;
          }
        });

        // ─── Single Tap ───
        unsubSingleTap = service.onSingleTap(() => {
          console.log('[PendantBridge] Single-tap: confirm');
        });

        // ─── Motion Frame ───
        unsubMotion = service.onMotionFrame(async (framePath: string) => {
          console.log('[PendantBridge] Motion frame:', framePath.slice(-30));

          // Update wear detector
          try {
            const { onFrameReceived } = require('../../services/ambient/wearDetector');
            onFrameReceived();
          } catch { /* wearDetector not loaded */ }

          // Save to pendant store for UI display
          pendantStore.addCapture({
            type: 'MOTION' as const,
            timestamp: Date.now(),
            framePath,
          });

          // Route through ambient intelligence pipeline
          try {
            const { getSceneStreamManager } = require('../../services/ambient/sceneStreamManager');
            const manager = getSceneStreamManager();
            manager.onPendantFrame(framePath, Date.now());
          } catch (err: any) {
            console.warn('[PendantBridge] Ambient pipeline error (non-blocking):', err?.message);
          }
        });

      } catch (err: any) {
        // If anything in pendant init fails, the app still works fine
        console.warn('[PendantBridge] Init failed (non-blocking):', err?.message || err);
      }
    };

    init();

    return () => {
      unsubDoubleTap?.();
      unsubSingleTap?.();
      unsubMotion?.();
    };
  }, []);
}
