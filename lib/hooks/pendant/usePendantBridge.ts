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
    let unsubButtonPress: (() => void) | undefined;
    let unsubSingleTap: (() => void) | undefined;
    let unsubMotion: (() => void) | undefined;

    // Fully lazy initialization -- all imports happen inside this async block
    const init = async () => {
      try {
        // Lazy imports to avoid crash on app boot
        const { getPendantService } = require('../../services/pendant/pendantService');
        const { speak } = require('../../services/ai/voiceService');

        const service = getPendantService();

        // Initialize pendant service (starts HTTP server, loads saved device)
        await service.initialize();
        console.log('[PendantBridge] Initialized');

        // Expose test function globally for dev console
        if (__DEV__) {
          (global as any).testPendantTap = () => service.simulateButtonPress(5000);
          console.log('[PendantBridge] Call global.testPendantTap() to simulate');
        }

        // Initialize pendant store (lazy)
        const pendantStore = require('../../services/pendant/pendantStore');
        await pendantStore.initPendantStore();

        // Initialize Kokoro neural voice (non-blocking -- falls back to native TTS)
        try {
          const { initVoice } = require('../../services/ai/voiceService');
          initVoice();
        } catch { /* voice init is best-effort */ }

        // ─── Button Press: Audio + optional frame -> Brain -> TTS ───
        unsubButtonPress = service.onButtonPress(async (audioPath: string, framePath?: string) => {
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
            type: 'BUTTON_PRESS' as const,
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

            let responseText: string;

            // Transcribe audio if present (STT for non-native-audio brains)
            let transcript: string | null = null;
            if (audioPath) {
              try {
                const { transcribeAudioFile } = require('../../services/ai/voiceService');
                transcript = await transcribeAudioFile(audioPath);
                console.log('[PendantBridge] Transcript:', transcript);
              } catch (sttErr: any) {
                console.warn('[PendantBridge] STT failed:', sttErr?.message);
              }
            }

            if (!transcript && !framePath) {
              throw new Error('Could not hear anything and no photo was captured.');
            }

            // Two-stage brain triage: classify intent, load context, execute
            const { dispatchVoice } = require('../../services/ambient/pendantVoiceDispatch');
            const result = await dispatchVoice(transcript, framePath, audioPath);
            responseText = result.response;
            console.log(`[PendantBridge] Dispatch: ${result.intent}/${result.action}`);

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
            try { speak("Sorry, I couldn't process that. Try again."); } catch { }
          } finally {
            processingRef.current = false;
          }
        });

        // ─── Single Tap ───
        unsubSingleTap = service.onSingleTap(() => {
          console.log('[PendantBridge] Single-tap: confirm');
        });

        // ─── Motion Frame ───
        // Track framePath -> captureId so queued frames can update the store
        const frameCaptures = new Map<string, string>();

        unsubMotion = service.onMotionFrame(async (framePath: string) => {
          console.log('[PendantBridge] Motion frame:', framePath.slice(-30));

          // If we are actively processing a button press (voice), drop ambient vision frames
          // so they don't interrupt or conflict with the voice interaction.
          if (processingRef.current) {
            console.log('[PendantBridge] Voice interaction active. Dropping motion frame to prioritize voice.');
            return;
          }

          // Update wear detector
          try {
            const { onFrameReceived } = require('../../services/ambient/wearDetector');
            onFrameReceived();
          } catch { /* wearDetector not loaded */ }

          // Save to pendant store for UI display
          const captureId = pendantStore.addCapture({
            type: 'MOTION' as const,
            timestamp: Date.now(),
            framePath,
          });

          // Track mapping so queue drain can update the correct capture
          frameCaptures.set(framePath, captureId);

          // Callback for queued frames: updates pendantStore when they finish
          const onQueueResult = (queuedFramePath: string, queuedResult: { summary: string, log?: any }) => {
            const queuedCaptureId = frameCaptures.get(queuedFramePath);
            if (!queuedCaptureId) return;
            frameCaptures.delete(queuedFramePath);

            if (queuedResult.summary.toLowerCase().includes('skipped')) {
              pendantStore.removeCapture(queuedCaptureId);
            } else if (queuedResult.summary.startsWith('Brain offline:')) {
              // Brain not connected -- keep the capture, show the error
              pendantStore.updateCapture(queuedCaptureId, {
                processed: true,
                brainResponse: queuedResult.summary,
                pipelineLog: queuedResult.log,
              });
            } else {
              pendantStore.updateCapture(queuedCaptureId, {
                processed: true,
                brainResponse: queuedResult.summary,
                pipelineLog: queuedResult.log,
              });
            }
          };

          // Route through ambient intelligence pipeline
          try {
            const { getSceneStreamManager } = require('../../services/ambient/sceneStreamManager');
            const manager = getSceneStreamManager();
            const result = await manager.onPendantFrame(framePath, Date.now(), onQueueResult);

            if (result) {
              // Clean up the mapping for the directly-processed frame
              frameCaptures.delete(framePath);

              if (result.summary.toLowerCase().includes('skipped')) {
                pendantStore.removeCapture(captureId);
              } else if (result.summary.startsWith('Brain offline:')) {
                // Brain not connected -- keep the capture, show the error
                pendantStore.updateCapture(captureId, {
                  processed: true,
                  brainResponse: result.summary,
                  pipelineLog: result.log,
                });
              } else if (result.summary === 'Queued for processing...') {
                // Frame was queued -- leave it as unprocessed, callback will handle it
                // Do NOT mark processed: true here
              } else {
                pendantStore.updateCapture(captureId, {
                  processed: true,
                  brainResponse: result.summary,
                  pipelineLog: result.log,
                });
              }
            }
          } catch (err: any) {
            console.warn('[PendantBridge] Ambient pipeline error (non-blocking):', err?.message);
            frameCaptures.delete(framePath);
            pendantStore.updateCapture(captureId, {
              processed: true,
              brainResponse: `Pipeline Error: ${err?.message}`,
            });
          }
        });

      } catch (err: any) {
        // If anything in pendant init fails, the app still works fine
        console.warn('[PendantBridge] Init failed (non-blocking):', err?.message || err);
      }
    };

    init();

    return () => {
      unsubButtonPress?.();
      unsubSingleTap?.();
      unsubMotion?.();
    };
  }, []);
}
