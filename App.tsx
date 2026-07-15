/**
 * Peguei
 * @format
 */

import React, { useEffect, useRef } from 'react';
import { StatusBar, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import analytics from '@react-native-firebase/analytics';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { GalleryScreen } from './src/screens/GalleryScreen';
import { ClipPreviewScreen } from './src/screens/ClipPreviewScreen';
import { TipsScreen } from './src/screens/TipsScreen';
import { useOnboardingStore } from './src/store/onboardingStore';
import { usePermissions } from './src/hooks/usePermissions';
import { colors } from './src/theme/colors';
import type { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const hydrated = useOnboardingStore(s => s.hydrated);
  const hasCompletedOnboarding = useOnboardingStore(s => s.hasCompletedOnboarding);
  const hydrate = useOnboardingStore(s => s.hydrate);
  // Checking each permission is async (react-native-permissions' check()),
  // so on first render nothing is known yet -- picking initialRouteName
  // before this resolves would default to 'Permissions' and flash that
  // screen for a frame even when everything is already granted. Waiting
  // for `checked` lets the app skip straight to Camera instead.
  const { allGranted, checked } = usePermissions();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const currentRouteNameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  if (!hydrated || (hasCompletedOnboarding && !checked)) {
    // Reading the "onboarding seen" flag from AsyncStorage is near-instant; a
    // bare background view avoids flashing the wrong initial route.
    return <View style={styles.hydrating} testID="app-hydrating" />;
  }

  const initialRouteName: keyof RootStackParamList = !hasCompletedOnboarding
    ? 'Onboarding'
    : allGranted
      ? 'Camera'
      : 'Permissions';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          currentRouteNameRef.current = navigationRef.getCurrentRoute()?.name;
        }}
        onStateChange={() => {
          const previousRouteName = currentRouteNameRef.current;
          const currentRouteName = navigationRef.getCurrentRoute()?.name;
          if (currentRouteName && currentRouteName !== previousRouteName) {
            analytics()
              .logScreenView({ screen_name: currentRouteName, screen_class: currentRouteName })
              .catch(() => undefined);
          }
          currentRouteNameRef.current = currentRouteName;
        }}>
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{ headerStyle: { backgroundColor: colors.backgroundDark }, headerTintColor: colors.textDark }}>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Permissions" component={PermissionsScreen} options={{ title: 'Permissões' }} />
          <Stack.Screen name="Camera" component={CameraScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Configurações' }} />
          <Stack.Screen name="Gallery" component={GalleryScreen} options={{ title: 'Galeria' }} />
          <Stack.Screen name="ClipPreview" component={ClipPreviewScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Tips" component={TipsScreen} options={{ title: 'Dicas' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  hydrating: { flex: 1, backgroundColor: colors.backgroundDark },
});

export default App;
