import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * health-structure: Text LLM function for structured data extraction
 * 
 * This is step 2 of the medical record processing pipeline.
 * It extracts structured data (title, type, date, summary, keywords) from OCR text.
 * 
 * Flow: Upload -> health-ocr -> OCR Review -> [health-structure] -> Structure Review -> Save
 */

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface StructureRequest {
  record_id: string;
}

interface StructuredData {
  record_type: string;
  title: string;
  record_date: string | null;
  summary: string;
  keywords: string[];
}

// Call LLM to extract structured data from OCR text
async function extractStructuredData(ocrText: string): Promise<StructuredData> {
  if (!ocrText || ocrText.trim().length === 0) {
    return {
      record_type: "other",
      title: "Пустой документ",
      record_date: null,
      summary: "Текст не найден",
      keywords: [],
    };
  }

  const systemPrompt = `Ты — анализатор медицинских документов. Тебе будет дан текст, извлечённый из медицинского документа (OCR).

Твоя задача: проанализировать текст и извлечь структурированную информацию.

Ответь JSON-объектом с полями:
- record_type: одно из "lab", "visit", "imaging", "prescription", "vaccination", "vet", "other"
- title: короткое описательное название записи НА РУССКОМ ЯЗЫКЕ (максимум 100 символов)
- record_date: дата документа в формате YYYY-MM-DD, или null если не найдена
- summary: ОЧЕНЬ КРАТКОЕ и ПОЛЕЗНОЕ описание результата НА РУССКОМ ЯЗЫКЕ (1-2 коротких предложения, максимум 150 символов)
- keywords: массив из 3-7 релевантных ключевых слов/тегов НА РУССКОМ ЯЗЫКЕ

ВАЖНЫЕ ПРАВИЛА ДЛЯ ТИПА (record_type):
- Если документ упоминает животных или ветеринарную помощь: "vet"
- Для анализов крови, мочи и т.д.: "lab"
- Для рентгена, МРТ, КТ, УЗИ: "imaging"
- Для рецептов или назначений лекарств: "prescription"
- Для записей о вакцинации: "vaccination"
- Для консультаций врача или записей о приёме: "visit"
- Если не подходит ни под одну категорию: "other"

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

ВАЖНЫЕ ПРАВИЛА ДЛЯ ЗАГОЛОВКА (title):
- НЕ включай имена пациентов, врачей или клиник
- НЕ включай даты
- Заголовок должен описывать ТИП и СОДЕРЖАНИЕ исследования/документа
- Используй СТАНДАРТНЫЕ медицинские названия
- Примеры хороших заголовков: "Общий анализ крови", "УЗИ брюшной полости", "Консультация терапевта"

ВАЖНЫЕ ПРАВИЛА ДЛЯ КЛЮЧЕВЫХ СЛОВ (keywords):
- Используй СТАНДАРТНЫЕ русские медицинские термины
- Нормализуй сокращения: ОАК → общий анализ крови, УЗИ → ультразвуковое исследование
- Добавляй ключевые слова по органам/системам: печень, почки, сердце, кровь и т.д.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SUPABASE_URL || "http://localhost:3000",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini", // Use cheaper model for text analysis
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Проанализируй этот текст медицинского документа:\n\n${ocrText}` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
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
      record_type: parsed.record_type || "other",
      title: parsed.title || "Медицинский документ",
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
    const body: StructureRequest = await req.json();
    const { record_id } = body;

    if (!record_id) {
      throw new Error("Missing required field: record_id");
    }

    // Get record with OCR text
    const { data: record, error: recordError } = await supabaseAdmin
      .from("medical_records")
      .select("id, person_id, ocr_text, status")
      .eq("id", record_id)
      .single();

    if (recordError || !record) {
      throw new Error("Record not found or access denied");
    }

    if (!record.ocr_text) {
      throw new Error("No OCR text found for this record. Run health-ocr first.");
    }

    // Extract structured data from OCR text
    const structuredData = await extractStructuredData(record.ocr_text);

    // Update the medical record with structured data
    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        title: structuredData.title,
        record_type: structuredData.record_type,
        record_date: structuredData.record_date,
        notes: structuredData.summary,
        llm_summary: structuredData.summary,
        llm_keywords: structuredData.keywords,
        status: "structure_review", // Ready for user to review structured data
      })
      .eq("id", record_id);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    // Return structured data
    return new Response(
      JSON.stringify({
        success: true,
        structured_data: structuredData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Structure extraction error:", error);
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
