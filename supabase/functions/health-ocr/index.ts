import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { encodeBase64 } from "https://deno.land/std@0.220.0/encoding/base64.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * health-ocr: Vision LLM function for OCR text extraction only
 *
 * This is step 1 of the medical record processing pipeline.
 * It extracts raw text from images using GPT-4o Vision.
 * Processes one image at a time to stay under Edge Function memory limit (256MB).
 *
 * Flow: Upload -> [health-ocr] -> OCR Review -> health-structure -> Structure Review -> Save
 */

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET_NAME = "medical-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
const MAX_OCR_ERROR_LENGTH = 500;
const OPENROUTER_TIMEOUT_MS = 55_000; // 55s per image so we stay under Edge limit

interface OcrRequest {
  record_id: string;
}

interface Attachment {
  id: string;
  storage_path: string;
  mime_type: string;
  original_filename: string;
}

interface OcrResult {
  ocr_text: string;
  suggested_title: string;
}

// Download one attachment and convert to base64 data URL (single image in memory)
async function downloadOneDataUrl(
  supabase: ReturnType<typeof createClient>,
  attachment: Attachment
): Promise<{ url: string; mimeType: string } | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(attachment.storage_path);

  if (error || !data) {
    console.error(`Failed to download ${attachment.storage_path}:`, error);
    return null;
  }

  const size = data.size;
  if (size > MAX_ATTACHMENT_BYTES) {
    console.error(`Skipping ${attachment.storage_path}: size ${size} exceeds ${MAX_ATTACHMENT_BYTES}`);
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const base64 = encodeBase64(new Uint8Array(arrayBuffer));
  const dataUrl = `data:${attachment.mime_type};base64,${base64}`;
  return { url: dataUrl, mimeType: attachment.mime_type };
}

