/**
 * LocalAgentSetupModal -- onboarding step for AI provider selection.
 *
 * Design philosophy:
 * - Checks device RAM before offering E2B download.
 * - If sufficient RAM (7GB+): default path auto-downloads E2B.
 * - If low RAM (<7GB, e.g. iPhone SE 3): skips E2B, leads with self-hosted/BYOK.
 * - If download fails (space/RAM), gracefully suggests self-hosted mode.
 * - Non-techy users never see anything scary.
 */

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, ActivityIndicator,
  TouchableOpacity, Image, Animated, TextInput, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../../lib/theme';
import { LocalInferenceService } from '../../lib/services/ai/localInference';
import {
  setAgentEnabled, setInferenceMode, setOllamaConfig,
} from '../../lib/providers/providerFactory';
import { OllamaProvider } from '../../lib/providers/ollamaProvider';
import { updateProfile } from '../../lib/api';
import { setBrainId } from '../../lib/brain/selector';
import { getDeviceRAM_GB } from '../../lib/services/ai/tierSelector';

const MITTENS_ICON = require('../../assets/icon.png');
const E2B_RAM_THRESHOLD_GB = 7;

type Phase = 'choose' | 'downloading' | 'loading' | 'ready' | 'error' | 'cloud-confirm';

interface Props {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export default function LocalAgentSetupModal({ visible, onComplete, onSkip }: Props) {
  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const progressAnim = useRef(new Animated.Value(0)).current;

  // RAM check
  const [deviceRAM, setDeviceRAM] = useState<number | null>(null);
  const isLowRAM = deviceRAM !== null && deviceRAM < E2B_RAM_THRESHOLD_GB;

