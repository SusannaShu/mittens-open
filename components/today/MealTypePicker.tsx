import { useState } from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '../../lib/theme';

const TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Drink'];

interface Props {
  value: string;
  onChange: (type: string) => void;
}

export default function MealTypePicker({ value, onChange }: Props) {
  const [showRightFade, setShowRightFade] = useState(true);
  const [showLeftFade, setShowLeftFade] = useState(false);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setShowLeftFade(contentOffset.x > 4);
    setShowRightFade(contentOffset.x + layoutMeasurement.width < contentSize.width - 4);
  };

  return (
    <View style={s.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ gap: 8, paddingRight: 20 }}
      >
        {TYPES.map(t => (
          <TouchableOpacity
            key={t}
            style={[s.pill, value === t.toLowerCase() && s.pillActive]}
            onPress={() => onChange(t.toLowerCase())}
          >
            <Text style={[s.pillText, value === t.toLowerCase() && s.pillTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Right fade */}
      {showRightFade && (
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.fadeRight}
          pointerEvents="none"
        />
      )}

      {/* Left fade */}
      {showLeftFade && (
        <LinearGradient
          colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.fadeLeft}
          pointerEvents="none"
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: 'relative',
    marginBottom: spacing.md,
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  pillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  pillText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.bg,
    fontWeight: '600',
  },
  fadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 32,
  },
  fadeLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 24,
  },
});
