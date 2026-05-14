import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { useFocusTimer } from '../../hooks/useFocusTimer';
import { CalendarEvent } from './CalendarDayView';

interface Props {
  ongoingLocation?: CalendarEvent;
}

export default function OngoingBanner({ ongoingLocation }: Props) {
  const { isRunning, activityName, category, getElapsed, clearTimer } = useFocusTimer();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning || ongoingLocation) {
      setElapsed(isRunning ? getElapsed() : Math.round((Date.now() - new Date(ongoingLocation!.loggedAt).getTime()) / 1000));
      interval = setInterval(() => {
        setElapsed(isRunning ? getElapsed() : Math.round((Date.now() - new Date(ongoingLocation!.loggedAt).getTime()) / 1000));
      }, 1000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isRunning, ongoingLocation, getElapsed]);

  if (!isRunning && !ongoingLocation) return null;

  const isLocation = !isRunning && !!ongoingLocation;
  const title = isRunning ? `Focus: ${activityName || category}` : `${ongoingLocation?.title}`;

  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  
  const timeStr = hours > 0 
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View style={styles.dot} />
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.time}>{timeStr}</Text>
        </View>
      </View>
      {!isLocation && (
        <TouchableOpacity style={styles.stopBtn} onPress={clearTimer}>
          <Feather name="square" size={14} color="#FFF" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: '#000',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADE80',
    shadowColor: '#4ADE80', shadowOpacity: 0.5, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  title: {
    color: '#FFF', fontSize: 13, fontWeight: '600',
  },
  time: {
    color: '#A0AEC0', fontSize: 11, fontWeight: '500', marginTop: 2, fontVariant: ['tabular-nums'],
  },
  stopBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.full,
  },
});
