import React from 'react';
import { render, within } from '@testing-library/react-native';
import { PermissionsScreen } from '../PermissionsScreen';
import * as usePermissionsModule from '../hooks/usePermissions';

jest.mock('../hooks/usePermissions');

const mockedUsePermissions = usePermissionsModule.usePermissions as jest.Mock;
const navigateMock = jest.fn();
const replaceMock = jest.fn();
const fakeNavigation = { navigate: navigateMock, replace: replaceMock } as never;

describe('PermissionsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows every permission as denied with a hint to open system settings ("sem permissão" state)', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'denied', microphone: 'denied' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: false,
    });

    const { getByTestId, queryByTestId, getAllByText, getByText } = await render(
      <PermissionsScreen navigation={fakeNavigation} route={{} as never} />,
    );

    expect(getAllByText('Ainda não concedida')).toHaveLength(2);
    expect(getByTestId('permission-card-camera')).toBeTruthy();
    expect(getByTestId('permission-card-microphone')).toBeTruthy();
    expect(queryByTestId('permission-card-storage')).toBeNull();
    expect(getByText(/bloqueada permanentemente/)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('navigates to Camera once every permission is granted', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'granted', microphone: 'granted' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: true,
    });

    await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(replaceMock).toHaveBeenCalledWith('Camera');
  });

  it('disables the request button only for already-granted permissions', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'granted', microphone: 'unknown' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: false,
    });

    const { getByTestId } = await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(getByTestId('permission-card-camera')).toBeTruthy();
    // Only the already-granted permission's action button should be disabled.
    const cameraButton = within(getByTestId('permission-card-camera')).getByTestId('permission-action-camera');
    const microphoneButton = within(getByTestId('permission-card-microphone')).getByTestId('permission-action-microphone');
    expect(cameraButton.props.accessibilityState.disabled).toBe(true);
    expect(microphoneButton.props.accessibilityState.disabled).toBe(false);
  });
});

describe('PermissionsScreen battery optimization card', () => {
  const { Platform } = require('react-native');
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('shows the non-blocking battery card on Android only, without gating navigation', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'denied', microphone: 'denied' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: false,
    });

    Platform.OS = 'android';
    const android = await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);
    expect(android.getByTestId('battery-optimization-card')).toBeTruthy();
    await android.unmount();

    Platform.OS = 'ios';
    const ios = await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);
    expect(ios.queryByTestId('battery-optimization-card')).toBeNull();
  });
});
