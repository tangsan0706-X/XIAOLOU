const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  createUploadFromBuffer,
  readUploadByUrlPath,
} = require("./uploads");
const {
  createAliyunVideoTask,
  extractAssetsWithAliyun,
  generateImagesWithAliyun,
  hasAliyunApiKey,
  normalizeModelId,
  normalizeVoicePreset,
  parseAliyunVideoResult,
  rewriteScriptWithAliyun,
  splitStoryboardsWithAliyun,
  synthesizeSpeechWithAliyun,
  testAliyunConnection,
  waitForAliyunTask,
} = require("./aliyun");
const { setEnvValue, unsetEnvValue } = require("./env");
const { createSeedData } = require("./mock-data");

function clone(value) {
  return structuredClone(value);
}

const DEFAULT_API_CENTER_VENDOR_CATALOG = (() => {
  const seedState = createSeedData();
  return Array.isArray(seedState?.apiCenterConfig?.vendors) ? clone(seedState.apiCenterConfig.vendors) : [];
})();

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isApiCenterRuntimeProvider(vendorId) {
  return vendorId === "aliyun-bailian";
}

function syncApiCenterRuntimeVendorState(config) {
  if (!config || !Array.isArray(config.vendors)) {
    return false;
  }

  let changed = false;

  for (const vendor of config.vendors) {
    if (!isApiCenterRuntimeProvider(vendor.id)) {
      continue;
    }

    const apiKeyConfigured = hasAliyunApiKey();
    if (vendor.apiKeyConfigured !== apiKeyConfigured) {
      vendor.apiKeyConfigured = apiKeyConfigured;
      changed = true;
    }

    if (!apiKeyConfigured && vendor.connected) {
      vendor.connected = false;
      changed = true;
    }
  }

  return changed;
}

function ensureApiCenterVendorCatalog(config) {
  if (!config || !Array.isArray(config.vendors)) {
    return false;
  }

  let changed = false;

  for (const defaultVendor of DEFAULT_API_CENTER_VENDOR_CATALOG) {
    let vendor = config.vendors.find((item) => item.id === defaultVendor.id);
    if (!vendor) {
      config.vendors.push(clone(defaultVendor));
      changed = true;
      continue;
    }

    const existingDomainSet = new Set(Array.isArray(vendor.supportedDomains) ? vendor.supportedDomains : []);
    for (const domain of defaultVendor.supportedDomains || []) {
      if (!existingDomainSet.has(domain)) {
        vendor.supportedDomains = [...existingDomainSet, domain];
        existingDomainSet.add(domain);
        changed = true;
      }
    }

    const existingModels = Array.isArray(vendor.models) ? vendor.models : [];
    if (!Array.isArray(vendor.models)) {
      vendor.models = existingModels;
      changed = true;
    }

    for (const defaultModel of defaultVendor.models || []) {
      if (!existingModels.some((item) => item.id === defaultModel.id)) {
        existingModels.push(clone(defaultModel));
        changed = true;
      }
    }
  }

  return changed;
}

const API_CENTER_MODEL_ASSIGNMENT_MAP = {
  textModelId: ["global", "script", "assets", "storyboard_script"],
  imageModelId: ["storyboard_image", "character_replace", "upscale_restore"],
  videoModelId: ["video_i2v", "video_kf2v", "motion_transfer"],
  audioModelId: ["dubbing_tts"],
  visionModelId: [],
};

const API_CENTER_DEFAULT_DOMAIN_MAP = {
  textModelId: "text",
  visionModelId: "vision",
  imageModelId: "image",
  videoModelId: "video",
  audioModelId: "audio",
};

function listApiCenterAssignments(config) {
  const nodeAssignments = Array.isArray(config?.nodeAssignments) ? config.nodeAssignments : [];
  const toolboxAssignments = Array.isArray(config?.toolboxAssignments) ? config.toolboxAssignments : [];
  return [...nodeAssignments, ...toolboxAssignments];
}

function applyPrimaryModelToAssignments(config, assignmentCodes, modelId) {
  const assignments = listApiCenterAssignments(config);
  let changed = false;

  for (const assignmentCode of assignmentCodes) {
    const assignment = assignments.find((item) => item.nodeCode === assignmentCode);
    if (!assignment || assignment.primaryModelId === modelId) {
      continue;
    }

    assignment.primaryModelId = modelId;
    changed = true;
  }

  return changed;
}

function isApiCenterModelReferenced(config, modelId) {
  if (!modelId || !config) {
    return false;
  }

  const defaults = config.defaults || {};
  if (Object.values(defaults).some((value) => value === modelId)) {
    return true;
  }

  return listApiCenterAssignments(config).some(
    (assignment) =>
      assignment?.primaryModelId === modelId ||
      (Array.isArray(assignment?.fallbackModelIds) && assignment.fallbackModelIds.includes(modelId))
  );
}

function normalizeStoredVideoResolution(model, resolution) {
  const normalizedModel = normalizeModelId(model || "");
  const normalizedResolution = String(resolution || "").trim().toLowerCase();

  if (normalizedModel === "wanx2.1-i2v-turbo") {
    return normalizedResolution === "480p" ? "480p" : "720p";
  }

  if (normalizedResolution === "1080p" || normalizedResolution === "480p") {
    return normalizedResolution;
  }

  return "720p";
}

function isCreateVideoTextModel(model) {
  return normalizeModelId(model || "") === "wan2.6-t2v";
}

function resolveCreateVideoModel(requestedModel, referenceImageUrl, fallbackModel) {
  const preferredModel = requestedModel || fallbackModel || "wanx2.1-i2v-turbo";
  if (referenceImageUrl) {
    return preferredModel;
  }

  return isCreateVideoTextModel(preferredModel) ? preferredModel : "wan2.6-t2v";
}

function formatCreateVideoModelLabel(model) {
  const normalizedModel = normalizeModelId(model || "");
  if (normalizedModel === "wan2.6-t2v") return "Wan 2.6 T2V";
  if (normalizedModel === "wanx2.1-i2v-turbo") return "WanX 2.1 I2V Turbo";
  if (normalizedModel === "wanx2.1-i2v-plus") return "WanX 2.1 I2V Plus";
  if (normalizedModel === "wan2.2-kf2v-flash") return "Wan 2.2 KF2V Flash";
  return model || normalizedModel || "Wan 2.6 T2V";
}

function deriveStoryboardVideoStatus({ storyboard, latestTask, latestVideo }) {
  if (latestTask?.status === "failed") return "failed";
  if (latestTask?.status === "running") return "running";
  if (latestTask?.status === "queued") return "queued";
  if (latestVideo) return "ready";
  if (storyboard.videoStatus === "ready") return "draft";
  if (storyboard.videoStatus === "failed") return "failed";
  if (storyboard.videoStatus === "running") return "running";
  return "draft";
}

function roundTimelineSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function clampTimelineValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function sortTimelineClips(a, b) {
  if (a.startTimeSeconds !== b.startTimeSeconds) {
    return a.startTimeSeconds - b.startTimeSeconds;
  }
  return String(a.id).localeCompare(String(b.id));
}

function hasPlayableVideoTimelineClips(timeline) {
  if (!timeline || !Array.isArray(timeline.tracks)) return false;

  const videoTrack = timeline.tracks.find((track) => track?.type === "video");
  if (!videoTrack || !Array.isArray(videoTrack.clips)) return false;

  return videoTrack.clips.some((clip) => clip?.enabled !== false && clip?.url);
}

function withTimeout(promise, timeoutMs, fallbackErrorMessage = "Operation timed out.") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(fallbackErrorMessage)), timeoutMs);
    }),
  ]);
}

function cleanStoryboardText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^△\s*/gm, "")
    .trim();
}

function inferStoryboardDuration(text) {
  const length = cleanStoryboardText(text).length;
  if (length <= 24) return 3;
  if (length <= 60) return 4;
  if (length <= 110) return 5;
  return 6;
}

function summarizeStoryboardText(text, limit = 28) {
  const cleaned = cleanStoryboardText(text);
  if (!cleaned) return "自动拆分镜头";
  const summary = cleaned.split(/[。！？\n]/).find(Boolean) || cleaned;
  return summary.length > limit ? `${summary.slice(0, limit)}…` : summary;
}

function titleFromStoryboardText(text, index) {
  const cleaned = summarizeStoryboardText(text, 12).replace(/[：:，,。！？!?\s]+$/g, "");
  return cleaned || `镜头 ${index + 1}`;
}

function inferShotType(text) {
  const value = cleanStoryboardText(text);
  if (/特写|眼神|眼睛|瞳孔|嘴角|手指|手部|表情|脸部/.test(value)) return "特写";
  if (/群山|全景|天空|远处|城外|整片|全貌|山间|圣地/.test(value)) return "远景";
  if (/两人|人物|半身|对视|站在|来到|走到/.test(value)) return "中景";
  return "近景";
}

function inferComposition(text) {
  const value = cleanStoryboardText(text);
  if (/对视|并肩|追逐|冲向|交错/.test(value)) return "对角线构图";
  if (/穿过|拨开|门口|窗外|前景|崖边/.test(value)) return "前景遮挡";
  if (/孤身|空旷|回音|天空|远处/.test(value)) return "留白构图";
  return "居中构图";
}

function inferColorTone(text) {
  const value = cleanStoryboardText(text);
  if (/霓虹|紫色|雨夜|蓝色|夜色/.test(value)) return "霓虹";
  if (/金光|阳光|暖黄|火光/.test(value)) return "暖色";
  if (/冷|寒|雾气|清晨/.test(value)) return "冷色";
  return "低饱和";
}

function inferLighting(text) {
  const value = cleanStoryboardText(text);
  if (/雨夜|霓虹|夜色/.test(value)) return "雨夜霓虹";
  if (/阳光|太阳|金光/.test(value)) return "顶光";
  if (/逆光|剪影/.test(value)) return "逆光";
  return "柔光";
}

function inferTechnique(text) {
  const value = cleanStoryboardText(text);
  if (/飞快|踉跄|巨响|摔倒|冲天而起|惨叫/.test(value)) return "手持感";
  if (/倒影|眼神|抚摸|特写|细节/.test(value)) return "浅景深";
  if (/纪录|真实|街头|白描/.test(value)) return "写实摄影";
  return "电影感";
}

function inferFocalLength(shotType) {
  if (shotType === "远景") return "24mm";
  if (shotType === "特写") return "85mm";
  if (shotType === "近景") return "50mm";
  return "35mm";
}

function splitStoryboardTextHeuristically(content) {
  const cleaned = cleanStoryboardText(content);
  if (!cleaned) return [];

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scenes = [];
  let currentScene = null;

  for (const line of lines) {
    if (/^第.+(集|话|章)$/.test(line) || /^EP\s*\d+/i.test(line)) {
      continue;
    }

    if (/^场[\d一二三四五六七八九十百千万\-]+/.test(line) || /^第.+场/.test(line)) {
      if (currentScene) scenes.push(currentScene);
      currentScene = {
        heading: line,
        lines: [],
      };
      continue;
    }

    if (!currentScene) {
      currentScene = {
        heading: "",
        lines: [],
      };
    }

    if (/^(景|人物)[:：]/.test(line)) {
      continue;
    }

    currentScene.lines.push(line.replace(/^△\s*/, ""));
  }

  if (currentScene) scenes.push(currentScene);

  const beats = [];
  for (const scene of scenes) {
    const fragments = [];
    for (const line of scene.lines) {
      const normalizedLine = line.replace(/\s+/g, " ").trim();
      if (!normalizedLine) continue;

      if (normalizedLine.length > 80 && /[。！？]/.test(normalizedLine)) {
        const sentences = normalizedLine
          .split(/(?<=[。！？])/)
          .map((item) => item.trim())
          .filter(Boolean);
        fragments.push(...sentences);
      } else {
        fragments.push(normalizedLine);
      }
    }

    let bucket = [];
    let bucketLength = 0;
    for (const fragment of fragments) {
      const nextLength = bucketLength + fragment.length;
      if (bucket.length && (bucket.length >= 2 || nextLength > 70)) {
        beats.push(bucket.join(" "));
        bucket = [];
        bucketLength = 0;
      }
      bucket.push(fragment);
      bucketLength += fragment.length;
    }

    if (bucket.length) {
      beats.push(bucket.join(" "));
    }
  }

  const normalizedBeats = beats
    .map((item) => cleanStoryboardText(item))
    .filter(Boolean)
    .slice(0, 12);

  if (normalizedBeats.length) {
    return normalizedBeats;
  }

  return cleaned
    .split(/(?<=[。！？])/)
    .map((item) => cleanStoryboardText(item))
    .filter(Boolean)
    .slice(0, 8);
}

class MockStore {
  constructor() {
    this.events = new EventEmitter();
    this.reset();
  }

  reset() {
    this.state = createSeedData();
    this.normalizeState();
  }

