import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.0";

type JobStatus = "queued" | "processing" | "done" | "error";

type GenerateRequest = {
  avatarImagePath: string;
  productImagePath: string;
  scriptText: string;
  voice?: {
    provider?: string;
    voiceId?: string;
    style?: string;
  };
  useStitch?: boolean;
};

type XaiGenerateRequest = {
  productImagePath: string;
  speakerImagePath?: string;
  sceneImagePath?: string;
  productName?: string;
  productDescription?: string;
  brandTone?: string;
  sceneStyle?: string;
  motionStyle?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const BUCKETS = {
  avatars: "kataru-avatars",
  products: "kataru-products",
  videos: "kataru-videos"
};

const DEFAULT_VOICE = {
  provider: "microsoft",
  voiceId: "ja-JP-NanamiNeural"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const didApiUrl = Deno.env.get("D_ID_API_URL") ?? "https://api.d-id.com";
const didApiKey = Deno.env.get("D_ID_API_KEY");
const xaiApiUrl = Deno.env.get("XAI_API_URL") ?? "https://api.x.ai";
const xaiApiKey = Deno.env.get("XAI_API_KEY");

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}

function errorResponse(code: string, message: string, status = 400, details?: Record<string, unknown>) {
  return jsonResponse({ error: { code, message, details } }, status);
}

function buildDidAuthHeader() {
  if (!didApiKey) {
    throw new Error("Missing D_ID_API_KEY env var.");
  }
  if (didApiKey.startsWith("Basic ")) {
    return didApiKey;
  }
  return `Basic ${didApiKey}`;
}

function buildXaiAuthHeader() {
  if (!xaiApiKey) {
    throw new Error("Missing XAI_API_KEY env var.");
  }
  if (xaiApiKey.startsWith("Bearer ")) {
    return xaiApiKey;
  }
  return `Bearer ${xaiApiKey}`;
}


function normalizePath(req: Request) {
  const { pathname } = new URL(req.url);
  const withoutPrefix = pathname
    .replace(/^\/functions\/v1\/kataru/, "")
    .replace(/^\/kataru/, "");
  return withoutPrefix.length === 0 ? "/" : withoutPrefix;
}

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function extractStoragePath(value: string, bucket: string) {
  if (!isUrl(value)) return value;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return value;
  return value.slice(idx + marker.length);
}

function buildXaiPrompt(payload: XaiGenerateRequest) {
  const productName = payload.productName?.trim();
  const description = payload.productDescription?.trim() ?? "";
  const brandTone = payload.brandTone?.trim() ?? "上質で信頼感のあるトーン";
  const sceneStyle = payload.sceneStyle?.trim() ?? "洗練されたスタジオ撮影";
  const motionStyle = payload.motionStyle?.trim() ?? "ゆっくりしたズーム";
  const aspectRatio = payload.aspectRatio ?? "16:9";
  const hasSpeaker = Boolean(payload.speakerImagePath);

  const layoutHint = hasSpeaker
    ? ["9:16", "3:4", "2:3"].includes(aspectRatio)
      ? "人物は上、商品は下に配置。"
      : "人物は左、商品は右に配置。"
    : "商品を画面中央に配置。";

  const subject = hasSpeaker ? "提供画像の人物が主役の上品な日本人プレゼンター" : "商品が主役";
  const context = `${sceneStyle}。清潔感のあるミニマルな空間。`;
  const action = hasSpeaker
    ? "プレゼンターが商品を手に取り、やさしく紹介する。手元と商品が丁寧に映る。"
    : "商品がゆっくり回転し、素材の質感とディテールが際立つ。";
  const style = `${brandTone}なハイエンドCM。柔らかな色調と上質な質感。`;
  const camera = `${motionStyle}の滑らかなカメラワーク。浅い被写界深度。`;
  const composition = `構図は${aspectRatio}。三分割構図、${layoutHint}余白を活かして商品を際立たせる。`;
  const ambience = "柔らかな拡散光、淡いグラデーション背景、清潔感、上質な陰影。";
  const audio = "テキスト・字幕・ロゴ・透かしは不要。";

  return [
    "日本市場向けの短尺プロモーション映像。",
    "提供画像の人物・商品を忠実に再現し、形状と色を保つ。",
    `【Subject】${subject}`,
    `【Context】${context}`,
    `【Action】${action}`,
    `【Style】${style}`,
    `【Camera】${camera}`,
    `【Composition】${composition}`,
    `【Ambience】${ambience}`,
    `【Audio】${audio}`,
    productName ? `【Product】${productName}` : null,
    description ? `【Description】${description}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveXaiResultUrl(payload: Record<string, unknown>) {
  const urlCandidate =
    (payload as { url?: string })?.url ??
    (payload as { video?: { url?: string } })?.video?.url ??
    (payload as { video_url?: string })?.video_url ??
    (payload as { output?: { url?: string } })?.output?.url ??
    ((payload as { data?: Array<{ url?: string }> })?.data ?? [])[0]?.url;
  return typeof urlCandidate === "string" ? urlCandidate : null;
}

async function toPublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function resolvePublicUrl(value: string, bucket: string) {
  return isUrl(value) ? value : await toPublicUrl(bucket, value);
}

async function handleGenerate(req: Request) {
  const payload = (await req.json().catch(() => null)) as GenerateRequest | null;
  if (!payload) {
    return errorResponse("invalid_json", "Request body must be valid JSON.");
  }

  const { avatarImagePath, productImagePath, scriptText, voice, useStitch } = payload;
  if (!avatarImagePath || !productImagePath || !scriptText?.trim()) {
    return errorResponse("invalid_input", "avatarImagePath, productImagePath, scriptText are required.");
  }

  const avatarPath = extractStoragePath(avatarImagePath, BUCKETS.avatars);
  const productPath = extractStoragePath(productImagePath, BUCKETS.products);

  const jobId = crypto.randomUUID();
  const insertResult = await supabase.from("kataru_jobs").insert({
    id: jobId,
    status: "queued",
    avatar_image_path: avatarPath,
    product_image_path: productPath,
    script_text: scriptText,
    voice_provider: voice?.provider ?? null,
    voice_id: voice?.voiceId ?? null
  });

  if (insertResult.error) {
    return errorResponse("db_insert_failed", insertResult.error.message, 500);
  }

  const avatarUrl = isUrl(avatarImagePath)
    ? avatarImagePath
    : await toPublicUrl(BUCKETS.avatars, avatarImagePath);
  const provider = voice?.provider ?? DEFAULT_VOICE.provider;
  const script: Record<string, unknown> = {
    type: "text",
    input: scriptText
  };

  const resolvedVoiceId =
    voice?.voiceId ?? (provider === DEFAULT_VOICE.provider ? DEFAULT_VOICE.voiceId : undefined);
  script.provider = {
    type: provider,
    ...(resolvedVoiceId ? { voice_id: resolvedVoiceId } : {}),
    ...(voice?.style ? { style: voice.style } : {})
  };

  const stitch = useStitch ?? true;

  const didResponse = await fetch(`${didApiUrl}/talks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: buildDidAuthHeader()
    },
    body: JSON.stringify({
      source_url: avatarUrl,
      script,
      config: { stitch }
    })
  });

  if (!didResponse.ok) {
    const errorText = await didResponse.text();
    let errorBody: Record<string, unknown> | null = null;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = null;
    }
    const message =
      (errorBody as { message?: string })?.message ??
      (errorBody as { error?: { message?: string } })?.error?.message ??
      errorText ??
      "D-ID request failed.";
    await supabase
      .from("kataru_jobs")
      .update({ status: "error", error_message: message })
      .eq("id", jobId);
    return errorResponse("did_request_failed", message, 502, {
      status: didResponse.status,
      statusText: didResponse.statusText,
      requestId: didResponse.headers.get("x-amzn-requestid") ?? didResponse.headers.get("x-request-id"),
      body: errorBody ?? errorText
    });
  }

  const didPayload = await didResponse.json().catch(() => ({}));
  const didTalkId = didPayload?.id ?? didPayload?.talk_id ?? null;

  await supabase
    .from("kataru_jobs")
    .update({ status: "processing", did_talk_id: didTalkId })
    .eq("id", jobId);

  return jsonResponse({ jobId, status: "processing" });
}

