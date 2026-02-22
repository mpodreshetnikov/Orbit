/** True if user's local time is within 30 minutes after their configured notification time. */
export function isNotificationWindowForUser(
  now: Date,
  notificationTime: string,
  timezone: string | null,
): boolean {
  const [hourRaw, minRaw] = notificationTime.split(":");
  const parsedHour = Number(hourRaw);
  const parsedMin = Number(minRaw);
  const hour = Number.isFinite(parsedHour) ? parsedHour : 9;
  const min = Number.isFinite(parsedMin) ? parsedMin : 0;
  const userNow = timezone ? new Date(now.toLocaleString("en-US", { timeZone: timezone })) : now;
  const userMinutes = userNow.getHours() * 60 + userNow.getMinutes();
  const windowStart = hour * 60 + min;
  const windowEnd = windowStart + 30;
  if (windowEnd <= 24 * 60) {
    return userMinutes >= windowStart && userMinutes < windowEnd;
  }
  return userMinutes >= windowStart || userMinutes < windowEnd % (24 * 60);
}