  normalizeState() {
    const config = this.state?.apiCenterConfig;
    let changed = false;

    if (this.ensureIdentityAndBillingState()) {
      changed = true;
    }

    if (config) {
      if (ensureApiCenterVendorCatalog(config)) {
        changed = true;
      }

      if (syncApiCenterRuntimeVendorState(config)) {
        changed = true;
      }

      const defaults = config.defaults || {};
      const textModelId = defaults.textModelId || "qwen-plus";
      const visionModelId = defaults.visionModelId || "qwen-vl-plus";
      const nodeAssignments = Array.isArray(config.nodeAssignments)
        ? config.nodeAssignments
        : [];
      const assetsNode = nodeAssignments.find((item) => item.nodeCode === "assets");

      if (assetsNode) {
        const previousPrimaryModelId = assetsNode.primaryModelId || null;

        if (!previousPrimaryModelId || previousPrimaryModelId === visionModelId) {
          assetsNode.primaryModelId = textModelId;
          changed = true;
        }

        const previousFallbacks = Array.isArray(assetsNode.fallbackModelIds)
          ? assetsNode.fallbackModelIds.filter(Boolean)
          : [];
        const normalizedFallbacks = previousFallbacks.filter(
          (item) => item !== assetsNode.primaryModelId && item !== visionModelId
        );
        if (
          normalizedFallbacks.length !== previousFallbacks.length ||
          normalizedFallbacks.some((item, index) => item !== previousFallbacks[index])
        ) {
          assetsNode.fallbackModelIds = normalizedFallbacks;
          changed = true;
        }

        const expectedNote = "Extract characters, scenes, and props from script text only.";
        if (assetsNode.notes !== expectedNote) {
          assetsNode.notes = expectedNote;
          changed = true;
        }
      }
    }

    for (const items of Object.values(this.state.assetsByProjectId || {})) {
      if (!Array.isArray(items)) continue;

      for (const asset of items) {
        const nextScope =
          asset.scope ||
          (["asset_char_001", "asset_char_002", "asset_scene_001"].includes(asset.id)
            ? "seed"
            : "manual");
        const referenceImageUrls = Array.isArray(asset.referenceImageUrls)
          ? asset.referenceImageUrls.filter(Boolean)
          : [];
        const nextGenerationPrompt =
          typeof asset.generationPrompt === "string" && asset.generationPrompt.trim()
            ? asset.generationPrompt.trim()
            : this.buildAssetGenerationPrompt(asset);
        const nextImageStatus =
          asset.imageStatus || (asset.previewUrl ? "ready" : "draft");
        const nextImageModel =
          asset.imageModel ||
          (referenceImageUrls.length ? "WanX 2.1 Image Edit" : "Wan 2.6 T2I");
        const nextAspectRatio = asset.aspectRatio || "1:1";
        const nextNegativePrompt =
          typeof asset.negativePrompt === "string" ? asset.negativePrompt : "";

        if (
          asset.generationPrompt !== nextGenerationPrompt ||
          asset.imageStatus !== nextImageStatus ||
          asset.imageModel !== nextImageModel ||
          asset.aspectRatio !== nextAspectRatio ||
          asset.negativePrompt !== nextNegativePrompt ||
          asset.scope !== nextScope ||
          !Array.isArray(asset.referenceImageUrls) ||
          asset.referenceImageUrls.length !== referenceImageUrls.length ||
          asset.referenceImageUrls.some((item, index) => item !== referenceImageUrls[index])
        ) {
          Object.assign(asset, {
            generationPrompt: nextGenerationPrompt,
            referenceImageUrls,
            imageStatus: nextImageStatus,
            imageModel: nextImageModel,
            aspectRatio: nextAspectRatio,
            negativePrompt: nextNegativePrompt,
            scope: nextScope,
          });
          changed = true;
        }
      }
    }

    const latestVideoTaskByStoryboardId = new Map();
    for (const task of this.state.tasks || []) {
      if (task?.type !== "video_generate" || !task.storyboardId) continue;
      if (!latestVideoTaskByStoryboardId.has(task.storyboardId)) {
        latestVideoTaskByStoryboardId.set(task.storyboardId, task);
      }
    }

    for (const [projectId, storyboards] of Object.entries(this.state.storyboardsByProjectId || {})) {
      if (!Array.isArray(storyboards)) continue;

      const projectVideos = Array.isArray(this.state.videosByProjectId?.[projectId])
        ? this.state.videosByProjectId[projectId]
        : [];

      for (const storyboard of storyboards) {
        const isStartEndMode = storyboard.videoMode === "start_end_frame";
        const videoModel =
          storyboard.videoModel ||
          this.getNodePrimaryModel(
            isStartEndMode ? "video_kf2v" : "video_i2v",
            this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo")
          );
        const nextVideoResolution = normalizeStoredVideoResolution(
          videoModel,
          storyboard.videoResolution || "720p"
        );
        const latestVideoTask = latestVideoTaskByStoryboardId.get(storyboard.id) || null;
        const latestVideo = projectVideos.find((item) => item.storyboardId === storyboard.id) || null;
        const nextVideoStatus = deriveStoryboardVideoStatus({
          storyboard,
          latestTask: latestVideoTask,
          latestVideo,
        });

        if (
          storyboard.videoResolution !== nextVideoResolution ||
          storyboard.videoStatus !== nextVideoStatus
        ) {
          Object.assign(storyboard, {
            videoResolution: nextVideoResolution,
            videoStatus: nextVideoStatus,
          });
          changed = true;
        }
      }
    }

    for (const project of this.state.projects || []) {
      const timeline = this.state.timelinesByProjectId?.[project.id] || null;
      const hasReadyVideos = Array.isArray(this.state.videosByProjectId?.[project.id])
        ? this.state.videosByProjectId[project.id].some(
            (video) => video?.status === "ready" && video?.videoUrl
          )
        : false;
      const needsDetailedTimeline =
        !timeline ||
        !Array.isArray(timeline.tracks) ||
        timeline.tracks.some((track) => !Array.isArray(track?.clips)) ||
        (hasReadyVideos && !hasPlayableVideoTimelineClips(timeline));

      const nextTimeline = needsDetailedTimeline
        ? this.buildDefaultTimeline(project.id, timeline)
        : this.normalizeTimelinePayload(project.id, timeline, {
            incrementVersion: false,
            updatedAt: timeline.updatedAt,
          });

      if (JSON.stringify(nextTimeline) !== JSON.stringify(timeline)) {
        this.state.timelinesByProjectId[project.id] = nextTimeline;
        changed = true;
      }
    }

    if (this.syncLegacyWalletState()) {
      changed = true;
    }

    return changed;
  }

  getDefaultModelId(key, fallback = null) {
    return this.state.apiCenterConfig?.defaults?.[key] || fallback;
  }

  getNodePrimaryModel(nodeCode, fallback = null) {
    const match = (this.state.apiCenterConfig?.nodeAssignments || []).find(
      (item) => item.nodeCode === nodeCode
    );
    return match?.primaryModelId || fallback;
  }

  getPublicBaseUrl() {
    return process.env.CORE_API_PUBLIC_BASE_URL || "http://127.0.0.1:4100";
  }

  buildDefaultTimeline(projectId, existingTimeline = null) {
    const storyboards = [...(this.state.storyboardsByProjectId?.[projectId] || [])].sort(
      (left, right) => left.shotNo - right.shotNo
    );
    const videos = Array.isArray(this.state.videosByProjectId?.[projectId])
      ? this.state.videosByProjectId[projectId]
      : [];
    const dubbings = Array.isArray(this.state.dubbingsByProjectId?.[projectId])
      ? this.state.dubbingsByProjectId[projectId]
      : [];
    const existingTracks = Array.isArray(existingTimeline?.tracks) ? existingTimeline.tracks : [];
    const existingVideoTrack = existingTracks.find((track) => track?.type === "video") || null;
    const existingAudioTrack = existingTracks.find((track) => track?.type === "audio") || null;

    let playhead = 0;
    const videoClips = [];
    for (const storyboard of storyboards) {
      const latestVideo = videos.find(
        (item) => item.storyboardId === storyboard.id && item.status === "ready" && item.videoUrl
      );
      if (!latestVideo) continue;

      const existingClip =
        existingVideoTrack?.clips?.find(
          (clip) => clip?.sourceId === latestVideo.id || clip?.storyboardId === storyboard.id
        ) || null;
      const sourceDuration = Math.max(
        0.5,
        roundTimelineSeconds(latestVideo.durationSeconds || storyboard.durationSeconds || 3)
      );
      const trimStartSeconds = clampTimelineValue(existingClip?.trimStartSeconds || 0, 0, sourceDuration - 0.5);
      const durationSeconds = clampTimelineValue(
        existingClip?.durationSeconds || sourceDuration,
        0.5,
        Math.max(0.5, sourceDuration - trimStartSeconds)
      );

      videoClips.push({
        id: existingClip?.id || `track_video_${storyboard.id}`,
        type: "video",
        sourceType: "storyboard_video",
        sourceId: latestVideo.id,
        storyboardId: storyboard.id,
        title: `S${String(storyboard.shotNo).padStart(2, "0")} ${storyboard.title}`,
        startTimeSeconds: roundTimelineSeconds(playhead),
        durationSeconds,
        trimStartSeconds,
        enabled: existingClip?.enabled !== false,
        muted: existingClip?.muted === true,
        url: latestVideo.videoUrl || null,
        thumbnailUrl: latestVideo.thumbnailUrl || storyboard.imageUrl || null,
        text: storyboard.script || "",
      });

      playhead += durationSeconds;
    }

    const videoTrackDuration = roundTimelineSeconds(playhead);
    const videoClipByStoryboardId = new Map(videoClips.map((clip) => [clip.storyboardId, clip]));
    const audioClips = [];
    for (const dubbing of dubbings) {
      if (dubbing.status !== "ready" || !dubbing.audioUrl) continue;
      const videoClip = videoClipByStoryboardId.get(dubbing.storyboardId);
      if (!videoClip) continue;

      const existingClip =
        existingAudioTrack?.clips?.find(
          (clip) => clip?.sourceId === dubbing.id || clip?.storyboardId === dubbing.storyboardId
        ) || null;
      const durationSeconds = clampTimelineValue(
        existingClip?.durationSeconds || videoClip.durationSeconds,
        0.5,
        Math.max(0.5, videoClip.durationSeconds)
      );
      const startTimeSeconds = clampTimelineValue(
        existingClip?.startTimeSeconds ?? videoClip.startTimeSeconds,
        0,
        Math.max(videoTrackDuration, 0)
      );

      audioClips.push({
        id: existingClip?.id || `track_audio_${dubbing.id}`,
        type: "audio",
        sourceType: "dubbing_audio",
        sourceId: dubbing.id,
        storyboardId: dubbing.storyboardId,
        title: dubbing.speakerName || videoClip.title,
        startTimeSeconds: roundTimelineSeconds(startTimeSeconds),
        durationSeconds,
        trimStartSeconds: roundTimelineSeconds(existingClip?.trimStartSeconds || 0),
        enabled: existingClip?.enabled !== false,
        muted: existingClip?.muted === true,
        url: dubbing.audioUrl || null,
        thumbnailUrl: videoClip.thumbnailUrl || null,
        text: dubbing.text || "",
      });
    }

    return this.normalizeTimelinePayload(
      projectId,
      {
        version: existingTimeline?.version || 1,
        tracks: [
          {
            id: "track_video",
            type: "video",
            label: "Video Track",
            enabled: existingVideoTrack?.enabled !== false,
            muted: existingVideoTrack?.muted === true,
            volume: existingVideoTrack?.volume ?? 1,
            clips: videoClips,
          },
          {
            id: "track_audio",
            type: "audio",
            label: "Audio Track",
            enabled: existingAudioTrack?.enabled !== false,
            muted: existingAudioTrack?.muted === true,
            volume: existingAudioTrack?.volume ?? 1,
            clips: audioClips,
          },
        ],
      },
      {
        incrementVersion: false,
        updatedAt: existingTimeline?.updatedAt,
      }
    );
  }

  normalizeTimelinePayload(projectId, input, options = {}) {
    const existingTimeline = this.state.timelinesByProjectId?.[projectId] || null;
    const rawTracks = Array.isArray(input?.tracks) ? input.tracks : [];
    const tracks = rawTracks
      .map((track, trackIndex) => {
        const type = String(track?.type || (trackIndex === 0 ? "video" : "audio")).toLowerCase() === "audio"
          ? "audio"
          : "video";
        const trackId = String(track?.id || `track_${type}`);
        const rawClips = Array.isArray(track?.clips) ? track.clips : [];
        const clips = rawClips
          .map((clip, clipIndex) => ({
            id: String(clip?.id || `${trackId}_clip_${clipIndex + 1}`),
            type,
            sourceType: String(
              clip?.sourceType || (type === "audio" ? "dubbing_audio" : "storyboard_video")
            ),
            sourceId: clip?.sourceId ? String(clip.sourceId) : null,
            storyboardId: clip?.storyboardId ? String(clip.storyboardId) : null,
            title: String(clip?.title || `Clip ${clipIndex + 1}`),
            startTimeSeconds: roundTimelineSeconds(clip?.startTimeSeconds || 0),
            durationSeconds: Math.max(0.5, roundTimelineSeconds(clip?.durationSeconds || 0.5)),
            trimStartSeconds: roundTimelineSeconds(clip?.trimStartSeconds || 0),
            enabled: clip?.enabled !== false,
            muted: clip?.muted === true,
            url: clip?.url ? String(clip.url) : null,
            thumbnailUrl: clip?.thumbnailUrl ? String(clip.thumbnailUrl) : null,
            text: clip?.text ? String(clip.text) : "",
          }))
          .sort(sortTimelineClips);

        return {
          id: trackId,
          type,
          label: String(track?.label || (type === "audio" ? "Audio Track" : "Video Track")),
          enabled: track?.enabled !== false,
          muted: track?.muted === true,
          volume: clampTimelineValue(track?.volume ?? 1, 0, 1),
          itemCount: clips.length,
          clips,
        };
      })
      .filter(Boolean);

    const totalDurationSeconds = roundTimelineSeconds(
      tracks.reduce((maxDuration, track) => {
        const trackDuration = track.clips.reduce((clipMax, clip) => {
          if (!clip.enabled || !track.enabled) return clipMax;
          return Math.max(clipMax, clip.startTimeSeconds + clip.durationSeconds);
        }, 0);
        return Math.max(maxDuration, trackDuration);
      }, 0)
    );

    return {
      projectId,
      version: options.incrementVersion
        ? (Number(existingTimeline?.version || 1) + 1)
        : Number(input?.version || existingTimeline?.version || 1),
      totalDurationSeconds,
      tracks,
      updatedAt: options.updatedAt || new Date().toISOString(),
    };
  }

  buildStoryboardShotsFallback(content) {
    return splitStoryboardTextHeuristically(content).map((script, index) => {
      const shotType = inferShotType(script);
      return {
        title: titleFromStoryboardText(script, index),
        script,
        durationSeconds: inferStoryboardDuration(script),
        promptSummary: summarizeStoryboardText(script, 32),
        shotType,
        composition: inferComposition(script),
        focalLength: inferFocalLength(shotType),
        colorTone: inferColorTone(script),
        lighting: inferLighting(script),
        technique: inferTechnique(script),
        assetNames: [],
      };
    });
  }

  matchStoryboardAssetIds(projectId, scriptText, assetNames = []) {
    const items = Array.isArray(this.state.assetsByProjectId?.[projectId])
      ? this.state.assetsByProjectId[projectId]
      : [];
    if (!items.length) return [];

    const explicitNames = Array.isArray(assetNames)
      ? assetNames.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const haystack = cleanStoryboardText(scriptText);
    const matched = [];

    for (const asset of items) {
      const assetName = String(asset?.name || "").trim();
      if (!assetName) continue;
      if (explicitNames.includes(assetName) || haystack.includes(assetName)) {
        matched.push(asset.id);
      }
    }

    return [...new Set(matched)];
  }

  createStoryboardRecord(projectId, shot, shotNo) {
    const settings = this.state.settingsByProjectId?.[projectId] || {};
    const aspectRatio = settings.aspectRatio || "16:9";
    const durationSeconds = Math.max(
      2,
      Math.min(8, Number.parseInt(String(shot?.durationSeconds || 4), 10) || 4)
    );
    const script = cleanStoryboardText(shot?.script || "");
    const shotType = shot?.shotType || inferShotType(script);

    return {
      id: `sb_${randomUUID().slice(0, 8)}`,
      projectId,
      shotNo,
      title: String(shot?.title || "").trim() || titleFromStoryboardText(script, shotNo - 1),
      script,
      imageStatus: "draft",
      videoStatus: "draft",
      durationSeconds,
      promptSummary:
        String(shot?.promptSummary || "").trim() || summarizeStoryboardText(script, 32),
      imageUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assetIds: this.matchStoryboardAssetIds(projectId, script, shot?.assetNames),
      composition: shot?.composition || inferComposition(script),
      shotType,
      focalLength: shot?.focalLength || inferFocalLength(shotType),
      colorTone: shot?.colorTone || inferColorTone(script),
      lighting: shot?.lighting || inferLighting(script),
      technique: shot?.technique || inferTechnique(script),
      modelName: "Wan 2.6 T2I",
      aspectRatio,
      imageQuality: "2K",
      videoMode: "image_to_video",
      videoPrompt: script,
      motionPreset: "智能运镜",
      motionDescription: "",
      videoModel: this.getNodePrimaryModel(
        "video_i2v",
        this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo")
      ),
      videoAspectRatio: aspectRatio,
      videoResolution: "720p",
      videoDuration: `${durationSeconds}s`,
      referenceImageUrls: [],
      startFrameUrl: null,
      endFrameUrl: null,
    };
  }

  buildStoryboardAssetSummary(state, storyboard) {
    const selectedAssetIds = Array.isArray(storyboard?.assetIds) ? storyboard.assetIds : [];
    if (!selectedAssetIds.length) return "";

    const items = Array.isArray(state.assetsByProjectId?.[storyboard.projectId])
      ? state.assetsByProjectId[storyboard.projectId]
      : [];
    const selectedAssets = items.filter((item) => selectedAssetIds.includes(item.id));
    if (!selectedAssets.length) return "";

    const grouped = {
      character: [],
      scene: [],
      prop: [],
    };

    for (const asset of selectedAssets) {
      if (!grouped[asset.assetType]) continue;
      grouped[asset.assetType].push(asset.name);
    }

    const summaryParts = [];
    if (grouped.character.length) summaryParts.push(`角色：${grouped.character.join("、")}`);
    if (grouped.scene.length) summaryParts.push(`场景：${grouped.scene.join("、")}`);
    if (grouped.prop.length) summaryParts.push(`道具：${grouped.prop.join("、")}`);

    return summaryParts.join("；");
  }

  buildVideoRhythmHint(duration) {
    const parsed = Number.parseInt(String(duration || "").replace(/[^\d]/g, ""), 10);
    if (parsed <= 3) {
      return "短促明确，聚焦一个核心动作点，起势和收束都要干净利落。";
    }
    if (parsed <= 5) {
      return "节奏舒缓连贯，允许轻微铺垫与收束，但不要拖沓。";
    }
    return "节奏从容稳定，镜头变化要平滑，主体动作层次要完整。";
  }

