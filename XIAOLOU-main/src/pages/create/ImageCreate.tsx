import {
  Clock3,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useState } from "react";
import {
  AssetSyncDialog,
  AssetSyncDropzone,
  type AssetSyncDraft,
} from "../../components/create/AssetSyncControls";
import {
  REFERENCE_ASSET_MIME,
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import { cn } from "../../lib/utils";
import {
  createAsset,
  generateCreateImages,
  listCreateImages,
  listTasks,
  uploadFile,
  type CreateImageResult,
  type Task,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

type ReferenceImageState = {
  id: string;
  url: string;
  originalName: string;
  source: "upload" | "asset";
  assetId?: string | null;
};

function resultImage(item: CreateImageResult) {
  return getGeneratedMediaUrl(item.imageUrl);
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function taskReference(task: Task) {
  const value = task.metadata?.referenceImageUrl;
  return typeof value === "string" ? value : null;
}

function summarizePrompt(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

function buildImageAssetDraft(item: CreateImageResult): AssetSyncDraft {
  const imageUrl = resultImage(item);

  return {
    id: item.id,
    mediaKind: "image",
    previewUrl: imageUrl,
    mediaUrl: imageUrl,
    prompt: item.prompt,
    model: item.model,
    aspectRatio: item.aspectRatio,
    taskId: item.taskId ?? null,
    referenceImageUrl: item.referenceImageUrl ?? null,
    defaultAssetType: "style",
    defaultName: summarizePrompt(item.prompt, `图片素材 ${formatTime(item.createdAt)}`),
    defaultDescription: [
      item.prompt,
      `来源：通用创作图片`,
      `模型：${item.model}`,
      `风格：${item.style}`,
      `比例：${item.aspectRatio}`,
      `清晰度：${item.resolution}`,
    ].join("\n"),
  };
}

const STYLE_OPTIONS = ["电影感", "赛博朋克", "古风写意", "写实摄影"];

export default function ImageCreate() {
  const [currentProjectId] = useCurrentProjectId();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState("Wan 2.6 T2I");
  const [style, setStyle] = useState("电影感");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2K");
  const [imageCount, setImageCount] = useState(1);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyModel, setHistoryModel] = useState("all");
  const [referenceImage, setReferenceImage] = useState<ReferenceImageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<CreateImageResult[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [previewItem, setPreviewItem] = useState<CreateImageResult | null>(null);
  const [draggingItem, setDraggingItem] = useState<AssetSyncDraft | null>(null);
  const [syncDraft, setSyncDraft] = useState<AssetSyncDraft | null>(null);
  const [syncingAsset, setSyncingAsset] = useState(false);
  const [syncDragActive, setSyncDragActive] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [referenceDropActive, setReferenceDropActive] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [imageResponse, taskResponse] = await Promise.all([listCreateImages(), listTasks()]);
      setResults(imageResponse.items);
      setTasks(taskResponse.items.filter((item) => item.type === "create_image_generate"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      const matchQuery =
        !historyQuery ||
        item.prompt.includes(historyQuery) ||
        item.style.includes(historyQuery) ||
        item.taskId?.includes(historyQuery);
      const matchModel = historyModel === "all" || item.model === historyModel;
      return matchQuery && matchModel;
    });
  }, [historyModel, historyQuery, results]);

  const modelOptions = useMemo(
    () => ["all", ...Array.from(new Set(results.map((item) => item.model)))],
    [results],
  );

  const recentTasks = useMemo(() => tasks.slice(0, 6), [tasks]);
  const hasActiveTasks = useMemo(
    () => tasks.some((item) => item.status === "queued" || item.status === "running"),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveTasks) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [hasActiveTasks]);

  useEffect(() => {
    if (!syncNotice) return;

    const timer = window.setTimeout(() => {
      setSyncNotice(null);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setGenerating(true);
    try {
      await generateCreateImages({
        prompt,
        negativePrompt,
        model,
        style,
        aspectRatio,
        resolution,
        count: imageCount,
        referenceImageUrl: referenceImage?.url,
      });
      await loadData();
    } finally {
      setGenerating(false);
    }
  };

  const handleReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const uploaded = await uploadFile(file, "create-image-reference");
      setReferenceImage({
        id: uploaded.id,
        url: uploaded.url,
        originalName: uploaded.originalName,
        source: "upload",
      });
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const applyReferenceAsset = (asset: ReferenceAssetSelection) => {
    setReferenceImage({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setReferenceDropActive(false);
  };

  const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setReferenceDropActive(true);
  };

  const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setReferenceDropActive(false);
  };

  const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) {
      setReferenceDropActive(false);
      return;
    }

    try {
      applyReferenceAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      setReferenceDropActive(false);
    }
  };

  const openAssetSync = (item: CreateImageResult) => {
    setSyncDraft(buildImageAssetDraft(item));
    setSyncDragActive(false);
    setDraggingItem(null);
  };

  const handleResultDragStart = (event: DragEvent<HTMLElement>, item: CreateImageResult) => {
    const draft = buildImageAssetDraft(item);
    setDraggingItem(draft);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draft.id);
  };

  const handleResultDragEnd = () => {
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSyncDragActive(true);
  };

  const handleSyncDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setSyncDragActive(false);
  };

  const handleSyncDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!draggingItem) return;
    setSyncDraft(draggingItem);
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncSubmit = async (input: Parameters<typeof createAsset>[1]) => {
    setSyncingAsset(true);
    try {
      const asset = await createAsset(currentProjectId, input);
      setSyncNotice(`已同步到资产库：${asset.name}`);
      setSyncDraft(null);
    } finally {
      setSyncingAsset(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-background">
      <aside className="flex w-80 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <Settings2 className="h-4 w-4 text-primary" />
            生成参数
          </h2>
        </div>

        <div className="space-y-6 overflow-y-auto p-4 custom-scrollbar">
          <div
            className={cn(
              "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
              referenceDropActive ? "border-primary/50 bg-primary/5" : "",
            )}
            onDragOver={handleReferenceDragOver}
            onDragLeave={handleReferenceDragLeave}
            onDrop={handleReferenceDrop}
          >
            <label className="text-sm font-medium">参考图</label>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                referenceDropActive ? "border-primary bg-primary/10 text-primary" : "",
              )}
            >
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              上传参考图
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleReferenceUpload(event)}
              />
            </label>
            {referenceImage ? (
              <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                <img
                  src={referenceImage.url}
                  alt={referenceImage.originalName}
                  className="aspect-video w-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{referenceImage.originalName}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                    {referenceImage.source === "asset" ? "资产库" : "本地上传"}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-muted-foreground">
              你可以上传本地参考图，也可以直接从下方资产库挑选素材作为参考。
            </p>
            <p className="text-[11px] leading-5 text-primary/80">
              支持点击缩略图快速引用，也支持把素材卡拖到这个区域。
            </p>
          </div>

          <ReferenceAssetPicker
            projectId={currentProjectId}
            selectedAssetId={referenceImage?.source === "asset" ? referenceImage.assetId || null : null}
            onSelect={applyReferenceAsset}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">模型</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option>Wan 2.6 T2I</option>
              <option>WanX 2.1 Image Edit</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">负面提示词</label>
            <textarea
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              rows={3}
              placeholder="例如：模糊、低质量、畸形手部、重复主体"
              className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">风格</label>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {STYLE_OPTIONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">画幅比例</label>
            <div className="grid grid-cols-3 gap-2">
              {["16:9", "1:1", "9:16"].map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={cn(
                    "rounded-md border py-2 text-xs font-medium transition-colors",
                    aspectRatio === ratio
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">清晰度</label>
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option>1K</option>
              <option>2K</option>
              <option>4K</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">生成张数</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="4"
                value={imageCount}
                onChange={(event) => setImageCount(Number(event.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-4 text-right text-sm font-medium">{imageCount}</span>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-16 shrink-0 items-center border-b border-border bg-card/30 px-6">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <ImageIcon className="h-5 w-5 text-primary" />
              图片创作
            </h1>
            <p className="text-xs text-muted-foreground">
              独立创作结果只做临时输出，可预览、下载，也可以同步到资产库。
            </p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6 custom-scrollbar">
          <div className="glass-panel flex flex-col gap-4 rounded-2xl p-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-24 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="输入一段话，描述你想生成的画面"
            />

            <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
              <button
                onClick={() => {
                  setPrompt("");
                  setNegativePrompt("");
                }}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
                清空
              </button>
              {referenceImage ? (
                <button
                  onClick={() => setReferenceImage(null)}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除参考图
                </button>
              ) : null}
              <button
                onClick={() => void handleGenerate()}
                disabled={generating || !prompt.trim()}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始生成
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h3 className="text-sm font-medium">生成结果</h3>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="搜索提示词、风格或任务 ID"
                  className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <select
                value={historyModel}
                onChange={(event) => setHistoryModel(event.target.value)}
                className="rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {modelOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "全部模型" : item}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadData()}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredResults.map((item) => {
                const imageUrl = resultImage(item);

                return (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={(event) => handleResultDragStart(event, item)}
                    onDragEnd={handleResultDragEnd}
                    className={cn(
                      "glass-panel group overflow-hidden rounded-xl transition-transform",
                      draggingItem?.id === item.id ? "scale-[0.98] opacity-70" : "",
                    )}
                  >
                    <button
                      onClick={() => setPreviewItem(item)}
                      className="block aspect-video w-full overflow-hidden bg-muted text-left"
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={item.prompt}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <GeneratedMediaPlaceholder
                          kind="image"
                          className="h-full w-full"
                          description="图片生成完成后会在这里显示"
                        />
                      )}
                    </button>

                    <div className="space-y-3 p-3">
                      <p className="line-clamp-2 text-sm text-foreground">{item.prompt}</p>
                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>{item.model}</span>
                        <span>{item.resolution}</span>
                        {item.taskId ? <span>{item.taskId}</span> : null}
                      </div>

                      {item.referenceImageUrl ? (
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
                          <img
                            src={item.referenceImageUrl}
                            alt="reference"
                            className="h-10 w-10 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <span className="text-xs text-muted-foreground">带参考图生成</span>
                        </div>
                      ) : null}

                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(item.createdAt)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openAssetSync(item)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            同步资产
                          </button>
                          <button
                            onClick={() => setPreviewItem(item)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            预览
                          </button>
                          {imageUrl ? (
                            <a
                              href={imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="glass-panel rounded-2xl p-4">
              <AssetSyncDropzone
                dragActive={syncDragActive}
                syncing={syncingAsset}
                notice={syncNotice}
                onDragOver={handleSyncDragOver}
                onDragLeave={handleSyncDragLeave}
                onDrop={handleSyncDrop}
              />
              <div className="mb-4 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">最近任务</h3>
              </div>
              <div className="space-y-3">
                {recentTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium">{task.id}</span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                        {task.status}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {task.inputSummary || "暂无任务描述"}
                    </p>
                    {taskReference(task) ? (
                      <div className="mt-2 flex items-center gap-2">
                        <img
                          src={taskReference(task) || undefined}
                          alt="reference"
                          className="h-8 w-8 rounded object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <span className="text-[11px] text-muted-foreground">已关联参考图</span>
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {formatTime(task.createdAt)}
                    </div>
                  </div>
                ))}
                {!recentTasks.length ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    还没有生成任务
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {previewItem ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">结果预览</h3>
                <p className="text-xs text-muted-foreground">{previewItem.taskId || previewItem.id}</p>
              </div>
              <button
                onClick={() => setPreviewItem(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {resultImage(previewItem) ? (
                  <img
                    src={resultImage(previewItem) || undefined}
                    alt={previewItem.prompt}
                    className="h-full w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="image"
                    className="h-full min-h-[360px] w-full bg-black text-zinc-300"
                    description="当前结果还没有生成真实图片"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">提示词</div>
                  <p className="text-sm leading-6">{previewItem.prompt}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">模型</div>
                    <div className="mt-1 font-medium">{previewItem.model}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">清晰度</div>
                    <div className="mt-1 font-medium">{previewItem.resolution}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">比例</div>
                    <div className="mt-1 font-medium">{previewItem.aspectRatio}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">风格</div>
                    <div className="mt-1 font-medium">{previewItem.style}</div>
                  </div>
                </div>
                {previewItem.referenceImageUrl ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">参考图</div>
                    <img
                      src={previewItem.referenceImageUrl}
                      alt="reference"
                      className="w-full rounded-lg border border-border object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : null}
                {resultImage(previewItem) ? (
                  <a
                    href={resultImage(previewItem) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" />
                    打开并下载
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AssetSyncDialog
        item={syncDraft}
        submitting={syncingAsset}
        onClose={() => setSyncDraft(null)}
        onSubmit={handleSyncSubmit}
      />
    </div>
  );
}
