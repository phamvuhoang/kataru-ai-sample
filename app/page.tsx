"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, Mic2, Sparkles, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BUCKETS = {
  avatars: "kataru-avatars",
  products: "kataru-products"
} as const;

const STATUS_COPY: Record<string, { title: string; detail: string }> = {
  idle: { title: "準備完了", detail: "画像と日本語テキストを入力してください。" },
  uploading: { title: "アップロード中", detail: "画像を安全に保存しています…" },
  generating: { title: "生成開始", detail: "動画生成システムにリクエストを送信しました。" },
  polling: { title: "生成中", detail: "数十秒かかることがあります。しばらくお待ちください。" },
  done: { title: "生成完了", detail: "動画の再生とダウンロードが可能です。" },
  error: { title: "エラー", detail: "入力内容をご確認ください。" }
};

const DEFAULT_SCRIPT =
  "こちらの商品は、日常をもっと便利にしてくれる最新ガジェットです。軽量で使いやすく、忙しい毎日をサポートします。";

type GenerationStatus = "idle" | "uploading" | "generating" | "polling" | "done" | "error";
type VoiceProvider = "microsoft" | "amazon" | "elevenlabs";
type VoiceOption = {
  id: string;
  name?: string;
  gender?: string;
  language?: string;
  locale?: string;
  provider?: string;
};
type Mode = "lipsync" | "xai";

const DEFAULT_VOICE_BY_PROVIDER: Record<VoiceProvider, string> = {
  microsoft: "ja-JP-NanamiNeural",
  amazon: "",
  elevenlabs: ""
};
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const XAI_DEFAULTS = {
  aspectRatio: "16:9",
  duration: 8,
  resolution: "720p"
};
const XAI_TONES = ["プレミアム", "ミニマル", "テック", "ナチュラル", "ラグジュアリー", "ポップ"];
const XAI_SCENES = ["洗練スタジオ", "ライフスタイル", "和モダン", "近未来", "抽象背景"];
const XAI_MOTIONS = ["ゆっくりズーム", "スライド", "ゆるい回転", "ドリーイン", "シネマティックパン"];
const XAI_ASPECT_SIZES: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
  "4:3": { width: 960, height: 720 },
  "3:4": { width: 720, height: 960 },
  "3:2": { width: 1200, height: 800 },
  "2:3": { width: 800, height: 1200 }
};

function makePreview(file?: File | null) {
  if (!file) return null;
  return URL.createObjectURL(file);
}

async function uploadFile(bucket: string, file: Blob, filename?: string) {
  const extension = filename?.split(".").pop() ?? "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  if (error) throw error;
  return path;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeVoiceName(voice: VoiceOption) {
  const raw = (voice.name ?? voice.id ?? "").toString();
  let name = raw.replace(/^ja[-_]?JP[-_]?/i, "").replace(/Neural|Studio|HD|Voice|_/gi, " ").trim();
  if (!name) name = raw;
  return name.length ? name : "Japanese Voice";
}

function formatVoiceLabel(voice: VoiceOption) {
  const gender = voice.gender?.toLowerCase();
  const genderLabel = gender
    ? gender.startsWith("f")
      ? "女性"
      : gender.startsWith("m")
      ? "男性"
      : "中性"
    : undefined;
  return genderLabel ? `${normalizeVoiceName(voice)} (${genderLabel})` : normalizeVoiceName(voice);
}

function isJapaneseVoice(voice: VoiceOption) {
  const locale = voice.locale ?? voice.language ?? voice.id ?? "";
  return locale.toLowerCase().startsWith("ja");
}

function validateImageFile(file: File) {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return "JPGまたはPNG形式の画像を選択してください。";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "画像サイズは10MB以内にしてください。";
  }
  return null;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.max(w / image.width, h / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
}

async function composeSceneImage(avatarFile: File, productFile: File) {
  const width = 1280;
  const height = 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#fdf6ee");
  gradient.addColorStop(1, "#f2e7db");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const [avatarBitmap, productBitmap] = await Promise.all([
    createImageBitmap(avatarFile),
    createImageBitmap(productFile)
  ]);

  const avatarArea = { x: 56, y: 40, w: 640, h: 640 };
  drawImageCover(ctx, avatarBitmap, avatarArea.x, avatarArea.y, avatarArea.w, avatarArea.h);

  const productArea = { x: 760, y: 150, w: 420, h: 420 };
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.18)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  drawRoundedRect(ctx, productArea.x, productArea.y, productArea.w, productArea.h, 28);
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, productArea.x + 16, productArea.y + 16, productArea.w - 32, productArea.h - 32, 20);
  ctx.clip();
  drawImageCover(
    ctx,
    productBitmap,
    productArea.x + 16,
    productArea.y + 16,
    productArea.w - 32,
    productArea.h - 32
  );
  ctx.restore();

  ctx.fillStyle = "#3a2c20";
  ctx.font = "600 26px 'Noto Sans JP', system-ui, sans-serif";
  ctx.fillText("注目の商品", productArea.x, productArea.y - 18);

  avatarBitmap.close();
  productBitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to create composite image."));
    }, "image/png");
  });

  return blob;
}