  buildMotionDirective(storyboard) {
    const motionPreset = String(storyboard?.motionPreset || "智能运镜").trim() || "智能运镜";
    const motionDescription = String(storyboard?.motionDescription || "").trim();

    const baseByPreset = {
      "智能运镜": "根据主体动作自动安排轻微运镜，以稳定叙事和突出主体为优先。",
      "平移": "采用稳定平移或跟拍，让主体在画面中持续保持关注点。",
      "推进": "镜头缓慢向主体推进，逐步强化情绪与视觉焦点。",
      "拉远": "镜头从主体平滑后拉，逐步交代环境与人物关系。",
      "环绕": "围绕主体做小幅环绕，保持运动平稳，不要夸张旋转。",
      "静止": "固定机位，不做明显相机位移，只保留主体动作和环境变化。",
    };

    const base = baseByPreset[motionPreset] || `镜头运动以“${motionPreset}”为主，运动方向要明确且平滑。`;
    return motionDescription ? `${base} 额外要求：${motionDescription}` : base;
  }

  buildStoryboardVideoPrompt(state, storyboard, input = {}) {
    const storyScript = String(storyboard?.script || "").trim();
    const contentDescription = String(storyboard?.videoPrompt || "").trim();
    const videoMode = String(storyboard?.videoMode || input?.mode || "image_to_video").trim();
    const aspectRatio = String(storyboard?.videoAspectRatio || storyboard?.aspectRatio || "16:9").trim();
    const duration = String(storyboard?.videoDuration || `${storyboard?.durationSeconds || 3}s`).trim();
    const composition = [storyboard?.shotType, storyboard?.composition, storyboard?.focalLength]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("，");
    const style = [storyboard?.colorTone, storyboard?.lighting, storyboard?.technique]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("，");
    const assetSummary = this.buildStoryboardAssetSummary(state, storyboard);
    const rhythmHint = this.buildVideoRhythmHint(duration);
    const motionDirective = this.buildMotionDirective(storyboard);
    const modeDirective =
      videoMode === "start_end_frame"
        ? "根据首帧和尾帧完成单镜头连续过渡，保证中间变化自然衔接。"
        : "以参考图或当前分镜图为基础生成单镜头连续视频，保持主体造型与场景一致。";

    return [
      "任务：生成漫画分镜短视频。",
      `模式：${modeDirective}`,
      `剧情动作：${storyScript || contentDescription || "保持当前镜头内容的连续表演。"}`,
      contentDescription && contentDescription !== storyScript
        ? `画面补充：${contentDescription}`
        : null,
      assetSummary ? `关键资产：${assetSummary}` : null,
      `镜头运动：${motionDirective}`,
      `节奏控制：${duration}。${rhythmHint}`,
      composition ? `构图要求：${composition}。` : null,
      `画幅比例：${aspectRatio}。`,
      style ? `风格要求：${style}。` : null,
      "一致性要求：保持角色外观、服装、场景、道具与参考图一致，不新增无关主体，不切换成多镜头，不出现突兀跳变。",
      "输出要求：镜头运动明确、平滑、自然，适合漫剧分镜视频制作。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  buildAssetGenerationPrompt(input = {}) {
    const labelByType = {
      character: "角色设定图",
      scene: "场景设定图",
      prop: "道具设定图",
    };
    const label = labelByType[input.assetType] || "资产设定图";
    const subject = String(input.name || "").trim() || "目标资产";
    const description = String(input.description || "").trim();

    return `${label}，主体是${subject}${description ? `，${description}` : ""}。高细节，构图清晰，适合作为漫剧制作资产库设定图。`;
  }

  getExtensionByContentType(contentType, fallback = ".bin") {
    if (typeof contentType !== "string") return fallback;
    if (contentType.includes("video/mp4")) return ".mp4";
    if (contentType.includes("video/webm")) return ".webm";
    if (contentType.includes("image/png")) return ".png";
    if (contentType.includes("image/jpeg")) return ".jpg";
    if (contentType.includes("image/webp")) return ".webp";
    if (contentType.includes("audio/mpeg")) return ".mp3";
    if (contentType.includes("audio/wav")) return ".wav";
    return fallback;
  }

  async mirrorRemoteAssetToUpload({ url, kind, fallbackBaseName, fallbackContentType }) {
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`failed to fetch remote asset: ${response.status}`);
      error.statusCode = 502;
      error.code = "REMOTE_ASSET_FETCH_FAILED";
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || fallbackContentType || "application/octet-stream";
    const extension = this.getExtensionByContentType(contentType, ".bin");
    const upload = createUploadFromBuffer({
      buffer,
      kind,
      originalName: `${fallbackBaseName}${extension}`,
      contentType,
    });

    return `${this.getPublicBaseUrl()}${upload.urlPath}`;
  }

  createAssetRecord(projectId, input) {
    return this.normalizeAssetRecord({
      id: `asset_${randomUUID().slice(0, 8)}`,
      projectId,
      assetType: input.assetType,
      name: input.name,
      description: input.description || "",
      previewUrl: input.previewUrl || null,
      mediaKind: input.mediaKind || null,
      mediaUrl: input.mediaUrl || null,
      sourceTaskId: input.sourceTaskId || null,
      generationPrompt: input.generationPrompt || "",
      referenceImageUrls: Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [],
      imageStatus: input.imageStatus || null,
      imageModel: input.imageModel || null,
      aspectRatio: input.aspectRatio || null,
      negativePrompt: input.negativePrompt || "",
      scope: input.scope || "manual",
      createdAt: new Date().toISOString(),
      updatedAt: input.updatedAt,
    });
  }

  normalizeAssetRecord(asset) {
    if (!asset) return asset;

    const referenceImageUrls = Array.isArray(asset.referenceImageUrls)
      ? asset.referenceImageUrls.filter(Boolean)
      : [];

    return {
      ...asset,
      mediaKind: typeof asset.mediaKind === "string" ? asset.mediaKind : null,
      mediaUrl: typeof asset.mediaUrl === "string" ? asset.mediaUrl : null,
      sourceTaskId: typeof asset.sourceTaskId === "string" ? asset.sourceTaskId : null,
      generationPrompt:
        typeof asset.generationPrompt === "string" && asset.generationPrompt.trim()
          ? asset.generationPrompt.trim()
          : this.buildAssetGenerationPrompt(asset),
      referenceImageUrls,
      imageStatus: asset.imageStatus || (asset.previewUrl ? "ready" : "draft"),
      imageModel:
        asset.imageModel ||
        (referenceImageUrls.length ? "WanX 2.1 Image Edit" : "Wan 2.6 T2I"),
      aspectRatio: asset.aspectRatio || "1:1",
      negativePrompt: typeof asset.negativePrompt === "string" ? asset.negativePrompt : "",
      scope: asset.scope || "manual",
    };
  }

  upsertProjectAsset(state, projectId, input) {
    const items = state.assetsByProjectId[projectId];
    if (!items) return null;

    const normalizedType = String(input.assetType || "").trim().toLowerCase();
    const normalizedName = String(input.name || "").trim();
    if (!normalizedType || !normalizedName) return null;

    const existingItems = items.filter(
      (item) =>
        String(item.assetType || "").trim().toLowerCase() === normalizedType &&
        String(item.name || "").trim() === normalizedName
    );

    const nextAsset =
      existingItems.length > 0
        ? this.normalizeAssetRecord({
            ...existingItems[0],
            description: input.description || existingItems[0].description || "",
            previewUrl: input.previewUrl ?? existingItems[0].previewUrl ?? null,
            mediaKind: input.mediaKind ?? existingItems[0].mediaKind ?? null,
            mediaUrl: input.mediaUrl ?? existingItems[0].mediaUrl ?? null,
            sourceTaskId: input.sourceTaskId ?? existingItems[0].sourceTaskId ?? null,
            generationPrompt:
              input.generationPrompt || existingItems[0].generationPrompt || "",
            referenceImageUrls:
              input.referenceImageUrls ?? existingItems[0].referenceImageUrls ?? [],
            imageStatus: input.imageStatus || existingItems[0].imageStatus || null,
            imageModel: input.imageModel || existingItems[0].imageModel || null,
            aspectRatio: input.aspectRatio || existingItems[0].aspectRatio || null,
            negativePrompt:
              input.negativePrompt ?? existingItems[0].negativePrompt ?? "",
            scope: input.scope || existingItems[0].scope || "manual",
            updatedAt: new Date().toISOString(),
          })
        : this.createAssetRecord(projectId, {
            assetType: normalizedType,
            name: normalizedName,
            description: input.description || "",
            previewUrl: input.previewUrl ?? null,
            mediaKind: input.mediaKind ?? null,
            mediaUrl: input.mediaUrl ?? null,
            sourceTaskId: input.sourceTaskId ?? null,
            generationPrompt: input.generationPrompt || "",
            referenceImageUrls: input.referenceImageUrls ?? [],
            imageStatus: input.imageStatus || null,
            imageModel: input.imageModel || null,
            aspectRatio: input.aspectRatio || null,
            negativePrompt: input.negativePrompt || "",
            scope: input.scope || "manual",
          });

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (
        String(item.assetType || "").trim().toLowerCase() === normalizedType &&
        String(item.name || "").trim() === normalizedName
      ) {
        items.splice(index, 1);
      }
    }
    items.unshift(nextAsset);

