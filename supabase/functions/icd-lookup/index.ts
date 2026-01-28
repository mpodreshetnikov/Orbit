import { corsHeaders } from "../_shared/cors.ts";

/**
 * icd-lookup: WHO ICD API edge function
 * 
 * Looks up ICD-10 codes via the official WHO ICD API.
 * Returns official names in both English and Russian.
 * 
 * Requires environment variables:
 * - WHO_ICD_CLIENT_ID
 * - WHO_ICD_CLIENT_SECRET
 */

const WHO_ICD_CLIENT_ID = Deno.env.get("WHO_ICD_CLIENT_ID");
const WHO_ICD_CLIENT_SECRET = Deno.env.get("WHO_ICD_CLIENT_SECRET");

interface IcdLookupRequest {
  code: string;
}

interface IcdLookupResponse {
  code: string;
  name_en: string | null;
  name_ru: string | null;
  found: boolean;
}

// Cache token in memory (edge function instance)
let cachedToken: { token: string; expires: number } | null = null;

/**
 * Get OAuth access token from WHO ICD API
 */
async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && cachedToken.expires > Date.now()) {
    return cachedToken.token;
  }

  if (!WHO_ICD_CLIENT_ID || !WHO_ICD_CLIENT_SECRET) {
    throw new Error("WHO ICD API credentials not configured. Set WHO_ICD_CLIENT_ID and WHO_ICD_CLIENT_SECRET.");
  }

  const res = await fetch("https://icdaccessmanagement.who.int/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: WHO_ICD_CLIENT_ID,
      client_secret: WHO_ICD_CLIENT_SECRET,
      scope: "icdapi_access",
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error("WHO ICD token error:", error);
    throw new Error(`Failed to get WHO ICD access token: ${res.status}`);
  }

  const data = await res.json();
  
  // Cache token with 60s buffer before expiry
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  
  return cachedToken.token;
}

/**
 * Lookup ICD-10 code in a specific language
 */
async function lookupIcdCode(code: string, lang: "en" | "ru"): Promise<string | null> {
  const token = await getAccessToken();
  
  // Normalize code format: ICD-10 codes like "D50.9", "E11", "J06.9"
  // WHO API expects codes without dots for the URL path
  const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  
  // ICD-10 2019 release (latest stable)
  const url = `https://id.who.int/icd/release/10/2019/${normalizedCode}`;
  
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Language": lang,
        "API-Version": "v2",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        // Code not found - try with dot format
        // Some codes are stored with dots (e.g., D50.9)
        const codeWithDot = code.toUpperCase();
        const urlWithDot = `https://id.who.int/icd/release/10/2019/${encodeURIComponent(codeWithDot)}`;
        
        const retryRes = await fetch(urlWithDot, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Accept-Language": lang,
            "API-Version": "v2",
            Accept: "application/json",
          },
        });
        
        if (!retryRes.ok) {
          console.log(`ICD code ${code} not found in ${lang}`);
          return null;
        }
        
        const retryData = await retryRes.json();
        return retryData.title?.["@value"] || null;
      }
      console.error(`WHO ICD API error for ${code} (${lang}):`, res.status);
      return null;
    }
    
    const data = await res.json();
    return data.title?.["@value"] || null;
  } catch (error) {
    console.error(`Error looking up ICD code ${code} (${lang}):`, error);
    return null;
  }
}

/**
 * Search ICD-10 codes by name/term
 * 
 * Note: WHO ICD-10 API doesn't have a robust text search like ICD-11.
 * We use a multi-strategy approach:
 * 1. If query looks like a code (starts with letter+digit), do code lookup
 * 2. Try the ICD-11 entity search (it sometimes returns ICD-10 mappings)
 * 3. Fall back to code range suggestions
 */
