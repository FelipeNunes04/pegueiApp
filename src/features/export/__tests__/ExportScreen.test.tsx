import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ExportScreen } from '../ExportScreen';
import { exportClip, shareExported } from '../exportClip';
import { useRecordingStore } from '../../../shared/store/recordingStore';

jest.mock('../exportClip', () => {
  const actual = jest.requireActual('../exportClip');
  return {
    ...actual,
    exportClip: jest.fn().mockResolvedValue({ result: { path: '/out.mp4', width: 1080, height: 1920, durationSeconds: 10 }, withWatermark: false, withCaption: false }),
    shareExported: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../native/VideoExportModule', () => ({ isVideoExportAvailable: () => true }));

const mockedExport = exportClip as jest.Mock;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ExportScreen navigation={{} as never} route={{ key: 'k', name: 'ExportClip', params: { clipId: 'c1' } }} />
    </SafeAreaProvider>,
  );
}

describe('ExportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.setState({
      clips: [{ id: 'c1', path: '/clips/c1.mp4', createdAt: 1, durationSeconds: 10, triggeredBy: 'manual' }],
    });
  });

  it('exports in 9:16 with the picked species and weight, then opens the share sheet', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('export-species-Tucunaré'));
    await fireEvent.changeText(getByTestId('export-weight-input'), '2,4');
    await fireEvent.press(getByTestId('export-submit'));

    await waitFor(() => expect(shareExported).toHaveBeenCalledWith('/out.mp4'));
    expect(mockedExport).toHaveBeenCalledWith({ clipPath: '/clips/c1.mp4', portrait9x16: true, species: 'Tucunaré', weight: '2,4' });
  });

  it('keeps the original format when 9:16 is turned off', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent(getByTestId('export-portrait-switch'), 'valueChange', false);
    await fireEvent.press(getByTestId('export-submit'));

    await waitFor(() => expect(mockedExport).toHaveBeenCalledWith(expect.objectContaining({ portrait9x16: false })));
  });

  it('blocks an invalid weight and shows why', async () => {
    const { getByTestId, getByText } = await renderScreen();
    await fireEvent.changeText(getByTestId('export-weight-input'), 'muito');

    expect(getByText(/Peso inválido/)).toBeTruthy();
    await fireEvent.press(getByTestId('export-submit'));
    expect(mockedExport).not.toHaveBeenCalled();
  });

  it('shows an error when the export fails', async () => {
    mockedExport.mockRejectedValueOnce(new Error('E_EXPORT_FAILED'));
    const { getByTestId, findByText } = await renderScreen();
    await fireEvent.press(getByTestId('export-submit'));

    expect(await findByText(/Não foi possível exportar/)).toBeTruthy();
    expect(shareExported).not.toHaveBeenCalled();
  });
});
