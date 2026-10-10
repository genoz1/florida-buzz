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

/**
 * Two generate windows per week (default Tue + Fri). Falls back to intended
 * publish weekday B when generate_*_b columns are not in the live DB yet.
 */
function generateSlotsFromSettings(settings = {}) {
  const hour = Number(settings.generate_hour ?? 7);
  const minute = Number(settings.generate_minute ?? 0);
  return [
    {
      key: 'gen-a',
      index: 0,
      weekday: Number(settings.generate_weekday ?? 2),
      hour,
      minute,
    },
    {
      key: 'gen-b',
      index: 1,
      weekday: Number(
        settings.generate_weekday_b ?? settings.intended_publish_weekday_b ?? 5
      ),
      hour: Number(settings.generate_hour_b ?? hour),
      minute: Number(settings.generate_minute_b ?? minute),
    },
  ];
}

function slotMatchesClock(slot, parts) {
  if (parts.weekday !== Number(slot.weekday)) return false;
  if (parts.hour !== Number(slot.hour)) return false;
  const minute = Number(slot.minute) || 0;
  // 15-minute cron ticks: match within the configured minute window.
  return parts.minute >= minute && parts.minute < minute + 15;
}

/** Returns the matching generate slot, or null if outside both windows. */
function matchingGenerateSlot(settings, date = new Date()) {
  const p = partsInTimezone(date, settings.timezone || TIMEZONE);
  for (const slot of generateSlotsFromSettings(settings)) {
    if (slotMatchesClock(slot, p)) return slot;
  }
  return null;
}

function matchesGenerateSlot(settings, date = new Date()) {
  return matchingGenerateSlot(settings, date) != null;
}

/** Calendar Date (local interpretation via UTC noon trick) for weekday delta days ahead. */
function datePlusEtDays(date, days, timeZone = TIMEZONE) {
  const p = partsInTimezone(date, timeZone);
  const utcNoon = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  utcNoon.setUTCDate(utcNoon.getUTCDate() + days);
  return utcNoon;
}

function daysUntilWeekday(fromWeekday, targetWeekday) {
  return (Number(targetWeekday) - Number(fromWeekday) + 7) % 7;
}

/**
 * Next upcoming release/generate weekday from `date` (skips today — use a today
 * match first). Returns { weekday, deltaDays, targetDate }.
 */
function nextUpcomingWeekday(date, weekdays, timeZone = TIMEZONE) {
  const p = partsInTimezone(date, timeZone);
  let best = null;
  for (const weekday of weekdays) {
    let delta = daysUntilWeekday(p.weekday, weekday);
    if (delta === 0) delta = 7;
    if (!best || delta < best.deltaDays) {
      best = {
        weekday: Number(weekday),
        deltaDays: delta,
        targetDate: datePlusEtDays(date, delta, timeZone),
      };
    }
  }
  return best;
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
  const tz = settings.timezone || TIMEZONE;
  const genSlots = generateSlotsFromSettings(settings);
  const generateLabel = genSlots
    .map((s) => formatClockLabel(s.weekday, s.hour, s.minute))
    .join(' and ');
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
    generateLabel: `${generateLabel} ${tz} (one episode per run)`,
    publishLabel: `${slotA} and ${slotB} ${tz} (manual / not auto; separate Tue + Fri runs)`,
    publishSlotALabel: `${slotA} ${tz}`,
    publishSlotBLabel: `${slotB} ${tz}`,
    generateSlotALabel: `${formatClockLabel(genSlots[0].weekday, genSlots[0].hour, genSlots[0].minute)} ${tz}`,
    generateSlotBLabel: `${formatClockLabel(genSlots[1].weekday, genSlots[1].hour, genSlots[1].minute)} ${tz}`,
  };
}

module.exports = {
  TIMEZONE,
  WEEKDAY_NAMES,
  partsInTimezone,
  weekKeyEt,
  windowStartIso,
  generateSlotsFromSettings,
  matchingGenerateSlot,
  matchesGenerateSlot,
  datePlusEtDays,
  daysUntilWeekday,
  nextUpcomingWeekday,
  describeSchedule,
};
