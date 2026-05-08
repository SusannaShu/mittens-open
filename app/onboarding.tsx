import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useUpdateProfileMutation } from '../lib/services/profileApi';
import { colors, fonts, spacing, radius } from '../lib/theme';
import LocalAgentSetupModal from '../components/chat/LocalAgentSetupModal';

const FITZPATRICK_COLORS = {
  1: '#FAE0D0', // Type 1: Very fair
  2: '#F5CBA7', // Type 2: Fair
  3: '#E5B280', // Type 3: Light brown
  4: '#C68642', // Type 4: Moderate brown
  5: '#8D5524', // Type 5: Dark brown
  6: '#3C2218'  // Type 6: Deeply pigmented
};

export default function OnboardingScreen() {
  const router = useRouter();
  const [updateProfile] = useUpdateProfileMutation();
  
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [showAgentSetup, setShowAgentSetup] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [heightVal, setHeightVal] = useState(''); // Used for cm
  const [heightFt, setHeightFt] = useState('');
  const [heightInLocal, setHeightInLocal] = useState('');
  const [weightVal, setWeightVal] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'female' | 'male'>('female');
  const [unit, setUnit] = useState<'imperial' | 'metric'>('imperial');
  const [skinType, setSkinType] = useState('fitzpatrick-4');

  // LMST State
  const [homeLongitude, setHomeLongitude] = useState<number | null>(null);
  const [homeLatitude, setHomeLatitude] = useState<number | null>(null);
  const [homeLabel, setHomeLabel] = useState<string>('');
  const [chronotype, setChronotype] = useState<'morning' | 'intermediate' | 'evening'>('intermediate');
  const [sleepHours, setSleepHours] = useState<string>('8');
  const [lightPromptEnabled, setLightPromptEnabled] = useState<boolean>(true);
  const [gettingLocation, setGettingLocation] = useState(false);

  const requestLocation = async () => {
    setGettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission denied. You can enter a city manually.');
        setGettingLocation(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHomeLatitude(loc.coords.latitude);
      setHomeLongitude(loc.coords.longitude);
      const reverse = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (reverse && reverse.length > 0) {
        setHomeLabel(reverse[0].city || reverse[0].region || 'Home');
      }
    } catch (e) {
      alert('Failed to get location.');
    }
    setGettingLocation(false);
  };

  const handleNext = () => {
    if (step === 1 && !name.trim()) return;
    if (step === 2) {
      if (!weightVal || !age) {
        alert('Please fill in your biometrics');
        return;
      }
      if (unit === 'metric' && !heightVal) {
        alert('Please fill in your height');
        return;
      }
      if (unit === 'imperial' && (!heightFt || !heightInLocal)) {
        alert('Please fill in your height');
        return;
      }
    }
    if (step < 6) {
      if (step === 4) {
        if (homeLongitude === null && !homeLabel.trim()) {
           alert('Please select a location or enter one manually.');
           return;
        }
      }
      setStep(step + 1);
    } else {
      finishOnboarding();
    }
  };

  const finishOnboarding = async () => {
    setSubmitting(true);
    try {
      let payload: any = {
        name: name.trim(),
        age: parseInt(age, 10) || 30,
        sex,
        skinType,
        preferredUnit: unit,
        homeLongitude: homeLongitude,
        homeLatitude: homeLatitude,
        homeLabel: homeLabel,
        wakeTimeLmstMinutes: chronotype === 'morning' ? 360 : (chronotype === 'intermediate' ? 420 : 480),
        sleepHours: parseFloat(sleepHours) || 8,
        chronotype,
        lightPromptEnabled,
        scheduleMode: 'local_clock',
        scheduleTravelMode: 'home'
      };

      if (unit === 'imperial') {
         let computedInches = 0;
         if (heightFt || heightInLocal) {
            computedInches = (parseInt(heightFt, 10) || 0) * 12 + (parseInt(heightInLocal, 10) || 0);
         }
         payload.heightIn = computedInches || (sex === 'female' ? 64 : 69);
         payload.weightLb = parseFloat(weightVal) || (sex === 'female' ? 143 : 176);
      } else {
         payload.heightCm = parseInt(heightVal, 10) || (sex === 'female' ? 163 : 175);
         payload.weightKg = parseFloat(weightVal) || (sex === 'female' ? 65 : 80);
      }

      await updateProfile(payload).unwrap();
      // Show local agent setup instead of navigating directly
      setSubmitting(false);
      setShowAgentSetup(true);
    } catch (e: any) {
      alert('Failed to save profile: ' + e.message);
      setSubmitting(false);
    }
  };

  return (
    <>
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          
          {step === 1 && (
            <View style={styles.stepContainer}>
              <Text style={styles.title}>Welcome to Mittens</Text>
              <Text style={styles.subtitle}>Let's set up your intelligent health system. First, what should Mittens call you?</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Susanna"
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                autoFocus
              />
            </View>
          )}

          {step === 2 && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              <View style={[styles.stepContainer, { paddingTop: 20 }]}>
                <Text style={styles.title}>Core Biometrics</Text>
                <Text style={styles.subtitle}>This helps calculate your baseline Required Daily Allowances (RDA).</Text>
                
                <Text style={styles.label}>Measurement System</Text>
                <View style={[styles.row, { marginBottom: spacing.md }]}>
                  <TouchableOpacity style={[styles.choiceBtn, unit === 'imperial' && styles.choiceBtnActive]} onPress={() => setUnit('imperial')}>
                    <Text style={[styles.choiceText, unit === 'imperial' && styles.choiceTextActive]}>Imperial</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.choiceBtn, unit === 'metric' && styles.choiceBtnActive]} onPress={() => setUnit('metric')}>
                    <Text style={[styles.choiceText, unit === 'metric' && styles.choiceTextActive]}>Metric</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Biological Sex</Text>
                <View style={[styles.row, { marginBottom: spacing.md }]}>
                  <TouchableOpacity style={[styles.choiceBtn, sex === 'female' && styles.choiceBtnActive]} onPress={() => setSex('female')}>
                    <Text style={[styles.choiceText, sex === 'female' && styles.choiceTextActive]}>Female</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.choiceBtn, sex === 'male' && styles.choiceBtnActive]} onPress={() => setSex('male')}>
                    <Text style={[styles.choiceText, sex === 'male' && styles.choiceTextActive]}>Male</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>{unit === 'imperial' ? 'Height' : 'Height (cm)'}</Text>
                {unit === 'imperial' ? (
                  <View style={[styles.row, { gap: spacing.md }]}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput 
                        style={[styles.input, { flex: 1, marginBottom: 0 }]} 
                        keyboardType="numeric" 
                        value={heightFt} 
                        onChangeText={setHeightFt} 
                        placeholderTextColor={colors.textMuted} 
                        placeholder={sex === 'female' ? "5" : "5"} 
                      />
                      <Text style={{ marginLeft: 8, fontSize: 16, color: colors.textSecondary }}>ft</Text>
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput 
                        style={[styles.input, { flex: 1, marginBottom: 0 }]} 
                        keyboardType="numeric" 
                        value={heightInLocal} 
                        onChangeText={setHeightInLocal} 
                        placeholderTextColor={colors.textMuted} 
                        placeholder={sex === 'female' ? "4" : "9"} 
                      />
                      <Text style={{ marginLeft: 8, fontSize: 16, color: colors.textSecondary }}>in</Text>
                    </View>
                  </View>
                ) : (
                  <TextInput 
                    style={styles.input} 
                    keyboardType="numeric" 
                    value={heightVal} 
                    onChangeText={setHeightVal} 
                    placeholderTextColor={colors.textMuted} 
                    placeholder={sex === 'female' ? "e.g. 163" : "e.g. 175"} 
                  />
                )}
                <View style={{ marginBottom: spacing.md }} />
                
                <Text style={styles.label}>{unit === 'imperial' ? 'Weight (lbs)' : 'Weight (kg)'}</Text>
                <TextInput 
                  style={styles.input} 
                  keyboardType="numeric" 
                  value={weightVal} 
                  onChangeText={setWeightVal} 
                  placeholderTextColor={colors.textMuted} 
                  placeholder={unit === 'imperial' ? (sex === 'female' ? "e.g. 143" : "e.g. 176") : (sex === 'female' ? "e.g. 65" : "e.g. 80")} 
                />
                
                <Text style={styles.label}>Age</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={age} onChangeText={setAge} placeholderTextColor={colors.textMuted} placeholder="e.g. 25" />
              </View>
            </ScrollView>
          )}

        {step === 3 && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <View style={styles.stepContainer}>
              <Text style={styles.title}>Skin Type</Text>
              <Text style={styles.subtitle}>Select your Fitzpatrick skin type. This is used for Vitamin D synthesis and sun exposure estimations.</Text>
              
              {[1, 2, 3, 4, 5, 6].map(level => {
                const val = `fitzpatrick-${level}`;
                const p_color = FITZPATRICK_COLORS[level as keyof typeof FITZPATRICK_COLORS];
                return (
                  <TouchableOpacity 
                    key={val}
                    style={[styles.skinBtn, skinType === val && styles.skinBtnActive]} 
                    onPress={() => setSkinType(val)}
                  >
                    <View style={[styles.swatch, { backgroundColor: p_color }]} />
                    <Text style={[styles.skinText, skinType === val && styles.skinTextActive]}>Fitzpatrick Type {level}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}

        {step === 4 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Location Sandbox</Text>
            <Text style={styles.subtitle}>Mittens anchors your rhythm to the local solar time rather than a generic timezone. Where is home?</Text>
            
            <TouchableOpacity style={styles.geoBtn} onPress={requestLocation} disabled={gettingLocation}>
              {gettingLocation ? <ActivityIndicator color="#fff" /> : <Text style={styles.geoBtnText}>Get Current Location</Text>}
            </TouchableOpacity>

            <View style={{ marginTop: 24 }}>
              <Text style={styles.label}>Or enter your home city manually (Fallback Label)</Text>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. New York" 
                value={homeLabel} 
                onChangeText={setHomeLabel}
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.label}>Longitude Offset Approximation</Text>
              <TextInput 
                style={styles.input} 
                keyboardType="numbers-and-punctuation"
                placeholder="-74.006" 
                value={homeLongitude ? homeLongitude.toString() : ''} 
                onChangeText={(v) => setHomeLongitude(parseFloat(v))}
                placeholderTextColor={colors.textMuted}
              />
            </View>
          </View>
        )}

        {step === 5 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Your Rhythm</Text>
            <Text style={styles.subtitle}>When do you naturally feel most alert?</Text>
            
            <View style={styles.row}>
              <TouchableOpacity style={[styles.choiceBtn, chronotype === 'morning' && styles.choiceBtnActive]} onPress={() => setChronotype('morning')}>
                <Text style={[styles.choiceText, chronotype === 'morning' && styles.choiceTextActive]}>Morning (Early)</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.choiceBtn, chronotype === 'intermediate' && styles.choiceBtnActive]} onPress={() => setChronotype('intermediate')}>
                <Text style={[styles.choiceText, chronotype === 'intermediate' && styles.choiceTextActive]}>Intermediate</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity style={[styles.choiceBtn, chronotype === 'evening' && styles.choiceBtnActive]} onPress={() => setChronotype('evening')}>
                <Text style={[styles.choiceText, chronotype === 'evening' && styles.choiceTextActive]}>Evening (Late)</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ marginTop: 12, marginBottom: 24, fontSize: 13, color: colors.textSecondary }}>
              *Target wake time: {chronotype === 'morning' ? '6:00' : chronotype === 'intermediate' ? '7:00' : '8:00'} LMST 
            </Text>

            <Text style={styles.label}>Target Sleep Hours</Text>
            <TextInput 
                style={styles.input} 
                keyboardType="numeric"
                value={sleepHours} 
                onChangeText={setSleepHours}
                placeholder="8"
                placeholderTextColor={colors.textMuted}
              />
          </View>
        )}

        {step === 6 && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>Morning Nudge</Text>
            <Text style={styles.subtitle}>Mittens will nudge you at wake to get 10 minutes of outdoor light — this is the single highest-leverage habit for sleep and mood.</Text>
            
            <View style={[styles.row, { marginTop: 32 }]}>
              <TouchableOpacity style={[styles.choiceBtn, lightPromptEnabled === true && styles.choiceBtnActive]} onPress={() => setLightPromptEnabled(true)}>
                <Text style={[styles.choiceText, lightPromptEnabled === true && styles.choiceTextActive]}>Yes, enable</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.choiceBtn, lightPromptEnabled === false && styles.choiceBtnActive]} onPress={() => setLightPromptEnabled(false)}>
                <Text style={[styles.choiceText, lightPromptEnabled === false && styles.choiceTextActive]}>Not now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.footer}>
          <TouchableOpacity 
            style={[styles.nextBtn, (step === 1 && !name.trim()) && { opacity: 0.5 }]} 
            onPress={handleNext} 
            disabled={step === 1 && !name.trim()}
          >
            {submitting ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.nextBtnText}>{step === 6 ? 'Complete Setup' : 'Next'}</Text>}
          </TouchableOpacity>
        </View>

      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>

    {/* Local agent setup modal */}
    <LocalAgentSetupModal
      visible={showAgentSetup}
      onComplete={() => router.replace('/(tabs)')}
      onSkip={() => router.replace('/(tabs)')}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flex: 1, padding: spacing.xl, justifyContent: 'space-between' },
  
  stepContainer: { flex: 1, justifyContent: 'center' },
  title: { fontFamily: fonts.heading, fontSize: 32, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { fontSize: 16, color: colors.textSecondary, lineHeight: 24, marginBottom: spacing.xl },
  
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 18, color: colors.textPrimary,
    backgroundColor: '#FAFAFA'
  },
  
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  choiceBtn: {
    flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center'
  },
  choiceBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  choiceText: { fontSize: 16, color: colors.textSecondary, fontWeight: '600' },
  choiceTextActive: { color: colors.bg },

  skinBtn: {
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
    flexDirection: 'row', alignItems: 'center'
  },
  skinBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  swatch: { 
    width: 24, height: 24, borderRadius: 12, marginRight: spacing.md, 
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' 
  },
  skinText: { fontSize: 16, color: colors.textSecondary, fontWeight: '500' },
  skinTextActive: { color: colors.bg, fontWeight: '600' },

  footer: { paddingBottom: spacing.xl },
  nextBtn: {
    backgroundColor: colors.accent, paddingVertical: spacing.lg, borderRadius: radius.lg, alignItems: 'center'
  },
  nextBtnText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  geoBtn: {
    backgroundColor: '#34d399', padding: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.md
  },
  geoBtnText: { color: '#FFF', fontSize: 16, fontWeight: '600' }
});
