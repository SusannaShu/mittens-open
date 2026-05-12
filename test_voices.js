const { execSync } = require('child_process');
// We can't easily test expo-speech voices in pure Node since it relies on React Native.
// But we can just configure a known good iOS voice.
