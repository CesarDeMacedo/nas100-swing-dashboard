import type { OandaConfiguration } from './types';

export class OandaClientError extends Error {
  public constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'OandaClientError';
  }
}

type FetchLike = typeof fetch;

export class OandaClient {
  public constructor(
    private readonly configuration: Extract<OandaConfiguration, { state: 'configured' }>,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  public async getJson(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(path, this.configuration.baseUrl);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.configuration.apiToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new OandaClientError('OANDA provider request failed.');
    }
    if (!response.ok) throw new OandaClientError(`OANDA provider returned HTTP ${response.status}.`, response.status);
    try {
      return await response.json();
    } catch {
      throw new OandaClientError('OANDA provider returned malformed JSON.');
    }
  }

  public async getStream(path: string, query: Record<string, string>, signal: AbortSignal): Promise<Response> {
    const url = new URL(path, this.configuration.streamBaseUrl);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    try {
      const response = await this.fetcher(url, { method: 'GET', signal, headers: { Authorization: `Bearer ${this.configuration.apiToken}`, Accept: 'application/json' } });
      if (!response.ok) throw new OandaClientError(`OANDA provider returned HTTP ${response.status}.`, response.status);
      return response;
    } catch (cause) {
      if (cause instanceof OandaClientError) throw cause;
      throw new OandaClientError('OANDA provider pricing stream failed.');
    }
  }
}
