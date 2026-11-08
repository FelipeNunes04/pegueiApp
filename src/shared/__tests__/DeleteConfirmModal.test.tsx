import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

// Pressable only applies its `pressed` style while the responder system
// has an active touch; a plain fireEvent.press() never enters that state,
// so press-in is simulated with the same event shape RNTL's own userEvent
// dispatches for a responder grant.
function pressIn(element: Parameters<typeof fireEvent>[0]) {
  return fireEvent(element, 'responderGrant', {
    nativeEvent: {
      changedTouches: [],
      identifier: 0,
      locationX: 0,
      locationY: 0,
      pageX: 0,
      pageY: 0,
      target: 0,
      timestamp: Date.now(),
      touches: [],
    },
    persist() {},
    currentTarget: { measure() {} },
    dispatchConfig: { registrationName: 'onResponderGrant' },
  });
}
describe('DeleteConfirmModal', () => {
  it('uses singular copy for a single clip', async () => {
    const { getByText } = await render(
      <DeleteConfirmModal
        visible
        count={1}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(getByText('Excluir vídeo?')).toBeTruthy();
  });

  it('uses plural copy with the count for multiple clips', async () => {
    const { getByText } = await render(
      <DeleteConfirmModal
        visible
        count={3}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(getByText('Excluir 3 vídeos?')).toBeTruthy();
  });

  it('calls onCancel and onConfirm from their respective buttons', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <DeleteConfirmModal
        visible
        count={1}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    await fireEvent.press(getByTestId('delete-confirm-cancel'));
    await fireEvent.press(getByTestId('delete-confirm-delete'));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('renders nothing while not visible', async () => {
    const { queryByTestId, queryByText } = await render(
      <DeleteConfirmModal
        visible={false}
        count={1}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(queryByTestId('delete-confirm-modal')).toBeNull();
    expect(queryByText('Excluir vídeo?')).toBeNull();
  });

  it('warns that the action cannot be undone', async () => {
    const { getByText } = await render(
      <DeleteConfirmModal visible count={2} onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );

    expect(getByText('Essa ação não pode ser desfeita.')).toBeTruthy();
  });

  it('treats the Android back button (onRequestClose) as cancel, never as confirm', async () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <DeleteConfirmModal visible count={1} onCancel={onCancel} onConfirm={onConfirm} />,
    );

    await fireEvent(getByTestId('delete-confirm-modal'), 'requestClose');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('gives press feedback on both buttons', async () => {
    const { getByTestId } = await render(
      <DeleteConfirmModal visible count={1} onCancel={jest.fn()} onConfirm={jest.fn()} />,
    );
    expect(getByTestId('delete-confirm-cancel')).not.toHaveStyle({ opacity: 0.75 });
    expect(getByTestId('delete-confirm-delete')).not.toHaveStyle({ opacity: 0.75 });

    await pressIn(getByTestId('delete-confirm-cancel'));
    await pressIn(getByTestId('delete-confirm-delete'));

    expect(getByTestId('delete-confirm-cancel')).toHaveStyle({ opacity: 0.75 });
    expect(getByTestId('delete-confirm-delete')).toHaveStyle({ opacity: 0.75 });
  });
});
