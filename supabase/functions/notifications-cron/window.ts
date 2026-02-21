/** True if user's local time is within 30 minutes after their configured notification time. */
export function isNotificationWindowForUser(
  now: Date,
  notificationTime: string,
  timezone: string | null,
): boolean {
  const parts = notificationTime.split(":").map(Number);
  const hour = parts[0] ?? 9;
  const min = parts[1] ?? 0;
  const userNow = timezone ? new Date(now.toLocaleString("en-US", { timeZone: timezone })) : now;
  const userMinutes = userNow.getHours() * 60 + userNow.getMinutes();
  const windowStart = hour * 60 + min;
  const windowEnd = windowStart + 30;
  if (windowEnd <= 24 * 60) {
    return userMinutes >= windowStart && userMinutes < windowEnd;
  }
  return userMinutes >= windowStart || userMinutes < windowEnd % (24 * 60);
}
