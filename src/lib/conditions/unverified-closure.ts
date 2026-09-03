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

/** The columns the predicate below reads. Anything carrying these can be asked the question. */
export interface ClosureCandidate {
  status_in_record: string;
  is_llm_extracted: boolean;
  is_user_verified: boolean;
}

/**
 * Is this mention a closure the chart is deliberately ignoring?
 *
 * The exact negation of `AUTHORITATIVE_STATUS_FILTER` above, which is an `or=` of three ways a row
 * can be authoritative: a row is suppressed when none of them holds. The two must stay each other's
 * mirror -- a reader that decides differently from the recompute will describe a row the chart is
 * not applying as one it is, or the reverse -- so `unverified-closure.test.ts` derives one from the
 * other rather than restating it.
 *
 * The filter exists so a suppressed row cannot *set* a status. This exists so it cannot *say* it
 * did. The chart being right is not the same as the history being readable: a mention rendered as
 * an ordinary resolution, on a condition whose header still reads active, tells a person their
 * record contradicts itself, and tells an assistant reading the same rows that the condition
 * resolved. Every reader of `condition_records` is expected to ask this before presenting
 * `status_in_record` as something that happened.
 */
export function isUnverifiedClosure(mention: ClosureCandidate): boolean {
  return (
    (CLOSING_STATUSES as readonly string[]).includes(mention.status_in_record) &&
    mention.is_llm_extracted &&
    !mention.is_user_verified
  );
}
