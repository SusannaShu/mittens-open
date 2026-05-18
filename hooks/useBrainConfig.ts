/**
 * useBrainConfig -- Hook encapsulating all Mittens Brain state and handlers.
 * Extracted from ProfileIntegrationsSection to keep components focused.
 */
import { useState, useEffect } from 'react';
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updateProfile } from '../lib/api';
import { LocalInferenceService } from '../lib/services/ai/localInference';
import { ModelOrchestrator } from '../lib/services/ai/modelOrchestrator';
import { InferenceQueue } from '../lib/services/ai/inferenceQueue';
import {
  detectTier, getTierConfig, saveTier, getActiveTier,
  canRunModel, type LocalTier, type TierConfig,
} from '../lib/services/ai/tierSelector';
import { getModel, getDownloadSize, formatBytes } from '../lib/services/ai/modelRegistry';
import {
  setInferenceMode, setDataMode, getDataMode,
  getOllamaConfig, setOllamaConfig, getAgentEnabled, setAgentEnabled,
  DataMode, InferenceMode,
} from '../lib/providers/providerFactory';
import { OllamaProvider } from '../lib/providers/ollamaProvider';
import { invalidateBrainCache, setBrainId } from '../lib/brain/selector';

export const PRIVATE_MODELS = [
  { key: 'ollama-selfhost', label: 'Self-Hosted', sub: 'Ollama', inference: 'ollama' as InferenceMode },
  { key: 'ollama-byok', label: 'BYOK', sub: 'own key', inference: 'ollama' as InferenceMode },
  { key: 'smolvlm2-256m', label: 'SmolVLM2', sub: '256M', inference: 'ollama' as InferenceMode, localModelId: 'smolvlm2-256m' },
  { key: 'fastvlm-0.5b', label: 'FastVLM', sub: '0.5B', inference: 'ollama' as InferenceMode, localModelId: 'fastvlm-0.5b' },
  { key: 'moondream2', label: 'Moondream', sub: '1.9B', inference: 'ollama' as InferenceMode, localModelId: 'moondream2' },
  { key: 'gemma-e2b', label: 'Gemma E2B', sub: '4B', inference: 'ollama' as InferenceMode, localModelId: 'gemma-e2b' },
] as const;

const BRAIN_MODELS = [...PRIVATE_MODELS] as const;

export { getModel, getDownloadSize, formatBytes, canRunModel };

