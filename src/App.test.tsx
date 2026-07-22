import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import App from './App';
import { getActionState } from './domain/actionStates';
import { ActionSchema } from './domain/analysis';
import {
  actionFixtures,
  invalidAnalysisFixture,
  invalidCandleDatasetFixture,
  missingNarrativeFixture,
  openCandleDatasetFixture,
  openCandleFixture,
  staleDataFixture,
} from './domain/fixtures';

const readSourceTree = (directory: string): string =>
  readdirSync(directory)
    .map((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? readSourceTree(path) : readFileSync(path, 'utf8');
    })
    .join('\n');

describe('dashboard rendering', () => {
  it('renders every required action fixture through the centralized banner mapping', () => {
    for (const action of ActionSchema.options) {
      render(<App analysisSource={actionFixtures[action]} />);
      const banner = screen.getByLabelText(`Current action: ${getActionState(action).label}`);
      const supportingText = banner.querySelector('.action-banner__reason');

      expect(banner).toBeVisible();
      expect(supportingText).toBeVisible();
      expect(supportingText).not.toHaveTextContent(/^\s*$/);
      cleanup();
    }
  });

  it('allows action-banner supporting text to wrap without clipping', () => {
    const stylesheet = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
    const supportingTextRule = stylesheet.match(/\.action-banner__reason\s*\{([^}]*)\}/)?.[1];

    expect(supportingTextRule).toContain('overflow: visible');
    expect(supportingTextRule).toContain('overflow-wrap: anywhere');
    expect(supportingTextRule).toContain('white-space: normal');
    expect(supportingTextRule).not.toContain('overflow: hidden');
    expect(supportingTextRule).not.toContain('text-overflow: ellipsis');
    expect(supportingTextRule).not.toContain('max-height');
  });

  it('renders the validated approved mock analysis', () => {
    render(<App />);

    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'NAS100 H4 Setup Check' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current action: WAIT FOR PULLBACK')).toBeInTheDocument();
    expect(screen.getByTestId('summary-score')).toHaveTextContent('38');
    expect(screen.getByTestId('summary-grade')).toHaveTextContent('D');
    expect(screen.getByTestId('summary-actionability')).toHaveTextContent('Below premium threshold');
    expect(screen.queryByTestId('summary-score')).not.toHaveTextContent('74');
  });

  it('presents calculated pullback messaging and unavailable plan values without fixture fallbacks', () => {
    render(<App />);

    expect(screen.getByText('Entry: Waiting for pullback location.')).toBeVisible();
    expect(screen.getByText('Stop: Not calculated. Targets: Not calculated. R:R: Not available.')).toBeVisible();
    expect(screen.queryByText('Stop 28,820')).not.toBeInTheDocument();
    expect(screen.queryByText('Target 1 29,220')).not.toBeInTheDocument();
  });

  it('renders support, resistance, preferred-entry, and current-price markers from data', () => {
    render(<App />);

    expect(screen.getAllByTestId('support-zone')).toHaveLength(2);
    expect(screen.getAllByTestId('resistance-zone')).toHaveLength(2);
    expect(screen.getByTestId('preferred-entry-zone')).toHaveAccessibleName(
      'Preferred long pullback zone, 28,880 to 28,920',
    );
    expect(within(screen.getByTestId('current-price-marker')).getByText('29,082')).toBeVisible();
  });

  it('uses safe fallback copy when optional narrative text is missing', () => {
    render(<App analysisSource={missingNarrativeFixture} />);

    expect(screen.getByText('No additional setup rationale was provided.')).toBeVisible();
    expect(screen.getByText('No additional next-step guidance was provided.')).toBeVisible();
    expect(screen.getByText('No additional market context was provided.')).toBeVisible();
  });

  it('shows WAIT FOR NEXT 4H CLOSE when an open candle fixture requests BUY', () => {
    render(<App analysisSource={openCandleFixture} candleSource={openCandleDatasetFixture} />);

    expect(screen.getByLabelText('Current action: WAIT FOR NEXT 4H CLOSE')).toBeVisible();
    expect(screen.queryByLabelText('Current action: BUY')).not.toBeInTheDocument();
    expect(screen.getByText('An open H4 candle cannot authorize an entry.')).toBeVisible();
    expect(screen.getByTestId('latest-candle-status')).toHaveTextContent('Open H4 - unconfirmed');
  });

  it('keeps the dashboard available but withholds an invalid candle chart', () => {
    render(<App candleSource={invalidCandleDatasetFixture} />);

    expect(screen.getByTestId('dashboard')).toBeVisible();
    expect(screen.getByTestId('chart-error-state')).toBeVisible();
    expect(screen.queryByTestId('financial-chart')).not.toBeInTheDocument();
  });

  it('shows NO TRADE and a stale badge for stale market data', () => {
    render(<App analysisSource={staleDataFixture} />);

    expect(screen.getByLabelText('Current action: NO TRADE')).toBeVisible();
    expect(screen.getAllByText('Stale data').length).toBeGreaterThan(0);
    expect(screen.getByText('The latest market data is stale.')).toBeVisible();
  });

  it('withholds the dashboard and renders a safe error state for invalid JSON data', () => {
    render(<App analysisSource={invalidAnalysisFixture} />);

    expect(screen.getByTestId('error-state')).toBeVisible();
    expect(screen.queryByTestId('dashboard')).not.toBeInTheDocument();
  });

  it('does not embed approved mock analysis values in presentation component source', () => {
    const componentSource = readSourceTree(join(process.cwd(), 'src', 'components'));

    for (const forbiddenValue of ['29082', '28880', '28920', '29220', '29400']) {
      expect(componentSource).not.toContain(forbiddenValue);
    }
  });
});
