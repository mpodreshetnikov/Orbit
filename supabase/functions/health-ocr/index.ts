import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import { encodeBase64 } from "https://deno.land/std@0.220.0/encoding/base64.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * health-ocr: Vision LLM function for OCR text extraction only
 * 
 * This is step 1 of the medical record processing pipeline.
 * It extracts raw text from images using GPT-4o Vision.
 * 
 * Flow: Upload -> [health-ocr] -> OCR Review -> health-structure -> Structure Review -> Save
 */

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET_NAME = "medical-attachments";

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

// Call GPT-4o Vision for OCR only (text extraction)
async function callVisionOcr(
  imageDataUrls: { url: string; mimeType: string }[]
): Promise<OcrResult> {
  if (imageDataUrls.length === 0) {
    return { ocr_text: "" };
  }

  const systemPrompt = `Ты — OCR-система для извлечения текста из изображений медицинских документов.

Твоя ЕДИНСТВЕННАЯ задача: извлечь ВЕСЬ видимый текст из изображений.

Правила:
1. Извлеки АБСОЛЮТНО ВЕСЬ текст, видимый на изображениях
2. Сохрани оригинальную структуру документа насколько возможно (заголовки, таблицы, списки)
3. Включи ВСЕ: заголовки, подписи, даты, имена, значения, единицы измерения, номера, штампы, печати
4. Для таблиц используй разделители | или табуляцию для сохранения структуры
5. НЕ интерпретируй и НЕ анализируй текст — только извлеки его
6. НЕ добавляй никаких комментариев или пояснений

Ответь JSON-объектом с единственным полем:
- ocr_text: полный извлечённый текст из всех изображений`;

  // Build the content array with text prompt and images
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: "Извлеки весь текст из этих изображений:" },
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
      temperature: 0.1, // Low temperature for accurate OCR
      max_tokens: 8192, // Allow more tokens for long documents
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
    const body: OcrRequest = await req.json();
    const { record_id } = body;

    if (!record_id) {
      throw new Error("Missing required field: record_id");
    }

    // Verify record exists
    const { data: record, error: recordError } = await supabaseAdmin
      .from("medical_records")
      .select("id, person_id, status")
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

    // Call GPT-4o Vision for OCR only
    const ocrResult = await callVisionOcr(imageDataUrls);

    // Update the medical record with OCR text and set status to ocr_review
    const { error: updateError } = await supabaseAdmin
      .from("medical_records")
      .update({
        ocr_text: ocrResult.ocr_text,
        status: "ocr_review", // Ready for user to review OCR results
      })
      .eq("id", record_id);

    if (updateError) {
      throw new Error(`Failed to update record: ${updateError.message}`);
    }

    // Return OCR result
    return new Response(
      JSON.stringify({
        success: true,
        ocr_text: ocrResult.ocr_text,
        char_count: ocrResult.ocr_text.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("OCR error:", error);
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
