require("./env").loadEnvFiles();

const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { basename, extname } = require("node:path");
const WebSocket = require("ws");
const { readUploadByUrlPath } = require("./uploads");

const DEFAULT_BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com";
const DEFAULT_WS_URL =
  process.env.DASHSCOPE_WS_URL || "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

const MODEL_ID_MAP = {
  "Qwen Plus": "qwen-plus",
  "Qwen Max": "qwen-max",
  "Qwen VL Plus": "qwen-vl-plus",
  "Wan 2.6 T2I": "wan2.6-t2i",
  "Wan 2.6 T2V": "wan2.6-t2v",
  "WanX 2.1 Image Edit": "wanx2.1-imageedit",
  "WanX 2.1 I2V Turbo": "wanx2.1-i2v-turbo",
  "WanX 2.1 I2V Plus": "wanx2.1-i2v-plus",
  "Wan 2.2 KF2V Flash": "wan2.2-kf2v-flash",
  "WanX 2.1 KF2V Plus": "wanx2.1-kf2v-plus",
  "Wan 2.2 S2V Detect": "wan2.2-s2v-detect",
  "Wan 2.2 S2V": "wan2.2-s2v",
  "CosyVoice V3 Flash": "cosyvoice-v3-flash",
};

function hasAliyunApiKey() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

function normalizeModelId(model) {
  if (!model) return model;
  return MODEL_ID_MAP[model] || model;
}

const VOICE_PRESET_ALIASES = {
  female_story_01: "longanyang",
  female_calm_01: "longanyang",
  male_story_01: "longanyang",
  narrator_01: "longanyang",
};

function normalizeVoicePreset(voicePreset) {
  if (!voicePreset) return "longanyang";
  if (voicePreset.startsWith("long")) return voicePreset;
  return VOICE_PRESET_ALIASES[voicePreset] || "longanyang";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerError(message, statusCode = 502, code = "ALIYUN_PROVIDER_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isOssUrl(value) {
  return typeof value === "string" && value.startsWith("oss://");
}

function isPublicHttpUrl(value) {
  if (!isHttpUrl(value)) return false;

  try {
    const parsed = new URL(value);
    return !["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function sanitizeUploadFileName(fileName = "reference.png") {
  return basename(fileName)
    .replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "reference.png";
}

function guessExtensionFromContentType(contentType = "") {
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/bmp")) return ".bmp";
  return ".png";
}

function parseDataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const match = value.match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!match) return null;

  return {
    contentType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64"),
  };
}

function readLocalReferenceSource(value) {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    return {
      buffer: dataUrl.buffer,
      contentType: dataUrl.contentType,
      fileName: `reference${guessExtensionFromContentType(dataUrl.contentType)}`,
    };
  }

  if (typeof value !== "string") return null;

  const uploadPath = value.startsWith("/uploads/")
    ? value
    : (() => {
        try {
          const parsed = new URL(value);
          return parsed.pathname.startsWith("/uploads/") ? parsed.pathname : null;
        } catch {
          return null;
        }
      })();

  if (!uploadPath) return null;

  const upload = readUploadByUrlPath(uploadPath);
  if (!upload) return null;

  return {
    buffer: readFileSync(upload.absolutePath),
    contentType: upload.contentType || "application/octet-stream",
    fileName: upload.safeName || `reference${extname(upload.absolutePath) || ".png"}`,
  };
}

async function requestAliyun(path, init = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const raw = await response.text();
  let payload = null;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw providerError(
      payload.message || payload.code || `Aliyun request failed with ${response.status}`,
      502,
      "ALIYUN_API_ERROR",
    );
  }

  return payload;
}

