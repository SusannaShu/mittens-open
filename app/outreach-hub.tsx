import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function OutreachHubPlaceholder() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Outreach Hub</Text>
      <Text style={styles.body}>
        This screen originally managed a private email and CRM workflow, routing interactions through the cloud backend for processing using LLMs.
      </Text>
      <Text style={styles.body}>
        To preserve privacy and ensure a fully local-first experience for this open source release, the cloud email integration has been entirely removed.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 24,
    paddingTop: 80,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
    color: '#111',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
    marginBottom: 16,
  },
});
