/**
 * ambientPipeline.test.ts -- Unit tests for ambient intelligence modules.
 *
 * Tests each module in isolation with mocked dependencies.
 * Run via: npx jest mittens_pendant/testing/ambientPipeline.test.ts
 *
 * NOTE: These tests run in Node.js, not React Native.
 * Modules that require('../../database') or TTS are mocked.
 */

// ═══════════════════════════════════════
// SCENE LIFECYCLE TESTS
// ═══════════════════════════════════════

describe('Scene lifecycle', () => {
  const { openScene, extendScene, closeScene, matchesScene, isTimedOut } =
    require('../../lib/services/ambient/scene');

  const mockClassification = (type: string, subPhase: string, confidence = 0.8) => ({
    sceneType: type,
    subPhase,
    items: [],
    confidence,
  });

  test('openScene creates scene with correct type', () => {
    const c = mockClassification('meal_prep', 'prep');
    const scene = openScene(c, 'kitchen');
    expect(scene.type).toBe('meal_prep');
    expect(scene.subPhase).toBe('prep');
    expect(scene.place).toBe('kitchen');
    expect(scene.frameCount).toBe(0);
    expect(scene.pantryDeltas).toEqual([]);
    expect(scene.closedAt).toBeUndefined();
  });

  test('extendScene increments frame count', () => {
    const c = mockClassification('work', 'active');
    const scene = openScene(c);
    extendScene(scene, c, '/path/frame1.jpg');
    expect(scene.frameCount).toBe(1);
    expect(scene.framePaths).toContain('/path/frame1.jpg');
    extendScene(scene, c, '/path/frame2.jpg');
    expect(scene.frameCount).toBe(2);
  });

  test('closeScene sets closedAt and reason', () => {
    const c = mockClassification('exercise', 'active');
    const scene = openScene(c);
    closeScene(scene, 'timeout');
    expect(scene.closedAt).toBeDefined();
    expect(scene.closeReason).toBe('timeout');
  });

  test('matchesScene returns true for same type', () => {
    const c = mockClassification('work', 'active');
    const scene = openScene(c);
    expect(matchesScene(scene, c)).toBe(true);
  });

  test('matchesScene returns false for different type', () => {
    const c1 = mockClassification('work', 'active');
    const c2 = mockClassification('meal_prep', 'prep');
    const scene = openScene(c1);
    expect(matchesScene(scene, c2)).toBe(false);
  });

  test('isTimedOut returns true after 30 minutes', () => {
    const c = mockClassification('work', 'active');
    const scene = openScene(c);
    // Fake the openedAt to 31 minutes ago
    scene.lastActiveAt = Date.now() - 31 * 60 * 1000;
    expect(isTimedOut(scene, Date.now())).toBe(true);
  });

  test('isTimedOut returns false within 30 minutes', () => {
    const c = mockClassification('work', 'active');
    const scene = openScene(c);
    expect(isTimedOut(scene, Date.now())).toBe(false);
  });
});

// ═══════════════════════════════════════
// MEMORY TESTS
// ═══════════════════════════════════════

describe('Memory (session tier)', () => {
  const {
    addSessionNote,
    getSessionNotes,
    retrieveMemory,
    learnFromResponse,
  } = require('../../lib/services/ambient/memoryUpsert');

  test('addSessionNote stores and retrieves by keyword', () => {
    addSessionNote('kefir', 'Susanna always drinks kefir not yogurt', 'user');
    const notes = getSessionNotes('kefir');
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].note).toContain('kefir');
  });

  test('retrieveMemory returns tier 1 for session notes', () => {
    addSessionNote('breakfast', 'Usually has kefir and nuts', 'user');
    const result = retrieveMemory('breakfast');
    expect(result).not.toBeNull();
    expect(result?.tier).toBe(1);
  });

  test('retrieveMemory returns null for unknown keyword', () => {
    const result = retrieveMemory('xyzzy_nonexistent_item');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════
// MITTENS ASK TESTS
// ═══════════════════════════════════════

describe('MittensAsk', () => {
  const {
    hasPendingAsk,
    cancelAsk,
    getPendingQuestion,
  } = require('../../lib/services/ambient/mittensAsk');

  test('no pending ask initially', () => {
    expect(hasPendingAsk()).toBe(false);
    expect(getPendingQuestion()).toBeNull();
  });

  test('cancelAsk is safe when nothing pending', () => {
    expect(() => cancelAsk()).not.toThrow();
  });
});

// ═══════════════════════════════════════
// CAPTURE GATE TESTS
// ═══════════════════════════════════════

describe('CaptureGate', () => {
  const { getCaptureGate } = require('../../lib/services/ambient/captureGate');

  test('starts in passive mode', () => {
    const gate = getCaptureGate();
    expect(gate.getMode()).toBe('passive');
  });

  test('consumeGpsTag returns null when no tag set', () => {
    const gate = getCaptureGate();
    expect(gate.consumeGpsTag()).toBeNull();
  });

  test('setGpsTag and consumeGpsTag work together', () => {
    const gate = getCaptureGate();
    gate.setGpsTag(40.7128, -74.0060);
    const tag = gate.consumeGpsTag();
    expect(tag).not.toBeNull();
    expect(tag?.lat).toBeCloseTo(40.7128);
    expect(tag?.lon).toBeCloseTo(-74.0060);
    // Second consume should return null (consumed)
    expect(gate.consumeGpsTag()).toBeNull();
  });
});

// ═══════════════════════════════════════
// NUDGE COMPOSER TESTS
// ═══════════════════════════════════════

describe('NudgeComposer', () => {
  const {
    resetNudgeCooldown,
  } = require('../../lib/services/ambient/nudgeComposer');

  test('resetNudgeCooldown does not throw', () => {
    expect(() => resetNudgeCooldown()).not.toThrow();
  });
});

// ═══════════════════════════════════════
// WEAR DETECTOR TESTS
// ═══════════════════════════════════════

describe('WearDetector', () => {
  const {
    getWearStatus,
    onBleStatusChange,
    onFrameReceived,
    isPendantConnected,
    timeSinceLastFrame,
  } = require('../../lib/services/ambient/wearDetector');

  test('initially returns off', () => {
    onBleStatusChange(false);
    expect(getWearStatus()).toBe('off');
    expect(isPendantConnected()).toBe(false);
  });

  test('connected without frames returns connected', () => {
    onBleStatusChange(true);
    // No frames received yet -- should be connected but not worn
    expect(getWearStatus()).toBe('connected');
  });

  test('connected with recent frame returns worn', () => {
    onBleStatusChange(true);
    onFrameReceived();
    expect(getWearStatus()).toBe('worn');
    expect(timeSinceLastFrame()).toBeLessThan(1000);
  });

  test('disconnected after frames returns off', () => {
    onBleStatusChange(true);
    onFrameReceived();
    onBleStatusChange(false);
    expect(getWearStatus()).toBe('off');
  });
});

// ═══════════════════════════════════════
// TYPES SANITY
// ═══════════════════════════════════════

describe('Types', () => {
  test('types module exports without errors', () => {
    expect(() => require('../../lib/services/ambient/types')).not.toThrow();
  });
});
