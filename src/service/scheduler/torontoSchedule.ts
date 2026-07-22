export const SCHEDULER_TIMEZONE = 'America/Toronto';
export const SCHEDULER_SCHEDULE = [
  'Monday-Friday 13:01',
  'Sunday-Friday 21:01',
] as const;

export type TorontoScheduleSlot = {
  key: string;
  localDate: string;
  weekday: string;
  time: '13:01' | '21:01';
};

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
  const isWeekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(weekday);
  const isSunday = weekday === 'Sunday';

  if ((isWeekday && time === '13:01') || ((isWeekday || isSunday) && time === '21:01')) {
    return { key: `${localDate}:${time}`, localDate, weekday, time: time as '13:01' | '21:01' };
  }
  return null;
};

export const parseSchedulerEnabled = (value: string | undefined): boolean => {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('NAS100_DASHBOARD_SCHEDULER_ENABLED must be "true" or "false".');
};
