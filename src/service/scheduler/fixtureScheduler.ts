import { SCHEDULER_SCHEDULE, SCHEDULER_TIMEZONE, getTorontoScheduleSlot } from './torontoSchedule';
import type { SchedulerProvider } from './torontoSchedule';

export type SchedulerRunResult = {
  outcome: 'created' | 'already_exists' | 'blocked' | 'failed';
  runKey: string;
  message?: string;
};

export type SchedulerStatus = {
  enabled: boolean;
  running: boolean;
  timezone: typeof SCHEDULER_TIMEZONE;
  configuredSchedule: readonly string[];
  lastEvaluatedSlot: string | null;
  lastRunResult: SchedulerRunResult | null;
  configuredProvider: SchedulerProvider;
  activeProvider: SchedulerProvider;
  lastRunProvider: SchedulerProvider | null;
  lastFailureSummary: string | null;
  /** Consecutive 'failed' outcomes since the last non-failed run (or process start). Resets to 0 on any other outcome. In-memory only — lost on restart, same as the rest of this status. */
  consecutiveFailures: number;
};

type FixtureSchedulerOptions = {
  enabled: boolean;
  run: () => Promise<SchedulerRunResult>;
  now?: () => Date;
  intervalMs?: number;
  log?: (message: string) => void;
  provider?: SchedulerProvider;
};

export class FixtureScheduler {
  private readonly seenSlots = new Set<string>();
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly log: (message: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEvaluatedSlot: string | null = null;
  private lastRunResult: SchedulerRunResult | null = null;
  private lastRunProvider: SchedulerProvider | null = null;
  private consecutiveFailures = 0;

  public constructor(private readonly options: FixtureSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? 15_000;
    this.log = options.log ?? ((message) => process.stdout.write(`${message}\n`));
  }

  public start() {
    if (!this.options.enabled || this.timer) return;
    void this.evaluate();
    this.timer = setInterval(() => void this.evaluate(), this.intervalMs);
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public status(): SchedulerStatus {
    return {
      enabled: this.options.enabled,
      running: this.timer !== null,
      timezone: SCHEDULER_TIMEZONE,
      configuredSchedule: SCHEDULER_SCHEDULE,
      lastEvaluatedSlot: this.lastEvaluatedSlot,
      lastRunResult: this.lastRunResult,
      configuredProvider: this.options.provider ?? 'fixture',
      activeProvider: this.options.provider ?? 'fixture',
      lastRunProvider: this.lastRunProvider,
      lastFailureSummary: this.lastRunResult?.outcome === 'failed' ? this.lastRunResult.message ?? 'Scheduled analysis failed.' : null,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  public async evaluate(date = this.now()): Promise<SchedulerRunResult | null> {
    const slot = getTorontoScheduleSlot(date);
    if (!slot) return null;
    this.lastEvaluatedSlot = slot.key;
    if (this.seenSlots.has(slot.key)) return null;
    this.seenSlots.add(slot.key);

    try {
      const result = await this.options.run();
      this.lastRunResult = result;
      this.lastRunProvider = this.options.provider ?? 'fixture';
      this.consecutiveFailures = result.outcome === 'failed' ? this.consecutiveFailures + 1 : 0;
      this.log(`NAS100 scheduler ${slot.key}: ${result.outcome}`);
      return result;
    } catch (cause) {
      const result: SchedulerRunResult = {
        outcome: 'failed',
        runKey: `scheduler:${slot.key}`,
        message: cause instanceof Error ? cause.message : 'Scheduled synthetic analysis failed.',
      };
      this.lastRunResult = result;
      this.lastRunProvider = this.options.provider ?? 'fixture';
      this.consecutiveFailures += 1;
      this.log(`NAS100 scheduler ${slot.key}: failed`);
      return result;
    }
  }
}
