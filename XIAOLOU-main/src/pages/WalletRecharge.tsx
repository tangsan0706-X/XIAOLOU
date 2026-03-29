import { ArrowLeft, ArrowRight, Check, CreditCard, QrCode, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  confirmWalletRechargeOrder,
  createWalletRechargeOrder,
  getMe,
  listWalletLedger,
  listWallets,
  type PermissionContext,
  type Wallet as WalletInfo,
  type WalletLedgerEntry,
  type WalletRechargeOrder,
} from "../lib/api";
import { cn } from "../lib/utils";

type BillingCycle = "monthly" | "annual" | "oneTime";
type PaymentMethod = "wechat_pay" | "alipay" | "bank_transfer";
type Plan = {
  id: string;
  name: string;
  badge?: string;
  recommended?: boolean;
  price: Record<BillingCycle, number>;
  credits: Record<BillingCycle, number>;
  features: string[];
};

const BILLING_OPTIONS = [
  { id: "monthly" as const, label: "月付" },
  { id: "annual" as const, label: "年付" },
  { id: "oneTime" as const, label: "一次性" },
];

const PAYMENT_METHODS = [
  { id: "wechat_pay" as const, label: "微信支付", detail: "支持扫码支付", available: true },
  { id: "alipay" as const, label: "支付宝", detail: "后续接入", available: false },
  { id: "bank_transfer" as const, label: "对公转账", detail: "企业采购", available: false },
];

const PLANS: Plan[] = [
  { id: "starter", name: "Starter", badge: "入门", price: { monthly: 39, annual: 29, oneTime: 59 }, credits: { monthly: 800, annual: 9600, oneTime: 900 }, features: ["无水印导出", "标准队列", "基础出图"] },
  { id: "creator", name: "Creator", badge: "常用", price: { monthly: 89, annual: 67, oneTime: 129 }, credits: { monthly: 2500, annual: 30000, oneTime: 2800 }, features: ["优先队列", "批量分镜", "失败退回"] },
  { id: "studio", name: "Studio", badge: "推荐", recommended: true, price: { monthly: 189, annual: 142, oneTime: 269 }, credits: { monthly: 7500, annual: 90000, oneTime: 8500 }, features: ["高优先级", "多项目并行", "工具箱直连"] },
  { id: "enterprise", name: "Enterprise", badge: "企业", price: { monthly: 499, annual: 374, oneTime: 699 }, credits: { monthly: 25000, annual: 300000, oneTime: 30000 }, features: ["共享钱包", "企业资产库", "专属支持"] },
];

const FAQS = [
  ["现在是正式微信支付吗？", "当前是可走通的 mock 支付链路，后续只需要替换商户接口。"],
  ["一次性充值包会过期吗？", "不会，一次性充值适合冲刺期和临时加量。"],
  ["失败任务会退积分吗？", "会。任务已经支持冻结、结算和失败退款。"],
];

function formatCurrency(value: number) {
  return `¥${value.toLocaleString("zh-CN")}`;
}

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return `${value.toLocaleString("zh-CN")} 积分`;
}

