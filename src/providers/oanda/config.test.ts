import { oandaConfigurationStatus, parseOandaConfiguration } from './config';

describe('parseOandaConfiguration', () => {
  it('defaults to practice when OANDA_ENVIRONMENT is unset', () => {
    const configuration = parseOandaConfiguration({});
    expect(configuration.state).toBe('unconfigured');
    expect(configuration.environment).toBe('practice');
  });

  it('rejects an environment value other than practice or live', () => {
    const configuration = parseOandaConfiguration({ OANDA_ENVIRONMENT: 'sandbox' });
    expect(configuration).toMatchObject({ state: 'invalid', environment: null, message: 'OANDA_ENVIRONMENT must be "practice" or "live".' });
  });

  it('is unconfigured when account id or api token is missing', () => {
    const missingBoth = parseOandaConfiguration({});
    const missingToken = parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account' });
    const missingAccount = parseOandaConfiguration({ OANDA_API_TOKEN: 'token' });

    expect(missingBoth.state).toBe('unconfigured');
    expect(missingToken.state).toBe('unconfigured');
    expect(missingAccount.state).toBe('unconfigured');
  });

  it('treats whitespace-only values as missing', () => {
    const configuration = parseOandaConfiguration({ OANDA_ACCOUNT_ID: '   ', OANDA_API_TOKEN: 'token' });
    expect(configuration.state).toBe('unconfigured');
  });

  it('resolves practice and live base URLs when fully configured', () => {
    const practice = parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'token' });
    const live = parseOandaConfiguration({ OANDA_ENVIRONMENT: 'live', OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'token' });

    expect(practice).toMatchObject({ state: 'configured', environment: 'practice', baseUrl: 'https://api-fxpractice.oanda.com', streamBaseUrl: 'https://stream-fxpractice.oanda.com' });
    expect(live).toMatchObject({ state: 'configured', environment: 'live', baseUrl: 'https://api-fxtrade.oanda.com', streamBaseUrl: 'https://stream-fxtrade.oanda.com' });
  });

  it('carries an optional, trimmed nas100Instrument through every state', () => {
    const unconfigured = parseOandaConfiguration({ OANDA_NAS100_INSTRUMENT: '  NAS100_USD  ' });
    const configured = parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'token', OANDA_NAS100_INSTRUMENT: 'NAS100_USD' });
    const absent = parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account', OANDA_API_TOKEN: 'token' });

    expect(unconfigured.nas100Instrument).toBe('NAS100_USD');
    expect(configured.nas100Instrument).toBe('NAS100_USD');
    expect(absent.nas100Instrument).toBeNull();
  });
});

describe('oandaConfigurationStatus', () => {
  it('never exposes credentials and includes a message only for invalid/unconfigured states', () => {
    const configured = oandaConfigurationStatus(parseOandaConfiguration({ OANDA_ACCOUNT_ID: 'account-secret', OANDA_API_TOKEN: 'token-secret' }));
    const unconfigured = oandaConfigurationStatus(parseOandaConfiguration({}));
    const invalid = oandaConfigurationStatus(parseOandaConfiguration({ OANDA_ENVIRONMENT: 'sandbox' }));

    expect(configured).toEqual({ state: 'configured', environment: 'practice', configuredInstrument: false });
    expect(JSON.stringify(configured)).not.toContain('secret');
    expect(unconfigured).toMatchObject({ state: 'unconfigured', message: expect.any(String) });
    expect(invalid).toMatchObject({ state: 'invalid', message: expect.any(String) });
  });
});
