export const SCHEDULER_TIMEZONE = 'America/Toronto';
export const SCHEDULER_SCHEDULE = [
  'Monday-Friday 01:01',
  'Monday-Friday 05:01',
  'Monday-Friday 09:01',
  'Monday-Friday 13:01',
  'Monday-Friday 17:01',
  'Sunday-Friday 21:01',
] as const;

export type TorontoScheduleTime = '01:01' | '05:01' | '09:01' | '13:01' | '17:01' | '21:01';

export type TorontoScheduleSlot = {
  key: string;
  localDate: string;
  weekday: string;
  time: TorontoScheduleTime;
};

const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

const SLOT_DEFINITIONS: readonly { time: TorontoScheduleTime; weekdays: readonly string[] }[] = [
  { time: '01:01', weekdays: MON_FRI },
  { time: '05:01', weekdays: MON_FRI },
  { time: '09:01', weekdays: MON_FRI },
  { time: '13:01', weekdays: MON_FRI },
  { time: '17:01', weekdays: MON_FRI },
  { time: '21:01', weekdays: ['Sunday', ...MON_FRI] },
];

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULER_TIMEZONE,
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const partsFor = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));

export const getTorontoScheduleSlot = (date: Date): TorontoScheduleSlot | null => {
  const parts = partsFor(date);
  const weekday = parts.weekday;
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;

  const definition = SLOT_DEFINITIONS.find((slot) => slot.time === time);
  if (!definition || !definition.weekdays.includes(weekday)) return null;

  return { key: `${localDate}:${time}`, localDate, weekday, time: definition.time };
};

export const parseSchedulerEnabled = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('NAS100_DASHBOARD_SCHEDULER_ENABLED must be "true" or "false".');
};

export type SchedulerProvider = 'fixture' | 'oanda';

export const parseSchedulerProvider = (value: string | undefined): SchedulerProvider => {
  if (value === undefined || value === 'fixture') return 'fixture';
  if (value === 'oanda') return 'oanda';
  throw new Error('NAS100_DASHBOARD_SCHEDULER_PROVIDER must be "fixture" or "oanda".');
};
