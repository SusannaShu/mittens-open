import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { login } from '../../lib/api';
import { radius, spacing } from '../../lib/theme';

interface LoginScreenProps {
  onLogin: (user: any) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setError('Username/Email and password required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await login(identifier.trim(), password);
      onLogin(result.user);
    } catch (err: any) {
      if (err.message?.includes('Network') || err.message?.includes('Fetch')) {
        setError('Cannot reach backend. Is Strapi running? Check console for detected URL.');
      } else {
        setError('Invalid username/email or password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>mittens</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Username or Email"
            placeholderTextColor="#999"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.xl },

  title: {
    fontFamily: 'ArchivoBlack',
    fontSize: 48,
    color: '#000000',
    textAlign: 'center',
    marginBottom: spacing.xxl + spacing.lg,
    letterSpacing: -1,
  },

  form: { gap: 14 },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: '#000000',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  error: { color: '#D32F2F', fontSize: 14, textAlign: 'center' },

  loginBtn: {
    backgroundColor: '#000000',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  loginBtnDisabled: { opacity: 0.5 },
  loginBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
