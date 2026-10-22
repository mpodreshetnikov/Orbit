/**
 * Per-person hidden measurement types.
 *
 * Persisted as a jsonb blob on `user_preferences.hidden_measurement_codes`,
 * shaped `{"<person_id>": ["height", "bmi"]}`. Hiding is a display preference
 * for the measurements list only -- it never filters the Add Measurement
 * dropdown, and it never touches measurement data.
 */

export type HiddenMeasurementCodes = Record<string, string[]>;

/**
 * Coerces the raw jsonb into a usable map. The column is a free-form blob that
 * can be `{}`, null, an array, or hand-edited into any shape, and a malformed
 * value must never break the measurements page.
 */
export function normalizeHiddenMeasurementCodes(raw: unknown): HiddenMeasurementCodes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const result: HiddenMeasurementCodes = {};
  for (const [personId, codes] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(codes)) continue;
    const validCodes = codes.filter((code): code is string => typeof code === "string");
    if (validCodes.length > 0) {
      result[personId] = Array.from(new Set(validCodes));
    }
  }
  return result;
}

/** The hidden codes for one person, as a set for cheap lookup. */
export function hiddenCodesForPerson(
  hidden: HiddenMeasurementCodes,
  personId: string | null,
): Set<string> {
  if (!personId) return new Set();
  return new Set(hidden[personId] ?? []);
}

/**
 * Returns a new map with `code` flipped for `personId`. Person keys that end up
 * with nothing hidden are dropped so the blob does not accumulate empty arrays.
 */
export function toggleHiddenCode(
  hidden: HiddenMeasurementCodes,
  personId: string,
  code: string,
): HiddenMeasurementCodes {
  const current = new Set(hidden[personId] ?? []);
  if (current.has(code)) {
    current.delete(code);
  } else {
    current.add(code);
  }

  const next = { ...hidden };
  if (current.size === 0) {
    delete next[personId];
  } else {
    next[personId] = Array.from(current);
  }
  return next;
}
