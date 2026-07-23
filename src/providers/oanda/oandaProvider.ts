import { OandaClient } from './oandaClient';
import type { OandaCandle, OandaCandleGranularity, OandaCandleResult, OandaDailyCandleResult, OandaConfiguration, OandaH4Candle, OandaH4CandleResult, OandaInstrument } from './types';

type ConfiguredOandaConfiguration = Extract<OandaConfiguration, { state: 'configured' }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const string = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const decimal = (value: unknown) => {
  const parsed = typeof value === 'string' ? Number(value) : finiteNumber(value);
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

const invalidPayload = (message: string): never => {
  throw new Error(`Invalid OANDA response: ${message}`);
};

export const normalizeInstrument = (value: unknown): OandaInstrument => {
  if (!isRecord(value)) return invalidPayload('instrument record is required.');
  const name = string(value.name);
  const displayName = string(value.displayName);
  const type = string(value.type);
  const displayPrecision = finiteNumber(value.displayPrecision);
  const pipLocation = finiteNumber(value.pipLocation);
  if (!name || !displayName || !type || displayPrecision === null || pipLocation === null) return invalidPayload('instrument fields are incomplete.');
  return { name, displayName, type, displayPrecision, pipLocation };
};

export const findNas100CandidatesFromInstruments = (instruments: OandaInstrument[]) =>
  instruments.filter(({ name, displayName }) => /nas\s*100|nas100|us\s*100|us100|technology.*index|index.*technology/i.test(`${name} ${displayName}`));

export const normalizeCandle = <TTimeframe extends OandaCandleGranularity>(value: unknown, instrument: string, timeframe: TTimeframe): OandaCandle & { timeframe: TTimeframe } => {
  if (!isRecord(value) || !isRecord(value.mid)) return invalidPayload('candle midpoint data is required.');
  const time = string(value.time);
  const open = decimal(value.mid.o);
  const high = decimal(value.mid.h);
  const low = decimal(value.mid.l);
  const close = decimal(value.mid.c);
  const complete = value.complete;
  const volume = value.volume === undefined ? null : decimal(value.volume);
  if (!time || Number.isNaN(Date.parse(time)) || open === null || high === null || low === null || close === null || typeof complete !== 'boolean' || (value.volume !== undefined && volume === null)) return invalidPayload('candle fields are incomplete.');
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return invalidPayload('candle OHLC values are invalid.');
  return { time, open, high, low, close, isClosed: complete, volume, instrument, timeframe, source: 'oanda-v20' };
};

export const normalizeH4Candle = (value: unknown, instrument: string): OandaH4Candle => normalizeCandle(value, instrument, 'H4');

const validateCandleSeries = <TTimeframe extends OandaCandleGranularity>(candles: Array<OandaCandle & { timeframe: TTimeframe }>) => {
  const timestamps = new Set<string>();
  candles.forEach((candle, index) => {
    if (timestamps.has(candle.time)) invalidPayload('candle timestamps must be unique.');
    timestamps.add(candle.time);
    const previous = candles[index - 1];
    if (previous && Date.parse(candle.time) <= Date.parse(previous.time)) invalidPayload('candles must be in ascending chronological order.');
  });
  return candles;
};

export class OandaProvider {
  private readonly client: OandaClient;

  public constructor(private readonly configuration: ConfiguredOandaConfiguration, fetcher?: typeof fetch) {
    this.client = new OandaClient(configuration, fetcher);
  }

  public async getAccountInstruments(): Promise<OandaInstrument[]> {
    const payload = await this.client.getJson(`/v3/accounts/${encodeURIComponent(this.configuration.accountId)}/instruments`);
    if (!isRecord(payload) || !Array.isArray(payload.instruments)) return invalidPayload('instruments array is required.');
    return payload.instruments.map(normalizeInstrument);
  }

  public async findNas100Candidates(): Promise<OandaInstrument[]> {
    return findNas100CandidatesFromInstruments(await this.getAccountInstruments());
  }

  public async getCandles<TTimeframe extends OandaCandleGranularity>(instrument: string, timeframe: TTimeframe, count = 250): Promise<OandaCandleResult<TTimeframe>> {
    if (!instrument.trim()) throw new Error('An explicit OANDA instrument is required.');
    if (!Number.isInteger(count) || count < 1 || count > 5000) throw new Error('Candle count must be an integer between 1 and 5000.');
    const payload = await this.client.getJson(`/v3/instruments/${encodeURIComponent(instrument)}/candles`, { granularity: timeframe, price: 'M', count: String(count) });
    if (!isRecord(payload) || !Array.isArray(payload.candles)) return invalidPayload('candles array is required.');
    return { provider: 'oanda-v20', environment: this.configuration.environment, instrument, timeframe, candles: validateCandleSeries(payload.candles.map((candle) => normalizeCandle(candle, instrument, timeframe))) };
  }

  public getH4Candles(instrument: string, count = 250): Promise<OandaH4CandleResult> {
    return this.getCandles(instrument, 'H4', count);
  }

  public getDailyCandles(instrument: string, count = 250): Promise<OandaDailyCandleResult> {
    return this.getCandles(instrument, 'D', count);
  }

  public openPricingStream(instrument: string, signal: AbortSignal): Promise<Response> {
    if (!instrument.trim()) throw new Error('An explicit OANDA instrument is required.');
    return this.client.getStream(`/v3/accounts/${encodeURIComponent(this.configuration.accountId)}/pricing/stream`, { instruments: instrument }, signal);
  }
}
