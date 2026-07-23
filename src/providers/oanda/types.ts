export type OandaEnvironment = 'practice' | 'live';

export type OandaConfiguration =
  | {
      state: 'configured';
      environment: OandaEnvironment;
      baseUrl: string;
      accountId: string;
      apiToken: string;
      nas100Instrument: string | null;
    }
  | {
      state: 'unconfigured';
      environment: OandaEnvironment;
      nas100Instrument: string | null;
      message: string;
    }
  | {
      state: 'invalid';
      environment: OandaEnvironment | null;
      nas100Instrument: string | null;
      message: string;
    };

export type OandaInstrument = {
  name: string;
  displayName: string;
  type: string;
  displayPrecision: number;
  pipLocation: number;
};

export type OandaH4Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
  volume: number | null;
  instrument: string;
  timeframe: 'H4';
  source: 'oanda-v20';
};

export type OandaH4CandleResult = {
  provider: 'oanda-v20';
  environment: OandaEnvironment;
  instrument: string;
  timeframe: 'H4';
  candles: OandaH4Candle[];
};
