/**
 * ModelBenchmarkModal -- Debug & benchmark the on-device LiteRT-LM engine.
 *
 * Features:
 * - Download status & re-download
 * - Load with CPU or GPU backend
 * - Text inference benchmark
 * - Vision inference benchmark (pick photo)
 * - Detailed timing & result display
 */

import { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  Modal, SafeAreaView, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LocalInferenceService } from '../../lib/services/ai/localInference';
import { resizeForVision } from '../../lib/imageUtils';
import { colors, radius, spacing } from '../../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface TestResult {
  label: string;
  status: 'idle' | 'running' | 'pass' | 'fail';
  timeMs?: number;
  output?: string;
  error?: string;
}

export function ModelBenchmarkModal({ visible, onClose }: Props) {
  const [modelStatus, setModelStatus] = useState<string>('Checking...');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [selectedBackend, setSelectedBackend] = useState<'cpu' | 'gpu' | 'mixed'>('cpu');
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const addResult = (r: TestResult) => {
    setResults(prev => [...prev, r]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const updateLastResult = (update: Partial<TestResult>) => {
    setResults(prev => {
      const copy = [...prev];
      if (copy.length > 0) copy[copy.length - 1] = { ...copy[copy.length - 1], ...update };
      return copy;
    });
  };

  // Check current state
  const checkStatus = async () => {
    const native = LocalInferenceService.isNativeAvailable();
    const downloaded = native ? await LocalInferenceService.isModelDownloaded() : false;
    const loaded = native ? LocalInferenceService.isModelLoaded() : false;
    const loadTime = native ? LocalInferenceService.getLoadTimeMs() : 0;

    if (!native) setModelStatus('Native module not available');
    else if (!downloaded) setModelStatus('Model not downloaded');
    else if (!loaded) setModelStatus(`Downloaded, not loaded`);
    else setModelStatus(`Loaded (${loadTime}ms load time)`);
  };

  // Download model
  const handleDownload = async () => {
    setDownloadProgress(0);
    addResult({ label: 'Download', status: 'running' });
    const start = Date.now();
    try {
      await LocalInferenceService.downloadModel('gemma-local', (p) => setDownloadProgress(p));
      const ms = Date.now() - start;
      updateLastResult({ status: 'pass', timeMs: ms, output: `2.58 GB in ${(ms / 1000).toFixed(1)}s` });
    } catch (e: any) {
      updateLastResult({ status: 'fail', error: e?.message });
    }
    setDownloadProgress(null);
    await checkStatus();
  };

  // Load model with selected backend
  const handleLoad = async () => {
    addResult({ label: `Load (${selectedBackend})`, status: 'running' });
    const start = Date.now();
    try {
      // Unload first if already loaded
      if (LocalInferenceService.isModelLoaded()) {
        LocalInferenceService.unloadModel();
      }
      await LocalInferenceService.loadModel('gemma-local', selectedBackend);
      const ms = Date.now() - start;
      updateLastResult({ status: 'pass', timeMs: ms, output: `Engine ready (${selectedBackend})` });
    } catch (e: any) {
      const ms = Date.now() - start;
      updateLastResult({ status: 'fail', timeMs: ms, error: e?.message });
    }
    await checkStatus();
  };

  // Text benchmark
  const handleTextTest = async () => {
    if (!LocalInferenceService.isModelLoaded()) {
      addResult({ label: 'Text Test', status: 'fail', error: 'Model not loaded' });
      return;
    }
    addResult({ label: 'Text Test', status: 'running' });
    const start = Date.now();
    try {
      const result = await LocalInferenceService.generateLocalResponse(
        'Describe a healthy breakfast in one sentence.'
      );
      const ms = Date.now() - start;
      updateLastResult({ status: 'pass', timeMs: ms, output: result?.slice(0, 300) });
    } catch (e: any) {
      const ms = Date.now() - start;
      updateLastResult({ status: 'fail', timeMs: ms, error: e?.message });
    }
  };

  // Vision benchmark with original image
  const handleVisionTest = async (resize: boolean) => {
    if (!LocalInferenceService.isModelLoaded()) {
      addResult({ label: 'Vision Test', status: 'fail', error: 'Model not loaded' });
      return;
    }

    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (pick.canceled || !pick.assets?.[0]) return;

    const label = resize ? 'Vision (resized)' : 'Vision (original)';
    addResult({ label, status: 'running' });
    const start = Date.now();
    try {
      let imagePath = pick.assets[0].uri;
      if (resize) {
        imagePath = await resizeForVision(imagePath);
      }
      const result = await LocalInferenceService.generateWithImage(
        'Describe what you see in this image in one sentence.',
        imagePath,
      );
      const ms = Date.now() - start;
      updateLastResult({ status: 'pass', timeMs: ms, output: result?.slice(0, 300) });
    } catch (e: any) {
      const ms = Date.now() - start;
      updateLastResult({ status: 'fail', timeMs: ms, error: e?.message });
    }
  };

  // Run full benchmark suite
  const handleFullBenchmark = async () => {
    setRunning(true);
    setResults([]);
    await checkStatus();

    // 1. Check downloaded
    const downloaded = await LocalInferenceService.isModelDownloaded();
    if (!downloaded) {
      addResult({ label: 'Pre-check', status: 'fail', error: 'Model not downloaded' });
      setRunning(false);
      return;
    }

    // 2. Load with CPU
    addResult({ label: 'Load (cpu)', status: 'running' });
    let cpuLoadMs = 0;
    try {
      if (LocalInferenceService.isModelLoaded()) LocalInferenceService.unloadModel();
      const s = Date.now();
      await LocalInferenceService.loadModel('gemma-local', 'cpu');
      cpuLoadMs = Date.now() - s;
      updateLastResult({ status: 'pass', timeMs: cpuLoadMs, output: 'CPU engine ready' });
    } catch (e: any) {
      updateLastResult({ status: 'fail', error: e?.message });
    }

    // 3. Text test (CPU)
    if (LocalInferenceService.isModelLoaded()) {
      addResult({ label: 'Text (cpu)', status: 'running' });
      const s = Date.now();
      try {
        const r = await LocalInferenceService.generateLocalResponse('Say hello in 5 words.');
        updateLastResult({ status: 'pass', timeMs: Date.now() - s, output: r?.slice(0, 200) });
      } catch (e: any) {
        updateLastResult({ status: 'fail', timeMs: Date.now() - s, error: e?.message });
      }
      LocalInferenceService.unloadModel();
    }

    // 4. Load with GPU
    addResult({ label: 'Load (gpu)', status: 'running' });
    try {
      if (LocalInferenceService.isModelLoaded()) LocalInferenceService.unloadModel();
      const s = Date.now();
      await LocalInferenceService.loadModel('gemma-local', 'gpu');
      updateLastResult({ status: 'pass', timeMs: Date.now() - s, output: 'GPU engine ready' });
    } catch (e: any) {
      updateLastResult({ status: 'fail', error: e?.message });
    }

    // 5. Text test (GPU)
    if (LocalInferenceService.isModelLoaded()) {
      addResult({ label: 'Text (gpu)', status: 'running' });
      const s = Date.now();
      try {
        const r = await LocalInferenceService.generateLocalResponse('Say hello in 5 words.');
        updateLastResult({ status: 'pass', timeMs: Date.now() - s, output: r?.slice(0, 200) });
      } catch (e: any) {
        updateLastResult({ status: 'fail', timeMs: Date.now() - s, error: e?.message });
      }
      LocalInferenceService.unloadModel();
    }

    // 6. Load with Mixed (cpu/gpu/cpu — the original working config)
    addResult({ label: 'Load (mixed cpu/gpu/cpu)', status: 'running' });
    try {
      if (LocalInferenceService.isModelLoaded()) LocalInferenceService.unloadModel();
      const s = Date.now();
      await LocalInferenceService.loadModel('gemma-local', 'mixed');
      updateLastResult({ status: 'pass', timeMs: Date.now() - s, output: 'Mixed engine ready' });
    } catch (e: any) {
      updateLastResult({ status: 'fail', error: e?.message });
    }

    // 7. Text test (Mixed)
    if (LocalInferenceService.isModelLoaded()) {
      addResult({ label: 'Text (mixed)', status: 'running' });
      const s = Date.now();
      try {
        const r = await LocalInferenceService.generateLocalResponse('Say hello in 5 words.');
        updateLastResult({ status: 'pass', timeMs: Date.now() - s, output: r?.slice(0, 200) });
      } catch (e: any) {
        updateLastResult({ status: 'fail', timeMs: Date.now() - s, error: e?.message });
      }
    }

    // 8. Vision test -- manual only
    addResult({ label: 'Vision', status: 'idle', output: 'Use manual button to test with photo' });

    setRunning(false);
    await checkStatus();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>Model Benchmark</Text>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* Status Card */}
          <View style={cardStyle}>
            <Text style={sectionTitle}>Status</Text>
            <Text style={{ fontSize: 13, color: colors.text, marginBottom: 8 }}>{modelStatus}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Check" icon="refresh-cw" onPress={checkStatus} />
              <Btn label="Download" icon="download" onPress={handleDownload} />
            </View>
            {downloadProgress !== null && (
              <View style={{ marginTop: 8 }}>
                <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${Math.round(downloadProgress * 100)}%`, backgroundColor: colors.accent }} />
                </View>
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{(downloadProgress * 100).toFixed(0)}%</Text>
              </View>
            )}
          </View>

          {/* Load Card */}
          <View style={cardStyle}>
            <Text style={sectionTitle}>Load Engine</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {(['cpu', 'gpu', 'mixed'] as const).map(b => (
                <TouchableOpacity
                  key={b}
                  onPress={() => setSelectedBackend(b)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md,
                    backgroundColor: selectedBackend === b ? colors.accent : colors.border,
                  }}
                >
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: selectedBackend === b ? '#FFF' : colors.text,
                  }}>{b === 'mixed' ? 'MIXED' : b.toUpperCase()}</Text>
                  <Text style={{ fontSize: 9, color: selectedBackend === b ? 'rgba(255,255,255,0.7)' : colors.textMuted }}>
                    {b === 'cpu' ? 'cpu/cpu/cpu' : b === 'gpu' ? 'gpu/gpu/gpu' : 'cpu/gpu/cpu'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Btn label={`Load (${selectedBackend})`} icon="cpu" onPress={handleLoad} />
          </View>

          {/* Manual Tests */}
          <View style={cardStyle}>
            <Text style={sectionTitle}>Manual Tests</Text>
            <View style={{ gap: 8 }}>
              <Btn label="Text Inference" icon="type" onPress={handleTextTest} />
              <Btn label="Vision (original)" icon="image" onPress={() => handleVisionTest(false)} />
              <Btn label="Vision (resized 384px)" icon="maximize" onPress={() => handleVisionTest(true)} />
            </View>
          </View>

          {/* Auto Benchmark */}
          <View style={cardStyle}>
            <Text style={sectionTitle}>Full Benchmark</Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
              Runs: CPU load, CPU text, GPU load, GPU text. Vision requires manual test.
            </Text>
            <Btn label={running ? 'Running...' : 'Run Benchmark'} icon="play" onPress={handleFullBenchmark} disabled={running} />
          </View>

          {/* Results */}
          {results.length > 0 && (
            <View style={cardStyle}>
              <Text style={sectionTitle}>Results</Text>
              {results.map((r, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6,
                  borderBottomWidth: i < results.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                }}>
                  {/* Status icon */}
                  <View style={{ width: 22, marginRight: 8, paddingTop: 1 }}>
                    {r.status === 'running' && <ActivityIndicator size="small" color={colors.accent} />}
                    {r.status === 'pass' && <Feather name="check-circle" size={16} color="#4CAF50" />}
                    {r.status === 'fail' && <Feather name="x-circle" size={16} color="#F44336" />}
                    {r.status === 'idle' && <Feather name="minus-circle" size={16} color={colors.textMuted} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{r.label}</Text>
                      {r.timeMs !== undefined && (
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>
                          {r.timeMs < 1000 ? `${r.timeMs}ms` : `${(r.timeMs / 1000).toFixed(1)}s`}
                        </Text>
                      )}
                    </View>
                    {r.output && (
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }} numberOfLines={4}>
                        {r.output}
                      </Text>
                    )}
                    {r.error && (
                      <Text style={{ fontSize: 11, color: '#F44336', marginTop: 2 }} numberOfLines={4}>
                        {r.error}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// --- Helpers ---

function Btn({ label, icon, onPress, disabled }: { label: string; icon: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md,
        backgroundColor: disabled ? colors.border : colors.card,
        borderWidth: 1, borderColor: colors.border,
      }}
    >
      <Feather name={icon as any} size={14} color={disabled ? colors.textMuted : colors.text} />
      <Text style={{ fontSize: 13, color: disabled ? colors.textMuted : colors.text, fontWeight: '500' }}>{label}</Text>
    </TouchableOpacity>
  );
}

const cardStyle = {
  backgroundColor: colors.card,
  borderRadius: radius.lg,
  padding: 14,
  marginBottom: 12,
  borderWidth: 1,
  borderColor: colors.border,
} as const;

const sectionTitle = {
  fontSize: 14,
  fontWeight: '600' as const,
  color: colors.text,
  marginBottom: 8,
};