function mapDidStatus(raw: string | undefined): JobStatus {
  if (!raw) return "processing";
  if (raw === "done") return "done";
  if (raw === "error" || raw === "failed") return "error";
  return "processing";
}

async function storeVideo(jobId: string, resultUrl: string) {
  const response = await fetch(resultUrl);
  if (!response.ok) {
    throw new Error("Failed to fetch generated video.");
  }
  const arrayBuffer = await response.arrayBuffer();
  const path = `${jobId}.mp4`;

  const { error } = await supabase.storage.from(BUCKETS.videos).upload(path, arrayBuffer, {
    contentType: "video/mp4",
    upsert: true
  });

  if (error) {
    throw error;
  }

  return path;
}

async function handleJobStatus(req: Request, jobId: string) {
  const { data: job, error } = await supabase
    .from("kataru_jobs")
    .select("id,status,did_talk_id,result_video_path,error_message")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return errorResponse("db_read_failed", error.message, 500);
  }
  if (!job) {
    return errorResponse("not_found", "Job not found.", 404);
  }

  if (job.status === "done" && job.result_video_path) {
    const url = await toPublicUrl(BUCKETS.videos, job.result_video_path);
    return jsonResponse({ jobId, status: "done", resultUrl: url });
  }

  if (!job.did_talk_id) {
    return jsonResponse({ jobId, status: job.status ?? "queued" });
  }

  const didResponse = await fetch(`${didApiUrl}/talks/${job.did_talk_id}`, {
    headers: {
      Authorization: buildDidAuthHeader()
    }
  });

  if (!didResponse.ok) {
    const errorText = await didResponse.text();
    let errorBody: Record<string, unknown> | null = null;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = null;
    }
    return errorResponse("did_status_failed", "Failed to fetch D-ID status.", 502, {
      status: didResponse.status,
      statusText: didResponse.statusText,
      body: errorBody ?? errorText
    });
  }

  const didPayload = await didResponse.json().catch(() => ({}));
  const didStatus = mapDidStatus(didPayload?.status);

  if (didStatus === "error") {
    await supabase
      .from("kataru_jobs")
      .update({ status: "error", error_message: didPayload?.error?.message ?? "D-ID failed." })
      .eq("id", jobId);
    return jsonResponse({
      jobId,
      status: "error",
      error: {
        code: "did_error",
        message: didPayload?.error?.message ?? "D-ID failed."
      }
    });
  }

  if (didStatus === "done") {
    const resultUrl = didPayload?.result_url;
    if (!resultUrl) {
      return jsonResponse({ jobId, status: "processing" });
    }

    if (!job.result_video_path) {
      try {
        const storedPath = await storeVideo(jobId, resultUrl);
        await supabase
          .from("kataru_jobs")
          .update({ status: "done", result_video_path: storedPath })
          .eq("id", jobId);

        const publicUrl = await toPublicUrl(BUCKETS.videos, storedPath);
        return jsonResponse({ jobId, status: "done", resultUrl: publicUrl });
      } catch (err) {
        await supabase
          .from("kataru_jobs")
          .update({ status: "error", error_message: err instanceof Error ? err.message : "Storage error" })
          .eq("id", jobId);
        return errorResponse("storage_failed", "Failed to store video.", 500);
      }
    }
  }

  await supabase.from("kataru_jobs").update({ status: didStatus }).eq("id", jobId);
  return jsonResponse({ jobId, status: didStatus });
}

