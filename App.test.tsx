/**
 * @format
 */

import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import analytics from '@react-native-firebase/analytics';
import App from './App';
import { useOnboardingStore } from './src/features/onboarding/store/onboardingStore';
import { usePermissions } from './src/features/permissions/hooks/usePermissions';

// The Camera and Permissions screens drive native camera / permission
// modules that have their own dedicated test suites; App's job is only
// picking the initial route and reporting screen views, so they're stubbed
// with minimal screens that can trigger navigation.
// The real SafeAreaProvider renders nothing until native reports insets.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('./src/features/camera/CameraScreen', () => {
  const { Pressable: P, Text: T, View: V } = require('react-native');
  return {
    CameraScreen: ({ navigation }: { navigation: { navigate: (r: string) => void; setParams: (p: object) => void } }) => (
      <V testID="camera-screen">
        <P testID="stub-open-gallery" onPress={() => navigation.navigate('Gallery')}>
          <T>gallery</T>
        </P>
        <P testID="stub-set-params" onPress={() => navigation.setParams({})}>
          <T>params</T>
        </P>
      </V>
    ),
  };
});

jest.mock('./src/features/permissions/PermissionsScreen', () => {
  const { Pressable: P, Text: T, View: V } = require('react-native');
  return {
    PermissionsScreen: ({ navigation }: { navigation: { replace: (r: string) => void } }) => (
      <V testID="permissions-screen">
        <P testID="stub-permissions-done" onPress={() => navigation.replace('Camera')}>
          <T>done</T>
        </P>
      </V>
    ),
  };
});

jest.mock('./src/features/permissions/hooks/usePermissions', () => ({
  usePermissions: jest.fn(),
}));

const mockedUsePermissions = usePermissions as jest.Mock;
const mockedUseColorScheme = useColorScheme as jest.Mock;
const mockedLogScreenView = analytics().logScreenView as jest.Mock;

function permissionsState(overrides: Partial<{ allGranted: boolean; checked: boolean }> = {}) {
  return {
    statuses: {},
    requestPermission: jest.fn(),
    refresh: jest.fn(),
    allGranted: false,
    checked: true,
    ...overrides,
  };
}

test('renders correctly', async () => {
  mockedUsePermissions.mockReturnValue(permissionsState());
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  // Unmount so this tree's store subscriptions don't outlive the test.
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

describe('App', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    useOnboardingStore.setState({ hydrated: false, hasCompletedOnboarding: false });
    mockedUsePermissions.mockReturnValue(permissionsState());
    mockedUseColorScheme.mockReturnValue('light');
  });

  it('shows a blank hydrating view (no route yet) until the onboarding flag has been read', async () => {
    let finishRead: (value: string | null) => void = () => undefined;
    jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(
      new Promise(resolve => {
        finishRead = resolve;
      }),
    );

    const { getByTestId, queryByTestId } = await render(<App />);
    expect(getByTestId('app-hydrating')).toBeTruthy();
    expect(queryByTestId('onboarding-screen')).toBeNull();

    await act(async () => {
      finishRead(null);
    });
    expect(getByTestId('onboarding-screen')).toBeTruthy();
  });

  it('starts at onboarding on first launch, without waiting on the permission check', async () => {
    mockedUsePermissions.mockReturnValue(permissionsState({ checked: false }));

    const { findByTestId } = await render(<App />);

    expect(await findByTestId('onboarding-screen')).toBeTruthy();
  });

  it('keeps showing the hydrating view while permissions are still being checked for a returning user', async () => {
    await AsyncStorage.setItem('peguei:onboardingCompleted', 'true');
    mockedUsePermissions.mockReturnValue(permissionsState({ checked: false }));

    const { getByTestId, queryByTestId, rerender } = await render(<App />);
    await waitFor(() => expect(useOnboardingStore.getState().hydrated).toBe(true));

    expect(getByTestId('app-hydrating')).toBeTruthy();
    expect(queryByTestId('permissions-screen')).toBeNull();

    mockedUsePermissions.mockReturnValue(permissionsState({ checked: true, allGranted: true }));
    await rerender(<App />);
    expect(getByTestId('camera-screen')).toBeTruthy();
  });

  it('goes straight to the camera for a returning user with every permission granted', async () => {
    await AsyncStorage.setItem('peguei:onboardingCompleted', 'true');
    mockedUsePermissions.mockReturnValue(permissionsState({ allGranted: true }));

    const { findByTestId } = await render(<App />);

    expect(await findByTestId('camera-screen')).toBeTruthy();
  });

  it('sends a returning user to the permissions screen when something is still missing', async () => {
    await AsyncStorage.setItem('peguei:onboardingCompleted', 'true');
    mockedUsePermissions.mockReturnValue(permissionsState({ allGranted: false }));

    const { findByTestId } = await render(<App />);

    expect(await findByTestId('permissions-screen')).toBeTruthy();
  });

  describe('screen-view analytics', () => {
    it('logs a screen view for each new screen navigated to', async () => {
      const { findByTestId, getByTestId } = await render(<App />);
      await findByTestId('onboarding-screen');

      await fireEvent.press(getByTestId('onboarding-skip'));
      await findByTestId('permissions-screen');
      expect(mockedLogScreenView).toHaveBeenLastCalledWith({
        screen_name: 'Permissions',
        screen_class: 'Permissions',
      });

      await fireEvent.press(getByTestId('stub-permissions-done'));
      await findByTestId('camera-screen');
      expect(mockedLogScreenView).toHaveBeenLastCalledWith({
        screen_name: 'Camera',
        screen_class: 'Camera',
      });

      await fireEvent.press(getByTestId('stub-open-gallery'));
      await findByTestId('gallery-screen');
      expect(mockedLogScreenView).toHaveBeenLastCalledWith({
        screen_name: 'Gallery',
        screen_class: 'Gallery',
      });
      expect(mockedLogScreenView).toHaveBeenCalledTimes(3);
    });

    it('does not log again for a state change that stays on the same screen', async () => {
      await AsyncStorage.setItem('peguei:onboardingCompleted', 'true');
      mockedUsePermissions.mockReturnValue(permissionsState({ allGranted: true }));
      const { findByTestId, getByTestId } = await render(<App />);
      await findByTestId('camera-screen');

      await fireEvent.press(getByTestId('stub-set-params'));

      expect(mockedLogScreenView).not.toHaveBeenCalled();
    });

    it('never crashes navigation if analytics rejects', async () => {
      mockedLogScreenView.mockRejectedValueOnce(new Error('analytics offline'));
      const { findByTestId, getByTestId } = await render(<App />);
      await findByTestId('onboarding-screen');

      await fireEvent.press(getByTestId('onboarding-skip'));

      expect(await findByTestId('permissions-screen')).toBeTruthy();
      expect(mockedLogScreenView).toHaveBeenCalled();
    });
  });

  describe('status bar', () => {
    let pushSpy: jest.SpyInstance;

    beforeEach(() => {
      pushSpy = jest.spyOn(StatusBar, 'pushStackEntry');
    });

    afterEach(() => {
      pushSpy.mockRestore();
    });

    it('uses dark status-bar content in light mode', async () => {
      const { findByTestId } = await render(<App />);
      await findByTestId('onboarding-screen');

      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ barStyle: 'dark-content' }));
    });

    it('uses light status-bar content in dark mode', async () => {
      mockedUseColorScheme.mockReturnValue('dark');

      const { findByTestId } = await render(<App />);
      await findByTestId('onboarding-screen');

      expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ barStyle: 'light-content' }));
    });
  });
});
