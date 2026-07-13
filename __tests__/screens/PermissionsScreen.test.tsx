import React from 'react';
import { render, within } from '@testing-library/react-native';
import { PermissionsScreen } from '../../src/screens/PermissionsScreen';
import * as usePermissionsModule from '../../src/hooks/usePermissions';

jest.mock('../../src/hooks/usePermissions');

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
      statuses: { camera: 'denied', storage: 'denied' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: false,
    });

    const { getByTestId, getAllByText, getByText } = await render(
      <PermissionsScreen navigation={fakeNavigation} route={{} as never} />,
    );

    expect(getAllByText('Status: denied')).toHaveLength(2);
    expect(getByTestId('permission-card-camera')).toBeTruthy();
    expect(getByTestId('permission-card-storage')).toBeTruthy();
    expect(getByText(/bloqueada permanentemente/)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('navigates to Camera once every permission is granted', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'granted', storage: 'granted' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: true,
    });

    await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(replaceMock).toHaveBeenCalledWith('Camera');
  });

  it('disables the request button only for already-granted permissions', async () => {
    mockedUsePermissions.mockReturnValue({
      statuses: { camera: 'granted', storage: 'unknown' },
      requestPermission: jest.fn(),
      refresh: jest.fn(),
      allGranted: false,
    });

    const { getByTestId } = await render(<PermissionsScreen navigation={fakeNavigation} route={{} as never} />);

    expect(getByTestId('permission-card-camera')).toBeTruthy();
    // Only the already-granted permission's action button should be disabled.
    const cameraButton = within(getByTestId('permission-card-camera')).getByTestId('permission-action-camera');
    const storageButton = within(getByTestId('permission-card-storage')).getByTestId('permission-action-storage');
    expect(cameraButton.props.accessibilityState.disabled).toBe(true);
    expect(storageButton.props.accessibilityState.disabled).toBe(false);
  });
});