async function handleVoices(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const locale = url.searchParams.get("locale");

  const endpoint = new URL(`${didApiUrl}/voices`);
  if (provider) endpoint.searchParams.set("provider", provider);

  const didResponse = await fetch(endpoint.toString(), {
    headers: {
      Authorization: buildDidAuthHeader()
    }
  });

  if (!didResponse.ok) {
    return errorResponse("did_voices_failed", "Failed to fetch voices.", 502);
  }

  const payload = await didResponse.json().catch(() => ({}));
  const voices = Array.isArray(payload) ? payload : payload?.voices ?? [];
  const filtered = locale
    ? voices.filter((voice: { language?: string; locale?: string }) =>
        (voice.language ?? voice.locale ?? "").startsWith(locale)
      )
    : voices;

  return jsonResponse({ voices: filtered });
}

async function handleCleanup(req: Request) {
  const payload = (await req.json().catch(() => null)) as { days?: number } | null;
  const days = payload?.days ?? 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobs, error } = await supabase
    .from("kataru_jobs")
    .select("id,avatar_image_path,product_image_path,result_video_path,created_at")
    .lt("created_at", cutoff)
    .limit(200);

  if (error) {
    return errorResponse("cleanup_failed", error.message, 500);
  }

  if (!jobs?.length) {
    return jsonResponse({ removed: 0 });
  }

  const avatarPaths = jobs.map((job) => job.avatar_image_path).filter(Boolean);
  const productPaths = jobs.map((job) => job.product_image_path).filter(Boolean);
  const videoPaths = jobs.map((job) => job.result_video_path).filter(Boolean);

  if (avatarPaths.length) {
    await supabase.storage.from(BUCKETS.avatars).remove(avatarPaths);
  }
  if (productPaths.length) {
    await supabase.storage.from(BUCKETS.products).remove(productPaths);
  }
  if (videoPaths.length) {
    await supabase.storage.from(BUCKETS.videos).remove(videoPaths);
  }

  await supabase.from("kataru_jobs").delete().in(
    "id",
    jobs.map((job) => job.id)
  );

  return jsonResponse({ removed: jobs.length });
}

