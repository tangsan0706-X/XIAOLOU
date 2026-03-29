import {
  ArrowRight,
  Building2,
  CreditCard,
  FolderKanban,
  LoaderCircle,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMe,
  getOrganizationWallet,
  listOrganizationMembers,
  listProjects,
  type OrganizationMember,
  type PermissionContext,
  type Project,
  type Wallet as WalletInfo,
} from "../lib/api";
import { useActorId } from "../lib/actor-session";

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return `${value.toLocaleString("zh-CN")} 积分`;
}

function roleLabel(role: PermissionContext["currentOrganizationRole"]) {
  if (role === "enterprise_admin") return "企业管理员";
  if (role === "enterprise_member") return "企业成员";
  return "未加入企业";
}

function billingPolicyLabel(policy: Project["billingPolicy"] | undefined) {
  if (policy === "personal_only") return "仅个人钱包";
  if (policy === "organization_first_fallback_personal") return "企业优先，余额不足时回落个人";
  return "仅企业钱包";
}

export default function EnterpriseConsole() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadEnterprise = async () => {
      setLoading(true);
      try {
        const meResponse = await getMe();
        if (!active) return;
        setMe(meResponse);

        if (!meResponse.currentOrganizationId) {
          setWallet(null);
          setMembers([]);
          setProjects([]);
          return;
        }

        const [walletResponse, memberResponse, projectResponse] = await Promise.all([
          getOrganizationWallet(meResponse.currentOrganizationId),
          listOrganizationMembers(meResponse.currentOrganizationId),
          listProjects(),
        ]);

        if (!active) return;
        setWallet(walletResponse);
        setMembers(memberResponse.items);
        setProjects(
          projectResponse.items.filter((item) => item.organizationId === meResponse.currentOrganizationId),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadEnterprise();

    return () => {
      active = false;
    };
  }, [actorId]);

  const currentOrganization = useMemo(
    () => me?.organizations.find((item) => item.id === me.currentOrganizationId) ?? null,
    [me],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me?.permissions.canUseEnterprise || !currentOrganization) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="glass-panel rounded-[32px] p-8 sm:p-10">
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">企业控制台</span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              当前账号还没有企业上下文
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              你可以先在侧边栏的“更多”里切换到企业成员或企业管理员，再回到这里查看共享钱包、成员列表和企业项目。这个页面现在主要用来验证企业角色和共享计费链路。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/home")}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                返回首页
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="glass-panel rounded-[32px] p-8 sm:p-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_360px]">
            <div>
              <span className="dashboard-pill inline-flex bg-primary/12 text-primary">企业控制台</span>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {currentOrganization.name}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
                这里集中展示企业钱包、成员和项目预算，方便校验企业角色是否拿到了正确的共享资源，也方便后续继续扩展企业管理能力。
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <Building2 className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">当前角色</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{roleLabel(me.currentOrganizationRole)}</p>
                </div>
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <Users className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">企业成员</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{members.length} 人</p>
                </div>
                <div className="dashboard-subtle-card rounded-2xl p-4">
                  <FolderKanban className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">企业项目</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{projects.length} 个</p>
                </div>
              </div>

              <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                <ShieldCheck className="h-4 w-4" />
                {me.permissions.canManageOrganization
                  ? "当前身份可以管理成员、预算与共享权限"
                  : "当前身份可以使用企业资源，但不能修改企业设置"}
              </div>
            </div>

            <aside className="rounded-[28px] border border-border/70 bg-background/35 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业钱包</p>
                  <p className="text-sm font-medium text-foreground">{wallet?.displayName || "共享钱包"}</p>
                </div>
              </div>

              <div className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
                {formatCredits(wallet?.creditsAvailable)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                冻结 {formatCredits(wallet?.creditsFrozen)}
              </p>

              <div className="mt-6 rounded-2xl border border-border/70 bg-background/30 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前策略</p>
                <p className="mt-2 text-sm text-foreground">企业项目默认从企业钱包扣费，预算超限时阻止新任务。</p>
              </div>

              <button
                type="button"
                onClick={() => navigate("/wallet/recharge")}
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
              >
                <CreditCard className="h-4 w-4" />
                进入充值页
              </button>
            </aside>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel rounded-[28px] p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">成员列表</p>
            <div className="mt-5 space-y-3">
              {members.length ? (
                members.map((member) => (
                  <div key={member.id} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{member.displayName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{member.email || member.userId}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                        {member.role === "enterprise_admin" ? "企业管理员" : "企业成员"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-4 text-sm text-muted-foreground">
                  当前组织下还没有成员数据。
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业项目</p>
            <div className="mt-5 space-y-3">
              {projects.length ? (
                projects.map((project) => (
                  <div key={project.id} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{project.title}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          预算 {formatCredits(project.budgetLimitCredits ?? project.budgetCredits)} · 已用{" "}
                          {formatCredits(project.budgetUsedCredits ?? 0)}
                        </p>
                      </div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                        {billingPolicyLabel(project.billingPolicy)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-4 text-sm text-muted-foreground">
                  当前组织下还没有企业项目。
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