async function testAliyunConnection(apiKey = process.env.DASHSCOPE_API_KEY) {
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(`${DEFAULT_BASE_URL}/compatible-mode/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const raw = await response.text();
  let payload = null;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw providerError(
      payload?.message || payload?.code || `Aliyun request failed with ${response.status}`,
      502,
      "ALIYUN_API_ERROR",
    );
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    modelCount: Array.isArray(payload?.data) ? payload.data.length : 0,
  };
}

async function uploadBufferToAliyunOss({ buffer, contentType, fileName, model }) {
  const policyPayload = await requestAliyun(
    `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(normalizeModelId(model))}`
  );
  const policy = policyPayload?.data || policyPayload;

  if (!policy?.upload_host || !policy?.upload_dir || !policy?.oss_access_key_id) {
    throw providerError("Aliyun upload policy is incomplete");
  }

  const safeFileName = sanitizeUploadFileName(fileName);
  const key = `${policy.upload_dir}/${safeFileName}`;
  const formData = new FormData();
  formData.set("OSSAccessKeyId", policy.oss_access_key_id);
  formData.set("Signature", policy.signature);
  formData.set("policy", policy.policy);
  formData.set("x-oss-object-acl", policy.x_oss_object_acl);
  formData.set("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite);
  formData.set("key", key);
  formData.set("success_action_status", "200");
  formData.set(
    "file",
    new Blob([buffer], { type: contentType || "application/octet-stream" }),
    safeFileName
  );

  const response = await fetch(policy.upload_host, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw providerError(`Aliyun temporary OSS upload failed with ${response.status}`);
  }

  return `oss://${key}`;
}

async function prepareAliyunImageUrl(value, model) {
  if (!value) return null;
  if (isOssUrl(value) || isPublicHttpUrl(value) || parseDataUrl(value)) return value;

  const localSource = readLocalReferenceSource(value);
  if (!localSource) {
    throw providerError("Reference image is not accessible for Aliyun image editing", 400);
  }

  return `data:${localSource.contentType};base64,${localSource.buffer.toString("base64")}`;
}

function parseTextResponse(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  throw providerError("Aliyun text response is empty");
}

function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    return arrayMatch[0];
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    return objectMatch[0];
  }

  return text;
}

