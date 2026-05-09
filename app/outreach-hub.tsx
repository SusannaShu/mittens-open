/**
 * Outreach Hub screen -- not available in open-source version.
 */

import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '../lib/theme';

export default function OutreachHubScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Outreach Hub</Text>
      <Text style={styles.subtitle}>This feature requires a connected backend.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { fontSize: 20, fontFamily: fonts.heading, color: colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
});
