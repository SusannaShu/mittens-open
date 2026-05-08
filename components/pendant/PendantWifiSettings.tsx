/**
 * PendantWifiSettings -- WiFi credential input for pendant provisioning.
 *
 * When the pendant is BLE-connected, saving credentials pushes them
 * to the pendant via BLE COMMAND characteristic. The pendant stores
 * them in NVS and uses them for all WiFi connections.
 *
 * When disconnected, credentials are saved locally (AsyncStorage)
 * and will be pushed on next BLE connection.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

const STORAGE_KEY = '@mittens_pendant_wifi';

interface WifiConfig {
  ssid: string;
  password: string;
  phoneIP: string;
}

const DEFAULT_CONFIG: WifiConfig = {
  ssid: '',
  password: '',
  phoneIP: '172.20.10.1',
};

interface Props {
  isConnected: boolean;
  onSendToPendant: (ssid: string, password: string) => Promise<void>;
}

export function PendantWifiSettings({ isConnected, onSendToPendant }: Props) {
  const [config, setConfig] = useState<WifiConfig>(DEFAULT_CONFIG);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          setConfig({ ...DEFAULT_CONFIG, ...parsed });
        }
      } catch {
        // Use defaults
      }
      setLoaded(true);
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!config.ssid.trim()) {
      Alert.alert('WiFi Name Required', 'Enter the WiFi or hotspot name.');
      return;
    }

    setSaving(true);
    try {
      // Save locally
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));

      // Push to pendant if BLE connected
      if (isConnected) {
        await onSendToPendant(config.ssid, config.password);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save WiFi settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        {isConnected
          ? 'Credentials will be sent to pendant over BLE.'
          : 'Saved locally. Will be sent when pendant connects.'}
      </Text>

      {/* SSID */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Network Name</Text>
        <TextInput
          style={styles.input}
          value={config.ssid}
          onChangeText={(text) => setConfig((c) => ({ ...c, ssid: text }))}
          placeholder="WiFi or hotspot name"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Password */}
      <View style={styles.inputGroup}>
        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            value={config.password}
            onChangeText={(text) => setConfig((c) => ({ ...c, password: text }))}
            placeholder="WiFi password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => setShowPassword((v) => !v)}
            activeOpacity={0.7}
          >
            <Feather
              name={showPassword ? 'eye-off' : 'eye'}
              size={14}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[
          styles.saveButton,
          saved && styles.saveButtonDone,
          saving && styles.saveButtonSaving,
        ]}
        onPress={handleSave}
        activeOpacity={0.7}
        disabled={saving}
      >
        <Feather
          name={saved ? 'check' : isConnected ? 'send' : 'save'}
          size={14}
          color={saved ? '#FFF' : colors.textPrimary}
        />
        <Text style={[styles.saveText, saved && styles.saveTextDone]}>
          {saving
            ? 'Sending...'
            : saved
            ? 'Sent to Pendant'
            : isConnected
            ? 'Send to Pendant'
            : 'Save WiFi Settings'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  hint: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: '#FAFAFA',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  passwordInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  eyeButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#FAFAFA',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    marginTop: 4,
  },
  saveButtonDone: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  saveButtonSaving: {
    opacity: 0.6,
  },
  saveText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  saveTextDone: {
    color: '#FFF',
  },
});
