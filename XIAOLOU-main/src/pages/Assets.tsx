import {
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Map,
  Package,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../components/media/GenerationPlaceholder";
import { cn } from "../lib/utils";
import {
  createAsset,
  deleteAsset,
  getProjectOverview,
  listAssets,
  updateAsset,
  type Asset,
} from "../lib/api";
import { useCurrentProjectId } from "../lib/session";

const CATEGORY_CONFIG = [
  { id: "all", label: "全部", icon: FolderOpen },
  { id: "character", label: "角色", icon: Users },
  { id: "scene", label: "场景", icon: Map },
  { id: "prop", label: "道具", icon: Package },
  { id: "style", label: "风格", icon: ImageIcon },
  { id: "video_ref", label: "视频素材", icon: Video },
] as const;

type AssetFormState = {
  mode: "create" | "edit";
  assetId: string | null;
  assetType: string;
  name: string;
  description: string;
};

function assetPreviewUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.previewUrl);
}

function assetMediaUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.mediaUrl) || getGeneratedMediaUrl(asset.previewUrl) || null;
}

function isVideoAsset(asset: Asset) {
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

function canPreviewAssetVideo(asset: Asset) {
  return isVideoAsset(asset) && Boolean(getGeneratedMediaUrl(asset.mediaUrl));
}

function assetTypeLabel(assetType: string) {
  const match = CATEGORY_CONFIG.find((item) => item.id === assetType);
  return match?.label || assetType;
}

export default function Assets() {
  const [currentProjectId] = useCurrentProjectId();
  const [projectTitle, setProjectTitle] = useState("当前项目");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AssetFormState | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const [overview, assetResponse] = await Promise.all([
        getProjectOverview(currentProjectId),
        listAssets(currentProjectId),
      ]);
      setProjectTitle(overview.project.title);
      setAssets(assetResponse.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssets();
  }, [currentProjectId]);

  const counts = useMemo(() => {
    const next = Object.fromEntries(CATEGORY_CONFIG.map((item) => [item.id, 0])) as Record<
      string,
      number
    >;
    next.all = assets.length;

    for (const asset of assets) {
      if (asset.assetType in next) {
        next[asset.assetType] += 1;
      }
    }

    return next;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchCategory = activeCategory === "all" || asset.assetType === activeCategory;
      const matchQuery =
        !query ||
        asset.name.includes(query) ||
        asset.description.includes(query) ||
        asset.assetType.includes(query);

      return matchCategory && matchQuery;
    });
  }, [activeCategory, assets, query]);

  const openCreate = () => {
    setFormState({
      mode: "create",
      assetId: null,
      assetType: activeCategory === "all" ? "character" : activeCategory,
      name: "",
      description: "",
    });
  };

  const openEdit = (asset: Asset) => {
    setFormState({
      mode: "edit",
      assetId: asset.id,
      assetType: asset.assetType,
      name: asset.name,
      description: asset.description,
    });
  };

  const closeForm = () => {
    setFormState(null);
  };

  const handleSubmit = async () => {
    if (!formState || !formState.name.trim()) return;

    setSubmitting(true);
    try {
      if (formState.mode === "create") {
        await createAsset(currentProjectId, {
          assetType: formState.assetType,
          name: formState.name.trim(),
          description: formState.description.trim(),
        });
      } else if (formState.assetId) {
        await updateAsset(currentProjectId, formState.assetId, {
          assetType: formState.assetType,
          name: formState.name.trim(),
          description: formState.description.trim(),
        });
      }

      closeForm();
      await loadAssets();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (assetId: string) => {
    setDeletingId(assetId);
    try {
      await deleteAsset(currentProjectId, assetId);
      await loadAssets();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full w-full bg-background">
      <aside className="flex w-72 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4 text-primary" />
            资产库
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">当前项目：{projectTitle}</p>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-3 custom-scrollbar">
          {CATEGORY_CONFIG.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveCategory(item.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                activeCategory === item.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-3">
                <item.icon className="h-4 w-4" />
                {item.label}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  activeCategory === item.id ? "bg-primary/20" : "bg-secondary",
                )}
              >
                {counts[item.id] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资产名称或描述"
              className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex items-center gap-3">
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
            <button
              onClick={() => void loadAssets()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              刷新
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              新增资产
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
            {filteredAssets.map((asset) => {
              const pendingDelete = deletingId === asset.id;
              const previewUrl = assetPreviewUrl(asset);

              return (
                <article
                  key={asset.id}
                  className="glass-panel group flex flex-col overflow-hidden rounded-xl"
                >
                  <div className="relative aspect-square bg-muted">
                    <button
                      onClick={() => setPreviewAsset(asset)}
                      className="absolute inset-0 block h-full w-full overflow-hidden text-left"
                    >
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={asset.name}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <GeneratedMediaPlaceholder
                          kind={isVideoAsset(asset) ? "video" : "image"}
                          className="h-full w-full"
                          description="生成后会在这里显示预览"
                        />
                      )}
                    </button>

                    {isVideoAsset(asset) ? (
                      <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                        视频素材
                      </div>
                    ) : null}

                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => setPreviewAsset(asset)}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                        title="预览"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(asset)}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void handleDelete(asset.id)}
                        disabled={pendingDelete}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                        title="删除"
                      >
                        {pendingDelete ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-medium">{asset.name}</h3>
                      <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                        {assetTypeLabel(asset.assetType)}
                      </span>
                    </div>
                    <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
                      {asset.description || "暂无描述"}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          {!loading && filteredAssets.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
              <FolderOpen className="mb-4 h-12 w-12 opacity-20" />
              <p>当前分类下还没有资产</p>
            </div>
          ) : null}
        </div>
      </section>

      {formState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <h3 className="mb-6 text-lg font-semibold">
              {formState.mode === "create" ? "新增资产" : "编辑资产"}
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">资产类型</label>
                <select
                  value={formState.assetType}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, assetType: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {CATEGORY_CONFIG.filter((item) => item.id !== "all").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">资产名称</label>
                <input
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <textarea
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, description: event.target.value } : current,
                    )
                  }
                  className="h-28 w-full resize-none rounded-lg border border-border bg-input px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeForm}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting || !formState.name.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "提交中..." : formState.mode === "create" ? "创建资产" : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewAsset ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">{previewAsset.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {isVideoAsset(previewAsset) ? "视频素材预览" : "图片资产预览"}
                </p>
              </div>
              <button
                onClick={() => setPreviewAsset(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {canPreviewAssetVideo(previewAsset) ? (
                  <video
                    src={assetMediaUrl(previewAsset) || undefined}
                    poster={assetPreviewUrl(previewAsset) || undefined}
                    controls
                    className="h-full min-h-[320px] w-full object-contain"
                  />
                ) : assetPreviewUrl(previewAsset) ? (
                  <img
                    src={assetPreviewUrl(previewAsset) || undefined}
                    alt={previewAsset.name}
                    className="h-full min-h-[320px] w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind={isVideoAsset(previewAsset) ? "video" : "image"}
                    className="h-full min-h-[320px] w-full bg-black text-zinc-300"
                    description="当前资产还没有可预览的真实媒体"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">资产类型</div>
                  <div className="mt-1 font-medium">{assetTypeLabel(previewAsset.assetType)}</div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">描述</div>
                  <div className="mt-1 text-sm leading-6">
                    {previewAsset.description || "暂无描述"}
                  </div>
                </div>
                {assetMediaUrl(previewAsset) ? (
                  <a
                    href={assetMediaUrl(previewAsset) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    打开原始文件
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
