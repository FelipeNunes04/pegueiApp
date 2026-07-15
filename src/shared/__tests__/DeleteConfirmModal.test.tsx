import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';

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
});