async function handleXaiGenerate(req: Request) {
  if (!xaiApiKey) {
    return errorResponse("xai_config_missing", "Missing XAI_API_KEY env var.", 500);
  }

  const payload = (await req.json().catch(() => null)) as XaiGenerateRequest | null;
  if (!payload) {
    return errorResponse("invalid_json", "Request body must be valid JSON.");
  }

  const productImagePath = payload.productImagePath;
  const speakerImagePath = payload.speakerImagePath;
  const sceneImagePath = payload.sceneImagePath;
  if (!productImagePath) {
    return errorResponse("invalid_input", "productImagePath is required.");
  }
  if (!payload.productDescription || !payload.productDescription.trim()) {
    return errorResponse("invalid_input", "productDescription is required.");
  }

  const productPath = extractStoragePath(productImagePath, BUCKETS.products);
  const speakerPath = speakerImagePath ? extractStoragePath(speakerImagePath, BUCKETS.avatars) : null;
  const scenePath = sceneImagePath ? extractStoragePath(sceneImagePath, BUCKETS.products) : null;

  const sourceReference = sceneImagePath ?? productImagePath;
  const sourceBucket = BUCKETS.products;
  const sourceUrl = await resolvePublicUrl(sourceReference, sourceBucket);

  const duration = Math.max(1, Math.min(payload.duration ?? 8, 15));
  const aspectRatio = payload.aspectRatio ?? "16:9";
  const resolution = payload.resolution ?? "720p";
  const prompt = buildXaiPrompt(payload);

  const jobId = crypto.randomUUID();
  const insertResult = await supabase.from("kataru_xai_jobs").insert({
    id: jobId,
    status: "queued",
    product_image_path: productPath,
    speaker_image_path: speakerPath,
    scene_image_path: scenePath,
    product_name: payload.productName ?? null,
    product_description: payload.productDescription ?? null,
    brand_tone: payload.brandTone ?? null,
    scene_style: payload.sceneStyle ?? null,
    motion_style: payload.motionStyle ?? null,
    aspect_ratio: aspectRatio,
    duration_seconds: duration,
    resolution,
    prompt
  });

  if (insertResult.error) {
    return errorResponse("db_insert_failed", insertResult.error.message, 500);
  }

  const startUrl = `${xaiApiUrl}/v1/videos/generations`;
  const basePayload = {
    model: "grok-imagine-video",
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution
  };

  const buildPayload = (useImageObject: boolean) => ({
    ...basePayload,
    ...(useImageObject ? { image: { url: sourceUrl } } : { image_url: sourceUrl })
  });

  const callStart = (payload: Record<string, unknown>) =>
    fetch(startUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: buildXaiAuthHeader()
      },
      body: JSON.stringify(payload)
    });

  let startResponse = await callStart(buildPayload(true));
  let errorText = "";
  let errorBody: Record<string, unknown> | null = null;

  if (!startResponse.ok && (startResponse.status === 400 || startResponse.status === 422)) {
    errorText = await startResponse.text();
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = null;
    }
    startResponse = await callStart(buildPayload(false));
  }

  if (!startResponse.ok) {
    if (!errorText) {
      errorText = await startResponse.text();
      try {
        errorBody = JSON.parse(errorText);
      } catch {
        errorBody = null;
      }
    }
    const message =
      (errorBody as { message?: string })?.message ??
      (errorBody as { error?: { message?: string } })?.error?.message ??
      errorText ??
      "xAI request failed.";
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: message })
      .eq("id", jobId);
    return errorResponse("xai_request_failed", message, 502, {
      status: startResponse.status,
      statusText: startResponse.statusText,
      body: errorBody ?? errorText
    });
  }

  const startPayload = await startResponse.json().catch(() => ({}));
  const requestId =
    (startPayload as { request_id?: string })?.request_id ??
    (startPayload as { id?: string })?.id ??
    null;

  if (!requestId) {
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: "xAI did not return a request_id." })
      .eq("id", jobId);
    return errorResponse("xai_no_request_id", "xAI did not return a request_id.", 502, {
      body: startPayload
    });
  }

  await supabase
    .from("kataru_xai_jobs")
    .update({ status: "processing", xai_request_id: requestId })
    .eq("id", jobId);

  return jsonResponse({ jobId, status: "processing" });
}