async function composeXaiSceneImage(productFile: File, speakerFile: File, aspectRatio: string) {
  const size = XAI_ASPECT_SIZES[aspectRatio] ?? XAI_ASPECT_SIZES["16:9"];
  const width = size.width;
  const height = size.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f9f4f1");
  gradient.addColorStop(0.5, "#f2e8f1");
  gradient.addColorStop(1, "#e8f0f6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const [speakerBitmap, productBitmap] = await Promise.all([
    createImageBitmap(speakerFile),
    createImageBitmap(productFile)
  ]);

  const padding = Math.round(Math.min(width, height) * 0.05);
  const isLandscape = width >= height;
  const speakerArea = isLandscape
    ? { x: padding, y: padding, w: Math.round(width * 0.56) - padding, h: height - padding * 2 }
    : { x: padding, y: padding, w: width - padding * 2, h: Math.round(height * 0.58) - padding };
  const productArea = isLandscape
    ? {
        x: Math.round(width * 0.58),
        y: Math.round(height * 0.2),
        w: width - Math.round(width * 0.58) - padding,
        h: Math.round(height * 0.6)
      }
    : {
        x: padding,
        y: Math.round(height * 0.62),
        w: width - padding * 2,
        h: height - Math.round(height * 0.62) - padding
      };

  ctx.save();
  ctx.shadowColor = "rgba(17, 24, 39, 0.2)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  drawRoundedRect(ctx, speakerArea.x, speakerArea.y, speakerArea.w, speakerArea.h, 28);
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRect(ctx, speakerArea.x, speakerArea.y, speakerArea.w, speakerArea.h, 28);
  ctx.clip();
  drawImageCover(ctx, speakerBitmap, speakerArea.x, speakerArea.y, speakerArea.w, speakerArea.h);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.2)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  drawRoundedRect(ctx, productArea.x, productArea.y, productArea.w, productArea.h, 26);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fill();
  ctx.restore();

  ctx.save();
  drawRoundedRect(
    ctx,
    productArea.x + 18,
    productArea.y + 18,
    productArea.w - 36,
    productArea.h - 36,
    20
  );
  ctx.clip();
  drawImageCover(
    ctx,
    productBitmap,
    productArea.x + 18,
    productArea.y + 18,
    productArea.w - 36,
    productArea.h - 36
  );
  ctx.restore();

  speakerBitmap.close();
  productBitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("Failed to create composite image."));
    }, "image/png");
  });

  return blob;
}