async function searchIcdCodes(
  query: string, 
  lang: "en" | "ru", 
  maxResults = 10
): Promise<Array<{ code: string; name: string }>> {
  const token = await getAccessToken();
  const trimmedQuery = query.trim();
  
  // Strategy 1: If query looks like a code, try direct lookup
  const codePattern = /^[A-Z][0-9]/i;
  if (codePattern.test(trimmedQuery)) {
    console.log("Query looks like a code, using code lookup strategy");
    return await searchIcd10Release(trimmedQuery, lang, token, maxResults);
  }
  
  // Strategy 2: Try ICD-11 entity search (English only, better results)
  // This sometimes returns ICD-10 codes in the mappings
  const url = new URL("https://id.who.int/icd/entity/search");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("useFlexisearch", "true");
  url.searchParams.set("flatResults", "true");
  url.searchParams.set("highlightingEnabled", "false");
  
  console.log("ICD search URL:", url.toString());
  
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Language": "en", // Always search in English for better results
        "API-Version": "v2",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error(`WHO ICD search error: ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    console.log("WHO ICD search guessType:", data.guessType);
    
    const results: Array<{ code: string; name: string }> = [];
    const entities = data.destinationEntities || [];
    console.log("Found entities:", entities.length);
    
    if (entities.length > 0 && entities[0]) {
      console.log("First entity sample:", JSON.stringify(entities[0]).slice(0, 800));
    }

    for (const entity of entities.slice(0, maxResults * 3)) {
      let code: string = "";
      let name: string = "";
      
      // theCode contains the ICD code (could be ICD-11 or ICD-10)
      if (entity.theCode) {
        code = entity.theCode;
      }
      
      // Extract name from title
      if (typeof entity.title === "string") {
        name = entity.title;
      } else if (entity.title?.["@value"]) {
        name = entity.title["@value"];
      }
      
      // Check matchingPVs for title and potential ICD-10 references
      if (entity.matchingPVs && Array.isArray(entity.matchingPVs)) {
        for (const pv of entity.matchingPVs) {
          if (pv.propertyId === "Title" && pv.label && !name) {
            name = pv.label;
          }
          // Look for ICD-10 code in various property values
          if (pv.label) {
            const icd10Match = pv.label.match(/\b([A-Z][0-9]{2}(?:\.[0-9]+)?)\b/);
            if (icd10Match && !code.match(/^[A-Z][0-9]{2}/)) {
              code = icd10Match[1];
            }
          }
        }
      }
      
      // ICD-11 codes look like "9D00", "8A00.1" etc (digit first after letter)
      // ICD-10 codes look like "H52.1", "D50.9" etc (letter + 2 digits)
      const isIcd10Format = code && code.match(/^[A-Z][0-9]{2}(\.[0-9]+)?$/i);
      
      // If it's an ICD-11 code but we have a name, try to look up a similar ICD-10 code
      // For now, skip non-ICD-10 codes
      if (!isIcd10Format) {
        continue;
      }
      
      if (!name) {
        name = code;
      }

      // Avoid duplicates
      if (!results.find(r => r.code === code)) {
        console.log(`Found ICD-10 code: ${code} - ${name.slice(0, 50)}`);
        results.push({ code: code.toUpperCase(), name });
      }
      
      if (results.length >= maxResults) break;
    }
    
    // If we found results from entity search, return them
    if (results.length > 0) {
      return results;
    }
    
    console.log("No ICD-10 codes found in entity search");
    return [];
  } catch (error) {
    console.error(`Error searching ICD codes:`, error);
    return [];
  }
}

/**
 * Fallback: Search within ICD-10 2019 release by code prefix
 * This is the most reliable way to search ICD-10 since WHO doesn't provide text search
 */
async function searchIcd10Release(
  query: string,
  lang: "en" | "ru",
  token: string,
  maxResults: number
): Promise<Array<{ code: string; name: string }>> {
  const results: Array<{ code: string; name: string }> = [];
  const upperQuery = query.toUpperCase().trim();
  
  // Parse the query to understand what kind of code lookup to do
  // Examples: "H", "H5", "H52", "H52.", "H52.1"
  const codeMatch = upperQuery.match(/^([A-Z])([0-9]{0,2})\.?([0-9]?)$/);
  
  if (!codeMatch) {
    console.log(`Query "${query}" doesn't look like an ICD-10 code`);
    return results;
  }
  
  const letter = codeMatch[1];
  const num1 = codeMatch[2] || "";
  const num2 = codeMatch[3] || "";
  
  const codesToTry: string[] = [];
  
  if (num1.length === 2 && num2) {
    // Specific code like H52.1 - just try this one and nearby
    const baseNum = parseInt(num2);
    for (let i = Math.max(0, baseNum - 2); i <= Math.min(9, baseNum + 5); i++) {
      codesToTry.push(`${letter}${num1}.${i}`);
    }
  } else if (num1.length === 2) {
    // Full category like H52, try all subcodes
    codesToTry.push(`${letter}${num1}`);
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}${num1}.${i}`);
    }
  } else if (num1.length === 1) {
    // Partial like H5, try H50-H59
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}${num1}${i}`);
    }
  } else {
    // Just letter like H, show some common categories
    // For eye conditions (H), common ones are H00-H59
    for (let i = 0; i <= 9; i++) {
      codesToTry.push(`${letter}0${i}`);
      if (i <= 5) codesToTry.push(`${letter}${i}0`);
    }
  }
  
  console.log(`Trying ${codesToTry.length} codes for query "${query}"`);
  
  // Fetch codes in parallel (batch of up to 15)
  const fetchPromises = codesToTry.slice(0, 15).map(async (code) => {
    try {
      const name = await lookupIcdCode(code, "en"); // Always use English for more reliable results
      if (name) {
        return { code, name };
      }
    } catch {
      // Ignore lookup errors
    }
    return null;
  });
  
  const fetched = await Promise.all(fetchPromises);
  for (const result of fetched) {
    if (result && results.length < maxResults) {
      results.push(result);
    }
  }
  
  console.log(`Code lookup found ${results.length} results for "${query}"`);
  return results;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Check for search request (ICD-10: English only)
    if (body.search) {
      const query = body.search as string;
      const maxResults = body.maxResults || 10;
      
      const results = await searchIcdCodes(query, "en", maxResults);
      
      return new Response(
        JSON.stringify({ results }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    
    // Code lookup request
    const { code }: IcdLookupRequest = body;
    
    if (!code) {
      throw new Error("Missing code parameter");
    }

    console.log(`Looking up ICD code: ${code}`);

    // ICD-10: only English is supported by WHO API for this release
    const name_en = await lookupIcdCode(code, "en");

    const response: IcdLookupResponse = {
      code,
      name_en,
      name_ru: null,
      found: name_en !== null,
    };

    console.log(`ICD lookup result:`, response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("ICD lookup error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        found: false,
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" }, 
        status: 400,
      }
    );
  }
});