  // Self-Hosted / BYOK state
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [ollamaKey, setOllamaKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<boolean | null>(null);

  useEffect(() => {
    setDeviceRAM(getDeviceRAM_GB());
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // -- E2B local setup --
  const startLocalSetup = async () => {
    try {
      const alreadyDownloaded = await LocalInferenceService.isModelDownloaded();

      if (!alreadyDownloaded) {
        setPhase('downloading');
        setProgress(0);
        await LocalInferenceService.downloadModel('gemma-local', (p) => setProgress(p));
      }

      setPhase('loading');
      setProgress(1);
      await LocalInferenceService.loadModel('gemma-local', 'cpu');
      await setAgentEnabled(true);
      await setBrainId('e2b' as any);
      await updateProfile({ aiModel: 'e2b-local' }).catch(() => {});
      setPhase('ready');
    } catch (e: any) {
      const msg = e?.message || 'Setup failed';
      setErrorMsg(
        msg.includes('storage') || msg.includes('space') || msg.includes('disk')
          ? 'Not enough storage space for the model (~2.6 GB). Try freeing some space, or use a self-hosted server.'
          : msg.includes('memory') || msg.includes('RAM')
          ? 'Your device does not have enough memory to run the model. Use a self-hosted server instead.'
          : msg
      );
      setPhase('error');
    }
  };

  // -- Self-Hosted / BYOK setup --
  const handleConnectOllama = async (mode: 'selfhost' | 'byok') => {
    if (!ollamaUrl) return;
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      await setOllamaConfig(ollamaUrl, ollamaKey || undefined, ollamaModel || 'gemma4:26b');
      const provider = new OllamaProvider({
        baseUrl: ollamaUrl,
        apiKey: ollamaKey || undefined,
        model: ollamaModel || 'gemma4:26b',
      });
      const ok = await provider.ping();
      console.log('[Setup] ping ok:', ok);
      setConnectionResult(ok);
      if (ok) {
        console.log('[Setup] calling setInferenceMode...');
        await setInferenceMode('ollama');
        console.log('[Setup] calling setAgentEnabled...');
        await setAgentEnabled(false);
        const modelKey = mode === 'byok' ? 'ollama-byok' : 'ollama-selfhost';
        console.log('[Setup] calling setBrainId...');
        await setBrainId('gemma26b' as any);
        console.log('[Setup] calling updateProfile...');
        await updateProfile({ aiModel: modelKey }).catch(() => {});
        console.log('[Setup] all done, completing');
        setTimeout(() => onComplete(), 600);
      }
    } catch (e: any) {
      console.error('[Setup] FAILED after ping:', e?.message || e);
      setConnectionResult(false);
    } finally {
      setTestingConnection(false);
    }
  };

  // -- Cloud mode --
  const handleUseCloud = async () => {
    await setAgentEnabled(false);
    await setBrainId('groq-free' as any);
    await updateProfile({ aiModel: 'groq-free' }).catch(() => {});
    onComplete();
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen">
      <View style={s.container}>
        <Image source={MITTENS_ICON} style={s.icon} />

        {/* -- Choose phase -- */}
        {phase === 'choose' && (
          <ScrollView
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {isLowRAM ? (
              <LowRAMChooseView
                deviceRAM={deviceRAM!}
                ollamaUrl={ollamaUrl}
                ollamaKey={ollamaKey}
                ollamaModel={ollamaModel}
                testingConnection={testingConnection}
                connectionResult={connectionResult}
                onUrlChange={setOllamaUrl}
                onKeyChange={setOllamaKey}
                onModelChange={setOllamaModel}
                onConnect={handleConnectOllama}
                onCloud={() => setPhase('cloud-confirm')}
              />
            ) : (
              <FullRAMChooseView
                ollamaUrl={ollamaUrl}
                ollamaKey={ollamaKey}
                ollamaModel={ollamaModel}
                testingConnection={testingConnection}
                connectionResult={connectionResult}
                onUrlChange={setOllamaUrl}
                onKeyChange={setOllamaKey}
                onModelChange={setOllamaModel}
                onConnect={handleConnectOllama}
                onStartLocal={startLocalSetup}
                onCloud={() => setPhase('cloud-confirm')}
              />
            )}
          </ScrollView>
        )}

        {/* -- Downloading -- */}
        {phase === 'downloading' && (
          <View style={s.center}>
            <Text style={s.title}>Setting up Mittens</Text>
            <Text style={s.subtitle}>Downloading your private AI model</Text>

            <View style={s.progressTrack}>
              <Animated.View style={[s.progressFill, { width: progressWidth }]} />
            </View>
            <Text style={s.progressText}>{Math.round(progress * 100)}%</Text>

            <View style={s.features}>
              <FeatureRow icon="shield" text="On-device AI processing" />
              <FeatureRow icon="lock" text="Your data stays private" />
            </View>

            <Text style={s.powered}>Powered by Gemma 4 E2B</Text>
          </View>
        )}

        {/* -- Loading -- */}
        {phase === 'loading' && (
          <View style={s.center}>
            <Text style={s.title}>Almost there</Text>
            <Text style={s.subtitle}>Preparing on-device inference</Text>
            <ActivityIndicator size="large" color={colors.accent} style={{ marginBottom: spacing.xl }} />
            <Text style={s.powered}>Powered by Gemma 4 E2B</Text>
          </View>
        )}

        {/* -- Ready -- */}
        {phase === 'ready' && (
          <View style={s.center}>
            <Text style={s.title}>Mittens is ready</Text>
            <Text style={s.subtitle}>Your private AI is set up and running</Text>

            <View style={s.readyBadge}>
              <Feather name="check-circle" size={18} color="#4CAF50" />
              <Text style={s.readyText}>On-device agent active</Text>
            </View>

            <TouchableOpacity style={s.primaryBtn} onPress={onComplete}>
              <Text style={s.primaryBtnText}>Get started</Text>
            </TouchableOpacity>

            <Text style={s.powered}>Powered by Gemma 4 E2B</Text>
          </View>
        )}

        {/* -- Error: suggest alternatives -- */}
        {phase === 'error' && (
          <View style={s.center}>
            <Text style={s.title}>Setup didn't work</Text>
            <Text style={s.subtitle}>{errorMsg}</Text>

            <TouchableOpacity style={s.primaryBtn} onPress={() => { setPhase('choose'); setErrorMsg(''); }}>
              <Text style={s.primaryBtnText}>Try again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.secondaryBtn} onPress={() => { setPhase('choose'); }}>
              <Text style={s.secondaryBtnText}>Try self-hosted instead</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.cloudBtn} onPress={handleUseCloud}>
              <Feather name="cloud" size={14} color={colors.textMuted} />
              <Text style={s.cloudText}>Use cloud mode</Text>
            </TouchableOpacity>

            <Text style={s.powered}>Powered by Gemma 4 E2B</Text>
          </View>
        )}

        {/* -- Cloud confirm -- */}
        {phase === 'cloud-confirm' && (
          <View style={s.center}>
            <Text style={s.title}>Cloud mode</Text>
            <Text style={s.subtitle}>
              Mittens will use cloud servers for AI processing. Your conversations are processed remotely but not stored by the provider.
            </Text>

            <TouchableOpacity style={s.primaryBtn} onPress={handleUseCloud}>
              <Text style={s.primaryBtnText}>Use cloud mode</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.skipBtn} onPress={() => setPhase('choose')}>
              <Text style={s.skipText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

// --------------------------------------------------------------------------
// Sub-views for the "choose" phase
// --------------------------------------------------------------------------

/**
 * Shown when device has enough RAM (7GB+) for on-device E2B.
 * Primary CTA = "Continue" to download E2B.
 */
function FullRAMChooseView({
  ollamaUrl, ollamaKey, ollamaModel,
  testingConnection, connectionResult,
  onUrlChange, onKeyChange, onModelChange, onConnect,
  onStartLocal, onCloud,
}: {
  ollamaUrl: string; ollamaKey: string; ollamaModel: string;
  testingConnection: boolean; connectionResult: boolean | null;
  onUrlChange: (v: string) => void; onKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onConnect: (mode: 'selfhost' | 'byok') => void;
  onStartLocal: () => void; onCloud: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <View style={s.center}>
      <Text style={s.title}>Private by default</Text>
      <Text style={s.subtitle}>
        Mittens runs on your device. Your data never leaves your phone.
      </Text>

      <View style={s.features}>
        <FeatureRow icon="shield" text="On-device AI processing" />
        <FeatureRow icon="lock" text="Your data stays private" />
        <FeatureRow icon="wifi-off" text="Works offline" />
      </View>

      <TouchableOpacity style={s.primaryBtn} onPress={onStartLocal}>
        <Text style={s.primaryBtnText}>Continue</Text>
      </TouchableOpacity>

      <Text style={s.sizeHint}>~2.6 GB download, runs on most modern phones</Text>

      {!showAdvanced ? (
        <TouchableOpacity style={s.advancedToggle} onPress={() => setShowAdvanced(true)}>
          <Text style={s.advancedText}>Other options</Text>
          <Feather name="chevron-down" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <SelfHostedSection
          ollamaUrl={ollamaUrl}
          ollamaKey={ollamaKey}
          ollamaModel={ollamaModel}
          testingConnection={testingConnection}
          connectionResult={connectionResult}
          onUrlChange={onUrlChange}
          onKeyChange={onKeyChange}
          onModelChange={onModelChange}
          onConnect={onConnect}
          onCloud={onCloud}
        />
      )}

      <Text style={s.powered}>Powered by Gemma 4 E2B</Text>
    </View>
  );
}

/**
 * Shown when device has insufficient RAM (<7GB) for on-device E2B.
 * Primary CTA = connect to self-hosted server.
 * E2B download is not offered (would fail after 2.6GB download).
 */
function LowRAMChooseView({
  deviceRAM,
  ollamaUrl, ollamaKey, ollamaModel,
  testingConnection, connectionResult,
  onUrlChange, onKeyChange, onModelChange, onConnect,
  onCloud,
}: {
  deviceRAM: number;
  ollamaUrl: string; ollamaKey: string; ollamaModel: string;
  testingConnection: boolean; connectionResult: boolean | null;
  onUrlChange: (v: string) => void; onKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onConnect: (mode: 'selfhost' | 'byok') => void;
  onCloud: () => void;
}) {
  return (
    <View style={s.center}>
      <Text style={s.title}>Connect your server</Text>
      <Text style={s.subtitle}>
        Your device has {deviceRAM.toFixed(1)} GB RAM. The on-device model needs 7 GB+, so Mittens will connect to your own server instead.
      </Text>

      <View style={s.features}>
        <FeatureRow icon="lock" text="Your data stays private" />
        <FeatureRow icon="server" text="Run models on your own hardware" />
        <FeatureRow icon="zap" text="No RAM or storage limits" />
      </View>

      <View style={s.ramBadge}>
        <Feather name="info" size={14} color={colors.textSecondary} />
        <Text style={s.ramBadgeText}>
          On-device AI requires 7 GB+ RAM. Use a Mac, PC, or cloud GPU to host the model, then connect from here.
        </Text>
      </View>

      <SelfHostedSection
        ollamaUrl={ollamaUrl}
        ollamaKey={ollamaKey}
        ollamaModel={ollamaModel}
        testingConnection={testingConnection}
        connectionResult={connectionResult}
        onUrlChange={onUrlChange}
        onKeyChange={onKeyChange}
        onModelChange={onModelChange}
        onConnect={onConnect}
        onCloud={onCloud}
        isPrimary
      />

      <Text style={s.powered}>Your server, your models</Text>
    </View>
  );
}

// --------------------------------------------------------------------------
// Shared components
// --------------------------------------------------------------------------

function SelfHostedSection({
  ollamaUrl, ollamaKey, ollamaModel,
  testingConnection, connectionResult,
  onUrlChange, onKeyChange, onModelChange, onConnect,
  onCloud, isPrimary = false,
}: {
  ollamaUrl: string; ollamaKey: string; ollamaModel: string;
  testingConnection: boolean; connectionResult: boolean | null;
  onUrlChange: (v: string) => void; onKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onConnect: (mode: 'selfhost' | 'byok') => void;
  onCloud: () => void;
  isPrimary?: boolean;
}) {
  return (
    <View style={s.advancedSection}>
      {!isPrimary && <View style={s.advancedDivider} />}

      <Text style={s.advLabel}>SELF-HOSTED</Text>
      <Text style={s.advHint}>Run your own model server (Ollama, vLLM, etc.)</Text>
      <TextInput
        style={s.advInput}
        value={ollamaUrl}
        onChangeText={onUrlChange}
        placeholder="http://192.168.x.x:11434"
        placeholderTextColor="#BBB"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextInput
        style={s.advInput}
        value={ollamaModel}
        onChangeText={onModelChange}
        placeholder="Model (default: gemma4:26b)"
        placeholderTextColor="#BBB"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[s.advLabel, { marginTop: 12 }]}>BRING YOUR OWN KEY</Text>
      <Text style={s.advHint}>Use your own API key with any OpenAI-compatible endpoint</Text>
      <TextInput
        style={s.advInput}
        value={ollamaKey}
        onChangeText={onKeyChange}
        placeholder="API key (sk-...)"
        placeholderTextColor="#BBB"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />

      {connectionResult === false && (
        <Text style={s.errorText}>Could not connect. Check URL and make sure server is running.</Text>
      )}
      {connectionResult === true && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Feather name="check-circle" size={14} color="#4CAF50" />
          <Text style={{ fontSize: 13, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
        </View>
      )}

      <TouchableOpacity
        style={[isPrimary ? s.primaryBtn : s.secondaryBtn, !ollamaUrl && { opacity: 0.4 }]}
        onPress={() => onConnect(ollamaKey ? 'byok' : 'selfhost')}
        disabled={!ollamaUrl || testingConnection}
      >
        {testingConnection
          ? <ActivityIndicator size="small" color={isPrimary ? '#FFF' : colors.textPrimary} />
          : <Text style={isPrimary ? s.primaryBtnText : s.secondaryBtnText}>Test connection</Text>
        }
      </TouchableOpacity>

      <View style={s.advancedDivider} />

      <TouchableOpacity style={s.cloudBtn} onPress={onCloud}>
        <Feather name="cloud" size={14} color={colors.textMuted} />
        <Text style={s.cloudText}>Use cloud instead</Text>
      </TouchableOpacity>
    </View>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={s.featureRow}>
      <Feather name={icon as any} size={16} color={colors.textSecondary} />
      <Text style={s.featureText}>{text}</Text>
    </View>
  );
}

// --------------------------------------------------------------------------
// Styles
// --------------------------------------------------------------------------

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  scrollContent: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: spacing.lg,
    marginTop: spacing.xl,
  },
  center: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 26,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  features: {
    alignSelf: 'stretch',
    marginBottom: spacing.lg,
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: spacing.lg,
  },
  featureText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  sizeHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: spacing.md,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  skipBtn: {
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  skipText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '500',
  },
  powered: {
    fontSize: 11,
    color: colors.textMuted,
    opacity: 0.5,
    marginTop: spacing.lg,
  },

  // RAM badge
  ramBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF8E1',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  ramBadgeText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // Advanced section
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  advancedText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  advancedSection: {
    width: '100%',
    marginTop: spacing.sm,
  },
  advancedDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  advLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  advHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  advInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: '#FAFAFA',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#E53E3E',
    marginBottom: 8,
  },
  cloudBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.sm,
  },
  cloudText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },

  // Progress
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.xl,
  },

  // Ready
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FFF4',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  readyText: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
});
