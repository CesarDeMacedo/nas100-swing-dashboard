import { ACTION_STATES, getActionState } from './actionStates';
import { ActionSchema } from './analysis';

describe('action-state mapping', () => {
  it('defines one complete visual mapping for every supported action', () => {
    for (const action of ActionSchema.options) {
      const state = ACTION_STATES[action];

      expect(state.label).toBeTruthy();
      expect(state.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(state.borderColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(state.iconColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(state.bannerClassName).toContain('action-banner');
      expect(state.overlayClassName).toContain('decision-overlay');
      expect(state.badgeClassName).toContain('action-badge');
    }
  });

  it('uses the warning treatment for every WAIT-family state', () => {
    const wait = getActionState('WAIT');
    const pullback = getActionState('WAIT_FOR_PULLBACK');
    const nextClose = getActionState('WAIT_FOR_NEXT_4H_CLOSE');

    expect(pullback.primaryColor).toBe(wait.primaryColor);
    expect(nextClose.primaryColor).toBe(wait.primaryColor);
    expect(pullback.bannerClassName).toBe(wait.bannerClassName);
  });
});
