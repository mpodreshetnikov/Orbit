import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { encodeBase64 } from "https://deno.land/std@0.220.0/encoding/base64.ts";
import { corsHeaders } from "../_shared/cors.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET_NAME = "medical-attachments";

interface IngestRequest {
  record_id: string;
}

interface Attachment {
  id: string;
  storage_path: string;
  mime_type: string;
  original_filename: string;
}

interface VisionExtractionResult {
  ocr_text: string;
  record_type: string;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

// Chunk text into segments for RAG
function chunkText(text: string, targetSize = 500, overlap = 50): string[] {
  if (!text || text.length === 0) return [];
  
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > targetSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  // If no sentences found, chunk by character count
  if (chunks.length === 0 && text.length > 0) {
    for (let i = 0; i < text.length; i += targetSize - overlap) {
      chunks.push(text.slice(i, i + targetSize));
    }
  }
  
  return chunks;
}

// Fetch attachment files and convert to base64 data URLs
async function getAttachmentDataUrls(
  supabase: ReturnType<typeof createClient>,
  attachments: Attachment[]
): Promise<{ url: string; mimeType: string }[]> {
  const results: { url: string; mimeType: string }[] = [];

  for (const attachment of attachments) {
    try {
      // Download the file from storage
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(attachment.storage_path);

      if (error || !data) {
        console.error(`Failed to download ${attachment.storage_path}:`, error);
        continue;
      }

      // Convert blob to base64
      const arrayBuffer = await data.arrayBuffer();
      const base64 = encodeBase64(new Uint8Array(arrayBuffer));
      
      // Create data URL
      const dataUrl = `data:${attachment.mime_type};base64,${base64}`;
      
      results.push({
        url: dataUrl,
        mimeType: attachment.mime_type,
      });
    } catch (err) {
      console.error(`Error processing ${attachment.storage_path}:`, err);
    }
  }

  return results;
}

// Call GPT-4o with vision to extract text and analyze
async function callOpenRouterVision(
  imageDataUrls: { url: string; mimeType: string }[]
): Promise<VisionExtractionResult> {
  if (imageDataUrls.length === 0) {
    return {
      ocr_text: "",
      record_type: "other",
      title: "Empty Record",
      record_date: null,
      summary: "No images to analyze",
      keywords: [],
    };
  }

  const systemPrompt = `Ты — анализатор медицинских документов с возможностью OCR. Тебе будут показаны изображения медицинских документов.

Твоя задача:
1. Извлечь ВЕСЬ видимый текст из изображений (OCR)
2. Проанализировать извлечённый текст для классификации и краткого описания документа

Ты должен ответить валидным JSON-объектом с этими полями:
- ocr_text: полный извлечённый текст из всех изображений, сохраняя оригинальную структуру насколько возможно
- record_type: одно из "lab", "visit", "imaging", "prescription", "vaccination", "vet", "other"
- title: короткое описательное название записи НА РУССКОМ ЯЗЫКЕ (максимум 100 символов)
- record_date: дата документа в формате YYYY-MM-DD, или null если не найдена
- summary: ОЧЕНЬ КРАТКОЕ и ПОЛЕЗНОЕ описание результата НА РУССКОМ ЯЗЫКЕ (1-2 коротких предложения, максимум 150 символов)
- keywords: массив из 3-7 релевантных ключевых слов/тегов НА РУССКОМ ЯЗЫКЕ

ВАЖНЫЕ ПРАВИЛА ДЛЯ ОПИСАНИЯ (summary):
- Пиши КРАТКО и ПО ДЕЛУ, без воды
- Фокусируйся на РЕЗУЛЬТАТЕ и ВЫВОДАХ, а не на описании процесса
- НЕ пиши "Документ представляет собой..." или "Врач провёл осмотр..."
- Пиши что ВАЖНО для пациента знать
- Примеры хороших описаний:
  * "Обследование перед операцией. Противопоказаний нет."
  * "Гемоглобин 145, всё в норме"
  * "УЗИ печени: без патологий"
  * "Назначен курс антибиотиков на 7 дней"
- Примеры плохих описаний:
  * "Документ представляет собой результаты анализа крови пациента, включающие показатели гемоглобина и других параметров"
  * "Врач провел осмотр и сделал заключение о состоянии здоровья"

Правила классификации:
- Если документ упоминает животных или ветеринарную помощь, используй "vet"
- Для анализов крови, мочи и т.д., используй "lab"
- Для рентгена, МРТ, КТ, УЗИ, используй "imaging"
- Для рецептов или назначений лекарств, используй "prescription"
- Для записей о вакцинации, используй "vaccination"
- Для консультаций врача или записей о приёме, используй "visit"

ВАЖНЫЕ ПРАВИЛА ДЛЯ ЗАГОЛОВКА (title):
- НЕ включай имена пациентов, врачей или клиник в заголовок
- НЕ включай даты в заголовок
- Заголовок должен описывать ТИП и СОДЕРЖАНИЕ исследования/документа
- Примеры хороших заголовков: "Общий анализ крови", "УЗИ брюшной полости", "Консультация терапевта", "Биохимия крови"
- Примеры плохих заголовков: "Анализ Иванова И.И.", "Результаты от 15.01.2024", "Клиника Здоровье"

Важно: Извлеки ВЕСЬ текст, видимый на изображениях, включая заголовки, подписи, даты, имена, значения, единицы измерения и т.д.`;

  // Build the content array with text prompt and images
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: "Пожалуйста, извлеки весь текст из этих изображений медицинских документов и проанализируй их:" },
  ];

  // Add all images
  for (const img of imageDataUrls) {
    content.push({
      type: "image_url",
      image_url: { url: img.url },
    });
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
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
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`);
  }

  const data = await response.json();
  const responseContent = data.choices[0]?.message?.content;
  
  if (!responseContent) {
    throw new Error("No response from OpenRouter");
  }

  try {
    const parsed = JSON.parse(responseContent);
    return {
      ocr_text: parsed.ocr_text || "",
      record_type: parsed.record_type || "other",
      title: parsed.title || "Medical Record",
      record_date: parsed.record_date || null,
      summary: parsed.summary || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    throw new Error("Failed to parse OpenRouter response as JSON");
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate environment
    if (!OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY not configured");
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment not configured");
    }

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");

    // Create Supabase client with anon key and user's token for RLS
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

    // Verify user is authenticated by getting user info
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      throw new Error("Unauthorized - invalid token");
    }

    // Check allowlist using service role (bypasses RLS)
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

    // Parse request body
    const body: IngestRequest = await req.json();
    const { record_id } = body;

    if (!record_id) {
      throw new Error("Missing required field: record_id");
    }

    // Verify record exists and get attachments
    const { data: record, error: recordError } = await supabaseAdmin
      .from("medical_records")
      .select("id, person_id")
      .eq("id", record_id)
      .single();

    if (recordError || !record) {
      throw new Error("Record not found or access denied");
    }

    // Get attachments for this record
    const { data: attachments, error: attachmentsError } = await supabaseAdmin
      .from("record_attachments")
      .select("id, storage_path, mime_type, original_filename")
      .eq("record_id", record_id)
      .order("sort_order", { ascending: true });

    if (attachmentsError) {
      throw new Error(`Failed to fetch attachments: ${attachmentsError.message}`);
    }

    if (!attachments || attachments.length === 0) {
      throw new Error("No attachments found for this record");
    }

    // Download and convert attachments to base64 data URLs
    const imageDataUrls = await getAttachmentDataUrls(supabaseAdmin, attachments);

    if (imageDataUrls.length === 0) {
      throw new Error("Failed to process any attachments");
    }

    // Call GPT-4o Vision for OCR and analysis
    const extraction = await callOpenRouterVision(imageDataUrls);

    // Update the medical record with extraction results
    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        ocr_text: extraction.ocr_text,
        llm_summary: extraction.summary,
        llm_keywords: extraction.keywords,
      })
      .eq("id", record_id);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    // Delete existing chunks for this record (in case of re-processing)
    await supabaseAdmin
      .from("record_chunks")
      .delete()
      .eq("record_id", record_id);

    // Chunk the OCR text and insert
    const chunks = chunkText(extraction.ocr_text);
    
    if (chunks.length > 0) {
      const chunkRecords = chunks.map((content, index) => ({
        record_id,
        chunk_index: index,
        content,
      }));

      const { error: chunkError } = await supabaseAdmin
        .from("record_chunks")
        .insert(chunkRecords);

      if (chunkError) {
        console.error("Failed to insert chunks:", chunkError);
        // Non-fatal, continue
      }
    }

    // Return extraction result including OCR text
    return new Response(
      JSON.stringify({
        success: true,
        extraction: {
          ocr_text: extraction.ocr_text,
          record_type: extraction.record_type,
          title: extraction.title,
          record_date: extraction.record_date,
          summary: extraction.summary,
          keywords: extraction.keywords,
        },
        chunks_created: chunks.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Ingest error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
