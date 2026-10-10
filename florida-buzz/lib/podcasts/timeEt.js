'use strict';

const TIMEZONE = 'America/New_York';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function partsInTimezone(date = new Date(), timeZone = TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    timeZone,
    weekday: weekdayMap[map.weekday],
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

/** ISO-like week key in Eastern time, e.g. 2026-W41 */
function weekKeyEt(date = new Date(), timeZone = TIMEZONE) {
  const p = partsInTimezone(date, timeZone);
  // Approximate ISO week using UTC noon of the Eastern calendar day.
  const utcNoon = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  const dayNum = utcNoon.getUTCDay() || 7;
  utcNoon.setUTCDate(utcNoon.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcNoon.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcNoon - yearStart) / 86400000 + 1) / 7);
  return `${utcNoon.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function windowStartIso(daysBack, date = new Date()) {
  return new Date(date.getTime() - daysBack * 86400000).toISOString();
}

function matchesGenerateSlot(settings, date = new Date()) {
  const p = partsInTimezone(date, settings.timezone || TIMEZONE);
  if (p.weekday !== Number(settings.generate_weekday)) return false;
  if (p.hour !== Number(settings.generate_hour)) return false;
  const minute = Number(settings.generate_minute) || 0;
  // 15-minute cron ticks: match within the configured minute window.
  return p.minute >= minute && p.minute < minute + 15;
}

function formatClockLabel(weekday, hour, minute) {
  const day = WEEKDAY_NAMES[Number(weekday)] || 'Release day';
  const h = Number(hour);
  const m = String(Number(minute) || 0).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${day} ${h12}:${m} ${ampm}`;
}

function describeSchedule(settings) {
  const day = WEEKDAY_NAMES[Number(settings.generate_weekday)] || 'Thursday';
  const hour = Number(settings.generate_hour);
  const minute = String(Number(settings.generate_minute) || 0).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  const tz = settings.timezone || TIMEZONE;
  const slotA = formatClockLabel(
    settings.intended_publish_weekday ?? 2,
    settings.intended_publish_hour ?? 6,
    settings.intended_publish_minute ?? 0
  );
  const slotB = formatClockLabel(
    settings.intended_publish_weekday_b ?? 5,
    settings.intended_publish_hour_b ?? 6,
    settings.intended_publish_minute_b ?? 0
  );
  return {
    generateLabel: `${day} ${h12}:${minute} ${ampm} ${tz}`,
    publishLabel: `${slotA} and ${slotB} ${tz} (two standalone episodes; manual / not auto)`,
    publishSlotALabel: `${slotA} ${tz}`,
    publishSlotBLabel: `${slotB} ${tz}`,
  };
}

module.exports = {
  TIMEZONE,
  WEEKDAY_NAMES,
  partsInTimezone,
  weekKeyEt,
  windowStartIso,
  matchesGenerateSlot,
  describeSchedule,
};
