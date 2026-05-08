/**
 * TypingIndicator -- Animated bouncing dots like iMessage.
 * Shows when Mittens is thinking/processing.
 * Optional label appears below dots to show current phase.
 */

import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { colors } from '../../lib/theme';

const DOT_SIZE = 6;
const BOUNCE_HEIGHT = -6;
const DURATION = 400;
const DELAYS = [0, 150, 300];

function Dot({ delay }: { delay: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: DURATION, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: DURATION, useNativeDriver: true }),
        Animated.delay(Math.max(0, 600 - delay)),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, BOUNCE_HEIGHT],
  });

  return (
    <Animated.View style={[styles.dot, { transform: [{ translateY }] }]} />
  );
}

interface Props {
  /** Optional label shown below dots (e.g. "Identifying items...") */
  label?: string | null;
}

export default function TypingIndicator({ label }: Props) {
  return (
    <View style={{ justifyContent: 'center' }}>
      {!label ? (
        <View style={styles.dotsRow}>
          {DELAYS.map((d, i) => <Dot key={i} delay={d} />)}
        </View>
      ) : (
        <Text style={[styles.label, { marginTop: 0, fontSize: 14, color: colors.textPrimary, fontStyle: 'italic' }]}>{label}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#999',
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    paddingHorizontal: 2,
  },
});