    return nextAsset;
  }

  isProviderAccessibleUrl(value) {
    if (!value || typeof value !== "string") return false;

    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }

      const host = parsed.hostname.toLowerCase();
      if (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "::1" ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
  }

  toUploadPath(value) {
    if (!value || typeof value !== "string") return null;
    if (value.startsWith("/uploads/")) {
      return value;
    }

    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/")) {
        return parsed.pathname;
      }
    } catch {}

    return null;
  }

  createDataUrlFromUpload(value) {
    const uploadPath = this.toUploadPath(value);
    if (!uploadPath) return null;

    const upload = readUploadByUrlPath(uploadPath);
    if (!upload) return null;

    const buffer = readFileSync(upload.absolutePath);
    return `data:${upload.contentType};base64,${buffer.toString("base64")}`;
  }

  resolveProviderImageSource(...candidates) {
    for (const value of candidates) {
      if (this.isDataUrl(value) || this.isProviderAccessibleUrl(value)) {
        return value;
      }

      const dataUrl = this.createDataUrlFromUpload(value);
      if (dataUrl) return dataUrl;
    }

    const error = new Error(
      "当前参考图不可用。请使用公网图片 URL，或先上传首帧/尾帧图片后再发起生成。"
    );
    error.statusCode = 400;
    error.code = "PROVIDER_IMAGE_NOT_ACCESSIBLE";
    throw error;
  }

  touchProject(projectId, patch = {}) {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) return null;

    const nextProgress =
      typeof patch.progressPercent === "number"
        ? Math.max(project.progressPercent || 0, patch.progressPercent)
        : project.progressPercent;

    Object.assign(project, patch, {
      progressPercent: nextProgress,
      updatedAt: new Date().toISOString()
    });

    return project;
  }

  listProjects(page = 1, pageSize = 20, actorId) {
    const actor = this.resolveActor(actorId);
    const visibleProjects = (this.state.projects || []).filter((project) => {
      if (actor.platformRole === "super_admin") return true;
      if (actor.platformRole !== "customer") return false;
      if (project.ownerType === "organization") {
        return Boolean(this.getMembership(actor.id, project.organizationId || project.ownerId));
      }
      return project.ownerId === actor.id || project.createdBy === actor.id;
    });
    const items = visibleProjects.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: clone(items),
      page,
      pageSize,
      total: visibleProjects.length
    };
  }

  createProject(input, actorId) {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "customer") {
      throw apiError(403, "FORBIDDEN", "Only signed-in customer accounts can create projects.");
    }

    const timestamp = new Date().toISOString();
    const ownerType =
      input.ownerType === "organization" && input.organizationId ? "organization" : "personal";

    if (ownerType === "organization") {
      this.assertOrganizationAccess(input.organizationId, actor.id);
    }

    const project = {
      id: `proj_${randomUUID().slice(0, 8)}`,
      title: input.title,
      summary: input.summary || "New project waiting for settings and script input.",
      status: "draft",
      coverUrl: null,
      organizationId: ownerType === "organization" ? input.organizationId : null,
      ownerType,
      ownerId: ownerType === "organization" ? input.organizationId : actor.id,
      createdBy: actor.id,
      currentStep: "global",
      progressPercent: 0,
      budgetCredits: Number(input.budgetLimitCredits || 600),
      budgetLimitCredits: Number(input.budgetLimitCredits || 600),
      budgetUsedCredits: 0,
      billingWalletType: ownerType === "organization" ? "organization" : "personal",
      billingPolicy: ownerType === "organization" ? "organization_only" : "personal_only",
      directorAgentName: "Unassigned",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.projects.unshift(project);
    this.state.settingsByProjectId[project.id] = {
      projectId: project.id,
      tone: "",
      genre: "",
      targetDurationSeconds: 60,
      aspectRatio: "9:16",
      visualStyle: "",
      audience: "",
      modelProfile: "standard",
      language: "zh-CN",
      updatedAt: timestamp
    };
    this.state.scriptsByProjectId[project.id] = {
      id: `script_${randomUUID().slice(0, 8)}`,
      projectId: project.id,
      version: 1,
      title: `${project.title} Draft`,
      content: "",
      updatedAt: timestamp
    };
    this.state.assetsByProjectId[project.id] = [];
    this.state.storyboardsByProjectId[project.id] = [];
    this.state.videosByProjectId[project.id] = [];
    this.state.dubbingsByProjectId[project.id] = [];
    this.state.timelinesByProjectId[project.id] = {
      projectId: project.id,
      version: 1,
      totalDurationSeconds: 0,
      tracks: [],
      updatedAt: timestamp
    };

    return clone(project);
  }

  getProject(projectId, actorId) {
    const project = this.assertProjectAccess(projectId, actorId);

    return clone({
      ...project,
      settings: this.state.settingsByProjectId[projectId],
      script: this.state.scriptsByProjectId[projectId],
      assetCount: this.state.assetsByProjectId[projectId]?.length || 0,
      storyboardCount: this.state.storyboardsByProjectId[projectId]?.length || 0,
      videoCount: this.state.videosByProjectId[projectId]?.length || 0,
      dubbingCount: this.state.dubbingsByProjectId[projectId]?.length || 0
    });
  }

  updateProject(projectId, input, actorId) {
    const needsOrgAdmin =
      Object.prototype.hasOwnProperty.call(input, "budgetLimitCredits") ||
      Object.prototype.hasOwnProperty.call(input, "billingPolicy") ||
      Object.prototype.hasOwnProperty.call(input, "billingWalletType");
    const project = this.assertProjectAccess(projectId, actorId, {
      requireOrgAdmin: needsOrgAdmin,
    });

    Object.assign(project, {
      ...input,
      budgetCredits:
        input.budgetLimitCredits != null
          ? Number(input.budgetLimitCredits)
          : project.budgetCredits,
      updatedAt: new Date().toISOString()
    });

    return clone(project);
  }

  getProjectOverview(projectId, actorId) {
    const project = this.getProject(projectId, actorId);
    if (!project) return null;

    return clone({
      project,
      settings: this.getSettings(projectId),
      script: this.getScript(projectId),
      assets: this.listAssets(projectId),
      storyboards: this.listStoryboards(projectId),
      videos: this.listVideos(projectId),
      dubbings: this.listDubbings(projectId),
      timeline: this.getTimeline(projectId),
      tasks: this.listTasks(projectId, actorId)
    });
  }

  getSettings(projectId) {
    return clone(this.state.settingsByProjectId[projectId] || null);
  }

  updateSettings(projectId, input) {
    if (!this.state.settingsByProjectId[projectId]) return null;

    this.state.settingsByProjectId[projectId] = {
      ...this.state.settingsByProjectId[projectId],
      ...input,
      updatedAt: new Date().toISOString()
    };

    this.touchProject(projectId, {
      currentStep: "global",
      progressPercent: 12
    });

    return clone(this.state.settingsByProjectId[projectId]);
  }

  getScript(projectId) {
    return clone(this.state.scriptsByProjectId[projectId] || null);
  }

  updateScript(projectId, content) {
    const script = this.state.scriptsByProjectId[projectId];
    if (!script) return null;

    script.content = content;
    script.version += 1;
    script.updatedAt = new Date().toISOString();

    this.touchProject(projectId, {
      currentStep: "script",
      progressPercent: 24
    });

    return clone(script);
  }

  listAssets(projectId, assetType) {
    const items = this.state.assetsByProjectId[projectId] || [];
    return clone(assetType ? items.filter((item) => item.assetType === assetType) : items);
  }

  getAsset(projectId, assetId) {
    const items = this.state.assetsByProjectId[projectId] || [];
    const asset = items.find((item) => item.id === assetId);
    return clone(asset || null);
  }

  createAsset(projectId, input) {
    if (!this.state.assetsByProjectId[projectId]) return null;

    const asset = this.createAssetRecord(projectId, input);

    this.state.assetsByProjectId[projectId].unshift(asset);
    this.touchProject(projectId, {
      currentStep: "assets",
      progressPercent: 36
    });

    return clone(asset);
  }

  updateAsset(projectId, assetId, input) {
    const items = this.state.assetsByProjectId[projectId];
    if (!items) return null;

    const asset = items.find((item) => item.id === assetId);
    if (!asset) return null;

    Object.assign(asset, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    const normalized = this.normalizeAssetRecord(asset);
    Object.assign(asset, normalized);

    return clone(asset);
  }

  deleteAsset(projectId, assetId) {
    const items = this.state.assetsByProjectId[projectId];
    if (!items) return false;

    const nextItems = items.filter((item) => item.id !== assetId);
    if (nextItems.length === items.length) return false;

    this.state.assetsByProjectId[projectId] = nextItems;
    return true;
  }

  listStoryboards(projectId) {
    return clone(this.state.storyboardsByProjectId[projectId] || []);
  }

  getStoryboard(projectId, storyboardId) {
    const items = this.state.storyboardsByProjectId[projectId] || [];
    const storyboard = items.find((item) => item.id === storyboardId);
    return clone(storyboard || null);
  }

  updateStoryboard(projectId, storyboardId, input) {
    const items = this.state.storyboardsByProjectId[projectId];
    if (!items) return null;

    const storyboard = items.find((item) => item.id === storyboardId);
    if (!storyboard) return null;

    Object.assign(storyboard, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    return clone(storyboard);
  }

  deleteStoryboard(projectId, storyboardId) {
    const items = this.state.storyboardsByProjectId[projectId];
    if (!items) return false;

    const nextItems = items.filter((item) => item.id !== storyboardId);
    if (nextItems.length === items.length) return false;

    this.state.storyboardsByProjectId[projectId] = nextItems;
    return true;
  }

  listVideos(projectId) {
    return clone(this.state.videosByProjectId[projectId] || []);
  }

  getVideo(projectId, videoId) {
    const items = this.state.videosByProjectId[projectId] || [];
    const video = items.find((item) => item.id === videoId);
    return clone(video || null);
  }

  listDubbings(projectId) {
    return clone(this.state.dubbingsByProjectId[projectId] || []);
  }

  getDubbing(projectId, dubbingId) {
    const items = this.state.dubbingsByProjectId[projectId] || [];
    const dubbing = items.find((item) => item.id === dubbingId);
    return clone(dubbing || null);
  }

  updateDubbing(projectId, dubbingId, input) {
    const items = this.state.dubbingsByProjectId[projectId];
    if (!items) return null;

    const dubbing = items.find((item) => item.id === dubbingId);
    if (!dubbing) return null;

    Object.assign(dubbing, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    return clone(dubbing);
  }

  getTimeline(projectId) {
    const timeline = this.state.timelinesByProjectId[projectId] || null;
    const hasReadyVideos = Array.isArray(this.state.videosByProjectId?.[projectId])
      ? this.state.videosByProjectId[projectId].some(
          (video) => video?.status === "ready" && video?.videoUrl
        )
      : false;

    if (hasReadyVideos && !hasPlayableVideoTimelineClips(timeline)) {
      const nextTimeline = this.buildDefaultTimeline(projectId, timeline);
      this.state.timelinesByProjectId[projectId] = nextTimeline;
      return clone(nextTimeline);
    }

    return clone(timeline);
  }

  updateTimeline(projectId, input) {
    if (!this.state.timelinesByProjectId[projectId]) return null;

    const nextTimeline = this.normalizeTimelinePayload(projectId, input, {
      incrementVersion: true,
    });
    this.state.timelinesByProjectId[projectId] = nextTimeline;
    this.touchProject(projectId, {
      currentStep: "preview",
      progressPercent: 100,
    });
    return clone(nextTimeline);
  }

  getWallet(actorId) {
    return this.toPublicWallet(this.getPrimaryWalletForActor(actorId));
  }

  createWalletRechargeOrder(input) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const order = {
      id: `recharge_${randomUUID().slice(0, 8)}`,
      planId: String(input.planId || "custom"),
      planName: String(input.planName || "Wallet Recharge"),
      billingCycle: String(input.billingCycle || "oneTime"),
      paymentMethod: String(input.paymentMethod || "wechat_pay"),
      amount: Number(input.amount || 0),
      credits: Number(input.credits || 0),
      currency: "CNY",
      status: "pending",
      qrCodePayload: `weixin://wxpay/bizpayurl/mock-${randomUUID().slice(0, 12)}`,
      qrCodeHint: "使用微信扫一扫完成支付",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    if (!Array.isArray(this.state.walletRechargeOrders)) {
      this.state.walletRechargeOrders = [];
    }

    this.state.walletRechargeOrders.unshift(order);
    return clone(order);
  }

  getWalletRechargeOrder(orderId) {
    const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
    return clone(order || null);
  }

  confirmWalletRechargeOrder(orderId) {
    const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
    if (!order) return null;

    if (order.status !== "paid") {
      order.status = "paid";
      order.updatedAt = new Date().toISOString();
      this.state.wallet.creditsAvailable += Number(order.credits || 0);
      this.state.wallet.updatedAt = order.updatedAt;

      this.emit("wallet_recharge_paid", {
        orderId: order.id,
        amount: order.amount,
        credits: order.credits,
        paymentMethod: order.paymentMethod,
      });
    }

    return clone(order);
  }

  listEnterpriseApplications() {
    return clone(this.state.enterpriseApplications);
  }

  createEnterpriseApplication(input) {
    const application = {
      id: `ent_app_${randomUUID().slice(0, 8)}`,
      companyName: input.companyName,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      status: "submitted",
      createdAt: new Date().toISOString()
    };

    this.state.enterpriseApplications.unshift(application);
    return clone(application);
  }

  listTasks(projectId) {
    const items = projectId
      ? this.state.tasks.filter((task) => task.projectId === projectId)
      : this.state.tasks;
    return clone(items);
  }

  getTask(taskId) {
    const task = this.state.tasks.find((item) => item.id === taskId);
    return clone(task || null);
  }

  getToolboxCapabilities() {
    return clone(this.state.toolboxCapabilities);
  }

  listCreateImages() {
    return clone(this.state.createStudioImages || []);
  }

  listCreateVideos() {
    return clone(this.state.createStudioVideos || []);
  }

  createTask(params) {
    const task = {
      id: `task_${randomUUID().slice(0, 8)}`,
      type: params.type,
      domain: params.domain,
      projectId: params.projectId || null,
      storyboardId: params.storyboardId || null,
      status: "queued",
      progressPercent: 0,
      currentStage: "queued",
      etaSeconds: 90,
      inputSummary: params.inputSummary || null,
      outputSummary: null,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.state.tasks.unshift(task);
    this.emit("task.created", task);
    this.scheduleTaskLifecycle(task.id, params.effect);
    return clone(task);
  }

  updateTask(taskId, patch) {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task) return null;

    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    const eventName = task.status === "succeeded" ? "task.completed" : "task.updated";
    this.emit(eventName, task);
    return clone(task);
  }

  emit(eventName, payload) {
    this.events.emit("event", {
      id: randomUUID(),
      type: eventName,
      occurredAt: new Date().toISOString(),
      payload: clone(payload)
    });
  }

  scheduleTaskLifecycle(taskId, effect) {
    setTimeout(() => {
      this.updateTask(taskId, {
        status: "running",
        progressPercent: 35,
        currentStage: "processing",
        etaSeconds: 45
      });
    }, 350);

    setTimeout(() => {
      this.updateTask(taskId, {
        status: "running",
        progressPercent: 72,
        currentStage: "rendering",
        etaSeconds: 18
      });
    }, 900);

    setTimeout(async () => {
      try {
        let outputSummary = "mock result ready";

        if (typeof effect === "function") {
          const result = await effect(this.state);
          if (typeof result === "string" && result.trim()) {
            outputSummary = result.trim();
          }
        }

        this.updateTask(taskId, {
          status: "succeeded",
          progressPercent: 100,
          currentStage: "completed",
          etaSeconds: 0,
          outputSummary
        });
      } catch (error) {
        this.updateTask(taskId, {
          status: "failed",
          progressPercent: 100,
          currentStage: "failed",
          etaSeconds: 0,
          outputSummary: error?.message || "provider call failed"
        });
      }
    }, 1600);
  }

  makeScriptRewriteTask(projectId, input) {
    return this.createTask({
      type: "script_rewrite",
      domain: "scripts",
      projectId,
      inputSummary: input.instruction,
      metadata: input,
      effect: async (state) => {
        const script = state.scriptsByProjectId[projectId];
        if (!script) return;

        if (hasAliyunApiKey()) {
          script.content = await rewriteScriptWithAliyun({
            content: script.content,
            instruction: input.instruction,
            model: this.getNodePrimaryModel("script", this.getDefaultModelId("textModelId", "qwen-plus")),
          });
        } else {
          script.content = `${script.content}\n\n[AI rewrite] ${input.instruction}`;
        }
        script.version += 1;
        script.updatedAt = new Date().toISOString();

        this.touchProject(projectId, {
          currentStep: "script",
          progressPercent: 28
        });

        return hasAliyunApiKey() ? "aliyun script rewrite completed" : "mock script rewrite completed";
      }
    });
  }

  makeAssetExtractTask(projectId, input) {
    const sourceText = String(
      input?.sourceText || this.state.scriptsByProjectId[projectId]?.content || ""
    );

    return this.createTask({
      type: "asset_extract",
      domain: "assets",
      projectId,
      inputSummary: sourceText || "Extract assets from script",
      metadata: {
        ...input,
        sourceText,
      },
      effect: async (state) => {
        if (!state.assetsByProjectId[projectId]) return;
        if (!sourceText.trim()) {
          const error = new Error("Script content is empty.");
          error.statusCode = 400;
          error.code = "BAD_REQUEST";
          throw error;
        }

        const script = state.scriptsByProjectId[projectId];
        if (script && script.content !== sourceText) {
          script.content = sourceText;
          script.version += 1;
          script.updatedAt = new Date().toISOString();
        }

        if (hasAliyunApiKey()) {
          state.assetsByProjectId[projectId] = state.assetsByProjectId[projectId].filter(
            (asset) => asset.scope !== "extracted"
          );

          const extractedAssets = await extractAssetsWithAliyun({
            content: sourceText,
            model: this.getNodePrimaryModel("assets", this.getDefaultModelId("textModelId", "qwen-plus")),
          });

          for (const asset of extractedAssets.slice(0, 12)) {
            if (!asset?.assetType || !asset?.name) continue;
            this.upsertProjectAsset(state, projectId, {
              assetType: asset.assetType,
              name: asset.name,
              description: asset.description || "",
              generationPrompt: asset.generationPrompt || "",
              referenceImageUrls: [],
              imageStatus: "draft",
              imageModel: asset.imageModel || null,
              aspectRatio: asset.aspectRatio || "1:1",
              negativePrompt: asset.negativePrompt || "",
              previewUrl: null,
              scope: "extracted",
            });
          }
        } else {
          const error = new Error("Real asset extraction requires DASHSCOPE_API_KEY.");
          error.statusCode = 503;
          error.code = "PROVIDER_NOT_CONFIGURED";
          throw error;
        }

        this.touchProject(projectId, {
          currentStep: "assets",
          progressPercent: 40
        });

        return "aliyun asset extraction completed";
      }
    });
  }

  makeAssetImageGenerateTask(projectId, assetId, input = {}) {
    const asset = this.state.assetsByProjectId[projectId]?.find((item) => item.id === assetId);
    if (asset) {
      Object.assign(asset, {
        generationPrompt: input.generationPrompt || asset.generationPrompt || "",
        referenceImageUrls:
          input.referenceImageUrls ?? asset.referenceImageUrls ?? [],
        aspectRatio: input.aspectRatio || asset.aspectRatio || "1:1",
        imageModel: input.imageModel || asset.imageModel || null,
        negativePrompt: input.negativePrompt ?? asset.negativePrompt ?? "",
        imageStatus: "queued",
        updatedAt: new Date().toISOString(),
      });
      Object.assign(asset, this.normalizeAssetRecord(asset));
    }

    return this.createTask({
      type: "asset_image_generate",
      domain: "assets",
      projectId,
      inputSummary: input.generationPrompt || asset?.generationPrompt || asset?.name || "Generate asset image",
      metadata: {
        assetId,
        ...input,
      },
      effect: async (state) => {
        const match = state.assetsByProjectId[projectId]?.find((item) => item.id === assetId);
        if (!match) return;

        Object.assign(match, this.normalizeAssetRecord(match));

        const generationPrompt =
          String(input.generationPrompt || match.generationPrompt || "").trim() ||
          this.buildAssetGenerationPrompt(match);
        const referenceImageUrls = Array.isArray(input.referenceImageUrls)
          ? input.referenceImageUrls.filter(Boolean)
          : match.referenceImageUrls || [];
        const aspectRatio = input.aspectRatio || match.aspectRatio || "1:1";
        const negativePrompt =
          typeof input.negativePrompt === "string"
            ? input.negativePrompt
            : match.negativePrompt || "";
        const imageModel =
          input.imageModel ||
          match.imageModel ||
          (referenceImageUrls.length ? "WanX 2.1 Image Edit" : "Wan 2.6 T2I");

        match.imageStatus = "queued";
        match.updatedAt = new Date().toISOString();

        try {
          let previewUrl = `https://mock.assets.local/assets/${assetId}_${Date.now()}.jpg`;

          if (hasAliyunApiKey()) {
            const [imageUrl] = await generateImagesWithAliyun({
              prompt: generationPrompt,
              model: imageModel,
              aspectRatio,
              count: 1,
              negativePrompt,
              referenceImageUrl: referenceImageUrls[0]
                ? this.resolveProviderImageSource(referenceImageUrls[0])
                : null,
            });

            previewUrl =
              (await this.mirrorRemoteAssetToUpload({
                url: imageUrl,
                kind: "asset-image",
                fallbackBaseName: assetId,
                fallbackContentType: "image/png",
              })) || imageUrl;
          }

          Object.assign(match, {
            generationPrompt,
            referenceImageUrls,
            aspectRatio,
            negativePrompt,
            imageModel,
            previewUrl,
            imageStatus: "ready",
            updatedAt: new Date().toISOString(),
          });

          this.touchProject(projectId, {
            currentStep: "assets",
            progressPercent: 48,
          });

          return hasAliyunApiKey()
            ? "aliyun asset image completed"
            : "mock asset image completed";
        } catch (error) {
          match.imageStatus = "failed";
          match.updatedAt = new Date().toISOString();
          throw error;
        }
      },
    });
  }

  makeStoryboardGenerateTask(projectId, input) {
    const sourceText = String(
      input?.sourceText || this.state.scriptsByProjectId[projectId]?.content || ""
    );

    return this.createTask({
      type: "storyboard_auto_generate",
      domain: "storyboards",
      projectId,
      inputSummary: sourceText ? summarizeStoryboardText(sourceText, 48) : "Auto split script into storyboards",
      metadata: {
        ...input,
        sourceText,
      },
      effect: async (state) => {
        if (!state.storyboardsByProjectId[projectId]) return;
        if (!sourceText.trim()) {
          const error = new Error("Script content is empty.");
          error.statusCode = 400;
          error.code = "BAD_REQUEST";
          throw error;
        }

        const script = state.scriptsByProjectId[projectId];
        if (script && script.content !== sourceText) {
          script.content = sourceText;
          script.version += 1;
          script.updatedAt = new Date().toISOString();
        }

        let storyboardShots = [];
        let outputSource = "heuristic";

        if (hasAliyunApiKey()) {
          try {
            storyboardShots = await withTimeout(
              splitStoryboardsWithAliyun({
                content: sourceText,
                model: this.getNodePrimaryModel(
                  "storyboard_script",
                  this.getDefaultModelId("textModelId", "qwen-plus")
                ),
              }),
              20000,
              "Storyboard split provider timeout."
            );
            outputSource = "aliyun";
          } catch (error) {
            storyboardShots = [];
          }
        }

        if (!storyboardShots.length) {
          storyboardShots = this.buildStoryboardShotsFallback(sourceText);
        }

        if (!storyboardShots.length) {
          const error = new Error("Failed to split script into storyboard shots.");
          error.statusCode = 422;
          error.code = "STORYBOARD_SPLIT_FAILED";
          throw error;
        }

        const nextStoryboards = storyboardShots
          .slice(0, 12)
          .map((shot, index) => this.createStoryboardRecord(projectId, shot, index + 1));

        state.storyboardsByProjectId[projectId] = nextStoryboards;
        state.videosByProjectId[projectId] = [];
        state.dubbingsByProjectId[projectId] = [];
        state.timelinesByProjectId[projectId] = this.buildDefaultTimeline(projectId, null);

        this.touchProject(projectId, {
          currentStep: "storyboards",
          progressPercent: 52
        });

        return `${outputSource} storyboard split completed (${nextStoryboards.length} shots)`;
      }
    });
  }

  makeImageGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    if (storyboard) {
      storyboard.imageStatus = "queued";
      storyboard.updatedAt = new Date().toISOString();
    }

    return this.createTask({
      type: "storyboard_image_generate",
      domain: "storyboards",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.prompt || "Generate storyboard image",
      metadata: input,
      effect: async (state) => {
        const match = this.findStoryboardInState(state, storyboardId);
        if (!match) return;

        match.imageStatus = "ready";
        if (hasAliyunApiKey()) {
          const [imageUrl] = await generateImagesWithAliyun({
            prompt: input?.prompt || match.script || match.promptSummary,
            model: normalizeModelId(
              match.modelName ||
                this.getNodePrimaryModel("storyboard_image", this.getDefaultModelId("imageModelId", "wan2.6-t2i"))
            ),
            aspectRatio: match.aspectRatio || "16:9",
            count: 1,
          });
          match.imageUrl = imageUrl;
        } else {
          match.imageUrl = `https://mock.assets.local/storyboards/${storyboardId}_${Date.now()}.jpg`;
        }
        match.updatedAt = new Date().toISOString();

        this.touchProject(match.projectId, {
          currentStep: "storyboards",
          progressPercent: 60
        });

        return hasAliyunApiKey() ? "aliyun storyboard image completed" : "mock storyboard image completed";
      }
    });
  }

  makeVideoGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    if (storyboard) {
      const isStartEndMode = (storyboard.videoMode || input?.mode) === "start_end_frame";
      const videoModel =
        storyboard.videoModel ||
        this.getNodePrimaryModel(
          isStartEndMode ? "video_kf2v" : "video_i2v",
          this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo")
        );
      storyboard.videoStatus = "queued";
      storyboard.videoResolution = normalizeStoredVideoResolution(
        videoModel,
        storyboard.videoResolution || input?.resolution || "720p"
      );
      storyboard.updatedAt = new Date().toISOString();
    }

    let taskId = null;
    const task = this.createTask({
      type: "video_generate",
      domain: "videos",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.motionPreset || "Generate shot video",
      metadata: input,
      effect: async (state) => {
        if (!storyboard) return;

        const match = this.findStoryboardInState(state, storyboardId);
        if (!match) return;

        let videoUrl = `https://mock.assets.local/videos/${storyboardId}_${Date.now()}.mp4`;
        let thumbnailUrl = `https://mock.assets.local/videos/${storyboardId}_${Date.now()}.jpg`;
        let durationSeconds = storyboard.durationSeconds;

        try {
          const isStartEndMode = (match.videoMode || input?.mode) === "start_end_frame";
          const videoModel = normalizeModelId(
            match.videoModel ||
              this.getNodePrimaryModel(
                isStartEndMode ? "video_kf2v" : "video_i2v",
                this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo")
              )
          );
          const normalizedResolution = normalizeStoredVideoResolution(
            videoModel,
            match.videoResolution || input?.resolution || "720p"
          );
          const resolvedPrompt = this.buildStoryboardVideoPrompt(state, match, input);

          if (taskId) {
            this.updateTask(taskId, {
              metadata: {
                ...(input || {}),
                resolvedPrompt,
              },
            });
          }

          match.videoStatus = "running";
          match.videoResolution = normalizedResolution;
          match.updatedAt = new Date().toISOString();

          if (hasAliyunApiKey()) {
            const referenceImageUrl = !isStartEndMode
              ? this.resolveProviderImageSource(match.referenceImageUrls?.[0], match.imageUrl)
              : null;
            const firstFrameUrl = isStartEndMode
              ? this.resolveProviderImageSource(match.startFrameUrl, match.imageUrl)
              : null;
            const lastFrameUrl = isStartEndMode && match.endFrameUrl
              ? this.resolveProviderImageSource(match.endFrameUrl)
              : null;
            const taskId = await createAliyunVideoTask({
              // Use a fixed prompt template so script, motion, rhythm, and style are all respected.
              model: videoModel,
              prompt: resolvedPrompt,
              referenceImageUrl,
              firstFrameUrl,
              lastFrameUrl,
              resolution: normalizedResolution,
              duration: match.videoDuration || `${storyboard.durationSeconds}s`,
            });
            const result = await waitForAliyunTask(taskId);
            const parsedResult = parseAliyunVideoResult(result);
            videoUrl = parsedResult.videoUrl || videoUrl;
            if (parsedResult.videoUrl) {
              videoUrl =
                (await this.mirrorRemoteAssetToUpload({
                  url: parsedResult.videoUrl,
                  kind: "generated-video",
                  fallbackBaseName: storyboardId,
                  fallbackContentType: "video/mp4",
                })) || videoUrl;
            }
            thumbnailUrl =
              parsedResult.thumbnailUrl ||
              (isStartEndMode
                ? match.startFrameUrl || match.endFrameUrl
                : match.referenceImageUrls?.[0] || match.imageUrl) ||
              thumbnailUrl;
            durationSeconds = parsedResult.durationSeconds || durationSeconds;
          }

          state.videosByProjectId[storyboard.projectId].unshift({
            id: `video_${randomUUID().slice(0, 8)}`,
            projectId: storyboard.projectId,
            storyboardId,
            version: 1,
            status: "ready",
            durationSeconds,
            videoUrl,
            thumbnailUrl,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          match.videoStatus = "ready";
          match.updatedAt = new Date().toISOString();

          this.touchProject(storyboard.projectId, {
            currentStep: "videos",
            progressPercent: 72
          });

          return hasAliyunApiKey() ? "aliyun storyboard video completed" : "mock storyboard video completed";
        } catch (error) {
          match.videoStatus = "failed";
          match.updatedAt = new Date().toISOString();
          throw error;
        }
      }
    });
    taskId = task.id;
    return task;
  }

  makeDubbingGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    return this.createTask({
      type: "dubbing_generate",
      domain: "dubbings",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.text || "Generate dubbing",
      metadata: input,
      effect: async (state) => {
        if (!storyboard) return;

        let audioUrl = `https://mock.assets.local/audio/${storyboardId}_${Date.now()}.mp3`;
        const normalizedVoicePreset = normalizeVoicePreset(input?.voicePreset || "longanyang");

        if (hasAliyunApiKey()) {
          const model = this.getNodePrimaryModel(
            "dubbing_tts",
            this.getDefaultModelId("audioModelId", "cosyvoice-v3-flash")
          );
          const audio = await synthesizeSpeechWithAliyun({
            text: input?.text || "New dubbing generated for demo purposes.",
            model,
            voice: normalizedVoicePreset,
            format: "mp3",
          });
          const upload = createUploadFromBuffer({
            buffer: audio.buffer,
            kind: "tts",
            originalName: `${storyboardId}.mp3`,
            contentType: "audio/mpeg",
          });
          audioUrl = `${this.getPublicBaseUrl()}${upload.urlPath}`;
        }

        state.dubbingsByProjectId[storyboard.projectId].unshift({
          id: `dub_${randomUUID().slice(0, 8)}`,
          projectId: storyboard.projectId,
          storyboardId,
          speakerName: input?.speakerName || "Narrator",
          voicePreset: normalizedVoicePreset,
          text: input?.text || "New dubbing generated for demo purposes.",
          status: "ready",
          audioUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        this.touchProject(storyboard.projectId, {
          currentStep: "dubbing",
          progressPercent: 82
        });

        return hasAliyunApiKey() ? "aliyun dubbing completed" : "mock dubbing completed";
      }
    });
  }

  makeLipSyncTask(storyboardId) {
    const storyboard = this.findStoryboard(storyboardId);
    return this.createTask({
      type: "lipsync_generate",
      domain: "lipsync",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: "Generate lip sync",
      effect: () => {
        if (!storyboard) return;

        this.touchProject(storyboard.projectId, {
          currentStep: "dubbing",
          progressPercent: 88
        });
      }
    });
  }

  makeExportTask(projectId, input) {
    return this.createTask({
      type: "project_export",
      domain: "exports",
      projectId,
      inputSummary: input?.format || "Export final cut",
      metadata: input,
      effect: (state) => {
        const timeline = state.timelinesByProjectId[projectId];
        if (!timeline) return;

        timeline.version += 1;
        timeline.updatedAt = new Date().toISOString();

        this.touchProject(projectId, {
          currentStep: "preview",
          progressPercent: 100,
          status: "published"
        });
      }
    });
  }

  makeToolboxTask(type, input) {
    return this.createTask({
      type,
      domain: "toolbox",
      projectId: input?.projectId || null,
      storyboardId: input?.storyboardId || null,
      inputSummary: input?.note || input?.target || type,
      metadata: input,
      effect: () => {
        if (!input?.projectId) return;

        this.touchProject(input.projectId, {
          progressPercent: 92
        });
      }
    });
  }

  makeCreateImageTask(input) {
    let taskId = null;
    const task = this.createTask({
      type: "create_image_generate",
      domain: "create",
      inputSummary: input?.prompt || "Generate standalone image",
      metadata: input,
      effect: async (state) => {
        const count = Math.max(1, Math.min(Number(input?.count) || 1, 4));
        const timestamp = new Date().toISOString();
        const imageUrls = hasAliyunApiKey()
          ? await generateImagesWithAliyun({
              prompt: input?.prompt || "Generated image prompt",
              model: normalizeModelId(input?.model || this.getDefaultModelId("imageModelId", "wan2.6-t2i")),
              aspectRatio: input?.aspectRatio || "16:9",
              count,
              negativePrompt: input?.negativePrompt || "",
              referenceImageUrl: input?.referenceImageUrl
                ? this.resolveProviderImageSource(input.referenceImageUrl)
                : null,
            })
          : null;

        for (let index = 0; index < count; index += 1) {
          state.createStudioImages.unshift({
            id: `create_img_${randomUUID().slice(0, 8)}`,
            taskId,
            prompt: input?.prompt || "Generated image prompt",
            model: input?.model || "Wan 2.6 T2I",
            style: input?.style || "default",
            aspectRatio: input?.aspectRatio || "16:9",
            resolution: input?.resolution || "2K",
            referenceImageUrl: input?.referenceImageUrl || null,
            imageUrl: imageUrls?.[index] || `https://mock.assets.local/create/images/${Date.now()}_${index}.jpg`,
            createdAt: timestamp
          });
        }

        return hasAliyunApiKey() ? "aliyun create image completed" : "mock create image completed";
      }
    });
    taskId = task.id;
    return task;
  }

  makeCreateVideoTask(input) {
    let taskId = null;
    const task = this.createTask({
      type: "create_video_generate",
      domain: "create",
      inputSummary: input?.prompt || "Generate standalone video",
      metadata: input,
      effect: async (state) => {
        const timestamp = new Date().toISOString();
        let thumbnailUrl = `https://mock.assets.local/create/videos/${Date.now()}.jpg`;
        let videoUrl = `https://mock.assets.local/create/videos/${Date.now()}.mp4`;
        const requestedModel = input?.model || this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo");
        const resolvedModel = resolveCreateVideoModel(
          requestedModel,
          input?.referenceImageUrl,
          this.getDefaultModelId("videoModelId", "wanx2.1-i2v-turbo")
        );
        const normalizedResolution = normalizeStoredVideoResolution(
          resolvedModel,
          input?.resolution || "720p"
        );

        if (hasAliyunApiKey()) {
          const providerTaskId = await createAliyunVideoTask({
            model: normalizeModelId(resolvedModel),
            prompt: input?.prompt || "Generated video prompt",
            referenceImageUrl: input?.referenceImageUrl
              ? this.resolveProviderImageSource(input.referenceImageUrl)
              : null,
            aspectRatio: input?.aspectRatio || "16:9",
            resolution: normalizedResolution,
            duration: input?.duration || "3s",
          });
          const result = await waitForAliyunTask(providerTaskId);
          const parsedResult = parseAliyunVideoResult(result);
          thumbnailUrl = parsedResult.thumbnailUrl || input.referenceImageUrl || thumbnailUrl;
          videoUrl = parsedResult.videoUrl || videoUrl;
          if (parsedResult.videoUrl) {
            videoUrl =
              (await this.mirrorRemoteAssetToUpload({
                url: parsedResult.videoUrl,
                kind: "create-video",
                fallbackBaseName: taskId || `create-video-${Date.now()}`,
                fallbackContentType: "video/mp4",
              })) || videoUrl;
          }
        }

        state.createStudioVideos.unshift({
          id: `create_vid_${randomUUID().slice(0, 8)}`,
          taskId,
          prompt: input?.prompt || "Generated video prompt",
          model: formatCreateVideoModelLabel(resolvedModel),
          duration: input?.duration || "3s",
          aspectRatio: input?.aspectRatio || "16:9",
          resolution: normalizedResolution,
          referenceImageUrl: input?.referenceImageUrl || null,
          thumbnailUrl,
          videoUrl,
          createdAt: timestamp
        });

        return hasAliyunApiKey() ? "aliyun create video completed" : "mock create video completed";
      }
    });
    taskId = task.id;
    return task;
  }

  findStoryboard(storyboardId) {
    return this.findStoryboardInState(this.state, storyboardId);
  }

  findStoryboardInState(state, storyboardId) {
    for (const storyboards of Object.values(state.storyboardsByProjectId)) {
      const match = storyboards.find((item) => item.id === storyboardId);
      if (match) return match;
    }
    return null;
  }
}

MockStore.prototype.buildDefaultUsers = function buildDefaultUsers(timestamp) {
  return [
    {
      id: "user_demo_001",
      displayName: "阿宁",
      email: "aning@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_member_001",
      displayName: "周叙",
      email: "zhouxu@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_personal_001",
      displayName: "独立创作者",
      email: "creator@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "ops_demo_001",
      displayName: "运营管理员",
      email: "ops@xiaolou.demo",
      platformRole: "ops_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "root_demo_001",
      displayName: "超级管理员",
      email: "root@xiaolou.demo",
      platformRole: "super_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultOrganizations = function buildDefaultOrganizations(timestamp) {
  return [
    {
      id: "org_demo_001",
      name: "小楼影像工作室",
      status: "active",
      assetLibraryStatus: "approved",
      defaultBillingPolicy: "organization_only",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultMemberships = function buildDefaultMemberships(timestamp) {
  return [
    {
      id: "membership_demo_admin",
      organizationId: "org_demo_001",
      userId: "user_demo_001",
      role: "admin",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "membership_demo_member",
      organizationId: "org_demo_001",
      userId: "user_member_001",
      role: "member",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultPricingRules = function buildDefaultPricingRules(timestamp) {
  return [
    {
      id: "price_script_rewrite",
      actionCode: "script_rewrite",
      label: "剧本改写",
      baseCredits: 8,
      unitLabel: "次",
      description: "按次计费的脚本润色与改写。",
      updatedAt: timestamp,
    },
    {
      id: "price_asset_extract",
      actionCode: "asset_extract",
      label: "资产提取",
      baseCredits: 12,
      unitLabel: "次",
      description: "从剧本中抽取角色、场景和道具。",
      updatedAt: timestamp,
    },
    {
      id: "price_asset_image_generate",
      actionCode: "asset_image_generate",
      label: "资产出图",
      baseCredits: 18,
      unitLabel: "张",
      description: "单个资产设定图生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_storyboard_auto_generate",
      actionCode: "storyboard_auto_generate",
      label: "自动拆分分镜",
      baseCredits: 14,
      unitLabel: "次",
      description: "整段剧本的分镜拆分预估。",
      updatedAt: timestamp,
    },
    {
      id: "price_storyboard_image_generate",
      actionCode: "storyboard_image_generate",
      label: "分镜出图",
      baseCredits: 12,
      unitLabel: "张",
      description: "单镜头分镜图生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_video_generate",
      actionCode: "video_generate",
      label: "视频生成",
      baseCredits: 80,
      unitLabel: "镜头",
      description: "按镜头计费的视频生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_dubbing_generate",
      actionCode: "dubbing_generate",
      label: "配音生成",
      baseCredits: 10,
      unitLabel: "条",
      description: "单条台词配音生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_lipsync_generate",
      actionCode: "lipsync_generate",
      label: "对口型",
      baseCredits: 28,
      unitLabel: "条",
      description: "单条镜头口型同步。",
      updatedAt: timestamp,
    },
    {
      id: "price_project_export",
      actionCode: "project_export",
      label: "成片导出",
      baseCredits: 16,
      unitLabel: "次",
      description: "项目导出与成片合成。",
      updatedAt: timestamp,
    },
    {
      id: "price_character_replace",
      actionCode: "character_replace",
      label: "人物替换",
      baseCredits: 26,
      unitLabel: "次",
      description: "工具箱人物替换能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_motion_transfer",
      actionCode: "motion_transfer",
      label: "动作迁移",
      baseCredits: 46,
      unitLabel: "次",
      description: "工具箱动作迁移能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_upscale_restore",
      actionCode: "upscale_restore",
      label: "超清修复",
      baseCredits: 14,
      unitLabel: "次",
      description: "工具箱超清修复能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_create_image_generate",
      actionCode: "create_image_generate",
      label: "独立出图",
      baseCredits: 18,
      unitLabel: "张",
      description: "创作中心单次图像生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_create_video_generate",
      actionCode: "create_video_generate",
      label: "独立视频生成",
      baseCredits: 88,
      unitLabel: "次",
      description: "创作中心单次视频生成。",
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.mapTaskTypeToActionCode = function mapTaskTypeToActionCode(type) {
  const mapping = {
    script_rewrite: "script_rewrite",
    asset_extract: "asset_extract",
    asset_image_generate: "asset_image_generate",
    storyboard_auto_generate: "storyboard_auto_generate",
    storyboard_image_generate: "storyboard_image_generate",
    video_generate: "video_generate",
    dubbing_generate: "dubbing_generate",
    lipsync_generate: "lipsync_generate",
    project_export: "project_export",
    character_replace: "character_replace",
    motion_transfer: "motion_transfer",
    upscale_restore: "upscale_restore",
    create_image_generate: "create_image_generate",
    create_video_generate: "create_video_generate",
  };
  return mapping[type] || type || "generic_task";
};

MockStore.prototype.resolveActorId = function resolveActorId(actorId) {
  if (typeof actorId === "string" && actorId.trim()) {
    return actorId.trim();
  }
  return this.state.defaultActorId || "user_demo_001";
};

MockStore.prototype.getUser = function getUser(userId) {
  return (this.state.users || []).find((item) => item.id === userId) || null;
};

MockStore.prototype.resolveActor = function resolveActor(actorId) {
  const resolvedActorId = this.resolveActorId(actorId);
  if (resolvedActorId === "guest") {
    return {
      id: "guest",
      displayName: "游客",
      platformRole: "guest",
      status: "active",
      defaultOrganizationId: null,
    };
  }

  return (
    this.getUser(resolvedActorId) || {
      id: resolvedActorId,
      displayName: "游客",
      platformRole: "guest",
      status: "active",
      defaultOrganizationId: null,
    }
  );
};

MockStore.prototype.getOrganizationById = function getOrganizationById(organizationId) {
  return (this.state.organizations || []).find((item) => item.id === organizationId) || null;
};

MockStore.prototype.listMembershipsForUser = function listMembershipsForUser(userId) {
  return (this.state.organizationMemberships || []).filter(
    (item) => item.userId === userId && item.status !== "disabled"
  );
};

MockStore.prototype.getMembership = function getMembership(userId, organizationId) {
  return (
    (this.state.organizationMemberships || []).find(
      (item) =>
        item.userId === userId &&
        item.organizationId === organizationId &&
        item.status !== "disabled"
    ) || null
  );
};

MockStore.prototype.getWalletById = function getWalletById(walletId) {
  return (this.state.wallets || []).find((item) => item.id === walletId) || null;
};

MockStore.prototype.getWalletByOwner = function getWalletByOwner(ownerType, ownerId) {
  return (
    (this.state.wallets || []).find(
      (item) => item.ownerType === ownerType && item.ownerId === ownerId
    ) || null
  );
};

MockStore.prototype.toPublicWallet = function toPublicWallet(wallet) {
  if (!wallet) return null;
  return clone({
    id: wallet.id,
    ownerType: wallet.ownerType,
    walletOwnerType: wallet.ownerType,
    ownerId: wallet.ownerId,
    displayName: wallet.displayName,
    availableCredits: Number(wallet.availableCredits || 0),
    frozenCredits: Number(wallet.frozenCredits || 0),
    creditsAvailable: Number(wallet.availableCredits || 0),
    creditsFrozen: Number(wallet.frozenCredits || 0),
    currency: wallet.currency || "credits",
    status: wallet.status || "active",
    allowNegative: Boolean(wallet.allowNegative),
    updatedAt: wallet.updatedAt || new Date().toISOString(),
  });
};

MockStore.prototype.toPublicLedgerEntry = function toPublicLedgerEntry(entry) {
  if (!entry) return null;
  return clone({
    id: entry.id,
    walletId: entry.walletId,
    entryType: entry.entryType,
    amount: Number(entry.amount || 0),
    balanceAfter: Number(entry.balanceAfter || 0),
    frozenBalanceAfter: Number(entry.frozenBalanceAfter || 0),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    projectId: entry.projectId || null,
    orderId: entry.orderId || null,
    createdBy: entry.createdBy || null,
    metadata: entry.metadata || {},
    createdAt: entry.createdAt,
  });
};

MockStore.prototype.ensureIdentityAndBillingState = function ensureIdentityAndBillingState() {
  let changed = false;
  const timestamp =
    this.state.projects?.[0]?.updatedAt ||
    this.state.wallet?.updatedAt ||
    new Date().toISOString();

  if (!Array.isArray(this.state.users) || this.state.users.length === 0) {
    this.state.users = this.buildDefaultUsers(timestamp);
    changed = true;
  }

  if (!Array.isArray(this.state.organizations) || this.state.organizations.length === 0) {
    this.state.organizations = this.buildDefaultOrganizations(timestamp);
    changed = true;
  }

  if (
    !Array.isArray(this.state.organizationMemberships) ||
    this.state.organizationMemberships.length === 0
  ) {
    this.state.organizationMemberships = this.buildDefaultMemberships(timestamp);
    changed = true;
  }

  if (!Array.isArray(this.state.pricingRules) || this.state.pricingRules.length === 0) {
    this.state.pricingRules = this.buildDefaultPricingRules(timestamp);
    changed = true;
  }

  if (!Array.isArray(this.state.wallets) || this.state.wallets.length === 0) {
    const legacyWallet = this.state.wallet || {};
    const personalAvailable = Number(
      legacyWallet.creditsAvailable ?? legacyWallet.availableCredits ?? 5820
    );
    const personalFrozen = Number(
      legacyWallet.creditsFrozen ?? legacyWallet.frozenCredits ?? 320
    );
    this.state.wallets = [
      {
        id: "wallet_user_demo_001",
        ownerType: "user",
        ownerId: legacyWallet.ownerId || "user_demo_001",
        displayName: "个人钱包",
        availableCredits: personalAvailable,
        frozenCredits: personalFrozen,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: legacyWallet.updatedAt || timestamp,
      },
      {
        id: "wallet_org_demo_001",
        ownerType: "organization",
        ownerId: "org_demo_001",
        displayName: "企业钱包",
        availableCredits: 32000,
        frozenCredits: 640,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
      {
        id: "wallet_user_member_001",
        ownerType: "user",
        ownerId: "user_member_001",
        displayName: "成员个人钱包",
        availableCredits: 2400,
        frozenCredits: 0,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
      {
        id: "wallet_user_personal_001",
        ownerType: "user",
        ownerId: "user_personal_001",
        displayName: "个人钱包",
        availableCredits: 1600,
        frozenCredits: 0,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
    ];
    changed = true;
  } else {
    for (const wallet of this.state.wallets) {
      const nextWallet = {
        id:
          wallet.id ||
          `wallet_${wallet.ownerType || wallet.walletOwnerType || "user"}_${
            wallet.ownerId || randomUUID().slice(0, 8)
          }`,
        ownerType: wallet.ownerType || wallet.walletOwnerType || "user",
        ownerId: wallet.ownerId || "user_demo_001",
        displayName:
          wallet.displayName ||
          ((wallet.ownerType || wallet.walletOwnerType) === "organization"
            ? "企业钱包"
            : "个人钱包"),
        availableCredits: Number(wallet.availableCredits ?? wallet.creditsAvailable ?? 0),
        frozenCredits: Number(wallet.frozenCredits ?? wallet.creditsFrozen ?? 0),
        currency: wallet.currency || "credits",
        status: wallet.status || "active",
        allowNegative: Boolean(wallet.allowNegative),
        updatedAt: wallet.updatedAt || timestamp,
      };

      if (JSON.stringify(nextWallet) !== JSON.stringify(wallet)) {
        Object.assign(wallet, nextWallet);
        changed = true;
      }
    }
  }

  if (!Array.isArray(this.state.walletLedgerEntries)) {
    this.state.walletLedgerEntries = [];

    for (const wallet of this.state.wallets) {
      const totalCredits = Number(wallet.availableCredits || 0) + Number(wallet.frozenCredits || 0);
      if (totalCredits > 0) {
        this.state.walletLedgerEntries.push({
          id: `ledger_seed_${wallet.id}`,
          walletId: wallet.id,
          entryType: "grant",
          amount: totalCredits,
          balanceAfter: totalCredits,
          frozenBalanceAfter: 0,
          sourceType: "manual",
          sourceId: `seed_${wallet.id}`,
          projectId: null,
          orderId: null,
          createdBy: "root_demo_001",
          metadata: { seed: true },
          createdAt: wallet.updatedAt || timestamp,
        });
      }

      if (Number(wallet.frozenCredits || 0) > 0) {
        this.state.walletLedgerEntries.push({
          id: `ledger_seed_freeze_${wallet.id}`,
          walletId: wallet.id,
          entryType: "freeze",
          amount: -Number(wallet.frozenCredits || 0),
          balanceAfter: Number(wallet.availableCredits || 0),
          frozenBalanceAfter: Number(wallet.frozenCredits || 0),
          sourceType: "task",
          sourceId: `seed_task_${wallet.id}`,
          projectId: null,
          orderId: null,
          createdBy: "root_demo_001",
          metadata: { seed: true },
          createdAt: wallet.updatedAt || timestamp,
        });
      }
    }

    changed = true;
  }

  if (!Array.isArray(this.state.walletRechargeOrders)) {
    this.state.walletRechargeOrders = [];
    changed = true;
  }

  if (!this.state.defaultActorId) {
    this.state.defaultActorId = "user_demo_001";
    changed = true;
  }

  for (const project of this.state.projects || []) {
    const nextOwnerType = project.ownerType || (project.organizationId ? "organization" : "personal");
    const nextOwnerId =
      project.ownerId ||
      (project.organizationId ? project.organizationId : project.createdBy || "user_demo_001");
    const nextBillingWalletType =
      project.billingWalletType || (project.organizationId ? "organization" : "personal");
    const nextBillingPolicy =
      project.billingPolicy || (project.organizationId ? "organization_only" : "personal_only");
    const nextBudgetLimitCredits =
      Number(project.budgetLimitCredits ?? project.budgetCredits) ||
      (project.organizationId ? 1280 : 600);
    const nextBudgetUsedCredits = Math.max(
      0,
      Number(project.budgetUsedCredits ?? Math.min(360, nextBudgetLimitCredits))
    );
    const nextCreatedBy = project.createdBy || "user_demo_001";

    if (
      project.ownerType !== nextOwnerType ||
      project.ownerId !== nextOwnerId ||
      project.billingWalletType !== nextBillingWalletType ||
      project.billingPolicy !== nextBillingPolicy ||
      project.budgetLimitCredits !== nextBudgetLimitCredits ||
      project.budgetUsedCredits !== nextBudgetUsedCredits ||
      project.createdBy !== nextCreatedBy ||
      project.budgetCredits !== nextBudgetLimitCredits
    ) {
      Object.assign(project, {
        ownerType: nextOwnerType,
        ownerId: nextOwnerId,
        billingWalletType: nextBillingWalletType,
        billingPolicy: nextBillingPolicy,
        budgetLimitCredits: nextBudgetLimitCredits,
        budgetUsedCredits: nextBudgetUsedCredits,
        budgetCredits: nextBudgetLimitCredits,
        createdBy: nextCreatedBy,
      });
      changed = true;
    }
  }

  for (const task of this.state.tasks || []) {
    const nextActionCode = task.actionCode || this.mapTaskTypeToActionCode(task.type);
    const nextBillingStatus =
      task.billingStatus || (Number(task.quotedCredits || 0) > 0 ? "frozen" : "unbilled");

    if (
      task.actorId !== (task.actorId || "user_demo_001") ||
      task.actionCode !== nextActionCode ||
      task.quotedCredits == null ||
      task.frozenCredits == null ||
      task.settledCredits == null ||
      task.billingStatus !== nextBillingStatus
    ) {
      Object.assign(task, {
        actorId: task.actorId || "user_demo_001",
        actionCode: nextActionCode,
        walletId: task.walletId || null,
        quotedCredits: Number(task.quotedCredits || 0),
        frozenCredits: Number(task.frozenCredits || 0),
        settledCredits: Number(task.settledCredits || 0),
        billingStatus: nextBillingStatus,
      });
      changed = true;
    }
  }

  return changed;
};

MockStore.prototype.getVisibleWalletsForActor = function getVisibleWalletsForActor(actorId) {
  const actor = this.resolveActor(actorId);

  if (actor.platformRole === "super_admin") {
    return [...(this.state.wallets || [])];
  }

  if (actor.platformRole !== "customer") {
    return [];
  }

  const visibleWallets = [];
  const personalWallet = this.getWalletByOwner("user", actor.id);
  if (personalWallet) visibleWallets.push(personalWallet);

  for (const membership of this.listMembershipsForUser(actor.id)) {
    const organizationWallet = this.getWalletByOwner("organization", membership.organizationId);
    if (organizationWallet) {
      visibleWallets.push(organizationWallet);
    }
  }

  return visibleWallets;
};

MockStore.prototype.getPrimaryWalletForActor = function getPrimaryWalletForActor(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "customer" && actor.defaultOrganizationId) {
    const organizationWallet = this.getWalletByOwner("organization", actor.defaultOrganizationId);
    if (organizationWallet) return organizationWallet;
  }

  if (actor.platformRole === "customer") {
    return this.getWalletByOwner("user", actor.id) || null;
  }

  if (actor.platformRole === "super_admin") {
    return this.state.wallets?.[0] || null;
  }

  return null;
};

MockStore.prototype.syncLegacyWalletState = function syncLegacyWalletState() {
  const nextWallet = this.toPublicWallet(this.getPrimaryWalletForActor(this.state.defaultActorId));
  if (JSON.stringify(this.state.wallet || null) !== JSON.stringify(nextWallet)) {
    this.state.wallet = nextWallet;
    return true;
  }
  return false;
};

MockStore.prototype.getPermissionContext = function getPermissionContext(actorId) {
  const actor = this.resolveActor(actorId);
  const memberships = actor.platformRole === "customer" ? this.listMembershipsForUser(actor.id) : [];
  const organizations = memberships
    .map((membership) => {
      const organization = this.getOrganizationById(membership.organizationId);
      if (!organization) return null;
      return {
        id: organization.id,
        name: organization.name,
        role: membership.role === "admin" ? "enterprise_admin" : "enterprise_member",
        membershipRole: membership.role,
        status: organization.status,
      };
    })
    .filter(Boolean);
  const currentOrganization =
    organizations.find((item) => item.id === actor.defaultOrganizationId) || organizations[0] || null;

  return clone({
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      email: actor.email || null,
      platformRole: actor.platformRole,
      status: actor.status || "active",
      defaultOrganizationId: actor.defaultOrganizationId || null,
    },
    platformRole: actor.platformRole,
    organizations,
    currentOrganizationId: currentOrganization?.id || null,
    currentOrganizationRole: currentOrganization?.role || null,
    permissions: {
      canCreateProject: actor.platformRole === "customer",
      canRecharge: actor.platformRole === "customer",
      canUseEnterprise: organizations.length > 0,
      canManageOrganization: currentOrganization?.role === "enterprise_admin",
      canManageOps: actor.platformRole === "ops_admin" || actor.platformRole === "super_admin",
      canManageSystem: actor.platformRole === "super_admin",
    },
  });
};

MockStore.prototype.assertPlatformAdmin = function assertPlatformAdmin(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "ops_admin" || actor.platformRole === "super_admin") {
    return actor;
  }
  throw apiError(403, "FORBIDDEN", "This endpoint requires platform admin access.");
};

MockStore.prototype.assertOrganizationAccess = function assertOrganizationAccess(
  organizationId,
  actorId,
  options = {}
) {
  const actor = this.resolveActor(actorId);
  const organization = this.getOrganizationById(organizationId);
  if (!organization) {
    throw apiError(404, "NOT_FOUND", "organization not found");
  }

  if (actor.platformRole === "super_admin") {
    return { actor, organization, membership: null };
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this organization.");
  }

  const membership = this.getMembership(actor.id, organizationId);
  if (!membership) {
    throw apiError(403, "FORBIDDEN", "You do not belong to this organization.");
  }

  if (options.requireAdmin && membership.role !== "admin") {
    throw apiError(403, "FORBIDDEN", "Organization admin permission is required.");
  }

  return { actor, organization, membership };
};

MockStore.prototype.assertWalletAccess = function assertWalletAccess(walletId, actorId) {
  const wallet = this.getWalletById(walletId);
  if (!wallet) {
    throw apiError(404, "NOT_FOUND", "wallet not found");
  }

  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return wallet;
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this wallet.");
  }

  if (wallet.ownerType === "user" && wallet.ownerId === actor.id) {
    return wallet;
  }

  if (wallet.ownerType === "organization" && this.getMembership(actor.id, wallet.ownerId)) {
    return wallet;
  }

  throw apiError(403, "FORBIDDEN", "You do not have access to this wallet.");
};

MockStore.prototype.assertProjectAccess = function assertProjectAccess(projectId, actorId, options = {}) {
  const project = this.state.projects.find((item) => item.id === projectId);
  if (!project) {
    throw apiError(404, "NOT_FOUND", "project not found");
  }

  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return project;
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this project.");
  }

  if (project.ownerType === "organization") {
    const membership = this.getMembership(actor.id, project.organizationId || project.ownerId);
    if (!membership) {
      throw apiError(403, "FORBIDDEN", "You do not belong to the project organization.");
    }

    if (options.requireOrgAdmin && membership.role !== "admin") {
      throw apiError(403, "FORBIDDEN", "Organization admin permission is required.");
    }

    return project;
  }

  if (project.ownerId !== actor.id && project.createdBy !== actor.id) {
    throw apiError(403, "FORBIDDEN", "You do not own this project.");
  }

  return project;
};

MockStore.prototype.getPricingRule = function getPricingRule(actionCode) {
  return (this.state.pricingRules || []).find((item) => item.actionCode === actionCode) || null;
};

MockStore.prototype.estimateActionCredits = function estimateActionCredits(actionCode, input = {}) {
  const rule = this.getPricingRule(actionCode);
  if (!rule) {
    return { credits: 0, quantity: 1, rule: null };
  }

  let quantity = 1;
  let credits = Number(rule.baseCredits || 0);

  if (
    actionCode === "asset_image_generate" ||
    actionCode === "storyboard_image_generate" ||
    actionCode === "create_image_generate"
  ) {
    quantity = Math.max(1, Number(input.count || 1));
    credits = Number(rule.baseCredits || 0) * quantity;
  } else if (actionCode === "video_generate") {
    quantity = Math.max(1, Number(input.shotCount || 1));
    credits = Number(rule.baseCredits || 0) * quantity;
  } else if (actionCode === "dubbing_generate") {
    const textLength = String(input.text || "").trim().length;
    quantity = Math.max(1, Math.ceil((textLength || 1) / 90));
    credits = Number(rule.baseCredits || 0) + Math.max(0, quantity - 1) * 3;
  } else if (actionCode === "storyboard_auto_generate") {
    const textLength = String(input.sourceText || "").trim().length;
    quantity = Math.max(1, Math.ceil((textLength || 1) / 500));
    credits = Number(rule.baseCredits || 0) + Math.max(0, quantity - 1) * 2;
  }

  return {
    credits: Math.max(0, Math.round(credits)),
    quantity,
    rule,
  };
};

MockStore.prototype.resolveBillingWalletForProject = function resolveBillingWalletForProject(
  project,
  actorId,
  credits = 0
) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole !== "customer") {
    return null;
  }

  const personalWallet = this.getWalletByOwner("user", actor.id);
  if (!project) {
    return personalWallet;
  }

  if (project.ownerType !== "organization") {
    return personalWallet;
  }

  const organizationWallet = this.getWalletByOwner("organization", project.organizationId || project.ownerId);
  const policy =
    project.billingPolicy ||
    (project.billingWalletType === "organization" ? "organization_only" : "personal_only");

  if (policy === "personal_only") {
    return personalWallet;
  }

  if (policy === "organization_first_fallback_personal") {
    if (organizationWallet && Number(organizationWallet.availableCredits || 0) >= Number(credits || 0)) {
      return organizationWallet;
    }
    return personalWallet || organizationWallet;
  }

  return organizationWallet;
};

MockStore.prototype.buildCreditQuote = function buildCreditQuote({
  projectId = null,
  actionCode,
  input = {},
  actorId,
}) {
  const actor = this.resolveActor(actorId);
  const project = projectId ? this.assertProjectAccess(projectId, actor.id) : null;
  const { credits, quantity, rule } = this.estimateActionCredits(actionCode, input);
  const wallet = this.resolveBillingWalletForProject(project, actor.id, credits);
  const budgetLimitCredits = project ? Number(project.budgetLimitCredits || 0) : null;
  const budgetUsedCredits = project ? Number(project.budgetUsedCredits || 0) : 0;
  const budgetRemainingCredits =
    budgetLimitCredits != null ? Math.max(0, budgetLimitCredits - budgetUsedCredits) : null;

  let reason = null;
  if (!wallet && credits > 0) {
    reason = "No available wallet for this action.";
  } else if (
    project &&
    budgetLimitCredits != null &&
    budgetLimitCredits > 0 &&
    budgetUsedCredits + credits > budgetLimitCredits
  ) {
    reason = "Project budget limit would be exceeded.";
  } else if (wallet && Number(wallet.availableCredits || 0) < credits) {
    reason = "Insufficient credits.";
  }

  return clone({
    actionCode,
    label: rule?.label || actionCode,
    description: rule?.description || "",
    credits,
    quantity,
    currency: "credits",
    walletId: wallet?.id || null,
    walletName: wallet?.displayName || null,
    walletOwnerType: wallet?.ownerType || null,
    availableCredits: Number(wallet?.availableCredits || 0),
    frozenCredits: Number(wallet?.frozenCredits || 0),
    billingPolicy: project?.billingPolicy || "personal_only",
    projectId,
    projectOwnerType: project?.ownerType || null,
    budgetLimitCredits,
    budgetUsedCredits,
    budgetRemainingCredits,
    canAfford: !reason,
    reason,
  });
};

MockStore.prototype.getProjectCreditQuote = function getProjectCreditQuote(
  projectId,
  actionCode,
  input = {},
  actorId
) {
  return this.buildCreditQuote({ projectId, actionCode, input, actorId });
};

MockStore.prototype.calculateSettledCredits = function calculateSettledCredits(task) {
  const quotedCredits = Number(task?.quotedCredits || 0);
  if (quotedCredits <= 0) return 0;

  if (task?.actionCode === "storyboard_auto_generate") {
    return Math.max(quotedCredits - 2, 1);
  }

  if (task?.actionCode === "dubbing_generate") {
    return Math.max(quotedCredits - 1, 1);
  }

  return quotedCredits;
};

MockStore.prototype.recordWalletEntry = function recordWalletEntry({
  wallet,
  entryType,
  amount,
  sourceType,
  sourceId,
  projectId = null,
  orderId = null,
  createdBy = null,
  metadata = {},
}) {
  const entry = {
    id: `ledger_${randomUUID().slice(0, 10)}`,
    walletId: wallet.id,
    entryType,
    amount,
    balanceAfter: Number(wallet.availableCredits || 0),
    frozenBalanceAfter: Number(wallet.frozenCredits || 0),
    sourceType,
    sourceId,
    projectId,
    orderId,
    createdBy,
    metadata,
    createdAt: new Date().toISOString(),
  };

  this.state.walletLedgerEntries.unshift(entry);
  return entry;
};

MockStore.prototype.freezeWalletCredits = function freezeWalletCredits({
  walletId,
  credits,
  sourceType,
  sourceId,
  projectId = null,
  createdBy = null,
  metadata = {},
}) {
  const wallet = this.getWalletById(walletId);
  if (!wallet) {
    throw apiError(404, "NOT_FOUND", "wallet not found");
  }

  if (!wallet.allowNegative && Number(wallet.availableCredits || 0) < Number(credits || 0)) {
    throw apiError(409, "INSUFFICIENT_CREDITS", "Wallet balance is insufficient.");
  }

  wallet.availableCredits = Number(wallet.availableCredits || 0) - Number(credits || 0);
  wallet.frozenCredits = Number(wallet.frozenCredits || 0) + Number(credits || 0);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "freeze",
    amount: -Number(credits || 0),
    sourceType,
    sourceId,
    projectId,
    createdBy,
    metadata,
  });
};

MockStore.prototype.settleTaskBilling = function settleTaskBilling(taskId, actualCredits) {
  const task = this.state.tasks.find((item) => item.id === taskId);
  if (!task || !task.walletId || Number(task.frozenCredits || 0) <= 0) {
    return;
  }

  const wallet = this.getWalletById(task.walletId);
  if (!wallet) return;

  const quotedCredits = Number(task.frozenCredits || task.quotedCredits || 0);
  const settledCredits = Math.max(0, Number(actualCredits || 0));
  const refundCredits = Math.max(0, quotedCredits - settledCredits);
  const extraCredits = Math.max(0, settledCredits - quotedCredits);

  if (extraCredits > 0) {
    if (!wallet.allowNegative && Number(wallet.availableCredits || 0) < extraCredits) {
      throw apiError(409, "INSUFFICIENT_CREDITS", "Wallet balance is insufficient for settlement.");
    }
    wallet.availableCredits = Number(wallet.availableCredits || 0) - extraCredits;
  }

  wallet.frozenCredits = Math.max(0, Number(wallet.frozenCredits || 0) - quotedCredits);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "settle",
    amount: -settledCredits,
    sourceType: "task",
    sourceId: task.id,
    projectId: task.projectId || null,
    createdBy: task.actorId || null,
    metadata: {
      actionCode: task.actionCode,
      quotedCredits,
      settledCredits,
    },
  });

  if (refundCredits > 0) {
    wallet.availableCredits = Number(wallet.availableCredits || 0) + refundCredits;
    wallet.updatedAt = new Date().toISOString();
    this.recordWalletEntry({
      wallet,
      entryType: "refund",
      amount: refundCredits,
      sourceType: "task",
      sourceId: task.id,
      projectId: task.projectId || null,
      createdBy: task.actorId || null,
      metadata: {
        actionCode: task.actionCode,
        refundCredits,
      },
    });
  }

  task.settledCredits = settledCredits;
  task.frozenCredits = 0;
  task.billingStatus = refundCredits > 0 ? "settled_with_refund" : "settled";

  if (task.projectId) {
    const project = this.state.projects.find((item) => item.id === task.projectId);
    if (project) {
      project.budgetUsedCredits = Number(project.budgetUsedCredits || 0) + settledCredits;
      project.updatedAt = new Date().toISOString();
    }
  }
};

MockStore.prototype.refundTaskBilling = function refundTaskBilling(taskId, reason = "Task failed") {
  const task = this.state.tasks.find((item) => item.id === taskId);
  if (!task || !task.walletId || Number(task.frozenCredits || 0) <= 0) {
    return;
  }

  const wallet = this.getWalletById(task.walletId);
  if (!wallet) return;

  const refundCredits = Number(task.frozenCredits || 0);
  wallet.availableCredits = Number(wallet.availableCredits || 0) + refundCredits;
  wallet.frozenCredits = Math.max(0, Number(wallet.frozenCredits || 0) - refundCredits);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "refund",
    amount: refundCredits,
    sourceType: "task",
    sourceId: task.id,
    projectId: task.projectId || null,
    createdBy: task.actorId || null,
    metadata: {
      actionCode: task.actionCode,
      reason,
    },
  });

  task.settledCredits = 0;
  task.frozenCredits = 0;
  task.billingStatus = "refunded";
};

MockStore.prototype.listWallets = function listWallets(actorId) {
  return this.getVisibleWalletsForActor(actorId).map((wallet) => this.toPublicWallet(wallet));
};

MockStore.prototype.listWalletLedger = function listWalletLedger(walletId, actorId) {
  this.assertWalletAccess(walletId, actorId);
  return (this.state.walletLedgerEntries || [])
    .filter((item) => item.walletId === walletId)
    .map((entry) => this.toPublicLedgerEntry(entry));
};

MockStore.prototype.assertApiCenterAccess = function assertApiCenterAccess(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "guest") {
    throw apiError(403, "FORBIDDEN", "Please sign in before configuring API providers.");
  }
  return actor;
};

MockStore.prototype.requireApiCenterConfig = function requireApiCenterConfig() {
  if (!this.state.apiCenterConfig) {
    throw apiError(404, "NOT_FOUND", "API center configuration is not initialized.");
  }
  return this.state.apiCenterConfig;
};

MockStore.prototype.requireApiCenterVendor = function requireApiCenterVendor(vendorId) {
  const config = this.requireApiCenterConfig();
  const vendor = (config.vendors || []).find((item) => item.id === vendorId);
  if (!vendor) {
    throw apiError(404, "NOT_FOUND", "API provider not found.");
  }
  return vendor;
};

MockStore.prototype.requireApiCenterVendorModel = function requireApiCenterVendorModel(vendorId, modelId) {
  const vendor = this.requireApiCenterVendor(vendorId);
  const model = (vendor.models || []).find((item) => item.id === modelId);
  if (!model) {
    throw apiError(404, "NOT_FOUND", "Provider model not found.");
  }
  return { vendor, model };
};

MockStore.prototype.getApiCenterConfig = function getApiCenterConfig(actorId) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  syncApiCenterRuntimeVendorState(config);
  return clone(config);
};

MockStore.prototype.saveApiCenterVendorApiKey = function saveApiCenterVendorApiKey(
  vendorId,
  apiKey,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const vendor = this.requireApiCenterVendor(vendorId);

  if (!isApiCenterRuntimeProvider(vendor.id)) {
    throw apiError(422, "PROVIDER_NOT_SUPPORTED", "This provider is not wired to the runtime yet.");
  }

  const normalizedApiKey = String(apiKey || "").trim();
  if (normalizedApiKey) {
    setEnvValue("DASHSCOPE_API_KEY", normalizedApiKey);
  } else {
    unsetEnvValue("DASHSCOPE_API_KEY");
  }

  vendor.connected = false;
  vendor.apiKeyConfigured = Boolean(normalizedApiKey);
  vendor.lastCheckedAt = null;
  vendor.testedAt = null;
  syncApiCenterRuntimeVendorState(this.requireApiCenterConfig());

  return clone(vendor);
};

MockStore.prototype.testApiCenterVendorConnection = async function testApiCenterVendorConnection(
  vendorId,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const vendor = this.requireApiCenterVendor(vendorId);

  if (!isApiCenterRuntimeProvider(vendor.id)) {
    throw apiError(422, "PROVIDER_NOT_SUPPORTED", "This provider is not wired to the runtime yet.");
  }

  const result = await testAliyunConnection();
  const checkedAt = result?.checkedAt || new Date().toISOString();

  vendor.apiKeyConfigured = hasAliyunApiKey();
  vendor.connected = true;
  vendor.lastCheckedAt = checkedAt;
  vendor.testedAt = checkedAt;

  return clone({
    vendor,
    checkedAt,
    modelCount: Number(result?.modelCount || 0),
  });
};

MockStore.prototype.updateApiVendorModel = function updateApiVendorModel(
  vendorId,
  modelId,
  patch,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  const { model } = this.requireApiCenterVendorModel(vendorId, modelId);
  const nextEnabled =
    typeof patch?.enabled === "boolean" ? patch.enabled : Boolean(model.enabled);

  if (nextEnabled !== model.enabled && !nextEnabled && isApiCenterModelReferenced(config, model.id)) {
    throw apiError(
      409,
      "MODEL_IN_USE",
      "This model is still referenced by the current defaults or pipeline assignments."
    );
  }

  model.enabled = nextEnabled;
  return clone(model);
};

MockStore.prototype.updateApiCenterDefaults = function updateApiCenterDefaults(input, actorId) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  const nextDefaults = { ...(config.defaults || {}) };
  const enabledModels = (config.vendors || [])
    .flatMap((vendor) => vendor.models || [])
    .filter((model) => model?.enabled);
  const enabledModelIds = new Set(enabledModels.map((model) => model.id));
  let changed = false;

  for (const [key, assignmentCodes] of Object.entries(API_CENTER_MODEL_ASSIGNMENT_MAP)) {
    if (!(key in (input || {}))) {
      continue;
    }

    const requestedModelId = String(input[key] || "").trim();
    if (!requestedModelId) {
      throw apiError(400, "BAD_REQUEST", `${key} is required.`);
    }

    if (!enabledModelIds.has(requestedModelId)) {
      throw apiError(
        400,
        "MODEL_NOT_AVAILABLE",
        `${requestedModelId} is not enabled in the current provider pool.`
      );
    }

    const expectedDomain = API_CENTER_DEFAULT_DOMAIN_MAP[key] || null;
    const targetModel = enabledModels.find((model) => model.id === requestedModelId) || null;
    if (expectedDomain && targetModel?.domain !== expectedDomain) {
      throw apiError(
        400,
        "MODEL_DOMAIN_MISMATCH",
        `${requestedModelId} does not match the ${expectedDomain} slot.`
      );
    }

    if (nextDefaults[key] !== requestedModelId) {
      nextDefaults[key] = requestedModelId;
      changed = true;
    }

    if (assignmentCodes.length && applyPrimaryModelToAssignments(config, assignmentCodes, requestedModelId)) {
      changed = true;
    }
  }

  if (changed) {
    config.defaults = nextDefaults;
    this.normalizeState();
  }

  return clone(config.defaults);
};

MockStore.prototype.listPricingRules = function listPricingRules(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(this.state.pricingRules || []);
};

MockStore.prototype.listAdminOrders = function listAdminOrders(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(
    (this.state.walletRechargeOrders || []).map((order) => ({
      ...order,
      wallet: this.toPublicWallet(this.getWalletById(order.walletId)),
    }))
  );
};

MockStore.prototype.listOrganizationMembers = function listOrganizationMembers(organizationId, actorId) {
  this.assertOrganizationAccess(organizationId, actorId, { requireAdmin: true });
  return clone(
    (this.state.organizationMemberships || [])
      .filter((item) => item.organizationId === organizationId)
      .map((membership) => {
        const user = this.getUser(membership.userId);
        return {
          id: membership.id,
          organizationId: membership.organizationId,
          userId: membership.userId,
          displayName: user?.displayName || membership.userId,
          email: user?.email || null,
          platformRole: user?.platformRole || "customer",
          role: membership.role === "admin" ? "enterprise_admin" : "enterprise_member",
          membershipRole: membership.role,
          status: membership.status,
          createdAt: membership.createdAt,
          updatedAt: membership.updatedAt,
        };
      })
  );
};

MockStore.prototype.getOrganizationWallet = function getOrganizationWallet(organizationId, actorId) {
  this.assertOrganizationAccess(organizationId, actorId);
  return this.toPublicWallet(this.getWalletByOwner("organization", organizationId));
};

MockStore.prototype.getWalletRechargeOrder = function getWalletRechargeOrder(orderId, actorId) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  const actor = this.resolveActor(actorId || order.actorId);
  if (actor.platformRole !== "super_admin") {
    this.assertWalletAccess(order.walletId, actor.id);
  }

  return clone(order);
};