// Call GPT-4o Vision for a single image (OCR only). When requestTitle is true, also ask for suggested_title.
async function callVisionOcrSingle(
  imageDataUrl: { url: string; mimeType: string },
  options: { requestTitle: boolean }
): Promise<OcrResult> {
  const requestTitle = options.requestTitle ?? true;

  const systemPrompt = requestTitle
    ? `Ты — OCR-система для извлечения текста из изображений медицинских документов.

Твои задачи:
1. Извлечь ВЕСЬ видимый текст из изображения
2. Предложить короткое название документа для отображения в списке (1–10 слов)

Правила извлечения текста:
1. Извлеки АБСОЛЮТНО ВЕСЬ текст, видимый на изображении
2. Сохрани оригинальную структуру документа насколько возможно (заголовки, таблицы, списки)
3. Включи ВСЕ: заголовки, подписи, даты, имена, значения, единицы измерения, номера, штампы, печати
4. Для таблиц используй разделители | или табуляцию для сохранения структуры
5. НЕ интерпретируй и НЕ анализируй текст — только извлеки его
6. НЕ добавляй никаких комментариев или пояснений

Правила для названия (suggested_title):
- Краткое описание типа документа, если видны (например: "Анализ крови", "Выписка из стационара", "Результаты УЗИ")
- Только факты из документа, без интерпретации
- На русском языке

Ответь JSON-объектом с полями:
- ocr_text: полный извлечённый текст из изображения
- suggested_title: короткое название документа для списка записей`
    : `Ты — OCR-система для извлечения текста из изображений медицинских документов.

Извлеки АБСОЛЮТНО ВЕСЬ видимый текст. Сохрани структуру (заголовки, таблицы, списки). Включи заголовки, подписи, даты, имена, значения, единицы, номера, штампы. Для таблиц используй | или табуляцию. НЕ интерпретируй — только извлеки текст.

Ответь JSON-объектом с полями:
- ocr_text: полный извлечённый текст
- suggested_title: "" (оставь пустым)`;

  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: requestTitle ? "Извлеки весь текст из этого изображения и предложи короткое название документа:" : "Извлеки весь текст из этого изображения:" },
    { type: "image_url", image_url: { url: imageDataUrl.url } },
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": SUPABASE_URL || "http://localhost:3000",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        temperature: 0.1,
        max_tokens: 12000,
        response_format: { type: "json_object" },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${error}`);
    }

    const data = await response.json();
    const responseContent = data.choices[0]?.message?.content;

    if (!responseContent) {
      throw new Error("No response from OpenRouter");
    }

    const parsed = JSON.parse(responseContent);
    const suggestedTitle = typeof parsed.suggested_title === "string"
      ? parsed.suggested_title.trim()
      : "";
    return {
      ocr_text: parsed.ocr_text || "",
      suggested_title: suggestedTitle || "Медицинский документ",
    };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e?.name === "AbortError") {
      throw new Error("OpenRouter request timed out");
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let recordId: string | null = null;
  const startMs = Date.now();

  try {
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseClient = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError);
      throw new Error("Unauthorized - invalid token");
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: allowedUser, error: allowlistError } = await supabaseAdmin
      .from("allowed_users")
      .select("id")
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (allowlistError || !allowedUser) {
      throw new Error("User not in allowlist");
    }

    const body: OcrRequest = await req.json();
    recordId = body.record_id ?? null;
    console.log("[health-ocr] record_id:", recordId);

    if (!recordId) {
      throw new Error("Missing required field: record_id");
    }

    const { data: record, error: recordError } = await supabaseAdmin
      .from("medical_records")
      .select("id, person_id, status")
      .eq("id", recordId)
      .single();

    if (recordError || !record) {
      throw new Error("Record not found or access denied");
    }

    const { data: attachments, error: attachmentsError } = await supabaseAdmin
      .from("record_attachments")
      .select("id, storage_path, mime_type, original_filename")
      .eq("record_id", recordId)
      .order("sort_order", { ascending: true });

    if (attachmentsError) {
      throw new Error(`Failed to fetch attachments: ${attachmentsError.message}`);
    }

    if (!attachments || attachments.length === 0) {
      throw new Error("No attachments found for this record");
    }

    const pageTexts: string[] = [];
    let suggestedTitle = "Медицинский документ";

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const dataUrl = await downloadOneDataUrl(supabaseAdmin, attachment);
      if (!dataUrl) {
        pageTexts.push("");
        continue;
      }

      try {
        const result = await callVisionOcrSingle(dataUrl, { requestTitle: i === 0 });
        pageTexts.push(result.ocr_text);
        if (i === 0 && result.suggested_title) {
          suggestedTitle = result.suggested_title;
        }
      } catch (err) {
        console.error(`OCR failed for ${attachment.storage_path}:`, err);
        pageTexts.push("");
      }
    }

    const fullOcrText = pageTexts
      .map((text, idx) => (text ? `--- Страница ${idx + 1} ---\n\n${text}` : `--- Страница ${idx + 1} ---\n\n[Не удалось извлечь текст]`))
      .join("\n\n");

    if (pageTexts.every((t) => !t.trim())) {
      throw new Error("Failed to extract text from any attachment");
    }

    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        ocr_text: fullOcrText,
        title: suggestedTitle,
        status: "ocr_review",
        ocr_error: null,
      })
      .eq("id", recordId);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    const durationMs = Date.now() - startMs;
    console.log("[health-ocr] success record_id:", recordId, "duration_ms:", durationMs);

    return new Response(
      JSON.stringify({
        success: true,
        ocr_text: fullOcrText,
        char_count: fullOcrText.length,
        suggested_title: suggestedTitle || undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const durationMs = Date.now() - startMs;
    console.error("[health-ocr] error record_id:", recordId, "duration_ms:", durationMs, "error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const truncatedMessage = errorMessage.slice(0, MAX_OCR_ERROR_LENGTH);

    if (recordId) {
      try {
        const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await supabaseAdmin
          .from("medical_records")
          .update({
            status: "ocr_failed",
            ocr_error: truncatedMessage,
          })
          .eq("id", recordId);
      } catch (updateErr) {
        console.error("Failed to update record with ocr_failed:", updateErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
