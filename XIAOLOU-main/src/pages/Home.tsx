import {
  ArrowRight,
  Building2,
  Film,
  FolderOpen,
  LayoutTemplate,
  LoaderCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActorId } from "../lib/actor-session";
import {
  createProject,
  getMe,
  getToolboxCapabilities,
  listProjects,
  listWallets,
  mapStepToComicPath,
  runToolboxCapability,
  type PermissionContext,
  type Project,
  type ToolboxCapability,
  type Wallet as WalletInfo,
} from "../lib/api";
import { setCurrentProjectId, useCurrentProjectId } from "../lib/session";
import { cn } from "../lib/utils";

const STEP_LABELS: Record<string, string> = {
  global: "全局设定",
  script: "故事剧本",
  assets: "角色场景",
  storyboards: "分镜脚本",
  videos: "分镜视频",
  dubbing: "配音与口型",
  preview: "成片预览",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  in_production: "制作中",
  published: "已发布",
};

type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
};

function projectCover(project: Project) {
  if (project.coverUrl && !project.coverUrl.includes("mock.assets.local")) {
    return project.coverUrl;
  }

  return `https://picsum.photos/seed/${project.id}/960/540`;
}

function formatProjectStep(step: string) {
  return STEP_LABELS[step] || step || "未开始";
}

function formatProjectStatus(status: string) {
  return STATUS_LABELS[status] || status || "未知状态";
}

function formatDateTime(value: string) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("zh-CN");
}

