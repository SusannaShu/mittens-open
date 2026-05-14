/**
 * LocationEditSection -- Location-specific UI sections for ActivityEditModal.
 *
 * Renders the Timeline row (tappable, opens LocationTimelineModal) and
 * the trail info view for movement sessions.
 */

import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { activityEditStyles as s } from './activityEditStyles';
import LocationTimelineModal from '../reflect/LocationTimelineModal';
import type { LocationSession } from '../../lib/services/location/locationSessionApi';

interface TimelineRowProps {
  observationCount: number;
  onPress: () => void;
}

/** Tappable row showing observation count, opens LocationTimelineModal */
export function TimelineRow({ observationCount, onPress }: TimelineRowProps) {
  return (
    <TouchableOpacity
      style={locationStyles.container}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <Feather name="clock" size={16} color={colors.textPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={locationStyles.title}>Timeline</Text>
        <Text style={locationStyles.subtitle}>
          {observationCount} observation{observationCount !== 1 ? 's' : ''}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

interface LocationFieldProps {
  locationSession: LocationSession;
  location: string;
  setLocation: (val: string) => void;
}

/** Location field: trail info for movement sessions, text input for stationary */
export function LocationField({ locationSession, location, setLocation }: LocationFieldProps) {
  const isTrail = locationSession.motionType !== 'stationary' && (locationSession.path?.length ?? 0) > 1;

  if (isTrail) {
    return (
      <View style={locationStyles.trailInfo}>
        <Feather name="navigation" size={14} color={colors.textSecondary} />
        <Text style={locationStyles.trailText}>
          {locationSession.motionType} trail
          {locationSession.duration_min ? ` -- ${locationSession.duration_min} min` : ''}
          {locationSession.path?.length > 0 ? ` -- ${locationSession.path.length} points` : ''}
        </Text>
      </View>
    );
  }

  return (
    <TextInput
      style={s.input}
      value={location}
      onChangeText={setLocation}
      placeholder="Where did this happen?"
      placeholderTextColor={colors.textMuted}
    />
  );
}

interface LocationTimelineProps {
  visible: boolean;
  session: LocationSession | null;
  title: string;
  onClose: () => void;
}

/** Wrapper for LocationTimelineModal integration */
export function LocationTimeline({ visible, session, title, onClose }: LocationTimelineProps) {
  return (
    <LocationTimelineModal
      visible={visible}
      session={session}
      title={title}
      onClose={onClose}
    />
  );
}

const locationStyles = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: spacing.md, marginBottom: spacing.sm,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  title: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12, color: colors.textMuted, marginTop: 1,
  },
  trailInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: '#F0FFF0',
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: '#D4EDDA',
  },
  trailText: {
    fontSize: 13, color: colors.textSecondary,
    textTransform: 'capitalize',
  },
});