async function handleXaiJob(req: Request, jobId: string) {
  if (!xaiApiKey) {
    return errorResponse("xai_config_missing", "Missing XAI_API_KEY env var.", 500);
  }

  const { data: job, error } = await supabase
    .from("kataru_xai_jobs")
    .select("id,status,xai_request_id,result_video_path,error_message,created_at")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    return errorResponse("db_read_failed", error.message, 500);
  }
  if (!job) {
    return errorResponse("not_found", "Job not found.", 404);
  }

  if (job.status === "done" && job.result_video_path) {
    const url = await toPublicUrl(BUCKETS.videos, job.result_video_path);
    return jsonResponse({ jobId, status: "done", resultUrl: url });
  }

  if (job.status === "error") {
    return jsonResponse({ jobId, status: "error", error: { message: job.error_message ?? "xAI failed." } });
  }

  if (!job.xai_request_id) {
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: "Missing xAI request_id." })
      .eq("id", jobId);
    return errorResponse("xai_no_request_id", "Missing xAI request_id.", 502);
  }

  const resultUrl = `${xaiApiUrl}/v1/videos/${job.xai_request_id}`;
  const resultResponse = await fetch(resultUrl, {
    headers: {
      Authorization: buildXaiAuthHeader()
    }
  });

  if (resultResponse.status === 202 || resultResponse.status === 204) {
    return jsonResponse({ jobId, status: "processing" });
  }

  if (!resultResponse.ok) {
    const errorText = await resultResponse.text();
    let errorBody: Record<string, unknown> | null = null;
    try {
      errorBody = JSON.parse(errorText);
    } catch {
      errorBody = null;
    }
    const message = `xAI status check failed: HTTP ${resultResponse.status}`;
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: message })
      .eq("id", jobId);
    return errorResponse("xai_status_failed", "Failed to fetch xAI status.", 502, {
      status: resultResponse.status,
      statusText: resultResponse.statusText,
      body: errorBody ?? errorText
    });
  }

  const resultPayload = await resultResponse.json().catch(() => ({}));
  const videoUrl = resolveXaiResultUrl(resultPayload as Record<string, unknown>);
  if (!videoUrl) {
    const message = "xAI returned 200 but no video URL was found.";
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: message })
      .eq("id", jobId);
    return errorResponse("xai_no_video_url", message, 502, { body: resultPayload });
  }

  try {
    const storedPath = await storeVideo(jobId, videoUrl);
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "done", result_video_path: storedPath })
      .eq("id", jobId);
    const publicUrl = await toPublicUrl(BUCKETS.videos, storedPath);
    return jsonResponse({ jobId, status: "done", resultUrl: publicUrl });
  } catch (err) {
    await supabase
      .from("kataru_xai_jobs")
      .update({ status: "error", error_message: err instanceof Error ? err.message : "Storage error" })
      .eq("id", jobId);
    return errorResponse("storage_failed", "Failed to store video.", 500);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const path = normalizePath(req);

  if (req.method === "POST" && path === "/generate-video") {
    return await handleGenerate(req);
  }

  if (req.method === "GET" && path.startsWith("/jobs/")) {
    const jobId = path.split("/")[2];
    if (!jobId) {
      return errorResponse("invalid_job", "Job id is required.");
    }
    return await handleJobStatus(req, jobId);
  }

  if (req.method === "GET" && path === "/voices") {
    return await handleVoices(req);
  }

  if (req.method === "POST" && path === "/cleanup") {
    return await handleCleanup(req);
  }

  if (req.method === "POST" && path === "/xai/generate-video") {
    return await handleXaiGenerate(req);
  }

  if (req.method === "GET" && path.startsWith("/xai/jobs/")) {
    const jobId = path.split("/")[3];
    if (!jobId) {
      return errorResponse("invalid_job", "Job id is required.");
    }
    return await handleXaiJob(req, jobId);
  }

  return errorResponse("not_found", "Route not found.", 404);
});