export function useBrainConfig(profileContext: any, onRefresh: () => void, onSyncRequired?: () => void) {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [gemmaLoaded, setGemmaLoaded] = useState(LocalInferenceService.isModelLoaded());
  const [gemmaStatus, setGemmaStatus] = useState<string | null>(null);
  const currentDataMode: DataMode = 'local';
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return profileContext?.aiModel || 'gemma-e2b';
  });

  const [agentOn, setAgentOn] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);
  const [ollamaTesting, setOllamaTesting] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [benchmarkVisible, setBenchmarkVisible] = useState(false);
  const [localTier, setLocalTier] = useState<LocalTier | null>(null);
  const [tierConfig, setTierConfig] = useState<TierConfig | null>(null);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);
  const [localDownloadPhase, setLocalDownloadPhase] = useState<string | null>(null);
  const [isLowRAM, setIsLowRAM] = useState(false);

  const checkModelDownloaded = async (modelIdOrTier: string): Promise<boolean> => {
    try {
      let model = getModel(modelIdOrTier);
      if (!model) {
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

  useEffect(() => {
    getAgentEnabled().then(en => {
      setAgentOn(en);
      if (en) setupGemma();
    });
    getOllamaConfig().then(cfg => {
      setOllamaUrl(cfg.baseUrl);
      setOllamaKey(cfg.apiKey || '');
      setOllamaModel(cfg.model || '');
    });
    InferenceQueue.getQueueSize().then(setQueueSize);
    setIsLowRAM(ModelOrchestrator.isLowRAMDevice());
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

  useEffect(() => {
    if (profileContext?.aiModel && profileContext.aiModel !== 'gemma-local') {
      setSelectedModel(profileContext.aiModel);
    } else if (!profileContext?.aiModel) {
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
      if (!LocalInferenceService.isNativeAvailable()) {
        Alert.alert(
          'Custom Build Required',
          `Gemma requires a custom dev build with the LiteRT-LM native module.\n\nRun: npx expo prebuild && npx expo run:${Platform.OS}`,
        );
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

  const resolveRedirect = async (url: string): Promise<string> => {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.url && res.url !== url) return res.url;
    } catch {}
    return url;
  };

  const downloadLocalModels = async () => {
    try {
      let model = getModel(selectedModel);
      if (!model) {
        const tier = localTier || detectTier();
        const cfg = getTierConfig(tier);
        if (tier === 'comfort') { await setupGemma(); return; }
        model = getModel(cfg.modelId);
      }
      if (!model) { Alert.alert('Error', 'Model not found: ' + selectedModel); return; }
      if (model.id === 'gemma-e2b') { await setupGemma(); return; }

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
          directUrl, filePath,
          { headers: { 'User-Agent': 'Mittens/1.0' } },
          (p: any) => {
            const fileProgress = Math.min(1, p.totalBytesWritten / (p.totalBytesExpectedToWrite || file.sizeBytes));
            setLocalDownloadProgress(Math.min(1, (filesCompleted + fileProgress) / totalFiles));
          },
        );
        try { await dl.downloadAsync(); filesCompleted++; }
        catch (e: any) {
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

  const handleSelectBrain = async (modelKey: string) => {
    const selected = BRAIN_MODELS.find(m => m.key === modelKey);
    if (!selected) return;

    const localModelId = 'localModelId' in selected ? (selected as any).localModelId : undefined;
    if (localModelId) {
      const { canRun } = canRunModel(localModelId);
      if (!canRun) return;
      const brainIdMap: Record<string, string> = {
        'smolvlm2-256m': 'smolvlm2', 'fastvlm-0.5b': 'fastvlm',
        'moondream2': 'moondream2', 'gemma-e2b': 'e2b',
      };
      const brainId = brainIdMap[modelKey] || 'smolvlm2';
      await setBrainId(brainId as any);
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
      setSelectedModel(modelKey);
      updateProfile({ aiModel: modelKey }).then(onRefresh).catch(() => {});
      const downloaded = await checkModelDownloaded(localModelId);
      setModelDownloaded(downloaded);
      return;
    }

    if (agentOn) {
      await setAgentEnabled(false);
      setAgentOn(false);
      if (LocalInferenceService.isModelLoaded()) {
        LocalInferenceService.unloadModel();
        setGemmaLoaded(false);
      }
    }

    if (modelKey === 'ollama-byok' || modelKey === 'ollama-selfhost') {
      await setOllamaConfig(ollamaUrl, ollamaKey || undefined, ollamaModel || 'gemma4:26b');
      await setBrainId('gemma26b' as any);
    } else {
      await setBrainId(modelKey as any);
    }

    await setInferenceMode(selected.inference);
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
      await setOllamaConfig(ollamaUrl, ollamaKey || undefined, ollamaModel || 'gemma4:26b');
      const provider = new OllamaProvider({
        baseUrl: ollamaUrl, apiKey: ollamaKey || undefined, model: ollamaModel || 'gemma4:26b',
      });
      const ok = await provider.ping();
      setOllamaConnected(ok);
      if (!ok) Alert.alert('Connection Failed', 'Could not reach the endpoint. Check the URL and make sure the server is running.\n\nBoth devices must be on the same WiFi, or use Tailscale.');
    } catch { setOllamaConnected(false); }
    finally { setOllamaTesting(false); }
  };

  const handleSaveOllamaConfig = async () => {
    await setOllamaConfig(ollamaUrl, ollamaKey || undefined, ollamaModel || 'gemma4:26b');
  };

  const currentModel = selectedModel;
  const isOllamaMode = currentModel === 'ollama-byok' || currentModel === 'ollama-selfhost';
  const isCloudReady = false;
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

  return {
    currentModel, brainDesc, isOllamaMode, isCloudReady, isLocalVLM, currentLocalModel,
    queueSize, currentDataMode,
    ollamaUrl, setOllamaUrl, ollamaKey, setOllamaKey, ollamaModel, setOllamaModel,
    ollamaConnected, ollamaTesting,
    downloadProgress, gemmaLoaded, gemmaStatus,
    localDownloadProgress, localDownloadPhase, modelDownloaded,
    benchmarkVisible, setBenchmarkVisible,
    handleSelectBrain, handleTestOllamaConnection, handleSaveOllamaConfig,
    downloadLocalModels,
  };
}