MockStore.prototype.listEnterpriseApplications = function listEnterpriseApplications(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(this.state.enterpriseApplications || []);
};

MockStore.prototype.getWallet = function getWallet(actorId) {
  return this.toPublicWallet(this.getPrimaryWalletForActor(actorId));
};

MockStore.prototype.createWalletRechargeOrder = function createWalletRechargeOrder(input, actorId) {
  const actor = this.resolveActor(actorId || input?.actorId);
  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "Only customer accounts can create recharge orders.");
  }

  const targetWallet =
    (input.walletId ? this.assertWalletAccess(input.walletId, actor.id) : null) ||
    this.getPrimaryWalletForActor(actor.id);
  if (!targetWallet) {
    throw apiError(404, "NOT_FOUND", "target wallet not found");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const order = {
    id: `recharge_${randomUUID().slice(0, 8)}`,
    planId: String(input.planId || "custom"),
    planName: String(input.planName || "Wallet Recharge"),
    billingCycle: String(input.billingCycle || "oneTime"),
    paymentMethod: String(input.paymentMethod || "wechat_pay"),
    amount: Number(input.amount || 0),
    credits: Number(input.credits || 0),
    currency: "CNY",
    status: "pending",
    actorId: actor.id,
    walletId: targetWallet.id,
    walletOwnerType: targetWallet.ownerType,
    walletOwnerId: targetWallet.ownerId,
    payerType: targetWallet.ownerType,
    qrCodePayload: `weixin://wxpay/bizpayurl/mock-${randomUUID().slice(0, 12)}`,
    qrCodeHint: "Use WeChat to scan and complete payment.",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  if (!Array.isArray(this.state.walletRechargeOrders)) {
    this.state.walletRechargeOrders = [];
  }

  this.state.walletRechargeOrders.unshift(order);
  return clone(order);
};

MockStore.prototype.confirmWalletRechargeOrder = function confirmWalletRechargeOrder(orderId, actorId) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  const actor = this.resolveActor(actorId || order.actorId);
  const wallet = this.assertWalletAccess(order.walletId, actor.id);

  if (order.status !== "paid") {
    order.status = "paid";
    order.updatedAt = new Date().toISOString();
    wallet.availableCredits = Number(wallet.availableCredits || 0) + Number(order.credits || 0);
    wallet.updatedAt = order.updatedAt;
    this.recordWalletEntry({
      wallet,
      entryType: "recharge",
      amount: Number(order.credits || 0),
      sourceType: "order",
      sourceId: order.id,
      orderId: order.id,
      createdBy: actor.id,
      metadata: {
        planId: order.planId,
        planName: order.planName,
        amount: order.amount,
        paymentMethod: order.paymentMethod,
      },
    });
    this.syncLegacyWalletState();

    this.emit("wallet_recharge_paid", {
      orderId: order.id,
      amount: order.amount,
      credits: order.credits,
      paymentMethod: order.paymentMethod,
      walletId: order.walletId,
    });
  }

  return clone(order);
};

