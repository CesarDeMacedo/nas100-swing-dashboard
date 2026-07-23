import type { OandaConfiguration, OandaEnvironment } from './types';

const BASE_URLS: Record<OandaEnvironment, string> = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com',
};

const STREAM_BASE_URLS: Record<OandaEnvironment, string> = {
  practice: 'https://stream-fxpractice.oanda.com',
  live: 'https://stream-fxtrade.oanda.com',
};

const optionalValue = (value: string | undefined) => value?.trim() || null;

export const parseOandaConfiguration = (environment: NodeJS.ProcessEnv = process.env): OandaConfiguration => {
  const requestedEnvironment = optionalValue(environment.OANDA_ENVIRONMENT) ?? 'practice';
  const nas100Instrument = optionalValue(environment.OANDA_NAS100_INSTRUMENT);

  if (requestedEnvironment !== 'practice' && requestedEnvironment !== 'live') {
    return {
      state: 'invalid',
      environment: null,
      nas100Instrument,
      message: 'OANDA_ENVIRONMENT must be "practice" or "live".',
    };
  }

  const accountId = optionalValue(environment.OANDA_ACCOUNT_ID);
  const apiToken = optionalValue(environment.OANDA_API_TOKEN);
  if (!accountId || !apiToken) {
    return {
      state: 'unconfigured',
      environment: requestedEnvironment,
      nas100Instrument,
      message: 'OANDA_ACCOUNT_ID and OANDA_API_TOKEN are required before provider verification.',
    };
  }

  return {
    state: 'configured',
    environment: requestedEnvironment,
      baseUrl: BASE_URLS[requestedEnvironment],
      streamBaseUrl: STREAM_BASE_URLS[requestedEnvironment],
    accountId,
    apiToken,
    nas100Instrument,
  };
};

export const oandaConfigurationStatus = (configuration: OandaConfiguration) => ({
  state: configuration.state,
  environment: configuration.environment,
  configuredInstrument: configuration.nas100Instrument !== null,
  ...(configuration.state === 'invalid' || configuration.state === 'unconfigured' ? { message: configuration.message } : {}),
});
