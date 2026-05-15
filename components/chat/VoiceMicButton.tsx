/**
 * VoiceMicButton -- animated mic button for voice input.
 *
 * Tap to start listening, tap again to stop. Shows pulsing
 * animation while actively listening. Fills the text input
 * with transcript via onTranscript callback.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  requestVoicePermissions,
  startListening,
  stopListening,
  useSpeechRecognitionEvent,
} from '../../lib/services/ai/voiceService';

interface VoiceMicButtonProps {
  /** Called with interim/final transcript text as user speaks */
  onTranscript: (text: string) => void;
  /** Called when recognition ends with the final transcript */
  onFinalResult: (text: string) => void;
  /** Whether the parent is currently sending (disable mic) */
  disabled?: boolean;
  /** Button size (diameter) */
  size?: number;
}

export default function VoiceMicButton({
  onTranscript,
  onFinalResult,
  disabled = false,
  size = 36,
}: VoiceMicButtonProps) {
  const [listening, setListening] = useState(false);
  const [permissionChecked, setPermissionChecked] = useState(false);
  const initiatedHere = useRef(false);

  // Pulse animation
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);

  // Start pulsing animation when listening
  useEffect(() => {
    if (listening) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.6, { duration: 800, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.in(Easing.ease) }),
        ),
        -1,
        false,
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 800 }),
          withTiming(0, { duration: 800 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseScale);
      cancelAnimation(pulseOpacity);
      pulseScale.value = withTiming(1, { duration: 200 });
      pulseOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [listening]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  // Speech recognition event listeners
  useSpeechRecognitionEvent('start', () => {
    if (initiatedHere.current) {
      setListening(true);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (initiatedHere.current) {
      setListening(false);
      initiatedHere.current = false;
    }
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!initiatedHere.current) return;
    const transcript = event.results[0]?.transcript || '';
    if (event.isFinal) {
      initiatedHere.current = false;
      stopListening();
      onFinalResult(transcript);
    } else {
      onTranscript(transcript);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    if (!initiatedHere.current) return;
    setListening(false);
    initiatedHere.current = false;
    // "no-speech" is normal -- user tapped mic but didn't say anything
    if (event.error !== 'no-speech') {
      console.warn('[voice] Recognition error:', event.error, event.message);
    }
  });

  const handlePress = useCallback(async () => {
    if (disabled) return;

    if (listening) {
      // Stop listening
      initiatedHere.current = false;
      stopListening();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    // Request permissions on first use
    if (!permissionChecked) {
      const granted = await requestVoicePermissions();
      setPermissionChecked(true);
      if (!granted) {
        Alert.alert(
          'Microphone Access',
          'Mittens needs microphone and speech recognition permissions to use voice input. Enable them in Settings.',
        );
        return;
      }
    }

    // Start listening
    initiatedHere.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    startListening();
  }, [listening, disabled, permissionChecked, onTranscript, onFinalResult]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      {/* Pulse ring (visible only when listening) */}
      <Animated.View
        style={[
          styles.pulseRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
          pulseStyle,
        ]}
      />
      {/* Button */}
      <Animated.View
        style={[
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: listening ? '#E53935' : '#000',
          },
          disabled && styles.disabled,
        ]}
      >
        <Feather
          name={listening ? 'mic' : 'mic'}
          size={size * 0.45}
          color="#FFF"
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    backgroundColor: '#E53935',
  },
  button: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.3,
  },
});
