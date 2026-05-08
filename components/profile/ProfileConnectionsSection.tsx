/**
 * ProfileConnectionsSection -- External services and data sources only.
 * Brain, Data Storage, and model selection have been moved to MittensBrainSection.
 */
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { updateProfile } from '../../lib/api';
import { connectGoogleCalendar } from '../../lib/services/calendarService';
import { connectGmail, isGmailConnected } from '../../lib/services/gmailService';
import { colors, radius, spacing } from '../../lib/theme';
import { profileStyles as styles } from './profileStyles';

interface Props {
  profileContext: any;
  onRefresh: () => void;
}

export function ProfileConnectionsSection({ profileContext, onRefresh }: Props) {
  const [gmailConnected, setGmailConnected] = useState(false);

  useEffect(() => {
    isGmailConnected().then(setGmailConnected);
  }, []);

  return (
    <View style={[styles.card, { marginTop: 0 }]}>
      <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.md }}>
        External services and data
      </Text>

          {/* Google Calendar */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="calendar" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Google Calendar</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Events, schedule, departure alarms</Text>
            </View>
            {profileContext?.googleCalendarToken?.accessToken ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={async () => {
                  const ok = await connectGoogleCalendar();
                  if (ok) { onRefresh(); Alert.alert('Connected', 'Google Calendar is now synced.'); }
                  else Alert.alert('Failed', 'Could not connect Google Calendar.');
                }}
                style={{ backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Location */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="map-pin" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Location</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Geofencing for known places, travel time</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Feather name="check-circle" size={12} color="#4CAF50" />
              <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Active</Text>
            </View>
          </View>



          {/* Gmail */}
          <View style={styles.integrationRow}>
            <View style={styles.integrationIcon}>
              <Feather name="mail" size={18} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Gmail</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Search, read, and send emails</Text>
            </View>
            {gmailConnected ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Feather name="check-circle" size={12} color="#4CAF50" />
                <Text style={{ fontSize: 11, color: '#4CAF50', fontWeight: '600' }}>Connected</Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={async () => {
                  const ok = await connectGmail();
                  if (ok) {
                    setGmailConnected(true);
                    onRefresh();
                    Alert.alert('Connected', 'Gmail is now connected.');
                  } else {
                    Alert.alert('Failed', 'Could not connect Gmail.');
                  }
                }}
                style={{ backgroundColor: colors.textPrimary, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.bg, fontWeight: '600' }}>Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Future integrations */}
          {[
            { icon: 'heart' as const, title: 'Apple Health', desc: 'Workouts, steps, menstrual cycle, sleep' },
            { icon: 'message-square' as const, title: 'iMessage', desc: 'Message monitoring, notification triage' },
          ].map((item, idx) => (
            <View key={idx} style={styles.integrationRow}>
              <View style={styles.integrationIcon}>
                <Feather name={item.icon} size={18} color={colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>{item.title}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>{item.desc}</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>Coming soon</Text>
            </View>
          ))}
    </View>
  );
}
