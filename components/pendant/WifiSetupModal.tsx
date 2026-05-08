/**
 * WifiSetupModal -- Full-screen modal for pendant WiFi provisioning.
 *
 * Shown when the pendant connects via BLE but has no WiFi configured.
 * Auto-detects the phone's current WiFi network name so the user
 * only needs to enter the password, or tap "Use Hotspot" for quick setup.
 *
 * Flow:
 *   1. Phone detects current WiFi/hotspot name via NetInfo
 *   2. User confirms network and enters password
 *   3. App sends wifi:SSID:PASSWORD:IP to pendant via BLE COMMAND
 *   4. Pendant stores in NVS and connects
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { wifiSetupStyles as styles } from './wifiSetupStyles';

interface Props {
  visible: boolean;
  mode?: 'setup' | 'hotspot_fix';
  lastWiFi?: string | null;
  onDismiss: () => void;
  onSubmit: (ssid: string, password: string) => Promise<void>;
}

type SetupStep = 'detect' | 'confirm' | 'sending' | 'done' | 'hotspot_fix';

export function WifiSetupModal({ visible, mode = 'setup', lastWiFi, onDismiss, onSubmit }: Props) {
  const [step, setStep] = useState<SetupStep>(mode === 'hotspot_fix' ? 'hotspot_fix' : 'detect');
  const [detectedSSID, setDetectedSSID] = useState<string | null>(null);
  const [ssid, setSSID] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [useManual, setUseManual] = useState(false);

  // Detect current WiFi or set initial step on mount
  useEffect(() => {
    if (!visible) {
      setStep(mode === 'hotspot_fix' ? 'hotspot_fix' : 'detect');
      setPassword('');
      setUseManual(false);
      return;
    }

    detectCurrentWifi();
  }, [visible]);

  const detectCurrentWifi = async () => {
    setStep('detect');
    try {
      const NetInfo = require('@react-native-community/netinfo').default;
      const state = await NetInfo.fetch();

      if (state.type === 'wifi' && state.details?.ssid) {
        setDetectedSSID(state.details.ssid);
        setSSID(state.details.ssid);
        setStep('confirm');
      } else {
        setDetectedSSID(null);
        setSSID('');
        setStep('confirm');
      }
    } catch {
      setDetectedSSID(null);
      setSSID('');
      setStep('confirm');
    }
  };

  const handleSubmit = async () => {
    if (!ssid.trim()) {
      Alert.alert('Network Name Required', 'Enter the WiFi or hotspot name.');
      return;
    }

    setStep('sending');
    try {
      await onSubmit(ssid, password);
      setStep('done');
      setTimeout(() => onDismiss(), 1500);
    } catch (err: any) {
      Alert.alert('Failed', err?.message || 'Could not send credentials to pendant.');
      setStep('confirm');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onDismiss} style={styles.closeButton}>
            <Feather name="x" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Pendant WiFi Setup</Text>
          <View style={styles.closeButton} />
        </View>

        {step === 'detect' && (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.textPrimary} />
            <Text style={styles.detectText}>Detecting your WiFi network...</Text>
          </View>
        )}

        {step === 'hotspot_fix' && (
          <View style={styles.body}>
            <View style={styles.detectedCard}>
              <View style={styles.detectedHeader}>
                <Feather name="alert-circle" size={16} color={colors.tagQuestionText} />
                <Text style={styles.detectedLabel}>Connection Failed</Text>
              </View>
              <Text style={styles.detectedSSID}>{lastWiFi || 'Hotspot'}</Text>
              <Text style={[styles.description, { marginTop: 12, marginBottom: 0 }]}>
                The pendant couldn't connect. If you are using your iPhone's Personal Hotspot, iOS often suspends it to save power.
                {'\n\n'}
                1. Open Settings {'>'} Personal Hotspot{'\n'}
                2. Toggle "Allow Others to Join" OFF and ON again{'\n'}
                3. The pendant will automatically reconnect!
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: colors.tagFeatureText, marginTop: 24 }]}
              onPress={onDismiss}
              activeOpacity={0.7}
            >
              <Text style={styles.submitText}>I toggled it, Dismiss</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.hotspotButton}
              onPress={() => setStep('detect')}
              activeOpacity={0.7}
            >
              <Feather name="edit-2" size={16} color={colors.textSecondary} />
              <Text style={styles.hotspotText}>Re-enter WiFi Credentials</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'confirm' && (
          <View style={styles.body}>
            <Text style={styles.description}>
              Choose the WiFi network your pendant will use to send photos and audio
              to your phone. Both devices need to be on the same network.
            </Text>

            {/* Detected network card */}
            {detectedSSID && !useManual && (
              <View style={styles.detectedCard}>
                <View style={styles.detectedHeader}>
                  <Feather name="wifi" size={16} color="#4CAF50" />
                  <Text style={styles.detectedLabel}>Current Network</Text>
                </View>
                <Text style={styles.detectedSSID}>{detectedSSID}</Text>
                <Text style={styles.detectedHint}>
                  Enter the password to share this network with your pendant.
                </Text>
              </View>
            )}

            {/* Manual SSID input */}
            {(!detectedSSID || useManual) && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Network Name</Text>
                <TextInput
                  style={styles.input}
                  value={ssid}
                  onChangeText={setSSID}
                  placeholder="WiFi or hotspot name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>
            )}

            {/* Password input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="WiFi password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={!!detectedSSID && !useManual}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((v) => !v)}
                >
                  <Feather
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={16}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Toggle between detected and manual */}
            {detectedSSID && (
              <TouchableOpacity
                onPress={() => {
                  setUseManual((v) => !v);
                  if (useManual) setSSID(detectedSSID);
                  else setSSID('');
                }}
                style={styles.toggleLink}
              >
                <Text style={styles.toggleText}>
                  {useManual ? 'Use detected network' : 'Enter network manually'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Hotspot shortcut */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.hotspotButton}
              onPress={() => {
                Alert.alert(
                  'Use Personal Hotspot',
                  'In Settings > Personal Hotspot:\n\n1. Turn ON "Allow Others to Join"\n2. Turn ON "Maximize Compatibility" (required -- the pendant only supports 2.4GHz WiFi)\n\nYour hotspot name is your device name (Settings > General > About > Name).',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Enter Hotspot Info',
                      onPress: () => {
                        setUseManual(true);
                        setSSID('');
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <Feather name="smartphone" size={16} color={colors.textSecondary} />
              <Text style={styles.hotspotText}>Use Phone Hotspot Instead</Text>
            </TouchableOpacity>

            {/* Submit */}
            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSubmit}
              activeOpacity={0.7}
            >
              <Feather name="send" size={16} color="#FFF" />
              <Text style={styles.submitText}>Send to Pendant</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'sending' && (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={colors.textPrimary} />
            <Text style={styles.detectText}>Sending credentials to pendant...</Text>
            <Text style={styles.subText}>
              The pendant will connect to this network and start sending data.
            </Text>
          </View>
        )}

        {step === 'done' && (
          <View style={styles.centerContent}>
            <Feather name="check-circle" size={48} color="#4CAF50" />
            <Text style={styles.doneText}>WiFi Configured</Text>
            <Text style={styles.subText}>
              Your pendant is connecting to the network.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}
