/**
 * The model every health pipeline calls, named once.
 *
 * This constant exists because of an outage. The id used to be written out in four separate
 * places — the OCR client, `health-structure`'s two copies, and the offline eval harness — and
 * when OpenRouter stopped serving the variant they all named, every one of them had to be found
 * and changed before production could transcribe a document again. A model id is configuration,
 * and configuration that is copied is configuration that goes stale in the copies nobody
 * remembers.
 *
 * The value carries its own history: it was `openai/gpt-5.2:nitro` until 2026-09-02, when
 * OpenRouter answered `404` to every request. `:nitro` was a routing preference — "prefer the
 * fastest provider for this model" — and it stopped being an accepted suffix; the catalogue at
 * `GET https://openrouter.ai/api/v1/models` now offers only `:batch` and `:free`, on none of
 * which `openai/gpt-5.2` appears. The base id was served throughout, which is why the suffix and
 * not the model is what changed here: the recorded cassettes under
 * `test/fixtures/extraction/cassettes/` show OpenRouter answering as plain `openai/gpt-5.2` even
 * when the request asked for `:nitro`, so this calls the same model the scored extraction corpus
 * was built against and the scores stay comparable.
 *
 * A suffix is therefore not a free thing to add back. It is a separate namespace from the model,
 * it can be withdrawn without the model going anywhere, and it fails as a `404` that names
 * nothing — which reads as "the model is gone" and sends whoever is on call looking in the wrong
 * place. `classifyOcrError` in `health-ocr/failure.ts` reports that status as `provider_no_endpoint`
 * for the same reason.
 *
 * The suffix was not the only way to earn that `404`. This family does not advertise
 * `temperature`, and `provider: { require_parameters: true }` is all-or-nothing, so a request
 * carrying `temperature` has no endpoint to route to and fails identically — which is why the OCR
 * client no longer sends one. Changing the id here without checking the request options against
 * the catalogue's `supported_parameters` can therefore reproduce the same outage with a live
 * model.
 *
 * Each pipeline still overrides this from the environment — `OPENROUTER_HEALTH_OCR_MODEL`,
 * `OPENROUTER_HEALTH_STRUCTURE_MODEL`, and the per-stage variables in `health-structure/deps.ts`
 * — so a deployment can move off this default without a code change. This is the floor those
 * fall back to, not a policy about what they must be.
 */
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.2";
