# Money categorize LLM context (parent + siblings)

## Intent

Give Jev and OpenRouter the same rich parent transaction context when classifying a
single receipt line, while making the classification target explicit so sibling lines
are context only.

## Before → after

```mermaid
flowchart LR
  subgraph before [Before]
    LI1[line_item flat fields]
    TX1[transaction subset]
    ACC1[account source/kind]
    LI1 --> PROMPT1[Jev state / OpenRouter prompt]
    TX1 --> PROMPT1
    ACC1 --> PROMPT1
  end

  subgraph after [After T-261113-xfj]
    TARGET[target_line_item]
    SIBS[receipt_sibling_items]
    TX2[transaction + card_id + raw_payload]
    CARD[card last4/label]
    ACC2[account id/label/kind]
    BRAND[brand name/slug]
    CAT[current_category id/name/key]
    TARGET --> PROMPT2[Jev state / OpenRouter prompt]
    SIBS --> PROMPT2
    TX2 --> PROMPT2
    CARD --> PROMPT2
    ACC2 --> PROMPT2
    BRAND --> PROMPT2
    CAT --> PROMPT2
  end
```

## Data path

```mermaid
flowchart TD
  SQL["money_get_category_rule_context()"]
  SVC[money-categorize service]
  LLM["llm-context.buildLlmCategorizeItemContext()"]
  JEV[Jev state]
  OR[OpenRouter prompt]

  SQL -->|"line_item, transaction, account, card, brand, current_category, receipt_sibling_items"| SVC
  SVC --> LLM
  LLM --> JEV
  LLM --> OR
```

## Contract notes

- `target_line_item` is the only line to classify.
- `receipt_sibling_items` is always present: populated for multi-line receipts, `[]` for
  single-line.
- `transaction.raw_payload` / line `raw_payload` are truncated at the LLM boundary
  (`LLM_RAW_PAYLOAD_MAX_BYTES`) while the SQL context keeps the full payload for rules.
- Sibling list is capped at 40 rows in SQL to bound prompt size.

## References

- `supabase/db/functions/money_get_category_rule_context.sql`
- `supabase/functions/money-categorize/llm-context.ts`
- `supabase/functions/money-categorize/jev-categorize.ts`
- `supabase/functions/money-categorize/openrouter-categorize.ts`