MockStore.prototype.listTasks = function listTasks(projectId, actorId) {
  const actor = this.resolveActor(actorId);
  const items = (this.state.tasks || []).filter((task) => {
    if (projectId && task.projectId !== projectId) {
      return false;
    }

    if (actor.platformRole === "super_admin") {
      return true;
    }

    if (actor.platformRole !== "customer") {
      return !task.projectId && task.actorId === actor.id;
    }

    if (!task.projectId) {
      return task.actorId === actor.id;
    }

    try {
      this.assertProjectAccess(task.projectId, actor.id);
      return true;
    } catch {
      return false;
    }
  });
  return clone(items);
};

MockStore.prototype.getTask = function getTask(taskId, actorId) {
  const task = (this.state.tasks || []).find((item) => item.id === taskId);
  if (!task) return null;

  if (task.projectId) {
    this.assertProjectAccess(task.projectId, actorId);
  } else {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "super_admin" && task.actorId !== actor.id) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this task.");
    }
  }

  return clone(task);
};

MockStore.prototype.createTask = function createTask(params) {
  const actorId = this.resolveActorId(params.actorId || params.metadata?.actorId);
  const actor = this.resolveActor(actorId);

  if (
    actor.platformRole !== "customer" &&
    (params.projectId || params.storyboardId || params.domain === "create" || params.domain === "toolbox")
  ) {
    throw apiError(403, "FORBIDDEN", "Only customer accounts can launch content tasks.");
  }

  const projectId = params.projectId || this.findStoryboard(params.storyboardId)?.projectId || null;
  if (projectId) {
    this.assertProjectAccess(projectId, actor.id);
  }

  const actionCode = params.actionCode || this.mapTaskTypeToActionCode(params.type);
  const quoteInput = params.quoteInput || params.metadata || {};
  const creditQuote =
    actor.platformRole === "customer"
      ? this.buildCreditQuote({ projectId, actionCode, input: quoteInput, actorId: actor.id })
      : {
          credits: 0,
          walletId: null,
          canAfford: true,
        };

  if (Number(creditQuote.credits || 0) > 0 && !creditQuote.canAfford) {
    const code =
      typeof creditQuote.reason === "string" && creditQuote.reason.includes("budget")
        ? "PROJECT_BUDGET_EXCEEDED"
        : "INSUFFICIENT_CREDITS";
    throw apiError(409, code, creditQuote.reason || "Unable to freeze credits.");
  }

  const taskId = `task_${randomUUID().slice(0, 8)}`;

  if (Number(creditQuote.credits || 0) > 0) {
    this.freezeWalletCredits({
      walletId: creditQuote.walletId,
      credits: creditQuote.credits,
      sourceType: "task",
      sourceId: taskId,
      projectId,
      createdBy: actor.id,
      metadata: {
        actionCode,
        quote: creditQuote,
      },
    });
    this.syncLegacyWalletState();
  }

  const task = {
    id: taskId,
    type: params.type,
    domain: params.domain,
    projectId,
    storyboardId: params.storyboardId || null,
    actorId: actor.id,
    actionCode,
    walletId: creditQuote.walletId || null,
    status: "queued",
    progressPercent: 0,
    currentStage: "queued",
    etaSeconds: 90,
    inputSummary: params.inputSummary || null,
    outputSummary: null,
    quotedCredits: Number(creditQuote.credits || 0),
    frozenCredits: Number(creditQuote.credits || 0),
    settledCredits: 0,
    billingStatus: Number(creditQuote.credits || 0) > 0 ? "frozen" : "unbilled",
    metadata: {
      ...(params.metadata || {}),
      creditQuote,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  this.state.tasks.unshift(task);
  this.emit("task.created", task);
  this.scheduleTaskLifecycle(task.id, params.effect);
  return clone(task);
};

MockStore.prototype.scheduleTaskLifecycle = function scheduleTaskLifecycle(taskId, effect) {
  setTimeout(() => {
    this.updateTask(taskId, {
      status: "running",
      progressPercent: 35,
      currentStage: "processing",
      etaSeconds: 45,
    });
  }, 350);

  setTimeout(() => {
    this.updateTask(taskId, {
      status: "running",
      progressPercent: 72,
      currentStage: "rendering",
      etaSeconds: 18,
    });
  }, 900);

  setTimeout(async () => {
    try {
      let outputSummary = "mock result ready";

      if (typeof effect === "function") {
        const result = await effect(this.state);
        if (typeof result === "string" && result.trim()) {
          outputSummary = result.trim();
        }
      }

      const settledTask = this.state.tasks.find((item) => item.id === taskId);
      this.settleTaskBilling(taskId, this.calculateSettledCredits(settledTask));
      this.syncLegacyWalletState();

      const latestTask = this.state.tasks.find((item) => item.id === taskId);
      this.updateTask(taskId, {
        status: "succeeded",
        progressPercent: 100,
        currentStage: "completed",
        etaSeconds: 0,
        outputSummary,
        settledCredits: Number(latestTask?.settledCredits || 0),
        frozenCredits: Number(latestTask?.frozenCredits || 0),
        billingStatus: latestTask?.billingStatus || "settled",
      });
    } catch (error) {
      this.refundTaskBilling(taskId, error?.message || "provider call failed");
      this.syncLegacyWalletState();
      const latestTask = this.state.tasks.find((item) => item.id === taskId);
      this.updateTask(taskId, {
        status: "failed",
        progressPercent: 100,
        currentStage: "failed",
        etaSeconds: 0,
        outputSummary: error?.message || "provider call failed",
        settledCredits: Number(latestTask?.settledCredits || 0),
        frozenCredits: Number(latestTask?.frozenCredits || 0),
        billingStatus: latestTask?.billingStatus || "refunded",
      });
    }
  }, 1600);
};

MockStore.prototype.makeLipSyncTask = function makeLipSyncTask(storyboardId, input = {}) {
  const storyboard = this.findStoryboard(storyboardId);
  return this.createTask({
    type: "lipsync_generate",
    domain: "lipsync",
    projectId: storyboard?.projectId || null,
    storyboardId,
    inputSummary: "Generate lip sync",
    metadata: input,
    effect: () => {
      if (!storyboard) return;

      this.touchProject(storyboard.projectId, {
        currentStep: "dubbing",
        progressPercent: 88,
      });
    },
  });
};

module.exports = {
  MockStore
};
