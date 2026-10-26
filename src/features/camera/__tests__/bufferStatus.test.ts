import { HEALTH_LABEL, PHASE_LABEL, visibleHealthLabel } from '../utils/bufferStatus';

describe('bufferStatus', () => {
  it('has a PT-BR label for every phase and every non-healthy state', () => {
    expect(PHASE_LABEL.buffering).toBe('Sempre gravando');
    expect(HEALTH_LABEL.healthy).toBeNull();
    expect(HEALTH_LABEL.recovering).toBe('Recuperando…');
    expect(HEALTH_LABEL.interrupted).toBe('Interrompido');
    expect(HEALTH_LABEL.throttled).toBe('Reduzido (calor)');
  });

  it('only surfaces health while the pipeline is supposed to be running', () => {
    expect(visibleHealthLabel('buffering', 'throttled')).toBe('Reduzido (calor)');
    expect(visibleHealthLabel('recording', 'recovering')).toBe('Recuperando…');
    expect(visibleHealthLabel('saving', 'interrupted')).toBe('Interrompido');
    expect(visibleHealthLabel('idle', 'interrupted')).toBeNull();
    expect(visibleHealthLabel('error', 'recovering')).toBeNull();
    expect(visibleHealthLabel('buffering', 'healthy')).toBeNull();
  });
});
