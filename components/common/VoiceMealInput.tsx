/**
 * VoiceMealInput -- Microphone button for dictating food descriptions.
 * Uses expo-speech-recognition for on-device speech-to-text.
 * Appends transcribed text to the parent's text field.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TouchableOpacity, Alert, Platform, StyleSheet, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

interface VoiceMealInputProps {
  onTranscript: (text: string) => void;
}

export default function VoiceMealInput({ onTranscript }: VoiceMealInputProps) {
  const [isListening, setIsListening] = useState(false);
  const partialRef = useRef('');
  const moduleRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      // Cleanup: stop recognition on unmount
      if (isListening && moduleRef.current) {
        try { moduleRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, [isListening]);

  const toggleListening = useCallback(async () => {
    try {
      const { ExpoSpeechRecognitionModule } = require('expo-speech-recognition');
      moduleRef.current = ExpoSpeechRecognitionModule;

      if (isListening) {
        ExpoSpeechRecognitionModule.stop();
        setIsListening(false);
        return;
      }

      // Check / request permissions
      const { status } = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (status !== 'granted') {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Microphone Access', 'Microphone permission is needed for voice input.');
          return;
        }
      }

      partialRef.current = '';

      // Listen for results via the event emitter
      const addListener = ExpoSpeechRecognitionModule.addListener;
      if (addListener) {
        const resultSub = addListener('result', (event: any) => {
          const transcript = event.results?.[0]?.transcript || '';
          if (event.isFinal && transcript) {
            onTranscript(transcript);
            partialRef.current = '';
          } else {
            partialRef.current = transcript;
          }
        });

        const endSub = addListener('end', () => {
          setIsListening(false);
          // Flush any remaining partial
          if (partialRef.current) {
            onTranscript(partialRef.current);
            partialRef.current = '';
          }
          resultSub?.remove?.();
          endSub?.remove?.();
        });

        const errorSub = addListener('error', (event: any) => {
          console.warn('[VoiceMealInput] Recognition error:', event?.error);
          setIsListening(false);
          errorSub?.remove?.();
        });
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        contextualStrings: [
          'eggs', 'avocado', 'toast', 'chicken', 'rice', 'salad',
          'broccoli', 'salmon', 'pasta', 'oatmeal', 'yogurt', 'banana',
          'coffee', 'orange juice', 'smoothie', 'sandwich', 'soup',
        ],
      });

      setIsListening(true);
    } catch (err: any) {
      console.error('[VoiceMealInput] Failed to start:', err?.message);
      Alert.alert('Voice Input', 'Speech recognition is not available on this device.');
      setIsListening(false);
    }
  }, [isListening, onTranscript]);

  return (
    <TouchableOpacity
      style={[styles.iconBtn, isListening && styles.iconBtnActive]}
      onPress={toggleListening}
      activeOpacity={0.6}
    >
      <Feather
        name="mic"
        size={20}
        color={isListening ? '#D32F2F' : colors.textSecondary}
      />
      {isListening && <View style={styles.recordingDot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnActive: {
    backgroundColor: '#FFEBEE',
  },
  recordingDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D32F2F',
  },
});
