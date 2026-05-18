/**
 * MittensBrainSection -- Brain model selector, data storage, and download status.
 * Extracted from ProfileIntegrationsSection so Brain is its own top-level section.
 */
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ModelBenchmarkModal } from './ModelBenchmarkModal';
import {
  useBrainConfig, PRIVATE_MODELS,
  canRunModel, getDownloadSize, formatBytes,
} from '../../hooks/useBrainConfig';
import { colors, radius, spacing } from '../../lib/theme';
import { profileStyles as styles } from './profileStyles';

interface Props {
  profileContext: any;
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onSyncRequired?: () => void;
}

export function MittensBrainSection({ profileContext, collapsed, onToggle, onRefresh, onSyncRequired }: Props) {
  const brain = useBrainConfig(profileContext, onRefresh, onSyncRequired);

  const renderBrainPill = (model: any) => {
    const isExplicitlyDisabled = 'disabled' in model && model.disabled;
    const localModelId = 'localModelId' in model ? model.localModelId : undefined;
    const capabilityCheck = localModelId ? canRunModel(localModelId) : { canRun: true };
    const isDisabled = isExplicitlyDisabled || !capabilityCheck.canRun;
    const isActive = brain.currentModel === model.key;
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
        onPress={() => !isDisabled && brain.handleSelectBrain(model.key)}
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
      <TouchableOpacity style={[styles.sectionHeader, !collapsed && { marginBottom: spacing.sm }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="hard-drive" size={16} color={colors.textPrimary} />
          <Text style={styles.cardTitle}>MITTENS' BRAIN</Text>
          {brain.queueSize > 0 && (
            <Text style={styles.queueBadge}>{brain.queueSize} queued</Text>
          )}
        </View>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.md }}>{brain.brainDesc}</Text>

          {/* Brain selector */}
          <View style={{ paddingBottom: 8 }}>
            <View style={{ marginBottom: 6 }}>
              <Text style={styles.rowLabel}>MODELS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {PRIVATE_MODELS.map(renderBrainPill)}
              </ScrollView>
            </View>

            {/* Local VLM status */}
            {brain.isLocalVLM && brain.currentLocalModel && (
              <View style={{ marginTop: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Feather name="hard-drive" size={11} color={colors.textMuted} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5 }}>
                    {brain.currentLocalModel.name.toUpperCase()} -- {formatBytes(getDownloadSize(brain.currentLocalModel))}
                  </Text>
                </View>

                {brain.localDownloadProgress !== null && (
                  <View style={{ marginBottom: 6 }}>
                    <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${Math.round(brain.localDownloadProgress * 100)}%`, backgroundColor: colors.accent }} />
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {(brain.localDownloadProgress * 100).toFixed(0)}% -- {brain.localDownloadPhase || 'Downloading...'}
                    </Text>
                  </View>
                )}

                {brain.currentModel === 'gemma-e2b' && (
                  <>
                    {brain.downloadProgress !== null && (
                      <View style={{ marginBottom: 4 }}>
                        <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${Math.round(brain.downloadProgress * 100)}%`, backgroundColor: colors.accent }} />
                        </View>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{(brain.downloadProgress * 100).toFixed(0)}% of 2.6 GB</Text>
                      </View>
                    )}
                    {brain.gemmaStatus && brain.downloadProgress === null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <ActivityIndicator size="small" color={colors.textMuted} />
                        <Text style={{ fontSize: 12, color: colors.textMuted }}>{brain.gemmaStatus}</Text>
                      </View>
                    )}
                    {!brain.gemmaStatus && brain.downloadProgress === null && brain.gemmaLoaded && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="check-circle" size={12} color="#4CAF50" />
                        <Text style={{ fontSize: 12, color: '#4CAF50', fontWeight: '600' }}>Ready -- text + vision + audio</Text>
                      </View>
                    )}
                  </>
                )}

                {brain.currentModel !== 'gemma-e2b' && brain.localDownloadProgress === null && (
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name={brain.modelDownloaded ? 'check-circle' : 'download'} size={12} color={brain.modelDownloaded ? '#4CAF50' : colors.textMuted} />
                      <Text style={{ fontSize: 12, color: brain.modelDownloaded ? '#4CAF50' : colors.textMuted, fontWeight: brain.modelDownloaded ? '600' : '400' }}>
                        {brain.currentLocalModel.name} -- {brain.currentLocalModel.role === 'multimodal' ? 'vision + text' : 'text only'}
                      </Text>
                    </View>
                    {!brain.modelDownloaded && (
                      <TouchableOpacity
                        onPress={() => brain.downloadLocalModels()}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent, borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginTop: 4 }}
                      >
                        <Feather name="download" size={11} color="#fff" />
                        <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>Download ({formatBytes(getDownloadSize(brain.currentLocalModel))})</Text>
                      </TouchableOpacity>
                    )}
                    {brain.modelDownloaded && (
                      <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                        On-device inference. No network needed. Private by default.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Cloud ready badge */}
          {brain.isCloudReady && (
            <View style={{ paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 12, color: '#4CAF50', fontWeight: '600' }}>Ready to use</Text>
                <Text style={{ fontSize: 10, color: colors.textMuted }}>-- no setup needed</Text>
              </View>
            </View>
          )}

          {/* Ollama config */}
          {brain.isOllamaMode && (
            <View style={{ paddingBottom: 12 }}>
              <TextInput
                style={styles.configInput}
                value={brain.ollamaUrl}
                onChangeText={brain.setOllamaUrl}
                onBlur={brain.handleSaveOllamaConfig}
                placeholder={brain.currentModel === 'ollama-selfhost' ? 'http://192.168.x.x:11434' : 'https://api.openai.com/v1'}
                placeholderTextColor="#BBB"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {brain.currentModel === 'ollama-selfhost' && (
                <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: -4, marginBottom: 6, paddingHorizontal: 2 }}>
                  Your Mac's IP on same WiFi. Or use Tailscale for any network.
                </Text>
              )}
              {brain.currentModel === 'ollama-byok' && (
                <TextInput
                  style={styles.configInput}
                  value={brain.ollamaKey}
                  onChangeText={brain.setOllamaKey}
                  onBlur={brain.handleSaveOllamaConfig}
                  placeholder="API key (sk-...)"
                  placeholderTextColor="#BBB"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
              <TextInput
                style={styles.configInput}
                value={brain.ollamaModel}
                onChangeText={brain.setOllamaModel}
                onBlur={brain.handleSaveOllamaConfig}
                placeholder={brain.currentModel === 'ollama-selfhost' ? 'gemma4:27b' : 'gpt-4o'}
                placeholderTextColor="#BBB"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity
                  onPress={brain.handleTestOllamaConnection}
                  disabled={brain.ollamaTesting}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6, opacity: brain.ollamaTesting ? 0.6 : 1 }}
                >
                  {brain.ollamaTesting ? (
                    <ActivityIndicator size="small" color={colors.bg} />
                  ) : (
                    <Feather name="wifi" size={12} color={colors.bg} />
                  )}
                  <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Test Connection</Text>
                </TouchableOpacity>
                {brain.ollamaConnected === true && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={[styles.statusDot, { backgroundColor: '#4CAF50' }]} />
                    <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
                  </View>
                )}
                {brain.ollamaConnected === false && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={[styles.statusDot, { backgroundColor: '#E53935' }]} />
                    <Text style={{ fontSize: 11, color: '#E53935', fontWeight: '600' }}>Unreachable</Text>
                  </View>
                )}
              </View>
            </View>
          )}


          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
            <Feather name="lock" size={12} color={colors.textMuted} />
            <Text style={{ flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16 }}>
              Your data stays on your device and your backend. Mittens does not sell data.
            </Text>
          </View>
        </>
      )}
    </View>
    <ModelBenchmarkModal visible={brain.benchmarkVisible} onClose={() => brain.setBenchmarkVisible(false)} />
    </>
  );
}
