import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform, TextInput, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ModelBenchmarkModal } from './ModelBenchmarkModal';
import { Feather } from '@expo/vector-icons';
import { updateProfile } from '../../lib/api';
import { connectGoogleCalendar } from '../../lib/services/calendarService';
import { connectGmail, isGmailConnected } from '../../lib/services/gmailService';
import { LocalInferenceService } from '../../lib/services/ai/localInference';

import { ModelOrchestrator } from '../../lib/services/ai/modelOrchestrator';
import { InferenceQueue } from '../../lib/services/ai/inferenceQueue';
import { detectTier, getTierConfig, saveTier, getActiveTier, canRunModel, type LocalTier, type TierConfig } from '../../lib/services/ai/tierSelector';
import { getModel, getDownloadSize, formatBytes } from '../../lib/services/ai/modelRegistry';
import {
  setInferenceMode, getInferenceMode, setDataMode, getDataMode,
  getOllamaConfig, setOllamaConfig, getAgentEnabled, setAgentEnabled,
  DataMode, InferenceMode,
} from '../../lib/providers/providerFactory';
import { OllamaProvider } from '../../lib/providers/ollamaProvider';
import { invalidateBrainCache, setBrainId } from '../../lib/brain/selector';
import { colors, radius, spacing } from '../../lib/theme';
import { profileStyles as styles } from './profileStyles';

const CLOUD_MODELS = [
  { key: 'gemini-flash', label: 'Flash', sub: 'Gemini', inference: 'gemini' as InferenceMode },
  { key: 'claude-sonnet', label: 'Sonnet', sub: 'Claude', inference: 'claude' as InferenceMode },
  { key: 'claude-opus', label: 'Opus', sub: 'Claude', inference: 'claude' as InferenceMode },
  { key: 'groq-free', label: 'Groq', sub: 'Llama 4 Scout', inference: 'gemini' as InferenceMode },
  { key: 'openrouter-free', label: 'OpenRouter', sub: 'Gemma 4', inference: 'gemini' as InferenceMode },
] as const;

// Cloud models with backend-managed API keys (no client config needed)
const BACKEND_CLOUD_KEYS = new Set(['gemini-flash', 'claude-sonnet', 'claude-opus', 'groq-free', 'openrouter-free']);

const PRIVATE_MODELS = [
  { key: 'ollama-selfhost', label: 'Self-Hosted', sub: 'Ollama', inference: 'ollama' as InferenceMode },
  { key: 'ollama-byok', label: 'BYOK', sub: 'own key', inference: 'ollama' as InferenceMode },
  { key: 'smolvlm2-256m', label: 'SmolVLM2', sub: '256M', inference: 'gemini' as InferenceMode, localModelId: 'smolvlm2-256m' },
  { key: 'fastvlm-0.5b', label: 'FastVLM', sub: '0.5B', inference: 'gemini' as InferenceMode, localModelId: 'fastvlm-0.5b' },
  { key: 'moondream2', label: 'Moondream', sub: '1.9B', inference: 'gemini' as InferenceMode, localModelId: 'moondream2' },
  { key: 'gemma-e2b', label: 'Gemma E2B', sub: '4B', inference: 'gemini' as InferenceMode, localModelId: 'gemma-e2b' },
] as const;

// Combined for lookups
const BRAIN_MODELS = [...CLOUD_MODELS, ...PRIVATE_MODELS] as const;

interface Props {
  profileContext: any;
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onSyncRequired?: () => void;
}