function formatRole(me: PermissionContext | null) {
  if (!me) return "--";
  if (me.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (me.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (me.platformRole === "ops_admin") return "运营管理员";
  if (me.platformRole === "super_admin") return "超级管理员";
  return "注册用户";
}

function formatLedger(entry: WalletLedgerEntry) {
  const labelMap: Record<string, string> = {
    recharge: "充值入账",
    freeze: "任务冻结",
    settle: "任务结算",
    refund: "积分退回",
  };
  return labelMap[entry.entryType] || entry.entryType;
}

function buildQrPattern(seed: string) {
  return Array.from({ length: 169 }, (_, index) => {
    const row = Math.floor(index / 13);
    const col = index % 13;
    if ((row < 5 && col < 5) || (row < 5 && col > 7) || (row > 7 && col < 5)) {
      return row % 4 === 0 || col % 4 === 0 || (row % 4 === 2 && col % 4 === 2);
    }
    const code = seed.charCodeAt(index % seed.length) || 87;
    return (code + row * 11 + col * 7) % 3 !== 0;
  });
}

export default function WalletRecharge() {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wechat_pay");
  const [selectedPlanId, setSelectedPlanId] = useState("studio");
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [currentOrder, setCurrentOrder] = useState<WalletRechargeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPlan = useMemo(() => PLANS.find((item) => item.id === selectedPlanId) ?? PLANS[0], [selectedPlanId]);
  const selectedWallet = useMemo(() => wallets.find((item) => item.id === selectedWalletId) ?? wallets[0] ?? null, [wallets, selectedWalletId]);
  const qrPattern = useMemo(() => buildQrPattern(currentOrder?.id || "wechat"), [currentOrder]);

  const loadContext = async () => {
    setLoading(true);
    try {
      const [meRes, walletsRes] = await Promise.all([getMe(), listWallets()]);
      setMe(meRes);
      setWallets(walletsRes.items);
      setSelectedWalletId((current) => walletsRes.items.some((item) => item.id === current) ? current : walletsRes.items[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadContext(); }, []);
  useEffect(() => { setCurrentOrder(null); setNotice(null); }, [billingCycle, paymentMethod, selectedPlanId, selectedWalletId]);
  useEffect(() => { if (selectedWallet?.id) void listWalletLedger(selectedWallet.id).then((res) => setLedger(res.items.slice(0, 5))); }, [selectedWallet?.id]);

  const handleCreateOrder = async () => {
    if (!selectedWallet?.id) return setNotice("当前身份下没有可充值的钱包。");
    if (paymentMethod !== "wechat_pay") return setNotice("当前只开放微信支付。");
    setCreating(true);
    setNotice(null);
    try {
      setCurrentOrder(await createWalletRechargeOrder({
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        billingCycle,
        paymentMethod,
        amount: selectedPlan.price[billingCycle],
        credits: selectedPlan.credits[billingCycle],
        walletId: selectedWallet.id,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建订单失败。");
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = async () => {
    if (!currentOrder) return;
    setConfirming(true);
    setNotice(null);
    try {
      const paid = await confirmWalletRechargeOrder(currentOrder.id);
      setCurrentOrder(paid);
      await loadContext();
      if (paid.walletId) {
        const ledgerRes = await listWalletLedger(paid.walletId);
        setLedger(ledgerRes.items.slice(0, 5));
      }
      setNotice("微信支付已模拟完成，积分已入账。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "确认支付失败。");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="glass-panel grid gap-8 rounded-[32px] p-8 xl:grid-cols-[minmax(0,1.15fr)_380px]">
          <div>
            <button type="button" onClick={() => navigate("/home")} className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/50 px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />返回首页
            </button>
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">充值与微信支付</span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">支持个人钱包和企业钱包充值</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">这版充值页已经接上双钱包选择、最近流水和微信支付订单链路，后续可以直接升级为真实商户支付。</p>
            <div className="mt-7 inline-flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-background/40 p-2">
              {BILLING_OPTIONS.map((item) => <button key={item.id} type="button" onClick={() => setBillingCycle(item.id)} className={cn("rounded-xl px-4 py-2 text-sm", billingCycle === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground")}>{item.label}</button>)}
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="dashboard-subtle-card rounded-2xl p-4"><Wallet className="h-5 w-5 text-primary" /><p className="mt-3 text-sm font-medium text-foreground">双钱包充值</p><p className="mt-2 text-xs leading-6 text-muted-foreground">个人钱包和企业钱包都能直接加款。</p></div>
              <div className="dashboard-subtle-card rounded-2xl p-4"><QrCode className="h-5 w-5 text-primary" /><p className="mt-3 text-sm font-medium text-foreground">微信扫码支付</p><p className="mt-2 text-xs leading-6 text-muted-foreground">订单、扫码态和入账链路已经打通。</p></div>
              <div className="dashboard-subtle-card rounded-2xl p-4"><ShieldCheck className="h-5 w-5 text-primary" /><p className="mt-3 text-sm font-medium text-foreground">失败自动退回</p><p className="mt-2 text-xs leading-6 text-muted-foreground">任务侧已支持冻结、结算和退款。</p></div>
            </div>
          </div>

          <aside className="rounded-[28px] border border-white/8 bg-background/40 p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">结算摘要</p>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">{selectedPlan.name}</h2>
            <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/10 p-4">
              <div className="text-3xl font-semibold text-foreground">{formatCurrency(selectedPlan.price[billingCycle])}</div>
              <p className="mt-2 text-sm text-muted-foreground">{selectedPlan.credits[billingCycle].toLocaleString("zh-CN")} 积分到账</p>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <div className="dashboard-inline-row"><span className="text-muted-foreground">当前身份</span><span className="font-medium text-foreground">{loading ? "同步中..." : formatRole(me)}</span></div>
              <div className="dashboard-inline-row"><span className="text-muted-foreground">充值钱包</span><span className="font-medium text-foreground">{loading ? "同步中..." : selectedWallet?.displayName || "--"}</span></div>
              <div className="dashboard-inline-row"><span className="text-muted-foreground">当前余额</span><span className="font-medium text-foreground">{loading ? "同步中..." : formatCredits(selectedWallet?.creditsAvailable)}</span></div>
              <div className="dashboard-inline-row"><span className="text-muted-foreground">冻结积分</span><span className="font-medium text-foreground">{loading ? "同步中..." : formatCredits(selectedWallet?.creditsFrozen)}</span></div>
            </div>
            <div className="mt-5 grid gap-3">
              {wallets.map((wallet) => <button key={wallet.id} type="button" onClick={() => setSelectedWalletId(wallet.id ?? null)} className={cn("rounded-2xl border px-4 py-3 text-left", selectedWallet?.id === wallet.id ? "border-primary/35 bg-primary/10" : "border-border/70 bg-background/35 hover:bg-secondary/70")}><div className="flex items-center justify-between gap-3"><div><div className="font-medium text-foreground">{wallet.displayName || "钱包"}</div><div className="mt-1 text-xs text-muted-foreground">{wallet.ownerType === "organization" ? "企业钱包" : "个人钱包"}</div></div><div className="text-right text-xs text-muted-foreground">可用 {formatCredits(wallet.creditsAvailable)}</div></div></button>)}
            </div>
            <div className="mt-5 space-y-3">
              {PAYMENT_METHODS.map((method) => <button key={method.id} type="button" disabled={!method.available} onClick={() => setPaymentMethod(method.id)} className={cn("w-full rounded-2xl border px-4 py-3 text-left", paymentMethod === method.id ? "border-primary/35 bg-primary/10" : "border-border/70 bg-background/35", !method.available && "cursor-not-allowed opacity-55")}><div className="flex items-center justify-between gap-3"><div><div className="font-medium text-foreground">{method.label}</div><div className="mt-1 text-xs text-muted-foreground">{method.detail}</div></div><div className="text-xs text-muted-foreground">{method.available ? "已接入" : "待接入"}</div></div></button>)}
            </div>
            {currentOrder ? (
              <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/8 p-4">
                <p className="text-sm font-medium text-foreground">微信支付订单</p>
                <p className="mt-1 text-xs text-muted-foreground">订单号 {currentOrder.id} · {currentOrder.status === "paid" ? "已支付" : "待支付"}</p>
                <div className="mt-4 flex items-start gap-4">
                  <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1 rounded-2xl bg-white p-3 shadow-sm">{qrPattern.map((active, index) => <div key={index} className={cn("h-2.5 w-2.5 rounded-[2px]", active ? "bg-black" : "bg-white")} />)}</div>
                  <div className="text-sm text-muted-foreground">请使用微信扫一扫完成支付，支付后点击确认，积分将直接进入当前钱包。</div>
                </div>
                <button type="button" onClick={() => void handleConfirm()} disabled={confirming || currentOrder.status === "paid"} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><CreditCard className="h-4 w-4" />{currentOrder.status === "paid" ? "支付已确认" : confirming ? "确认支付中..." : "我已完成支付"}</button>
              </div>
            ) : (
              <button type="button" onClick={() => void handleCreateOrder()} disabled={creating || !selectedWallet} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><ArrowRight className="h-4 w-4" />{creating ? "创建订单中..." : "生成微信支付订单"}</button>
            )}
            {notice ? <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/8 p-4 text-sm leading-6 text-primary">{notice}</div> : null}
          </aside>
        </section>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => <button key={plan.id} type="button" onClick={() => setSelectedPlanId(plan.id)} className={cn("glass-panel rounded-[28px] p-6 text-left", selectedPlanId === plan.id ? "ring-1 ring-primary/40" : "opacity-90 hover:opacity-100")}><div className="flex items-center justify-between gap-3"><h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>{plan.badge ? <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", plan.recommended ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}>{plan.badge}</span> : null}</div><div className="mt-5 text-4xl font-semibold text-foreground">{formatCurrency(plan.price[billingCycle])}</div><p className="mt-2 text-sm text-foreground">{plan.credits[billingCycle].toLocaleString("zh-CN")} 积分</p><ul className="mt-5 space-y-2">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{feature}</span></li>)}</ul></button>)}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="glass-panel rounded-[28px] p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">常见问题</p>
            <div className="mt-4 space-y-3">{FAQS.map(([question, answer]) => <details key={question} className="rounded-2xl border border-border/70 bg-background/35 p-5"><summary className="cursor-pointer list-none text-sm font-medium text-foreground">{question}</summary><p className="mt-3 text-sm leading-7 text-muted-foreground">{answer}</p></details>)}</div>
          </div>
          <div className="space-y-6">
            <div className="glass-panel rounded-[28px] p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">最近流水</p>
              <div className="mt-4 space-y-3">{ledger.length ? ledger.map((entry) => <div key={entry.id} className="rounded-2xl border border-border/70 bg-background/35 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-foreground">{formatLedger(entry)}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</p></div><div className={cn("text-sm font-semibold", entry.amount >= 0 ? "text-emerald-300" : "text-foreground")}>{entry.amount > 0 ? "+" : ""}{entry.amount.toLocaleString("zh-CN")}</div></div><div className="mt-2 text-xs text-muted-foreground">余额 {entry.balanceAfter.toLocaleString("zh-CN")} · 冻结 {entry.frozenBalanceAfter.toLocaleString("zh-CN")}</div></div>) : <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-4 text-sm text-muted-foreground">当前钱包还没有可展示的流水。</div>}</div>
            </div>
            <div className="glass-panel rounded-[28px] p-6"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业协作</p><p className="mt-3 text-sm leading-7 text-muted-foreground">企业管理员可以直接给企业钱包充值，用于共享项目和共享资产库的任务消耗。</p><button type="button" onClick={() => navigate("/home")} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-secondary px-4 py-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"><ArrowRight className="h-4 w-4" />返回控制台</button></div>
          </div>
        </section>
      </div>
    </div>
  );
}
