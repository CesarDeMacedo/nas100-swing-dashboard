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

export type OandaCandleGranularity = 'H4' | 'D';

export type OandaCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  isClosed: boolean;
  volume: number | null;
  instrument: string;
  timeframe: OandaCandleGranularity;
  source: 'oanda-v20';
};

export type OandaCandleResult<TTimeframe extends OandaCandleGranularity = OandaCandleGranularity> = {
  provider: 'oanda-v20';
  environment: OandaEnvironment;
  instrument: string;
  timeframe: TTimeframe;
  candles: Array<OandaCandle & { timeframe: TTimeframe }>;
};

export type OandaH4Candle = OandaCandle & { timeframe: 'H4' };
export type OandaH4CandleResult = OandaCandleResult<'H4'>;
export type OandaDailyCandle = OandaCandle & { timeframe: 'D' };
export type OandaDailyCandleResult = OandaCandleResult<'D'>;