function formatRole(me: PermissionContext | null) {
  if (!me) return "--";
  if (me.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (me.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (me.platformRole === "ops_admin") return "运营管理员";
  if (me.platformRole === "super_admin") return "超级管理员";
  if (me.platformRole === "customer") return "注册用户";
  return "游客";
}

function walletOwnerLabel(wallet: WalletInfo) {
  return wallet.ownerType === "organization" ? "企业钱包" : "个人钱包";
}

function toolStatusLabel(status: string) {
  if (status === "mock_ready") return "已接入";
  if (status === "placeholder") return "待接入";
  return status;
}

function projectStatusTone(status: string) {
  if (status === "published") return "bg-emerald-500/15 text-emerald-300";
  if (status === "draft") return "bg-amber-500/15 text-amber-200";
  return "bg-sky-500/15 text-sky-200";
}

export default function Home() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [tools, setTools] = useState<ToolboxCapability[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [pendingCreate, setPendingCreate] = useState<"personal" | "enterprise" | null>(null);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [dashboardNotice, setDashboardNotice] = useState<string | null>(null);

  const readyToolCount = useMemo(
    () => tools.filter((item) => item.status !== "placeholder").length,
    [tools],
  );

  const orderedProjects = useMemo(() => {
    const nextProjects = [...projects].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    const activeIndex = nextProjects.findIndex((item) => item.id === currentProjectId);

    if (activeIndex > 0) {
      const [activeProjectItem] = nextProjects.splice(activeIndex, 1);
      nextProjects.unshift(activeProjectItem);
    }

    return nextProjects;
  }, [currentProjectId, projects]);

  const activeProject =
    orderedProjects.find((item) => item.id === currentProjectId) ??
    orderedProjects[0] ??
    null;

  const currentOrganization = useMemo(
    () => me?.organizations.find((item) => item.id === me.currentOrganizationId) ?? null,
    [me],
  );

  const primaryWallet = useMemo(() => {
    if (!wallets.length) return null;
    if (currentOrganization) {
      return wallets.find((item) => item.ownerType === "organization") ?? wallets[0];
    }
    return wallets[0];
  }, [currentOrganization, wallets]);

  const dashboardMetrics = useMemo<DashboardMetric[]>(
    () => [
      {
        label: "项目总数",
        value: String(projects.length),
        detail: activeProject ? `当前聚焦：${activeProject.title}` : "当前身份还没有可见项目",
        icon: FolderOpen,
      },
      {
        label: "可见钱包",
        value: String(wallets.length),
        detail: primaryWallet ? `${primaryWallet.displayName || "默认钱包"} 在线` : "当前没有可用钱包",
        icon: Wallet,
      },
      {
        label: "工具就绪",
        value: `${readyToolCount}/${tools.length}`,
        detail: readyToolCount ? "可以直接发起工具任务" : "正在等待能力接入",
        icon: LayoutTemplate,
      },
      {
        label: "当前进度",
        value: activeProject ? `${activeProject.progressPercent}%` : "--",
        detail: activeProject ? formatProjectStep(activeProject.currentStep) : "暂无活跃项目",
        icon: MonitorPlay,
      },
    ],
    [activeProject, primaryWallet, projects.length, readyToolCount, tools.length, wallets.length],
  );

  const loadDashboard = async () => {
    setRefreshing(true);
    setDashboardNotice(null);

    const [meResult, projectsResult, walletsResult, toolsResult] = await Promise.allSettled([
      getMe(),
      listProjects(),
      listWallets(),
      getToolboxCapabilities(),
    ]);

    const notices: string[] = [];

    if (meResult.status === "fulfilled") {
      setMe(meResult.value);
    } else {
      setMe(null);
      notices.push("账户上下文加载失败");
    }

    if (projectsResult.status === "fulfilled") {
      setProjects(projectsResult.value.items);
    } else {
      setProjects([]);
      notices.push("项目列表暂时不可用");
    }

    if (walletsResult.status === "fulfilled") {
      setWallets(walletsResult.value.items);
    } else {
      setWallets([]);
      notices.push("钱包服务暂时不可用");
    }

    if (toolsResult.status === "fulfilled") {
      setTools(toolsResult.value.items);
    } else {
      setTools([]);
      notices.push("工具箱能力加载失败");
    }

    if (notices.length) {
      setDashboardNotice(`${notices.join("，")}。其余可用内容已继续显示。`);
    }

    setRefreshing(false);
  };

  useEffect(() => {
    void loadDashboard();
  }, [actorId, currentProjectId]);

  const openProject = (project: Project) => {
    setCurrentProjectId(project.id);
    navigate(mapStepToComicPath(project.currentStep));
  };

  const handleCreateProject = async (mode: "personal" | "enterprise") => {
    if (!me?.permissions.canCreateProject) {
      window.alert("当前身份不能创建项目，请先切换到注册用户或企业角色。");
      return;
    }

    if (mode === "enterprise" && !me.permissions.canManageOrganization) {
      window.alert("只有企业管理员可以直接新建企业项目。");
      return;
    }

    setPendingCreate(mode);

    try {
      const timestamp = new Date().toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const project = await createProject({
        title: `${mode === "enterprise" ? "企业" : "个人"}漫剧项目 ${timestamp}`,
        summary:
          mode === "enterprise"
            ? "从首页直接创建的企业协作项目。"
            : "从首页直接创建的个人创作项目。",
        ownerType: mode === "enterprise" ? "organization" : "personal",
        organizationId: mode === "enterprise" ? me.currentOrganizationId || undefined : undefined,
        budgetLimitCredits: mode === "enterprise" ? 2400 : 600,
      });

      setCurrentProjectId(project.id);
      navigate("/comic/global");
    } finally {
      setPendingCreate(null);
    }
  };

  const handleToolbox = async (tool: ToolboxCapability) => {
    if (!activeProject) return;
    setRunningTool(tool.code);

    try {
      if (
        tool.code === "character_replace" ||
        tool.code === "motion_transfer" ||
        tool.code === "upscale_restore"
      ) {
        await runToolboxCapability(tool.code, {
          projectId: activeProject.id,
          target: activeProject.title,
          note: `${tool.name} from dashboard`,
        });
        await loadDashboard();
      }
    } finally {
      setRunningTool(null);
    }
  };

  return (
    <div className="dashboard-home flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {dashboardNotice ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {dashboardNotice}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="glass-panel dashboard-hero relative overflow-hidden rounded-3xl p-8 lg:col-span-2">
            <div className="dashboard-hero-glow" aria-hidden="true" />

            <div className="relative">
              <span className="dashboard-pill mb-4 inline-flex bg-primary/12 text-primary">
                首页总览
              </span>

              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                双钱包、项目上下文和企业入口已经联动起来
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                你可以先在侧边栏切换演示身份，再回到这里对比权限范围、可见钱包和项目列表的变化。就算账户接口还没升级完成，首页也会尽量保留工具箱和项目面板，不再整块空掉。
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCreateProject("personal")}
                  disabled={pendingCreate !== null || !me?.permissions.canCreateProject}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingCreate === "personal" ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <Film className="h-5 w-5" />
                  )}
                  新建个人项目
                </button>

                {me?.permissions.canManageOrganization ? (
                  <button
                    type="button"
                    onClick={() => void handleCreateProject("enterprise")}
                    disabled={pendingCreate !== null}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingCreate === "enterprise" ? (
                      <LoaderCircle className="h-5 w-5 animate-spin" />
                    ) : (
                      <Building2 className="h-5 w-5" />
                    )}
                    新建企业项目
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  disabled={refreshing}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-5 py-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                  {refreshing ? "刷新中..." : "刷新面板"}
                </button>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前身份</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{formatRole(me)}</p>
                </div>
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前组织</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {currentOrganization?.name || "未加入企业组织"}
                  </p>
                </div>
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业能力</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {me?.permissions.canUseEnterprise ? "已启用" : "未启用"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel dashboard-wallet rounded-3xl p-8">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">钱包上下文</p>
            <div className="mt-4 text-4xl font-semibold tracking-tight text-foreground">
              {primaryWallet ? formatCredits(primaryWallet.creditsAvailable) : "--"}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {primaryWallet
                ? `${primaryWallet.displayName || "默认钱包"} · 冻结 ${formatCredits(primaryWallet.creditsFrozen)}`
                : "当前身份没有可见钱包"}
            </p>

            <div className="mt-6 space-y-3">
              {wallets.length ? (
                wallets.map((wallet) => {
                  const isPrimary = wallet.id === primaryWallet?.id;

                  return (
                    <div
                      key={wallet.id || `${wallet.ownerId}-${wallet.ownerType}`}
                      className={cn(
                        "rounded-2xl border border-border/70 bg-background/35 p-4",
                        isPrimary && "border-primary/25 bg-primary/8",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{wallet.displayName || "钱包"}</p>
                            {isPrimary ? (
                              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary">
                                当前优先
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{walletOwnerLabel(wallet)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-foreground">
                            {formatCredits(wallet.creditsAvailable)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            冻结 {formatCredits(wallet.creditsFrozen)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-4 text-sm text-muted-foreground">
                  当前身份下还没有钱包数据。
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/wallet/recharge")}
                disabled={!me?.permissions.canRecharge}
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                进入充值页
              </button>
              {me?.permissions.canUseEnterprise ? (
                <button
                  type="button"
                  onClick={() => navigate("/enterprise")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border/70 bg-background/50 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70"
                >
                  企业控制台
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {dashboardMetrics.map(({ detail, icon: Icon, label, value }) => (
            <div key={label} className="glass-panel dashboard-metric rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                  <p className="mt-4 text-3xl font-semibold text-foreground">{value}</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">最近项目</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                这里只展示当前身份有权限访问的项目，企业项目和个人项目会一起汇总。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={refreshing}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/50 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              {refreshing ? "刷新中..." : "刷新"}
            </button>
          </div>

          {orderedProjects.length ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {orderedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="glass-panel dashboard-card-hover group overflow-hidden rounded-2xl text-left"
                  onClick={() => openProject(project)}
                >
                  <div className="relative aspect-video bg-muted">
                    <img
                      src={projectCover(project)}
                      alt={project.title}
                      className="h-full w-full object-cover opacity-85 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/0 to-transparent" />
                    <div className="absolute left-3 top-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur",
                          projectStatusTone(project.status),
                        )}
                      >
                        {formatProjectStatus(project.status)}
                      </span>
                    </div>
                    <div className="absolute bottom-3 right-3 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-foreground backdrop-blur">
                      {formatProjectStep(project.currentStep)}
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-base font-medium text-foreground">{project.title}</h3>
                      {project.ownerType === "organization" ? (
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
                          企业
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                      {project.summary || "项目摘要会显示在这里。"}
                    </p>
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>更新于 {formatDateTime(project.updatedAt)}</span>
                        <span>{project.progressPercent}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${project.progressPercent}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-2.5 text-sm font-medium text-secondary-foreground transition-colors group-hover:bg-secondary/80">
                      继续创作
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </button>
              ))}

              {me?.permissions.canCreateProject ? (
                <button
                  type="button"
                  onClick={() => void handleCreateProject("personal")}
                  disabled={pendingCreate !== null}
                  className="glass-panel dashboard-card-hover flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                    {pendingCreate === "personal" ? (
                      <LoaderCircle className="h-6 w-6 animate-spin" />
                    ) : (
                      <Plus className="h-6 w-6" />
                    )}
                  </div>
                  <span className="font-medium">新建个人项目</span>
                  <span className="mt-2 text-center text-xs text-muted-foreground">
                    从首页直接进入新的创作流程
                  </span>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="glass-panel rounded-3xl p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-medium text-foreground">当前身份还没有项目</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    如果你是游客，可以先切换到注册用户或企业角色；如果你已经有权限，现在就可以从这里直接开始一个新项目。
                  </p>
                </div>
                {me?.permissions.canCreateProject ? (
                  <button
                    type="button"
                    onClick={() => void handleCreateProject("personal")}
                    disabled={pendingCreate !== null}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingCreate === "personal" ? (
                      <LoaderCircle className="h-5 w-5 animate-spin" />
                    ) : (
                      <Plus className="h-5 w-5" />
                    )}
                    立即创建项目
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">工具箱</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                保留原有能力入口，同时补上状态提示和当前作用项目。
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {activeProject ? `当前目标项目：${activeProject.title}` : "请先选择一个项目后再运行工具"}
            </p>
          </div>

          {tools.length ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {tools.map((tool) => {
                const isPending = runningTool === tool.code;
                const isDisabled = tool.status === "placeholder" || isPending || !activeProject;

                return (
                  <div
                    key={tool.code}
                    className={cn(
                      "glass-panel dashboard-card-hover flex flex-col rounded-2xl p-5",
                      tool.status === "placeholder" ? "cursor-not-allowed opacity-60 grayscale-[0.2]" : "",
                    )}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                        {isPending ? (
                          <LoaderCircle className="h-5 w-5 animate-spin" />
                        ) : (
                          <Sparkles className="h-5 w-5" />
                        )}
                      </div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {toolStatusLabel(tool.status)}
                      </span>
                    </div>

                    <h3 className="mb-2 text-base font-medium text-foreground">{tool.name}</h3>
                    <p className="mb-5 flex-1 text-xs leading-6 text-muted-foreground">{tool.description}</p>
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => void handleToolbox(tool)}
                      className="min-h-11 w-full rounded-xl bg-secondary py-2.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {tool.status === "placeholder"
                        ? "开发中"
                        : isPending
                          ? "处理中..."
                          : activeProject
                            ? "进入工具"
                            : "先选择项目"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass-panel rounded-3xl p-8 text-sm text-muted-foreground">
              工具箱能力暂时没有返回数据。你可以点击上方“刷新面板”重试；如果仍为空，说明当前后端实例还没有把工具箱能力接口挂出来。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
