import { useEffect, useState, type MouseEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  Film,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutTemplate,
  Library,
  Mic,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  PlaySquare,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { getMe, type PermissionContext } from "../lib/api";
import { setCurrentActorId, useActorId } from "../lib/actor-session";
import { runNavigationGuards } from "../lib/navigation-guards";
import { cn } from "../lib/utils";

const navItems = [
  { name: "首页", path: "/home", icon: LayoutDashboard },
  { name: "企业控制台", path: "/enterprise", icon: Building2 },
  { name: "剧本广场", path: "/script-plaza", icon: Library },
  {
    name: "通用创作",
    icon: ImageIcon,
    children: [
      { name: "图片创作", path: "/create/image", icon: ImageIcon },
      { name: "视频创作", path: "/create/video", icon: Video },
    ],
  },
  {
    name: "漫剧创作",
    icon: Film,
    children: [
      { name: "1 全局设定", path: "/comic/global", icon: Settings },
      { name: "2 故事剧本", path: "/comic/script", icon: BookOpen },
      { name: "3 角色场景资产", path: "/comic/entities", icon: Users },
      { name: "4 分镜脚本", path: "/comic/storyboard", icon: LayoutTemplate },
      { name: "5 分镜视频", path: "/comic/video", icon: PlaySquare },
      { name: "6 配音与口型", path: "/comic/dubbing", icon: Mic },
      { name: "7 成片预览", path: "/comic/preview", icon: MonitorPlay },
    ],
  },
  { name: "资产库", path: "/assets", icon: FolderOpen },
  { name: "教程", path: "/tutorial", icon: HelpCircle },
  { name: "API 中心", path: "/api-center", icon: Settings },
];

const demoActors = [
  { id: "guest", label: "游客", detail: "只能浏览案例与入口，不能创建作品" },
  { id: "user_personal_001", label: "注册用户", detail: "个人项目、个人资产与个人钱包" },
  { id: "user_member_001", label: "企业成员", detail: "共享项目、企业资产与团队协作" },
  { id: "user_demo_001", label: "企业管理员", detail: "成员管理、预算分配与共享权限" },
  { id: "ops_demo_001", label: "运营管理员", detail: "平台配置、企业审核与订单管理" },
  { id: "root_demo_001", label: "超级管理员", detail: "系统配置、审计日志与风控能力" },
];

function formatPlatformRole(context: PermissionContext | null) {
  if (!context) return "--";
  if (context.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (context.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (context.platformRole === "ops_admin") return "运营管理员";
  if (context.platformRole === "super_admin") return "超级管理员";
  if (context.platformRole === "customer") return "注册用户";
  return "游客";
}

export default function Layout() {
  const actorId = useActorId();
  const location = useLocation();
  const navigate = useNavigate();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [isMoreModalOpen, setIsMoreModalOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [permissionContext, setPermissionContext] = useState<PermissionContext | null>(null);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    漫剧创作: true,
    通用创作: true,
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.add("light");
    }
  }, [isDark]);

  useEffect(() => {
    let active = true;

    const loadContext = async () => {
      setLoadingAccount(true);
      try {
        const response = await getMe();
        if (active) {
          setPermissionContext(response);
        }
      } finally {
        if (active) {
          setLoadingAccount(false);
        }
      }
    };

    void loadContext();

    return () => {
      active = false;
    };
  }, [actorId]);

  const currentOrganizationName =
    permissionContext?.organizations.find((item) => item.id === permissionContext.currentOrganizationId)?.name ?? null;

  const toggleMenu = (name: string) => {
    if (isCollapsed) setIsCollapsed(false);
    setExpandedMenus((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleGuardedNavigate = async (path: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === path || navigating) return;

    event.preventDefault();
    setNavigating(true);
    try {
      await runNavigationGuards();
      navigate(path);
    } catch {
      window.alert("当前内容保存失败，请稍后重试。");
    } finally {
      setNavigating(false);
    }
  };

  const handleSwitchActor = (nextActorId: string) => {
    setCurrentActorId(nextActorId);
    setIsMoreModalOpen(false);
    navigate("/home");
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 80 : 260 }}
        className="relative z-20 flex h-full flex-col border-r border-border bg-card/50 backdrop-blur-sm"
      >
        <div className="flex h-16 items-center border-b border-border px-4">
          <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Film className="h-5 w-5 text-primary-foreground" />
            </div>
            <AnimatePresence>
              {!isCollapsed ? (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  className="text-lg font-semibold tracking-tight"
                >
                  小楼
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>

          <button
            type="button"
            aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="absolute -right-3 top-5 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-secondary transition-colors hover:bg-accent"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto px-3 py-4 custom-scrollbar">
          {navItems.map((item) => (
            <div key={item.name}>
              {item.children ? (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleMenu(item.name)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      !isCollapsed && expandedMenus[item.name] ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!isCollapsed ? <span>{item.name}</span> : null}
                    </div>
                    {!isCollapsed ? (
                      <ChevronRight
                        className={cn("h-4 w-4 transition-transform", expandedMenus[item.name] && "rotate-90")}
                      />
                    ) : null}
                  </button>

                  <AnimatePresence>
                    {!isCollapsed && expandedMenus[item.name] ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-4 mt-1 space-y-1 overflow-hidden border-l border-border pl-4"
                      >
                        {item.children.map((child) => (
                          <NavLink
                            key={child.path}
                            to={child.path}
                            onClick={(event) => void handleGuardedNavigate(child.path, event)}
                            className={({ isActive }) =>
                              cn(
                                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                                isActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )
                            }
                          >
                            <child.icon className="h-4 w-4 shrink-0" />
                            <span>{child.name}</span>
                          </NavLink>
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              ) : (
                <NavLink
                  to={item.path}
                  onClick={(event) => void handleGuardedNavigate(item.path, event)}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                  title={isCollapsed ? item.name : undefined}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!isCollapsed ? <span>{item.name}</span> : null}
                </NavLink>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border p-4">
          {!isCollapsed ? (
            <div className="mb-3 rounded-xl border border-border/70 bg-background/40 p-3">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前身份</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {loadingAccount ? "同步中..." : permissionContext?.actor.displayName || "游客"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {loadingAccount ? "--" : formatPlatformRole(permissionContext)}
              </p>
              {currentOrganizationName ? (
                <p className="mt-2 text-xs text-muted-foreground">组织：{currentOrganizationName}</p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={isCollapsed ? "切换主题" : undefined}
            >
              {isDark ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
              {!isCollapsed ? <span>{isDark ? "切换到浅色" : "切换到深色"}</span> : null}
            </button>
            <button
              type="button"
              onClick={() => setIsMoreModalOpen(true)}
              className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={isCollapsed ? "更多" : undefined}
            >
              <MoreHorizontal className="h-5 w-5 shrink-0" />
              {!isCollapsed ? <span>更多</span> : null}
            </button>
          </div>
        </div>
      </motion.aside>

      <AnimatePresence>
        {isMoreModalOpen ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="mx-4 w-full max-w-3xl rounded-2xl border border-border bg-background p-6 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">身份切换与演示</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    这里可以切换演示身份，用来验证角色权限、双钱包可见范围和企业入口状态。
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="关闭弹窗"
                  onClick={() => setIsMoreModalOpen(false)}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">演示身份</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {demoActors.map((actor) => (
                      <button
                        key={actor.id}
                        type="button"
                        onClick={() => handleSwitchActor(actor.id)}
                        className={cn(
                          "rounded-2xl border px-4 py-4 text-left transition-colors",
                          actorId === actor.id
                            ? "border-primary/35 bg-primary/10"
                            : "border-border/70 bg-background/35 hover:bg-secondary/70",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <UserRound className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{actor.label}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{actor.detail}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <aside className="rounded-2xl border border-border/70 bg-background/35 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前上下文</p>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
                      <p className="text-sm font-medium text-foreground">
                        {loadingAccount ? "同步中..." : permissionContext?.actor.displayName || "游客"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {loadingAccount ? "--" : formatPlatformRole(permissionContext)}
                      </p>
                    </div>

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span>所属组织</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.organizations.length ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>可创建项目</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canCreateProject ? "是" : "否"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>可充值</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canRecharge ? "是" : "否"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>企业管理</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canManageOrganization ? "可用" : "不可用"}
                        </span>
                      </div>
                    </div>

                    {currentOrganizationName ? (
                      <div className="rounded-2xl border border-primary/20 bg-primary/8 p-4 text-sm text-primary">
                        当前组织：{currentOrganizationName}
                      </div>
                    ) : null}

                    {permissionContext?.permissions.canManageOps ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        运营后台能力已启用
                      </div>
                    ) : null}

                    {permissionContext?.permissions.canManageSystem ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        系统级权限已启用
                      </div>
                    ) : null}
                  </div>
                </aside>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-background">
        <Outlet />
      </main>
    </div>
  );
}
