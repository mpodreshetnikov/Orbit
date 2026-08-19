-- Two catalogue-data corrections found by the scored extraction corpus.
--
-- Both are data, not code: the resolver and the unit converter behave correctly and are simply
-- being handed vocabulary that does not cover the documents they meet.
--
-- Written to be re-runnable. Each statement *sets* its column rather than appending to it, so
-- applying this twice leaves exactly the same rows as applying it once.

-- 1. `inflammation` could not be reached from the word a pathology report actually prints.
--
-- `Хронический активный гастрит` did not resolve to the `inflammation` entry, whose `name_ru` is
-- `Воспаление`. No similarity threshold reaches this: the two strings share almost no trigrams, and
-- the link between them is semantic rather than lexical. A gastritis is an inflammation of the
-- stomach, and nothing in the row said so.
--
-- The common `-ит` diagnoses are therefore listed explicitly. This is the same shape of fix the
-- catalogue already uses elsewhere -- `fibrosis` carries `склероз`, which is likewise a different
-- word for the same finding.
update public.finding_type_catalog
set synonyms_ru = ARRAY[
  'воспаление',
  'воспалительный процесс',
  'воспалительные изменения',
  'гастрит',
  'колит',
  'эзофагит',
  'дуоденит',
  'цистит',
  'панкреатит',
  'бронхит',
  'гепатит'
]
where finding_code = 'inflammation';

-- 2. `ggt` could not be reached from the analyte's own full name.
--
-- The catalogue lists `ГГТ (GGT)` with synonyms `ггт`, `ggt` and `гамма-гт` -- every abbreviation,
-- and not the expanded name a lab actually prints. `Гамма-глутамилтранспептидаза` resolved only
-- when the model happened to supply `obs_code` itself, and silently stopped resolving when it
-- supplied null instead. The deterministic resolver exists precisely so the pipeline does not
-- depend on that, and it cannot do its job with a vocabulary that omits the printed form.
--
-- Both spellings are in circulation for the same enzyme (`-пептидаза` and `-фераза`), so both are
-- listed rather than relying on either being close enough to the other.
update public.observation_catalog
set synonyms_ru = ARRAY[
  'ггт',
  'ggt',
  'гамма-гт',
  'гамма-глутамилтранспептидаза',
  'гамма-глутамилтрансфераза',
  'гаммаглутамилтранспептидаза'
]
where obs_code = 'ggt';

-- 3. `hba1c` shipped a conversion that cannot be evaluated, and it is now reachable.
--
-- `formula_to_canonical` held the string
--   'percent = (mmol_per_mol * 0.09148) + 2.152'
-- which describes the conversion rather than expressing it. `evaluateFormula` in
-- unit-conversion.ts accepts only arithmetic -- digits, `x`, and operators -- and correctly refuses
-- anything else rather than evaluating arbitrary text, so this returned null every time.
--
-- It had never fired: the key is `mmol/mol` and no Russian document ever matched a Latin unit key,
-- so the lookup missed and the value passed through unconverted. Now that printed units are folded
-- onto the catalogue's spellings, `ммоль/моль` reaches this entry -- and an unevaluable formula
-- would store no value at all, which is worse than the unconverted number it replaces.
--
-- Rewritten as the expression the evaluator actually accepts, with `x` as the input value.
-- (unit-conversion.ts also now falls back to the unconverted value instead of null, so a future
-- unevaluable formula degrades rather than deletes. Both halves are wanted: the data is correct
-- here, and the code no longer depends on it being correct.)
update public.observation_catalog
set accepted_units = jsonb_set(
  accepted_units,
  '{mmol/mol,formula_to_canonical}',
  '"(x * 0.09148) + 2.152"'::jsonb,
  true
)
where obs_code = 'hba1c'
  and accepted_units ? 'mmol/mol';
