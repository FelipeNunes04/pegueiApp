/**
 * Peguei
 * @format
 */

import React, { useEffect, useRef } from 'react';
import { StatusBar, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { initAnalytics, screen, track } from './src/analytics';
import { initFishingSessions } from './src/analytics/fishingSession';
import { startLifecycleAnalytics } from './src/analytics/lifecycle';
import {
  markAppStartForCameraTrace,
  markCameraColdStartEligible,
} from './src/features/camera/hooks/useCircularBuffer';
import { installStorageWarning } from './src/features/camera/storageWarning';
import { OnboardingScreen } from './src/features/onboarding/OnboardingScreen';
import { OnboardingProfileScreen } from './src/features/onboarding/OnboardingProfileScreen';
import { PermissionsScreen } from './src/features/permissions/PermissionsScreen';
import { CameraScreen } from './src/features/camera/CameraScreen';
import { SettingsScreen } from './src/features/settings/SettingsScreen';
import { GalleryScreen } from './src/features/gallery/GalleryScreen';
import { ClipPreviewScreen } from './src/features/gallery/ClipPreviewScreen';
import { TipsScreen } from './src/features/tips/TipsScreen';
import { ExportScreen } from './src/features/export/ExportScreen';
import { initRemoteConfig } from './src/config/remoteConfig';
import { prefetchSponsorAssets } from './src/features/export/sponsorAssets';
import { useOnboardingStore } from './src/features/onboarding/store/onboardingStore';
import { useProfileStore } from './src/features/onboarding/store/profileStore';
import { usePermissions } from './src/features/permissions/hooks/usePermissions';
import { colors } from './src/shared/theme/colors';
import type { RootStackParamList } from './src/shared/types';
import { styles } from './App.styles';

const Stack = createNativeStackNavigator<RootStackParamList>();

// As early as possible: camera_cold_start counts from the bundle starting.
markAppStartForCameraTrace();

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const hydrated = useOnboardingStore(s => s.hydrated);
  const hasCompletedOnboarding = useOnboardingStore(
    s => s.hasCompletedOnboarding,
  );
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

  useEffect(() => {
    initAnalytics();
    track('app_opened');
    startLifecycleAnalytics();
    installStorageWarning();
    initFishingSessions().catch(() => undefined);
    useProfileStore.getState().hydrate();
    // Background only: the app never waits for Remote Config.
    initRemoteConfig()
      .then(() => prefetchSponsorAssets())
      .catch(() => undefined);
  }, []);

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
  if (initialRouteName === 'Camera') markCameraColdStartEligible();

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
            screen(currentRouteName);
          }
          currentRouteNameRef.current = currentRouteName;
        }}
      >
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{
            headerStyle: { backgroundColor: colors.backgroundDark },
            headerTintColor: colors.textDark,
          }}
        >
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="OnboardingProfile"
            component={OnboardingProfileScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Permissions"
            component={PermissionsScreen}
            options={{ title: 'Permissões' }}
          />
          <Stack.Screen
            name="Camera"
            component={CameraScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Configurações' }}
          />
          <Stack.Screen
            name="Gallery"
            component={GalleryScreen}
            options={{ title: 'Galeria' }}
          />
          <Stack.Screen
            name="ClipPreview"
            component={ClipPreviewScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ExportClip"
            component={ExportScreen}
            options={{ title: 'Exportar vídeo' }}
          />
          <Stack.Screen
            name="Tips"
            component={TipsScreen}
            options={{ title: 'Dicas' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default App;