export default function HomePage() {
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null);
  const [productFile, setProductFile] = React.useState<File | null>(null);
  const [scriptText, setScriptText] = React.useState(DEFAULT_SCRIPT);
  const [voiceProvider, setVoiceProvider] = React.useState<VoiceProvider>("microsoft");
  const [voiceId, setVoiceId] = React.useState<string | null>(DEFAULT_VOICE_BY_PROVIDER.microsoft);
  const [status, setStatus] = React.useState<GenerationStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>("lipsync");

  const [xaiSpeakerFile, setXaiSpeakerFile] = React.useState<File | null>(null);
  const [xaiProductFile, setXaiProductFile] = React.useState<File | null>(null);
  const [xaiProductName, setXaiProductName] = React.useState("");
  const [xaiDescription, setXaiDescription] = React.useState(
    "日本の暮らしに寄り添う上質なデザインで、毎日が少し特別になるアイテムです。"
  );
  const [xaiTone, setXaiTone] = React.useState(XAI_TONES[0]);
  const [xaiScene, setXaiScene] = React.useState(XAI_SCENES[0]);
  const [xaiMotion, setXaiMotion] = React.useState(XAI_MOTIONS[0]);
  const [xaiAspectRatio, setXaiAspectRatio] = React.useState(XAI_DEFAULTS.aspectRatio);
  const [xaiDuration, setXaiDuration] = React.useState<number>(XAI_DEFAULTS.duration);
  const [xaiResolution, setXaiResolution] = React.useState(XAI_DEFAULTS.resolution);
  const [xaiStatus, setXaiStatus] = React.useState<GenerationStatus>("idle");
  const [xaiError, setXaiError] = React.useState<string | null>(null);
  const [xaiJobId, setXaiJobId] = React.useState<string | null>(null);
  const [xaiVideoUrl, setXaiVideoUrl] = React.useState<string | null>(null);
  const [xaiResumeReady, setXaiResumeReady] = React.useState(false);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const voicesQuery = useQuery({
    queryKey: ["voices", voiceProvider],
    enabled: Boolean(supabaseUrl && supabaseAnonKey),
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<VoiceOption[]> => {
      if (!supabaseUrl || !supabaseAnonKey) return [];
      const response = await fetch(
        `${supabaseUrl}/functions/v1/kataru/voices?provider=${voiceProvider}&locale=ja`,
        {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`
          }
        }
      );
      if (!response.ok) {
        throw new Error("音声一覧の取得に失敗しました。");
      }
      const payload = await response.json();
      return Array.isArray(payload?.voices) ? payload.voices : [];
    }
  });

  const voiceOptions = React.useMemo(() => {
    const base = voicesQuery.data?.length ? voicesQuery.data : [];
    const filtered = base.filter((voice) => isJapaneseVoice(voice));
    if (filtered.length) return filtered;
    if (voiceProvider === "microsoft") {
      return [
        {
          id: DEFAULT_VOICE_BY_PROVIDER.microsoft,
          name: "Nanami",
          gender: "female",
          language: "ja-JP",
          provider: "microsoft"
        }
      ];
    }
    return [];
  }, [voicesQuery.data, voiceProvider]);

  React.useEffect(() => {
    if (!voiceOptions.length) return;
    const preferred = DEFAULT_VOICE_BY_PROVIDER[voiceProvider];
    const nextVoice = voiceOptions.find((voice) => voice.id === preferred) ?? voiceOptions[0];
    setVoiceId((prev) => (prev && voiceOptions.some((voice) => voice.id === prev) ? prev : nextVoice.id));
  }, [voiceOptions, voiceProvider]);

  const avatarPreview = React.useMemo(() => makePreview(avatarFile), [avatarFile]);
  const productPreview = React.useMemo(() => makePreview(productFile), [productFile]);
  const xaiSpeakerPreview = React.useMemo(() => makePreview(xaiSpeakerFile), [xaiSpeakerFile]);
  const xaiProductPreview = React.useMemo(() => makePreview(xaiProductFile), [xaiProductFile]);

  React.useEffect(() => {
    return () => {
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      if (productPreview) URL.revokeObjectURL(productPreview);
      if (xaiSpeakerPreview) URL.revokeObjectURL(xaiSpeakerPreview);
      if (xaiProductPreview) URL.revokeObjectURL(xaiProductPreview);
    };
  }, [avatarPreview, productPreview, xaiSpeakerPreview, xaiProductPreview]);

  React.useEffect(() => {
    if (mode === "lipsync") {
      setXaiError(null);
    } else {
      setError(null);
    }
  }, [mode]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const storedJobId = window.localStorage.getItem("kataru_xai_job_id");
    if (storedJobId) {
      setXaiJobId(storedJobId);
      setXaiResumeReady(true);
    }
  }, []);

  const voiceHint = voicesQuery.isLoading
    ? "音声一覧を読み込み中です…"
    : voicesQuery.isError
    ? voiceProvider === "microsoft"
      ? "音声一覧の取得に失敗しました。標準音声で続行できます。"
      : "音声一覧の取得に失敗しました。時間をおいて再度お試しください。"
    : "日本語音声のみ表示しています。";

  const voiceSelectDisabled = voicesQuery.isLoading || (!voiceOptions.length && voiceProvider !== "microsoft");
  const isLipBusy = status === "uploading" || status === "generating" || status === "polling";
  const isXaiBusy = xaiStatus === "uploading" || xaiStatus === "generating" || xaiStatus === "polling";
  const activeStatus = mode === "lipsync" ? status : xaiStatus;
  const activeError = mode === "lipsync" ? error : xaiError;
  const activeVideoUrl = mode === "lipsync" ? videoUrl : xaiVideoUrl;
  const activeProductPreview = mode === "lipsync" ? productPreview : xaiProductPreview;

  const resetLip = () => {
    setStatus("idle");
    setError(null);
    setJobId(null);
    setVideoUrl(null);
  };

  const resetXai = () => {
    setXaiStatus("idle");
    setXaiError(null);
    setXaiJobId(null);
    setXaiVideoUrl(null);
    setXaiSpeakerFile(null);
    setXaiProductFile(null);
    setXaiResumeReady(false);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("kataru_xai_job_id");
    }
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setAvatarFile(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setAvatarFile(null);
      setError(validationError);
      setStatus("error");
      event.target.value = "";
      return;
    }
    setError(null);
    setStatus("idle");
    setAvatarFile(file);
  };

  const handleProductChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setProductFile(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setProductFile(null);
      setError(validationError);
      setStatus("error");
      event.target.value = "";
      return;
    }
    setError(null);
    setStatus("idle");
    setProductFile(file);
  };

  const handleXaiProductChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setXaiProductFile(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setXaiProductFile(null);
      setXaiError(validationError);
      setXaiStatus("error");
      event.target.value = "";
      return;
    }
    setXaiError(null);
    setXaiStatus("idle");
    setXaiProductFile(file);
  };

  const handleXaiSpeakerChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setXaiSpeakerFile(null);
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setXaiSpeakerFile(null);
      setXaiError(validationError);
      setXaiStatus("error");
      event.target.value = "";
      return;
    }
    setXaiError(null);
    setXaiStatus("idle");
    setXaiSpeakerFile(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!avatarFile || !productFile || !scriptText.trim()) {
      setError("画像2点と紹介文（日本語）を入力してください。");
      setStatus("error");
      return;
    }
    if (!voiceId) {
      setError("音声を選択してください。");
      setStatus("error");
      return;
    }

    try {
      setError(null);
      setStatus("uploading");

      const avatarPath = await uploadFile(BUCKETS.avatars, avatarFile, avatarFile.name);
      const productPath = await uploadFile(BUCKETS.products, productFile, productFile.name);
      let scenePath = avatarPath;

      try {
        const sceneBlob = await composeSceneImage(avatarFile, productFile);
        scenePath = await uploadFile(BUCKETS.avatars, sceneBlob, "scene.png");
      } catch (sceneError) {
        console.warn("Failed to compose scene image, fallback to avatar image.", sceneError);
      }

      setStatus("generating");
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("環境設定が不足しています。");
      }

      const generateResponse = await fetch(`${supabaseUrl}/functions/v1/kataru/generate-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          avatarImagePath: scenePath,
          productImagePath: productPath,
          scriptText,
          useStitch: true,
          voice: {
            provider: voiceProvider,
            voiceId
          }
        })
      });

      if (!generateResponse.ok) {
        const payload = await generateResponse.json().catch(() => ({}));
        throw new Error(payload?.error?.message ?? "生成リクエストに失敗しました。");
      }

      const generated = await generateResponse.json();
      setJobId(generated.jobId ?? null);
      setStatus("polling");

      const maxAttempts = 60;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const statusResponse = await fetch(`${supabaseUrl}/functions/v1/kataru/jobs/${generated.jobId}`, {
          method: "GET",
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`
          }
        });

        if (!statusResponse.ok) {
          const payload = await statusResponse.json().catch(() => ({}));
          throw new Error(payload?.error?.message ?? "ステータス取得に失敗しました。");
        }

        const job = await statusResponse.json();

        if (job.status === "done" && job.resultUrl) {
          setVideoUrl(job.resultUrl);
          setStatus("done");
          return;
        }

        if (job.status === "error") {
          setStatus("error");
          setError(job?.error?.message ?? "生成に失敗しました。");
          return;
        }

        await sleep(4000);
      }

      throw new Error("生成に時間がかかっています。後で再開できます。");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "不明なエラーが発生しました。");
    }
  };

  const pollXaiJob = async (jobId: string) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("環境設定が不足しています。");
    }

    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const statusResponse = await fetch(`${supabaseUrl}/functions/v1/kataru/xai/jobs/${jobId}`, {
        method: "GET",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`
        }
      });

      if (!statusResponse.ok) {
        const payload = await statusResponse.json().catch(() => ({}));
        throw new Error(payload?.error?.message ?? "ステータス取得に失敗しました。");
      }

      const job = await statusResponse.json();

      if (job.status === "done" && job.resultUrl) {
        setXaiVideoUrl(job.resultUrl);
        setXaiStatus("done");
        setXaiError(null);
        setXaiResumeReady(false);
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("kataru_xai_job_id");
        }
        return;
      }

      if (job.status === "error") {
        setXaiStatus("error");
        setXaiError(job?.error?.message ?? "生成に失敗しました。");
        return;
      }

      await sleep(5000);
    }

    setXaiStatus("error");
    setXaiError("生成に時間がかかっています。後で再開できます。");
    setXaiResumeReady(true);
  };

  const handleXaiSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!xaiProductFile || !xaiDescription.trim()) {
      setXaiError("商品画像と商品説明（日本語）を入力してください。");
      setXaiStatus("error");
      return;
    }

    try {
      setXaiError(null);
      setXaiStatus("uploading");

      const productPath = await uploadFile(BUCKETS.products, xaiProductFile, xaiProductFile.name);
      let speakerPath: string | null = null;
      let scenePath: string | null = null;

      if (xaiSpeakerFile) {
        speakerPath = await uploadFile(BUCKETS.avatars, xaiSpeakerFile, xaiSpeakerFile.name);
        try {
          const sceneBlob = await composeXaiSceneImage(xaiProductFile, xaiSpeakerFile, xaiAspectRatio);
          scenePath = await uploadFile(BUCKETS.products, sceneBlob, "scene.png");
        } catch (sceneError) {
          console.warn("Failed to compose xAI scene image, fallback to product image.", sceneError);
        }
      }

      setXaiStatus("generating");
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("環境設定が不足しています。");
      }

      const generateResponse = await fetch(`${supabaseUrl}/functions/v1/kataru/xai/generate-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          productImagePath: productPath,
          ...(speakerPath ? { speakerImagePath: speakerPath } : {}),
          ...(scenePath ? { sceneImagePath: scenePath } : {}),
          productName: xaiProductName,
          productDescription: xaiDescription,
          brandTone: xaiTone,
          sceneStyle: xaiScene,
          motionStyle: xaiMotion,
          aspectRatio: xaiAspectRatio,
          duration: xaiDuration,
          resolution: xaiResolution
        })
      });

      if (!generateResponse.ok) {
        const payload = await generateResponse.json().catch(() => ({}));
        throw new Error(payload?.error?.message ?? "生成リクエストに失敗しました。");
      }

      const generated = await generateResponse.json();
      setXaiJobId(generated.jobId ?? null);
      setXaiStatus("polling");
      if (generated.jobId && typeof window !== "undefined") {
        window.localStorage.setItem("kataru_xai_job_id", generated.jobId);
        setXaiResumeReady(false);
      }

      if (generated.jobId) {
        await pollXaiJob(generated.jobId);
        return;
      }
      throw new Error("ジョブIDの取得に失敗しました。");
    } catch (err) {
      setXaiStatus("error");
      setXaiError(err instanceof Error ? err.message : "不明なエラーが発生しました。");
    }
  };

  const handleXaiResume = async () => {
    if (!xaiJobId) {
      return;
    }
    setXaiStatus("polling");
    setXaiError(null);
    await pollXaiJob(xaiJobId);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_#fff7f2,_#f4eee8_45%,_#efe7e2_80%)] text-foreground">
      <div className="pointer-events-none absolute left-1/2 top-[-140px] h-[320px] w-[320px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_rgba(255,255,255,0.9)_0%,_rgba(255,197,143,0.35)_45%,_rgba(255,197,143,0)_70%)] blur-2xl" />
      <div className="pointer-events-none absolute right-[-120px] top-[160px] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,_rgba(94,234,212,0.35)_0%,_rgba(94,234,212,0)_70%)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-180px] left-[-120px] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,_rgba(255,179,71,0.32)_0%,_rgba(255,179,71,0)_70%)] blur-3xl" />

      <section className="relative mx-auto flex max-w-6xl flex-col gap-12 px-6 py-20 lg:flex-row lg:items-start lg:gap-16">
        <div className="flex flex-1 flex-col gap-6 animate-[fade-up_0.8s_ease-out]">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.4em] text-muted-foreground">
            <span className="h-[1px] w-10 bg-muted-foreground/60" />
            <Sparkles className="h-3.5 w-3.5 text-primary/80" />
            Kataru AI Studio
          </div>
          <h1 className="text-balance font-serif text-4xl leading-tight md:text-5xl">
            日本語の紹介文で、
            <span className="bg-gradient-to-r from-amber-700 via-rose-500 to-emerald-600 bg-clip-text text-transparent">
              美しい商品紹介動画
            </span>
            を即生成。
          </h1>
          <p className="text-base text-muted-foreground md:text-lg">
            画像2点と日本語テキストを入力すると、AI動画生成システムが自然な口パク動画を作成します。生成完了後は
            ブラウザで再生し、MP4としてダウンロードできます。
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="rounded-full border border-white/70 bg-white/70 px-4 py-1.5 shadow-sm">
              2つの生成モードを切り替え可能
            </span>
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary/80" />
              話者リップシンク
            </span>
            <span className="flex items-center gap-2">
              <Video className="h-4 w-4 text-primary/80" />
              商用プロモーション
            </span>
          </div>

          <Card className="relative overflow-hidden border-white/60 bg-white/70 p-6 shadow-[0_25px_60px_rgba(51,34,20,0.12)] backdrop-blur-xl transition-transform duration-300 hover:-translate-y-1">
            <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.55),rgba(255,255,255,0)_60%)] opacity-70" />
            <div className="relative flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">現在の状態</p>
                  <p className="text-lg font-semibold">{STATUS_COPY[activeStatus].title}</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-rose-400 to-emerald-400 text-white shadow-lg">
                  <Sparkles className="h-5 w-5" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{STATUS_COPY[activeStatus].detail}</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full w-1/3 rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-emerald-300",
                    activeStatus === "idle" && "w-1/5",
                    activeStatus === "uploading" && "w-1/3",
                    activeStatus === "generating" && "w-1/2",
                    activeStatus === "polling" && "w-2/3",
                    activeStatus === "done" && "w-full",
                    activeStatus === "error" && "w-full bg-destructive"
                  )}
                  style={{ animation: activeStatus === "polling" ? "shimmer 3s linear infinite" : undefined }}
                />
              </div>
              {activeError ? <p className="text-sm text-destructive">{activeError}</p> : null}
            </div>
          </Card>

          <div className="grid gap-4 rounded-2xl border border-white/60 bg-white/60 p-5 text-sm text-muted-foreground shadow-[0_18px_40px_rgba(49,33,20,0.08)] backdrop-blur-lg">
            <div className="flex items-center gap-3">
              <span className="text-lg">✔</span>
              <span>話者の正面写真は高解像度がおすすめです。</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg">✔</span>
              <span>商品画像は動画内に美しく合成されます。</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg">✔</span>
              <span>入力文は口語調だと自然な口パクになります。</span>
            </div>
          </div>
        </div>

        <div className="flex w-full max-w-xl flex-col gap-6 animate-[fade-up_1s_ease-out]">
          <div className="flex items-center justify-between gap-4 rounded-full border border-white/70 bg-white/70 p-2 shadow-[0_12px_30px_rgba(33,23,15,0.08)] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setMode("lipsync")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                mode === "lipsync"
                  ? "bg-gradient-to-r from-amber-500 via-rose-500 to-emerald-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Mic2 className="h-4 w-4" />
              リップシンク
            </button>
            <button
              type="button"
              onClick={() => setMode("xai")}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                mode === "xai"
                  ? "bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-500 text-white shadow-lg"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Video className="h-4 w-4" />
              商用プロモーション
            </button>
          </div>
          {mode === "lipsync" ? (
            <Card className="border-white/60 bg-white/75 p-6 shadow-[0_20px_50px_rgba(35,25,18,0.1)] backdrop-blur-xl">
              <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="avatar" className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-primary/80" />
                    話者の写真
                  </Label>
                  <Input
                    id="avatar"
                    type="file"
                    accept="image/jpeg,image/png"
                    className="border-white/60 bg-white/70"
                    onChange={handleAvatarChange}
                  />
                  <p className="text-xs text-muted-foreground">対応形式: JPG/PNG（10MB以内）</p>
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="話者プレビュー"
                      className="mt-2 h-32 w-32 rounded-xl object-cover shadow-sm"
                    />
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="product" className="flex items-center gap-2">
                    <Image className="h-4 w-4 text-primary/80" />
                    商品画像
                  </Label>
                  <Input
                    id="product"
                    type="file"
                    accept="image/jpeg,image/png"
                    className="border-white/60 bg-white/70"
                    onChange={handleProductChange}
                  />
                  <p className="text-xs text-muted-foreground">対応形式: JPG/PNG（10MB以内）</p>
                  {productPreview ? (
                    <img
                      src={productPreview}
                      alt="商品プレビュー"
                      className="mt-2 h-32 w-32 rounded-xl object-cover shadow-sm"
                    />
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="script" className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary/80" />
                      紹介文（日本語）
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setScriptText(DEFAULT_SCRIPT)}
                    >
                      サンプル文を挿入
                    </Button>
                  </div>
                  <Textarea
                    id="script"
                    value={scriptText}
                    onChange={(event) => setScriptText(event.target.value)}
                    rows={5}
                    className="border-white/60 bg-white/70"
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="flex items-center gap-2">
                    <Mic2 className="h-4 w-4 text-primary/80" />
                    音声の選択
                  </Label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select value={voiceProvider} onValueChange={(value) => setVoiceProvider(value as VoiceProvider)}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="プロバイダ" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="microsoft">Microsoft</SelectItem>
                        <SelectItem value="amazon">Amazon</SelectItem>
                        <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={voiceId ?? ""}
                      onValueChange={(value) => setVoiceId(value)}
                      disabled={voiceSelectDisabled}
                    >
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder={voicesQuery.isLoading ? "読み込み中…" : "音声を選択"} />
                      </SelectTrigger>
                      <SelectContent>
                        {voicesQuery.isLoading ? (
                          <SelectItem value="loading" disabled>
                            読み込み中…
                          </SelectItem>
                        ) : null}
                        {voicesQuery.isError && !voiceOptions.length ? (
                          <SelectItem value="error" disabled>
                            取得に失敗しました
                          </SelectItem>
                        ) : null}
                        {voiceOptions.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {formatVoiceLabel(voice)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">{voiceHint}</p>
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full shadow-[0_12px_30px_rgba(236,120,64,0.35)] transition-transform duration-300 hover:-translate-y-0.5"
                    disabled={isLipBusy || voiceSelectDisabled}
                  >
                    {isLipBusy ? "生成中…" : "いま生成する"}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetLip} disabled={isLipBusy}>
                    入力をリセット
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Card className="border-white/60 bg-white/75 p-6 shadow-[0_20px_50px_rgba(35,25,18,0.1)] backdrop-blur-xl">
              <form className="flex flex-col gap-5" onSubmit={handleXaiSubmit}>
                {xaiResumeReady ? (
                  <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 p-4 text-sm text-emerald-900">
                    前回の生成ジョブが残っています。再開すると結果を取得できます。
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={handleXaiResume} disabled={isXaiBusy}>
                        生成を再開
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={resetXai} disabled={isXaiBusy}>
                        破棄する
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="xai-speaker" className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-primary/80" />
                      話者の写真（任意）
                    </Label>
                    <Input
                      id="xai-speaker"
                      type="file"
                      accept="image/jpeg,image/png"
                      className="border-white/60 bg-white/70"
                      onChange={handleXaiSpeakerChange}
                    />
                    <p className="text-xs text-muted-foreground">
                      未入力でもOK。入力すると話者と商品を同じシーンに合成します。
                    </p>
                    {xaiSpeakerPreview ? (
                      <img
                        src={xaiSpeakerPreview}
                        alt="話者プレビュー"
                        className="mt-1 h-28 w-28 rounded-xl object-cover shadow-sm"
                      />
                    ) : null}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="xai-product" className="flex items-center gap-2">
                      <Image className="h-4 w-4 text-primary/80" />
                      商品画像
                    </Label>
                    <Input
                      id="xai-product"
                      type="file"
                      accept="image/jpeg,image/png"
                      className="border-white/60 bg-white/70"
                      onChange={handleXaiProductChange}
                    />
                    <p className="text-xs text-muted-foreground">対応形式: JPG/PNG（10MB以内）</p>
                    {xaiProductPreview ? (
                      <img
                        src={xaiProductPreview}
                        alt="商品プレビュー"
                        className="mt-1 h-28 w-28 rounded-xl object-cover shadow-sm"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="xai-name" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary/80" />
                    商品名（任意）
                  </Label>
                  <Input
                    id="xai-name"
                    value={xaiProductName}
                    onChange={(event) => setXaiProductName(event.target.value)}
                    className="border-white/60 bg-white/70"
                    placeholder="例: Aurora ミストセラム"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="xai-description" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary/80" />
                    商品説明（日本語）
                  </Label>
                  <Textarea
                    id="xai-description"
                    value={xaiDescription}
                    onChange={(event) => setXaiDescription(event.target.value)}
                    rows={4}
                    className="border-white/60 bg-white/70"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>トーン</Label>
                    <Select value={xaiTone} onValueChange={setXaiTone}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="トーン" />
                      </SelectTrigger>
                      <SelectContent>
                        {XAI_TONES.map((tone) => (
                          <SelectItem key={tone} value={tone}>
                            {tone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>シーン</Label>
                    <Select value={xaiScene} onValueChange={setXaiScene}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="シーン" />
                      </SelectTrigger>
                      <SelectContent>
                        {XAI_SCENES.map((scene) => (
                          <SelectItem key={scene} value={scene}>
                            {scene}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>カメラ</Label>
                    <Select value={xaiMotion} onValueChange={setXaiMotion}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="モーション" />
                      </SelectTrigger>
                      <SelectContent>
                        {XAI_MOTIONS.map((motion) => (
                          <SelectItem key={motion} value={motion}>
                            {motion}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>縦横比</Label>
                    <Select value={xaiAspectRatio} onValueChange={setXaiAspectRatio}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="アスペクト比" />
                      </SelectTrigger>
                      <SelectContent>
                        {["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"].map((ratio) => (
                          <SelectItem key={ratio} value={ratio}>
                            {ratio}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>秒数</Label>
                    <Input
                      type="number"
                      min={1}
                      max={15}
                      value={xaiDuration}
                      onChange={(event) => setXaiDuration(Number(event.target.value))}
                      className="border-white/60 bg-white/70"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>解像度</Label>
                    <Select value={xaiResolution} onValueChange={setXaiResolution}>
                      <SelectTrigger className="border-white/60 bg-white/70">
                        <SelectValue placeholder="解像度" />
                      </SelectTrigger>
                      <SelectContent>
                        {["720p", "480p"].map((res) => (
                          <SelectItem key={res} value={res}>
                            {res}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full shadow-[0_12px_30px_rgba(64,166,142,0.3)] transition-transform duration-300 hover:-translate-y-0.5"
                    disabled={isXaiBusy}
                  >
                    {isXaiBusy ? "生成中…" : "プロモ動画を生成"}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetXai} disabled={isXaiBusy}>
                    入力をリセット
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card className="border-white/60 bg-white/75 p-6 shadow-[0_18px_45px_rgba(35,25,18,0.1)] backdrop-blur-xl">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Video className="h-4 w-4 text-primary/80" />
                  プレビュー
                </h2>
                {activeVideoUrl ? (
                  <a
                    href={activeVideoUrl}
                    download
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    MP4をダウンロード
                  </a>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
                <div className="aspect-video overflow-hidden rounded-2xl bg-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)]">
                  {activeVideoUrl ? (
                    <video src={activeVideoUrl} controls className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <span className="text-xl">🎬</span>
                      生成された動画がここに表示されます
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/60 bg-white/70 p-3 shadow-[0_14px_30px_rgba(30,22,15,0.08)] backdrop-blur-md">
                  {activeProductPreview ? (
                    <img src={activeProductPreview} alt="商品" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      商品素材
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                生成された動画URLは一定時間で無効になるため、必要に応じてダウンロードしてください。
              </p>
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}
