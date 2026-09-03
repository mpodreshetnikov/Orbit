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

/**
 * Is this mention still waiting for a person to rule on it?
 *
 * A narrower question than the one above, and conflating them was a real defect: a dismissal
 * deliberately leaves `is_user_verified` false -- rejecting a closure must not verify it -- so a
 * dismissed row is still a suppressed closure forever. Asked the wider question, the screen kept
 * labelling it "awaiting your confirmation" and offering Confirm beside the Dismissed badge it had
 * just drawn, and the MCP reader kept saying nobody had confirmed it when somebody had, by saying
 * no.
 *
 * Suppression is about the chart: may this row set a status. Waiting is about the person: is there
 * a decision outstanding. `dismissed` answers no to the second while still answering yes to the
 * first, which is exactly why `review_decision` has three values and a boolean could not carry it.
 * A row with no decision recorded at all -- null, from before the column existed -- is treated as
 * pending, because nobody has ruled on it.
 */
export function isAwaitingClosureReview(
  mention: ClosureCandidate & { review_decision?: string | null },
): boolean {
  if (!isUnverifiedClosure(mention)) return false;
  return (mention.review_decision ?? "pending") === "pending";
}

/**
 * Does approving the record confirm this mention?
 *
 * Approving a record is a person saying yes to what it found, and that reasonably confirms every
 * mention nobody has ruled on. It must not reach a mention somebody already ruled *against*: a
 * dismissal leaves `is_user_verified` false by design, so a filter on that column alone sweeps
 * rejected closures back up and writes `confirmed` over the person's own no -- closing the very
 * condition they rejected, by the route the whole task exists to block.
 *
 * A separate named rule rather than a condition inline at the call site, because the call site is a
 * two-thousand-line review screen and this is the sentence that decides whether a rejection sticks.
 */
export function isConfirmedByRecordApproval(mention: {
  is_user_verified: boolean;
  review_decision?: string | null;
}): boolean {
  return !mention.is_user_verified && mention.review_decision !== "dismissed";
}
