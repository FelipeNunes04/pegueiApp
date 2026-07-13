/**
 * VoiceCam Buffer
 * @format
 */

import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { GalleryScreen } from './src/screens/GalleryScreen';
import { ClipPreviewScreen } from './src/screens/ClipPreviewScreen';
import { useOnboardingStore } from './src/store/onboardingStore';
import { colors } from './src/theme/colors';
import type { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const hydrated = useOnboardingStore(s => s.hydrated);
  const hasCompletedOnboarding = useOnboardingStore(s => s.hasCompletedOnboarding);
  const hydrate = useOnboardingStore(s => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated) {
    // Reading the "onboarding seen" flag from AsyncStorage is near-instant; a
    // bare background view avoids flashing the wrong initial route.
    return <View style={styles.hydrating} testID="app-hydrating" />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={hasCompletedOnboarding ? 'Permissions' : 'Onboarding'}
          screenOptions={{ headerStyle: { backgroundColor: colors.backgroundDark }, headerTintColor: colors.textDark }}>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: 'Permissões' }} />
          <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Configurações' }} />
          <Stack.Screen name="Gallery" component={GalleryScreen} options={{ title: 'Galeria' }} />
          <Stack.Screen name="ClipPreview" component={ClipPreviewScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  hydrating: { flex: 1, backgroundColor: colors.backgroundDark },
});

export default App;
