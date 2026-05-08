import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function DevHubPlaceholder() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Dev Hub (Cloud)</Text>
      <Text style={styles.body}>
        This screen originally connected to the private Strapi v5 backend to monitor Docker containers, display real-time logs via WebSocket, and manage dev tasks.
      </Text>
      <Text style={styles.body}>
        In Mittens Open, cloud infrastructure has been removed to ensure the app is fully local-first and self-contained for the hackathon. All data here was previously populated by the private cloud API.
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
