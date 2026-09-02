/**
 * Which `condition_records` rows may decide a condition's `current_status`.
 *
 * A closure written by the model and confirmed by nobody must not end an entry in someone's
 * medical record. `resolved` and `history` both take a condition off the active chart -- one says
 * it ended, the other says it no longer bears on today -- and both destroy information a person
 * would have to notice was missing. `active` and `suspected` are how conditions reach the chart at
 * all, so they still apply unreviewed; only the closing statuses wait for a human.
 *
 * Expressed as a PostgREST `or=` argument, so that a recompute filters before it takes its one
 * row: filtering afterwards would let a suppressed closure shadow the row beneath it and leave the
 * status stale in a different way.
 *
 * Three places in this tree decide a condition's status from its mentions and all three apply
 * this: the recompute in `src/hooks/use-conditions.ts`, the recompute on the activation path in
 * `src/lib/conditions/materialize-proposals.ts`, and the date comparison in
 * `useLinkConditionToRecord` that decides whether a manual link is the newest word. A path that
 * reads the mentions and does not apply this is a hole, whatever it does with what it reads: the
 * suppressed row does not have to be *applied* to do harm, it only has to be counted as newest.
 *
 * The edge function carries the same rule in
 * `supabase/functions/health-structure/repository.ts`. The two runtimes share no module -- the
 * Deno functions import nothing from this tree -- so the rule is written twice on purpose; change
 * one and change the other, and each side has tests that fail if you do not.
 */
export const CLOSING_STATUSES = ["resolved", "history"] as const;

export const AUTHORITATIVE_STATUS_FILTER = [
  `status_in_record.not.in.(${CLOSING_STATUSES.join(",")})`,
  "is_llm_extracted.is.false",
  "is_user_verified.is.true",
].join(",");