export function ProfileIntegrationsSection({ profileContext, collapsed, onToggle, onRefresh, onSyncRequired }: Props) {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [gemmaLoaded, setGemmaLoaded] = useState(LocalInferenceService.isModelLoaded());
  const [gemmaStatus, setGemmaStatus] = useState<string | null>(null);
  const [currentDataMode, setCurrentDataMode] = useState<DataMode>('cloud');
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return profileContext?.aiModel || 'gemma-e2b';
  });

  // Agent state (E2B on-device triage + voice)
  const [agentOn, setAgentOn] = useState(false);

  // Ollama config state
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaTesting, setOllamaTesting] = useState(false);

  // Queue state
  const [queueSize, setQueueSize] = useState(0);

  // Gmail connection state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [benchmarkVisible, setBenchmarkVisible] = useState(false);

  // On-device tier state
  const [localTier, setLocalTier] = useState<LocalTier | null>(null);
  const [tierConfig, setTierConfig] = useState<TierConfig | null>(null);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);
  const [localDownloadPhase, setLocalDownloadPhase] = useState<string | null>(null);
  const [isLowRAM, setIsLowRAM] = useState(false);

  // Load current modes on mount
  useEffect(() => {
    getDataMode().then(setCurrentDataMode);
    getAgentEnabled().then(en => {
      setAgentOn(en);
      // If agent was enabled, start loading Gemma
      if (en) setupGemma();
    });
    getOllamaConfig().then(cfg => {
      setOllamaUrl(cfg.baseUrl);
      setOllamaKey(cfg.apiKey || '');
      setOllamaModel(cfg.model || '');
    });
    InferenceQueue.getQueueSize().then(setQueueSize);
    isGmailConnected().then(setGmailConnected);
    setIsLowRAM(ModelOrchestrator.isLowRAMDevice());
    // Detect local AI tier and model status
    getActiveTier().then(async tier => {
      setLocalTier(tier);
      setTierConfig(getTierConfig(tier));
      if (tier !== 'comfort') {
        const downloaded = await checkModelDownloaded(tier);
        setModelDownloaded(downloaded);
      }
    });
    const unsub = InferenceQueue.addListener(q => {
      setQueueSize(q.filter(t => t.status === 'queued').length);
    });
    return unsub;
  }, []);

  // Poll model loaded status -- auto-load from _layout.tsx may finish after this component mounts
  useEffect(() => {
    if (selectedModel !== 'gemma-e2b') return;
    if (gemmaLoaded) return;
    const interval = setInterval(() => {
      if (LocalInferenceService.isNativeAvailable() && LocalInferenceService.isModelLoaded()) {
        setGemmaLoaded(true);
        setGemmaStatus(null);
        setDownloadProgress(null);
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedModel, gemmaLoaded]);

  /** Check if the model files for a given model ID (or tier) are downloaded */
  const checkModelDownloaded = async (modelIdOrTier: string): Promise<boolean> => {
    try {
      // Support both direct model IDs and tier names (backwards compat)
      let model = getModel(modelIdOrTier);
      if (!model) {
        // Try as a tier name
        const cfg = getTierConfig(modelIdOrTier as LocalTier);
        model = getModel(cfg.modelId);
      }
      if (!model) return false;
      const FileSystem = require('expo-file-system/legacy');
      const MODELS_DIR = FileSystem.documentDirectory + 'models/';
      for (const file of model.files) {
        const info = await FileSystem.getInfoAsync(MODELS_DIR + file.name);
        if (!info.exists) return false;
      }
      return true;
    } catch { return false; }
  };

  // Keep selectedModel in sync with profile changes
  useEffect(() => {
    if (profileContext?.aiModel && profileContext.aiModel !== 'gemma-local') {
      setSelectedModel(profileContext.aiModel);
    } else if (!profileContext?.aiModel) {
      // If profile is missing aiModel, recover from local AsyncStorage
      AsyncStorage.getItem('mittens_inference_mode').then(mode => {
        if (mode === 'ollama') {
          AsyncStorage.getItem('mittens_ollama_url').then(url => {
             setSelectedModel(url ? 'ollama-selfhost' : 'ollama-byok');
          });
        } else if (mode === 'gemini') {
           setSelectedModel('gemini-flash');
        } else if (mode === 'claude') {
           AsyncStorage.getItem('mittens_claude_variant').then(v => setSelectedModel(v || 'claude-sonnet'));
        }
      });
    }
  }, [profileContext?.aiModel]);

  const setupGemma = async () => {
    try {
      // Check native module availability first -- requires a custom dev build
      if (!LocalInferenceService.isNativeAvailable()) {
        Alert.alert(
          'Custom Build Required',
          `Gemma requires a custom dev build with the LiteRT-LM native module.\n\nRun: npx expo prebuild && npx expo run:${Platform.OS}`,
        );
        // Revert to Flash so the user isn't stuck on a broken selection
        await setBrainId('groq-free' as any);
        setSelectedModel('groq-free');
        updateProfile({ aiModel: 'groq-free' }).then(onRefresh).catch(() => {});
        return;
      }

      const downloaded = await LocalInferenceService.isModelDownloaded('gemma-local');
      if (!downloaded) {
        setGemmaStatus('Downloading model (2.6 GB)...');
        setDownloadProgress(0);
        await LocalInferenceService.downloadModel('gemma-local', (p) => setDownloadProgress(p));
        setDownloadProgress(null);
      }
      if (!LocalInferenceService.isModelLoaded()) {
        setGemmaStatus('Loading model...');
        await LocalInferenceService.loadModel('gemma-local', 'cpu');
      }
      setGemmaLoaded(true);
      setGemmaStatus(null);
    } catch (e: any) {
      setDownloadProgress(null);
      setGemmaStatus(null);
      const msg = e?.message || String(e);
      const isKnownError = msg.includes('native module') || msg.includes('corrupt') || msg.includes('Simulator') || msg.includes('incompatible');
      const hint = isKnownError ? '' : '\n\nCheck your internet connection and try again.';
      Alert.alert('Gemma Setup Failed', `${msg}${hint}`);
    }
  };

  const downloadLocalModels = async () => {
    try {
      // Try direct model lookup first (for individual local VLM models)
      let model = getModel(selectedModel);

      if (!model) {
        // Fallback to tier-based lookup
        const tier = localTier || detectTier();
        const cfg = getTierConfig(tier);

        // For comfort tier, use existing Gemma setup
        if (tier === 'comfort') {
          await setupGemma();
          return;
        }

        model = getModel(cfg.modelId);
      }

      if (!model) { Alert.alert('Error', 'Model not found: ' + selectedModel); return; }

      // Gemma E2B uses its own LiteRT setup flow
      if (model.id === 'gemma-e2b') {
        await setupGemma();
        return;
      }

      const FileSystem = require('expo-file-system/legacy');
      const MODELS_DIR = FileSystem.documentDirectory + 'models/';
      const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
      if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

      const totalFiles = model.files.length;
      let filesCompleted = 0;

      for (const file of model.files) {
        const filePath = MODELS_DIR + file.name;
        const exists = await FileSystem.getInfoAsync(filePath);
        if (exists.exists) { filesCompleted++; continue; }

        const label = file.name.startsWith('mmproj') ? 'Vision projector' : model.name;
        setLocalDownloadPhase(label);
        setLocalDownloadProgress(filesCompleted / totalFiles);

        const directUrl = await resolveRedirect(file.url);
        const dl = FileSystem.createDownloadResumable(
          directUrl,
          filePath,
          { headers: { 'User-Agent': 'Mittens/1.0' } },
          (p: any) => {
            const fileProgress = Math.min(1, p.totalBytesWritten / (p.totalBytesExpectedToWrite || file.sizeBytes));
            setLocalDownloadProgress(Math.min(1, (filesCompleted + fileProgress) / totalFiles));
          },
        );
        try {
          await dl.downloadAsync();
          filesCompleted++;
        } catch (e: any) {
          try { await FileSystem.deleteAsync(filePath, { idempotent: true }); } catch {}
          throw e;
        }
      }

      setModelDownloaded(true);
      setLocalDownloadProgress(null);
      setLocalDownloadPhase(null);
    } catch (e: any) {
      setLocalDownloadProgress(null);
      setLocalDownloadPhase(null);
      Alert.alert('Download Failed', e?.message || 'Check your internet connection.');
    }
  };

  const resolveRedirect = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.url && res.url !== url) return res.url;
    } catch {}
    return url;
  };

  const handleToggleAgent = async (on: boolean) => {
    if (on) {
      if (!LocalInferenceService.isNativeAvailable()) {
        Alert.alert(
          'Custom Build Required',
          `On-device agent requires a custom dev build with the LiteRT-LM native module.\n\nRun: npx expo prebuild && npx expo run:${Platform.OS}`,
        );
        return;
      }
      await setAgentEnabled(true);
      setAgentOn(true);
      await setupGemma();
    } else {
      await setAgentEnabled(false);
      setAgentOn(false);
      if (LocalInferenceService.isModelLoaded()) {
        LocalInferenceService.unloadModel();
        setGemmaLoaded(false);
      }
    }
  };

  const handleSelectBrain = async (modelKey: string) => {
    const selected = BRAIN_MODELS.find(m => m.key === modelKey);
    if (!selected) return;

    // Local VLM model selected (SmolVLM2, FastVLM, Moondream, Gemma E2B)
    const localModelId = 'localModelId' in selected ? (selected as any).localModelId : undefined;
    if (localModelId) {
      const { canRun } = canRunModel(localModelId);
      if (!canRun) return; // pill should be disabled, but guard anyway

      // Map model key to brain ID
      const brainIdMap: Record<string, string> = {
        'smolvlm2-256m': 'smolvlm2',
        'fastvlm-0.5b': 'fastvlm',
        'moondream2': 'moondream2',
        'gemma-e2b': 'e2b',
      };
      const brainId = brainIdMap[modelKey] || 'smolvlm2';
      await setBrainId(brainId as any);

      // Gemma E2B uses the existing LiteRT setup flow
      if (modelKey === 'gemma-e2b') {
        const tier = detectTier();
        setLocalTier(tier);
        setTierConfig(getTierConfig(tier));
        await saveTier(tier);
        await setAgentEnabled(true);
        setAgentOn(true);
        await setBrainId('e2b' as any);
        setSelectedModel(modelKey);
        updateProfile({ aiModel: modelKey }).then(onRefresh).catch(() => {});
        await setupGemma();
        return;
      }

      // Other local VLMs: check if downloaded, show status
      // Local VLM selected -- brain ID already set above, no inference mode change needed
      setSelectedModel(modelKey);
      updateProfile({ aiModel: modelKey }).then(onRefresh).catch(() => {});

      // Check download status
      const downloaded = await checkModelDownloaded(localModelId);
      setModelDownloaded(downloaded);
      return;
    }

    // Switching away from on-device: disable agent if it was on
    if (agentOn) {
      await setAgentEnabled(false);
      setAgentOn(false);
      if (LocalInferenceService.isModelLoaded()) {
        LocalInferenceService.unloadModel();
        setGemmaLoaded(false);
      }
    }

    // Ollama modes: configure client-side
    if (modelKey === 'ollama-byok' || modelKey === 'ollama-selfhost') {
      await setOllamaConfig(
        ollamaUrl,
        ollamaKey || undefined,
        ollamaModel || 'gemma4:26b',
      );
      await setBrainId('gemma26b' as any);
    }

    await setInferenceMode(selected.inference);
    if (BACKEND_CLOUD_KEYS.has(modelKey)) {
      await setBrainId(modelKey as any);
    }
    invalidateBrainCache();
    setSelectedModel(modelKey);
    updateProfile({ aiModel: modelKey }).then(onRefresh).catch(() => {});
  };

  const handleTestOllamaConnection = async () => {
    setOllamaTesting(true);
    setOllamaConnected(null);
    if (!ollamaUrl) {
      Alert.alert('URL Required', 'Enter your server\'s IP address first.\n\nRun "ipconfig getifaddr en0" on your Mac to find it.');
      setOllamaTesting(false);
      return;
    }
    try {
      // Save config first
      await setOllamaConfig(
        ollamaUrl,
        ollamaKey || undefined,
        ollamaModel || 'gemma4:26b',
      );
      const provider = new OllamaProvider({
        baseUrl: ollamaUrl,
        apiKey: ollamaKey || undefined,
        model: ollamaModel || 'gemma4:26b',
      });
      const ok = await provider.ping();
      setOllamaConnected(ok);
      if (!ok) Alert.alert('Connection Failed', 'Could not reach the endpoint. Check the URL and make sure the server is running.\n\nBoth devices must be on the same WiFi, or use Tailscale.');
    } catch {
      setOllamaConnected(false);
    } finally {
      setOllamaTesting(false);
    }
  };

  const handleSaveOllamaConfig = async () => {
    await setOllamaConfig(
      ollamaUrl,
      ollamaKey || undefined,
      ollamaModel || 'gemma4:26b',
    );
  };

  const handleToggleDataMode = async (newMode: DataMode) => {
    if (newMode === currentDataMode) return;

    if (newMode === 'local') {
      Alert.alert(
        'Switch to Local Only?',
        'This will store all data on your device only. In the future, switching to local will delete your cloud data.\n\nAre you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Switch to Local',
            style: 'destructive',
            onPress: async () => {
              await setDataMode('local');
              setCurrentDataMode('local');
            },
          },
        ]
      );
    } else {
      await setDataMode('cloud');
      setCurrentDataMode('cloud');
      onSyncRequired?.();
    }
  };

  const currentModel = selectedModel;
  const isOllamaMode = currentModel === 'ollama-byok' || currentModel === 'ollama-selfhost';
  const isCloudReady = BACKEND_CLOUD_KEYS.has(currentModel);
  // Check if current model is a local VLM
  const isLocalVLM = ['smolvlm2-256m', 'fastvlm-0.5b', 'moondream2', 'gemma-e2b'].includes(currentModel);
  const currentLocalModel = isLocalVLM ? getModel(currentModel) : null;
  const brainDesc =
    currentModel === 'smolvlm2-256m' ? 'SmolVLM2 256M -- tiny, vision, on-device' :
    currentModel === 'fastvlm-0.5b' ? 'FastVLM 0.5B -- Apple, fastest vision' :
    currentModel === 'moondream2' ? 'Moondream 2 -- compact VQA, on-device' :
    currentModel === 'gemma-e2b' ? 'Gemma 4 E2B -- best quality, on-device' :
    currentModel === 'gemini-flash' ? 'Gemini Flash -- fast, free' :
    currentModel === 'claude-sonnet' ? 'Claude Sonnet -- balanced' :
    currentModel === 'claude-opus' ? 'Claude Opus -- smartest' :
    currentModel === 'groq-free' ? 'Groq Llama 4 Scout -- fast, free' :
    currentModel === 'openrouter-free' ? 'OpenRouter Gemma 4 -- free' :
    currentModel === 'ollama-byok' ? 'BYOK -- your API key' :
    currentModel === 'ollama-selfhost' ? `Self-Hosted -- ${ollamaUrl || 'not configured'}` :
    'Gemma 4 E2B -- best quality, on-device';

  const renderBrainPill = (model: any) => {
    const isExplicitlyDisabled = 'disabled' in model && model.disabled;
    // Smart capability detection for local models
    const localModelId = 'localModelId' in model ? model.localModelId : undefined;
    const capabilityCheck = localModelId ? canRunModel(localModelId) : { canRun: true };
    const isDisabled = isExplicitlyDisabled || !capabilityCheck.canRun;
    const isActive = currentModel === model.key;
    const subLabel = isExplicitlyDisabled ? 'soon' : (!capabilityCheck.canRun ? capabilityCheck.reason : model.sub);
    
    if (isDisabled && subLabel === 'soon') return null;

    return (
      <TouchableOpacity
        key={model.key}
        style={[
          styles.actBtn,
          { minWidth: 64, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10 },
          isActive && styles.actBtnActive,
          isDisabled && { opacity: 0.35 },
        ]}
        onPress={() => !isDisabled && handleSelectBrain(model.key)}
        disabled={isDisabled}
      >
        <Text style={[styles.actText, { fontSize: 11 }, isActive && styles.actTextActive]}>
          {model.label}
        </Text>
        <Text style={[{ fontSize: 9, color: colors.textMuted, marginTop: 1 }, isActive && { color: 'rgba(255,255,255,0.7)' }]}>
          {subLabel}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
    <View style={styles.card}>
      <TouchableOpacity style={[styles.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="link" size={16} color={colors.textPrimary} />
          <Text style={styles.cardTitle}>INTEGRATIONS</Text>
        </View>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.md }}>
            External data sources
          </Text>

          {/* Google Calendar */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="calendar" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Google Calendar</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Events, schedule, departure alarms</Text>
            </View>
            {profileContext?.googleCalendarToken?.accessToken ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={async () => {
                  const ok = await connectGoogleCalendar();
                  if (ok) { onRefresh(); Alert.alert('Connected', 'Google Calendar is now synced.'); }
                  else Alert.alert('Failed', 'Could not connect Google Calendar.');
                }}
                style={{ backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Location */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="map-pin" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Location</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Geofencing for known places, travel time</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="check-circle" size={12} color="#4CAF50" />
              <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Active</Text>
            </View>
          </View>

          {/* Travel Mode */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 8 }}>TRAVEL MODE</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['transit', 'bicycling', 'walking', 'driving'] as const).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.actBtn, (profileContext?.travelMode || 'transit') === mode && styles.actBtnActive]}
                  onPress={() => updateProfile({ travelMode: mode }).then(onRefresh)}
                >
                  <Text style={[styles.actText, (profileContext?.travelMode || 'transit') === mode && styles.actTextActive]}>
                    {mode}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>



          {/* Brain (reasoning engine) */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="cpu" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Mittens' Brain</Text>
                {queueSize > 0 && (
                  <Text style={styles.queueBadge}>{queueSize} queued</Text>
                )}
              </View>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>{brainDesc}</Text>
            </View>
          </View>

          {/* Brain selector */}
          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            {/* Cloud row -- scrollable for 5+ options */}
            <View style={{ marginBottom: 6 }}>
              <Text style={styles.rowLabel}>CLOUD</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {CLOUD_MODELS.map(renderBrainPill)}
              </ScrollView>
            </View>
            {/* Private row -- scrollable for more options */}
            <View style={{ marginBottom: 6 }}>
              <Text style={styles.rowLabel}>PRIVATE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {PRIVATE_MODELS.map(renderBrainPill)}
              </ScrollView>
            </View>

            {/* Local VLM status -- show when a local model is selected */}
            {isLocalVLM && currentLocalModel && (
              <View style={{ marginTop: 6 }}>
                {/* Model info label */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Feather name="cpu" size={11} color={colors.textMuted} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5 }}>
                    {currentLocalModel.name.toUpperCase()} -- {formatBytes(getDownloadSize(currentLocalModel))}
                  </Text>
                </View>

                {/* Download progress (for any local model) */}
                {localDownloadProgress !== null && (
                  <View style={{ marginBottom: 6 }}>
                    <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${Math.round(localDownloadProgress * 100)}%`, backgroundColor: colors.accent }} />
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {(localDownloadProgress * 100).toFixed(0)}% -- {localDownloadPhase || 'Downloading...'}
                    </Text>
                  </View>
                )}

                {/* Gemma E2B specific: uses LiteRT setup flow */}
                {currentModel === 'gemma-e2b' && (
                  <>
                    {downloadProgress !== null && (
                      <View style={{ marginBottom: 4 }}>
                        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${Math.round(downloadProgress * 100)}%`, backgroundColor: colors.accent }} />
                        </View>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{(downloadProgress * 100).toFixed(0)}% of 2.6 GB</Text>
                      </View>
                    )}
                    {gemmaStatus && downloadProgress === null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <ActivityIndicator size="small" color={colors.textMuted} />
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>{gemmaStatus}</Text>
                      </View>
                    )}
                    {!gemmaStatus && downloadProgress === null && gemmaLoaded && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="check-circle" size={12} color="#4CAF50" />
                        <Text style={{ fontSize: 12, color: '#4CAF50', fontWeight: '600' }}>Ready -- text + vision + audio</Text>
                      </View>
                    )}
                  </>
                )}

                {/* SmolVLM2 / FastVLM / Moondream: download + status */}
                {currentModel !== 'gemma-e2b' && localDownloadProgress === null && (
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name={modelDownloaded ? 'check-circle' : 'download'} size={12} color={modelDownloaded ? '#4CAF50' : colors.textMuted} />
                      <Text style={{ fontSize: 12, color: modelDownloaded ? '#4CAF50' : colors.textMuted, fontWeight: modelDownloaded ? '600' : '400' }}>
                        {currentLocalModel.name} -- {currentLocalModel.role === 'multimodal' ? 'vision + text' : 'text only'}
                      </Text>
                    </View>
                    {!modelDownloaded && (
                      <TouchableOpacity
                        onPress={() => downloadLocalModels()}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginTop: 4 }}
                      >
                        <Feather name="download" size={11} color="#fff" />
                        <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>Download ({formatBytes(getDownloadSize(currentLocalModel))})</Text>
                      </TouchableOpacity>
                    )}
                    {modelDownloaded && (
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                        On-device inference. No network needed. Private by default.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Cloud models: Ready to use badge (keys on backend) */}
          {isCloudReady && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 12, color: '#4CAF50', fontWeight: '600' }}>Ready to use</Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>-- no setup needed</Text>
              </View>
            </View>
          )}

          {/* Ollama / BYOK config -- only for self-hosted and BYOK */}
          {isOllamaMode && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              <TextInput
                style={styles.configInput}
                value={ollamaUrl}
                onChangeText={setOllamaUrl}
                onBlur={handleSaveOllamaConfig}
                placeholder={currentModel === 'ollama-selfhost' ? 'http://192.168.x.x:11434' : 'https://api.openai.com/v1'}
                placeholderTextColor="#BBB"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {currentModel === 'ollama-selfhost' && (
                <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: -4, marginBottom: 6, paddingHorizontal: 2 }}>
                  Your Mac's IP on same WiFi. Or use Tailscale for any network.
                </Text>
              )}
              {currentModel === 'ollama-byok' && (
                <TextInput
                  style={styles.configInput}
                  value={ollamaKey}
                  onChangeText={setOllamaKey}
                  onBlur={handleSaveOllamaConfig}
                  placeholder="API key (sk-...)"
                  placeholderTextColor="#BBB"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              <TextInput
                style={styles.configInput}
                value={ollamaModel}
                onChangeText={setOllamaModel}
                onBlur={handleSaveOllamaConfig}
                placeholder={currentModel === 'ollama-selfhost' ? 'gemma4:27b' : 'gpt-4o'}
                placeholderTextColor="#BBB"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={handleTestOllamaConnection}
                  disabled={ollamaTesting}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, opacity: ollamaTesting ? 0.6 : 1 }}
                >
                  {ollamaTesting ? (
                    <ActivityIndicator size="small" color={colors.bg} />
                  ) : (
                    <Feather name="wifi" size={12} color={colors.bg} />
                  )}
                  <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Test Connection</Text>
                </TouchableOpacity>
                {ollamaConnected === true && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={[styles.statusDot, { backgroundColor: '#4CAF50' }]} />
                    <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
                  </View>
                )}
                {ollamaConnected === false && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={[styles.statusDot, { backgroundColor: '#E53935' }]} />
                    <Text style={{ fontSize: 11, color: '#E53935', fontWeight: '600' }}>Unreachable</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Data Storage -- independent toggle */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name={currentDataMode === 'local' ? 'smartphone' : 'cloud'} size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Data Storage</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>
                {currentDataMode === 'local' ? 'Private, all data on device' : 'Backed up to your account'}
              </Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.actBtn, { flex: 1, alignItems: 'center', paddingVertical: 6 }, currentDataMode === 'cloud' && styles.actBtnActive]}
                onPress={() => handleToggleDataMode('cloud')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="cloud" size={12} color={currentDataMode === 'cloud' ? '#fff' : colors.textPrimary} />
                  <Text style={[styles.actText, { fontSize: 12 }, currentDataMode === 'cloud' && styles.actTextActive]}>Cloud</Text>
                </View>
                <Text style={[{ fontSize: 9, color: colors.textMuted, marginTop: 1 }, currentDataMode === 'cloud' && { color: 'rgba(255,255,255,0.7)' }]}>synced + backed up</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actBtn, { flex: 1, alignItems: 'center', paddingVertical: 6 }, currentDataMode === 'local' && styles.actBtnActive]}
                onPress={() => handleToggleDataMode('local')}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="smartphone" size={12} color={currentDataMode === 'local' ? '#fff' : colors.textPrimary} />
                  <Text style={[styles.actText, { fontSize: 12 }, currentDataMode === 'local' && styles.actTextActive]}>Local Only</Text>
                </View>
                <Text style={[{ fontSize: 9, color: colors.textMuted, marginTop: 1 }, currentDataMode === 'local' && { color: 'rgba(255,255,255,0.7)' }]}>on device, private</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Gmail -- functional */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="mail" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Gmail</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Search, read, and send emails</Text>
            </View>
            {gmailConnected ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={async () => {
                  const ok = await connectGmail();
                  if (ok) {
                    setGmailConnected(true);
                    onRefresh();
                    Alert.alert('Connected', 'Gmail is now connected.');
                  } else {
                    Alert.alert('Failed', 'Could not connect Gmail.');
                  }
                }}
                style={{ backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Future integrations */}
          {[
            { icon: 'heart' as const, title: 'Apple Health', desc: 'Workouts, steps, menstrual cycle, sleep' },
            { icon: 'message-square' as const, title: 'iMessage', desc: 'Message monitoring, notification triage' },
          ].map((item, idx) => (
            <View key={idx} style={styles.integrationRow}>
              <View style={styles.integrationIcon}>
                <Feather name={item.icon} size={18} color={colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{item.title}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>{item.desc}</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>Coming soon</Text>
            </View>
          ))}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md }}>
            <Feather name="lock" size={12} color={colors.textMuted} />
            <Text style={{ flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16 }}>
              Your data stays on your device and your backend. Mittens does not sell data.
            </Text>
          </View>
        </>
      )}
    </View>
      <ModelBenchmarkModal visible={benchmarkVisible} onClose={() => setBenchmarkVisible(false)} />
    </>
  );
}