function normalizeExtractedAssets(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const allowedTypes = new Set(["character", "scene", "prop"]);
  const seen = new Set();
  const normalized = [];

  for (const item of rawItems) {
    const assetType = String(item?.assetType || "").trim().toLowerCase();
    const name = String(item?.name || "").trim();
    if (!allowedTypes.has(assetType) || !name) continue;

    const dedupeKey = `${assetType}:${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      assetType,
      name,
      description: String(item?.description || "").trim(),
      generationPrompt: String(item?.generationPrompt || "").trim(),
      imageModel: String(item?.imageModel || "").trim(),
      aspectRatio: String(item?.aspectRatio || "").trim(),
      negativePrompt: String(item?.negativePrompt || "").trim(),
    });
  }

  return normalized;
}

function normalizeStoryboardShots(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const allowedShotTypes = new Set(["特写", "近景", "中景", "远景"]);
  const allowedCompositions = new Set(["居中构图", "对角线构图", "前景遮挡", "留白构图"]);
  const allowedFocalLengths = new Set(["24mm", "35mm", "50mm", "85mm"]);
  const allowedColorTones = new Set(["暖色", "冷色", "霓虹", "低饱和"]);
  const allowedLightings = new Set(["柔光", "逆光", "雨夜霓虹", "顶光"]);
  const allowedTechniques = new Set(["手持感", "电影感", "写实摄影", "浅景深"]);
  const normalized = [];

  for (const [index, item] of rawItems.entries()) {
    const script = String(item?.script || item?.action || item?.description || "")
      .replace(/\s+/g, " ")
      .replace(/^△\s*/g, "")
      .trim();
    if (!script) continue;

    const durationSeconds = Number.parseInt(
      String(item?.durationSeconds || item?.duration || "").replace(/[^\d]/g, ""),
      10
    );
    const assetNames = Array.isArray(item?.assetNames)
      ? item.assetNames
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];

    normalized.push({
      title: String(item?.title || "").trim() || `镜头 ${index + 1}`,
      script,
      durationSeconds:
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.min(8, Math.max(2, durationSeconds))
          : 4,
      promptSummary:
        String(item?.promptSummary || item?.visualSummary || "").trim() || script.slice(0, 32),
      shotType: allowedShotTypes.has(String(item?.shotType || "").trim())
        ? String(item.shotType).trim()
        : "",
      composition: allowedCompositions.has(String(item?.composition || "").trim())
        ? String(item.composition).trim()
        : "",
      focalLength: allowedFocalLengths.has(String(item?.focalLength || "").trim())
        ? String(item.focalLength).trim()
        : "",
      colorTone: allowedColorTones.has(String(item?.colorTone || "").trim())
        ? String(item.colorTone).trim()
        : "",
      lighting: allowedLightings.has(String(item?.lighting || "").trim())
        ? String(item.lighting).trim()
        : "",
      technique: allowedTechniques.has(String(item?.technique || "").trim())
        ? String(item.technique).trim()
        : "",
      assetNames,
    });
  }

  return normalized;
}

async function rewriteScriptWithAliyun({ content, instruction, model = "qwen-plus" }) {
  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "你是漫剧编剧助理。请严格根据用户要求改写原剧本，只输出改写后的完整中文剧本文本，不要解释。",
        },
        {
          role: "user",
          content: `改写要求：${instruction}\n\n原剧本：\n${content}`,
        },
      ],
    },
  });

  return parseTextResponse(payload);
}

async function extractAssetsWithAliyun({ content, model = "qwen-plus" }) {
  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            [
              "You extract production assets from screenplay text.",
              "Return a strict JSON array only. Do not include markdown or explanations.",
              'Each item must contain these keys: "assetType", "name", "description", "generationPrompt".',
              'assetType must be exactly one of: "character", "scene", "prop".',
              "Only include assets explicitly mentioned in the text. Never invent people, places, or props.",
              "description must be a short factual Chinese description, not plot expansion.",
              "generationPrompt must be a concise Chinese image prompt for generating a clean concept sheet of this exact asset.",
            ].join(" "),
        },
        {
          role: "user",
          content:
            [
              "Extract up to 12 useful assets from the following screenplay text.",
              "Rules:",
              "1. Keep names as they appear in the text, or apply only the minimum necessary normalization.",
              "2. Do not output generic implied objects that are not explicitly present in the text.",
              "3. generationPrompt should focus on a single asset design image suitable for comic production.",
              "4. Return JSON only.",
              "",
              "Text:",
              content,
            ].join("\n"),
        },
      ],
    },
  });

  const text = parseTextResponse(payload);
  const jsonBlock = extractJsonBlock(text);
  const parsed = JSON.parse(jsonBlock);
  if (!Array.isArray(parsed)) {
    throw providerError("Aliyun asset extraction did not return an array");
  }
  return normalizeExtractedAssets(parsed);
}

async function splitStoryboardsWithAliyun({ content, model = "qwen-plus" }) {
  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: [
            "You split screenplay text into production-ready storyboard shots.",
            "Return a strict JSON array only. Do not include markdown or explanations.",
            'Each item must contain these keys: "title", "script", "durationSeconds", "promptSummary", "shotType", "composition", "focalLength", "colorTone", "lighting", "technique", "assetNames".',
            'shotType must be exactly one of: "特写", "近景", "中景", "远景".',
            'composition must be exactly one of: "居中构图", "对角线构图", "前景遮挡", "留白构图".',
            'focalLength must be exactly one of: "24mm", "35mm", "50mm", "85mm".',
            'colorTone must be exactly one of: "暖色", "冷色", "霓虹", "低饱和".',
            'lighting must be exactly one of: "柔光", "逆光", "雨夜霓虹", "顶光".',
            'technique must be exactly one of: "手持感", "电影感", "写实摄影", "浅景深".',
            "title, script, and promptSummary must be concise Chinese text.",
            "script must describe exactly one visual beat in chronological order and stay faithful to the source screenplay.",
            "durationSeconds must be an integer between 2 and 8.",
            "assetNames must be a JSON array of exact names explicitly appearing in the screenplay when obvious, otherwise [].",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            "Split the following screenplay into 4 to 12 storyboard shots for comic production.",
            "Rules:",
            "1. Keep the original chronology.",
            "2. One shot should cover one clear visual beat.",
            "3. Do not invent characters, locations, props, or plot.",
            "4. Keep the language concrete and production-oriented.",
            "5. Return JSON only.",
            "",
            "Screenplay:",
            content,
          ].join("\n"),
        },
      ],
    },
  });

  const text = parseTextResponse(payload);
  const jsonBlock = extractJsonBlock(text);
  const parsed = JSON.parse(jsonBlock);
  if (!Array.isArray(parsed)) {
    throw providerError("Aliyun storyboard split did not return an array");
  }
  return normalizeStoryboardShots(parsed);
}

function mapImageSize(aspectRatio = "16:9") {
  if (aspectRatio === "9:16") return "972*1728";
  if (aspectRatio === "1:1") return "1280*1280";
  return "1728*972";
}

function getSupportedVideoResolutions(model) {
  const normalizedModel = normalizeModelId(model);
  if (normalizedModel === "wanx2.1-i2v-turbo") {
    return ["720P", "480P"];
  }
  return ["1080P", "720P", "480P"];
}

function mapVideoResolution(resolution = "720p", model) {
  const normalized = String(resolution).toUpperCase();
  const supported = getSupportedVideoResolutions(model);
  if (supported.includes(normalized)) {
    return normalized;
  }
  if (normalized === "2K" && supported.includes("1080P")) {
    return "1080P";
  }
  return supported[0];
}

function mapVideoDuration(duration = "5s") {
  const parsed = Number.parseInt(String(duration).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function isTextToVideoModel(model) {
  const normalizedModel = normalizeModelId(model);
  return normalizedModel === "wan2.6-t2v";
}

function mapTextToVideoSize(aspectRatio = "16:9", resolution = "720p", model) {
  const normalizedResolution = mapVideoResolution(resolution, model);
  const sizeMap = {
    "480P": {
      "16:9": "832*480",
      "9:16": "480*832",
      "1:1": "832*832",
    },
    "720P": {
      "16:9": "1280*720",
      "9:16": "720*1280",
      "1:1": "960*960",
    },
    "1080P": {
      "16:9": "1920*1080",
      "9:16": "1080*1920",
      "1:1": "1440*1440",
    },
  };

  const sizeGroup = sizeMap[normalizedResolution] || sizeMap["720P"];
  return sizeGroup[aspectRatio] || sizeGroup["16:9"];
}

function parseImageUrls(payload) {
  const choices = payload?.output?.choices || [];
  const urls = [];

  for (const choice of choices) {
    const content = choice?.message?.content || [];
    for (const item of content) {
      if (item?.type === "image" && item?.image) {
        urls.push(item.image);
      }
    }
  }

  const results = Array.isArray(payload?.output?.results) ? payload.output.results : [];
  for (const result of results) {
    if (typeof result?.url === "string" && result.url) {
      urls.push(result.url);
    }
    if (typeof result?.result_url === "string" && result.result_url) {
      urls.push(result.result_url);
    }
    if (typeof result?.image_url === "string" && result.image_url) {
      urls.push(result.image_url);
    }
  }

  if (typeof payload?.output?.result_url === "string" && payload.output.result_url) {
    urls.push(payload.output.result_url);
  }
  if (typeof payload?.output?.image_url === "string" && payload.output.image_url) {
    urls.push(payload.output.image_url);
  }

  if (!urls.length) {
    throw providerError("Aliyun image response did not include any image URLs");
  }

  return Array.from(new Set(urls));
}

async function generateImagesWithAliyun({
  prompt,
  model = "wan2.6-t2i",
  aspectRatio = "16:9",
  count = 1,
  negativePrompt = "",
  referenceImageUrl = null,
}) {
  const normalizedModel = normalizeModelId(model);
  const imageCount = Math.max(1, Math.min(Number(count) || 1, 4));

  if (normalizedModel === "wanx2.1-imageedit" && referenceImageUrl) {
    const preparedReferenceImageUrl = await prepareAliyunImageUrl(referenceImageUrl, normalizedModel);
    const editPrompt = negativePrompt?.trim()
      ? `${prompt}\nAvoid: ${negativePrompt.trim()}`
      : prompt;
    const taskPayload = await requestAliyun("/api/v1/services/aigc/image2image/image-synthesis", {
      method: "POST",
      headers: {
        "X-DashScope-Async": "enable",
        ...(isOssUrl(preparedReferenceImageUrl)
          ? { "X-DashScope-OssResourceResolve": "enable" }
          : {}),
      },
      body: {
        model: normalizedModel,
        input: {
          function: "description_edit",
          prompt: editPrompt,
          base_image_url: preparedReferenceImageUrl,
        },
        parameters: {
          n: imageCount,
        },
      },
    });

    const taskId = taskPayload?.output?.task_id;
    if (!taskId) {
      throw providerError("Aliyun image edit did not return a task id");
    }

    const result = await waitForAliyunTask(taskId, { intervalMs: 6000 });
    return parseImageUrls(result);
  }

  const payload = await requestAliyun("/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    body: {
      model: normalizedModel,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
      },
      parameters: {
        n: imageCount,
        size: mapImageSize(aspectRatio),
        prompt_extend: true,
        watermark: false,
        negative_prompt: negativePrompt,
      },
    },
  });

  return parseImageUrls(payload);
}

async function createAliyunVideoTask({
  model,
  prompt,
  referenceImageUrl,
  firstFrameUrl,
  lastFrameUrl,
  aspectRatio,
  resolution,
  duration,
}) {
  const normalizedModel = normalizeModelId(model);
  const normalizedResolution = mapVideoResolution(resolution, normalizedModel);

  if (normalizedModel === "wan2.2-kf2v-flash" || normalizedModel === "wanx2.1-kf2v-plus") {
    if (!firstFrameUrl) {
      throw providerError("首尾帧模式缺少首帧图片");
    }

    const payload = await requestAliyun("/api/v1/services/aigc/image2video/video-synthesis", {
      method: "POST",
      headers: { "X-DashScope-Async": "enable" },
      body: {
        model: normalizedModel,
        input: {
          first_frame_url: firstFrameUrl,
          ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
          ...(prompt ? { prompt } : {}),
        },
        parameters: {
          resolution: normalizedResolution,
          prompt_extend: true,
        },
      },
    });

    return payload?.output?.task_id;
  }

  if (isTextToVideoModel(normalizedModel)) {
    const payload = await requestAliyun("/api/v1/services/aigc/video-generation/video-synthesis", {
      method: "POST",
      headers: { "X-DashScope-Async": "enable" },
      body: {
        model: normalizedModel,
        input: {
          prompt: prompt || "Generated video prompt",
        },
        parameters: {
          size: mapTextToVideoSize(aspectRatio, normalizedResolution, normalizedModel),
          duration: mapVideoDuration(duration),
          prompt_extend: true,
          watermark: false,
        },
      },
    });

    return payload?.output?.task_id;
  }

  if (!referenceImageUrl) {
    throw providerError("图生视频模式缺少参考图");
  }

  const payload = await requestAliyun("/api/v1/services/aigc/video-generation/video-synthesis", {
    method: "POST",
    headers: { "X-DashScope-Async": "enable" },
    body: {
      model: normalizedModel,
      input: {
        img_url: referenceImageUrl,
        ...(prompt ? { prompt } : {}),
      },
      parameters: {
        resolution: normalizedResolution,
        duration: mapVideoDuration(duration),
        prompt_extend: true,
        watermark: false,
      },
    },
  });

  return payload?.output?.task_id;
}

async function waitForAliyunTask(taskId, options = {}) {
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
  const intervalMs = options.intervalMs || 8000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await requestAliyun(`/api/v1/tasks/${taskId}`);
    const status = payload?.output?.task_status;

    if (status === "SUCCEEDED") {
      return payload;
    }

    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw providerError(payload?.message || `Aliyun task ${taskId} failed: ${status}`);
    }

    await sleep(intervalMs);
  }

  throw providerError(`Aliyun task ${taskId} timed out`);
}

function parseAliyunVideoResult(payload) {
  const output = payload?.output || {};
  const resultItem = Array.isArray(output.results) ? output.results[0] || {} : {};
  return {
    videoUrl: output.video_url || resultItem.video_url || resultItem.url || null,
    thumbnailUrl:
      output.cover_url ||
      output.cover_image_url ||
      resultItem.cover_url ||
      resultItem.cover_image_url ||
      null,
    durationSeconds: output.video_duration || output.duration || resultItem.duration || null,
  };
}

async function synthesizeSpeechWithAliyun({
  text,
  model = "cosyvoice-v3-flash",
  voice = "longanyang",
  format = "mp3",
  sampleRate = 22050,
  volume = 50,
  rate = 1,
  pitch = 1,
}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const taskId = randomUUID();
  const chunks = [];

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (socket) => {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };

    const finish = (socket, error, result) => {
      if (settled) return;
      settled = true;
      cleanup(socket);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const socket = new WebSocket(DEFAULT_WS_URL, {
      headers: {
        Authorization: `bearer ${apiKey}`,
      },
    });

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          header: {
            action: "run-task",
            task_id: taskId,
            streaming: "duplex",
          },
          payload: {
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            model: normalizeModelId(model),
            parameters: {
              text_type: "PlainText",
              voice: normalizeVoicePreset(voice),
              format,
              sample_rate: sampleRate,
              volume,
              rate,
              pitch,
            },
            input: {},
          },
        })
      );
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        chunks.push(Buffer.from(data));
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(Buffer.from(data).toString("utf8"));
      } catch {
        return;
      }

      const event = payload?.header?.event;

      if (event === "task-started") {
        socket.send(
          JSON.stringify({
            header: {
              action: "continue-task",
              task_id: taskId,
              streaming: "duplex",
            },
            payload: {
              input: {
                text,
              },
            },
          })
        );

        socket.send(
          JSON.stringify({
            header: {
              action: "finish-task",
              task_id: taskId,
              streaming: "duplex",
            },
            payload: {
              input: {},
            },
          })
        );
        return;
      }

      if (event === "task-finished") {
        finish(socket, null, {
          buffer: Buffer.concat(chunks),
          requestId: payload?.header?.attributes?.request_uuid || null,
          format,
        });
        return;
      }

      if (event === "task-failed") {
        finish(
          socket,
          providerError(payload?.header?.error_message || "Aliyun TTS task failed")
        );
      }
    });

    socket.on("error", (error) => {
      finish(socket, providerError(error.message || "Aliyun TTS websocket error"));
    });

    socket.on("close", (code, reason) => {
      if (!settled) {
        finish(
          socket,
          providerError(
            `Aliyun TTS websocket closed unexpectedly: ${code} ${String(reason || "")}`.trim()
          )
        );
      }
    });
  });
}

module.exports = {
  synthesizeSpeechWithAliyun,
  testAliyunConnection,
  extractAssetsWithAliyun,
  generateImagesWithAliyun,
  hasAliyunApiKey,
  normalizeModelId,
  normalizeVoicePreset,
  parseAliyunVideoResult,
  rewriteScriptWithAliyun,
  splitStoryboardsWithAliyun,
  createAliyunVideoTask,
  waitForAliyunTask,
};
