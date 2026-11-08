import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { BatteryOptimizationCard } from '../components/BatteryOptimizationCard';
import { CircularBufferModule } from '../../camera/native/CircularBufferModule';

jest.mock('../../camera/native/CircularBufferModule', () => ({
  CircularBufferModule: {
    isIgnoringBatteryOptimizations: jest.fn().mockResolvedValue(false),
    openBatteryOptimizationSettings: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedModule = CircularBufferModule as jest.Mocked<typeof CircularBufferModule>;

describe('BatteryOptimizationCard', () => {
  const originalOS = Platform.OS;
  let appStateHandler: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    mockedModule.isIgnoringBatteryOptimizations.mockResolvedValue(false);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandler = handler as (state: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
  });

  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
  });

  it('renders nothing (and never asks native) off Android', async () => {
    Platform.OS = 'ios';
    const { queryByTestId } = await render(<BatteryOptimizationCard />);

    expect(queryByTestId('battery-optimization-card')).toBeNull();
    expect(mockedModule.isIgnoringBatteryOptimizations).not.toHaveBeenCalled();
  });

  it('shows the restricted status and opens the system list on press', async () => {
    const { getByTestId } = await render(<BatteryOptimizationCard />);

    await waitFor(() =>
      expect(getByTestId('battery-optimization-status').props.children).toMatch(/Otimizada/),
    );
    await fireEvent.press(getByTestId('battery-optimization-action'));

    expect(mockedModule.openBatteryOptimizationSettings).toHaveBeenCalled();
  });

  it('re-checks when the app returns to the foreground (after the user changed it in Settings)', async () => {
    const { getByTestId } = await render(<BatteryOptimizationCard />);
    await waitFor(() =>
      expect(getByTestId('battery-optimization-status').props.children).toMatch(/Otimizada/),
    );

    mockedModule.isIgnoringBatteryOptimizations.mockResolvedValue(true);
    await act(async () => {
      appStateHandler?.('background');
    });
    expect(mockedModule.isIgnoringBatteryOptimizations).toHaveBeenCalledTimes(1);
    await act(async () => {
      appStateHandler?.('active');
    });

    await waitFor(() =>
      expect(getByTestId('battery-optimization-status').props.children).toBe('Sem restrição'),
    );
    expect(getByTestId('battery-optimization-action').props.accessibilityState.disabled).toBe(true);
  });

  it('falls back to "Verificando..." when the check fails, and swallows an open failure', async () => {
    mockedModule.isIgnoringBatteryOptimizations.mockRejectedValue(new Error('boom'));
    mockedModule.openBatteryOptimizationSettings.mockRejectedValueOnce(new Error('no activity'));
    const { getByTestId } = await render(<BatteryOptimizationCard />);
    await act(async () => {});

    expect(getByTestId('battery-optimization-status').props.children).toBe('Verificando...');
    await fireEvent.press(getByTestId('battery-optimization-action'));
    expect(mockedModule.openBatteryOptimizationSettings).toHaveBeenCalled();
  });
});
