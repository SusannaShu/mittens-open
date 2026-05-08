import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function DevNotesPlaceholder() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Dev Notes Pipeline</Text>
      <Text style={styles.body}>
        This screen originally functioned as the mobile ingestion point for a custom NLP pipeline. Notes written here were parsed by the backend to automatically generate prioritized GitHub-style issues and route them to specific repositories.
      </Text>
      <Text style={styles.body}>
        In Mittens Open, this cloud-dependent workflow is removed, focusing the app entirely on the on-device AI inference and local life-tracking capabilities.
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
