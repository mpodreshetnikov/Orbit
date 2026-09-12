/**
 * The model each `health-structure` stage calls, named once.
 *
 * These three used to exist only in a deployment console. `health-structure/deps.ts` read
 * `OPENROUTER_HEALTH_STAGE_*_MODEL` and nothing else, so an unset variable produced `undefined`,
 * `stages/index.ts` fell back to the shared `defaultModel`, and all three stages quietly ran the
 * same model. That is a working fallback, not a recorded choice: a fresh environment got the old
 * behaviour, no review ever saw the decision, and no test could see the difference because the
 * tests read the same unset variable and got the same consistent fallback. The variables are still
 * here and still win — see the bottom of this comment — but the floor they fall back to is now in
 * the tree, where the reasoning and the review are.
 *
 * The values are measured, not chosen by intuition. `T-260903-oy7` in the task registry ran the
 * three-case extraction corpus live against four configurations, fourteen passes in total, with
 * cost read from OpenRouter's own `usage.cost` rather than a price table:
 *
 * - `classify` — no measured quality gradient existed at all. Every model tried scored 100% on
 *   `record_type` and `record_date`, so the stage is chosen on price. It carries roughly 7% of the
 *   bill.
 *
 * - `extract` — the one dimension the corpus has real signal on, and it favours gemini:
 *   observations F1 100.0 stable across four passes against 90.3-100.0 for `openai/gpt-5.2`, at
 *   roughly a third of the price. It carries roughly 76% of the bill, so this is the stage where
 *   the money is.
 *
 * - `reconcile` — held on the more expensive model deliberately. **This is not an oversight and it
 *   is not a saving waiting to be taken.** Reconcile is the stage that closes a patient's
 *   conditions, and a wrongful resolution there marks a live condition resolved against a document
 *   that does not support it. Pooling all fourteen passes and grouping by which model served
 *   reconcile: **1 of 8 passes wrongfully resolved on `openai/gpt-5.2`, against 4 of 6 on
 *   `google/gemini-2.5-flash`.** Grouping the same passes by which model served `extract` separates
 *   nothing (2 of 6 against 3 of 8), so the defect follows reconcile and not the entities fed into
 *   it. Moving this one to the cheaper model saves about $0.013 per document and buys back a
 *   patient-safety failure mode. Do not do it on cost grounds; the price of the safety property is
 *   already counted.
 *
 * The measured cost of this configuration is $0.0300 per document against $0.0548 for `gpt-5.2`
 * everywhere and $0.0171 for gemini everywhere — a 1.8x saving rather than the 3.2x a full switch
 * would give, with the difference being reconcile.
 *
 * What the corpus does not support: a ranking on findings or conditions. Both models swing further
 * between their own repeat runs than they differ from each other, so those dimensions separate
 * nothing at n=3 cases. The wrongful-resolution split above is the strongest claim available and it
 * is still n=14 passes on three documents. Re-measure before moving a stage rather than reasoning
 * from the numbers here, and see `T-0026` for the prompt-and-rule work that would make reconcile
 * safe on any model.
 *
 * `deps.ts` still reads `OPENROUTER_HEALTH_STAGE_CLASSIFY_MODEL`,
 * `OPENROUTER_HEALTH_STAGE_EXTRACT_MODEL` and `OPENROUTER_HEALTH_STAGE_RECONCILE_MODEL` first, so a
 * deployment can still move one stage for a one-off experiment without shipping code. This is the
 * floor those fall back to, not a policy about what they must be — the same relationship the shared
 * model default has with `OPENROUTER_HEALTH_STRUCTURE_MODEL`.
 */
export const DEFAULT_HEALTH_STAGE_MODELS = {
  classify: "google/gemini-2.5-flash",
  extract: "google/gemini-2.5-flash",
  reconcile: "openai/gpt-5.2",
} as const;

export type HealthStageName = keyof typeof DEFAULT_HEALTH_STAGE_MODELS;
