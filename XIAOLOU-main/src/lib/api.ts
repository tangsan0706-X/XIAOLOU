import { getCurrentActorId } from "./actor-session";

export const API_BASE_URL =
  import.meta.env.VITE_CORE_API_BASE_URL ?? "http://127.0.0.1:4100";

export type ProjectStep =
  | "global"
  | "script"
  | "assets"
  | "storyboards"
  | "videos"
  | "dubbing"
  | "preview";

export type PlatformRole = "guest" | "customer" | "ops_admin" | "super_admin";
export type EnterpriseRole = "enterprise_member" | "enterprise_admin";
export type WalletOwnerType = "user" | "organization";
export type ProjectBillingPolicy =
  | "personal_only"
  | "organization_only"
  | "organization_first_fallback_personal";

export type User = {
  id: string;
  displayName: string;
  email: string | null;
  platformRole: PlatformRole;
  status: string;
  defaultOrganizationId: string | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  role: EnterpriseRole;
  membershipRole: "member" | "admin";
  status: string;
};

export type PermissionContext = {
  actor: User;
  platformRole: PlatformRole;
  organizations: OrganizationSummary[];
  currentOrganizationId: string | null;
  currentOrganizationRole: EnterpriseRole | null;
  permissions: {
    canCreateProject: boolean;
    canRecharge: boolean;
    canUseEnterprise: boolean;
    canManageOrganization: boolean;
    canManageOps: boolean;
    canManageSystem: boolean;
  };
};

export type Project = {
  id: string;
  title: string;
  summary: string;
  status: string;
  coverUrl: string | null;
  organizationId: string | null;
  ownerType?: "personal" | "organization";
  ownerId?: string;
  currentStep: ProjectStep | string;
  progressPercent: number;
  budgetCredits: number;
  budgetLimitCredits?: number;
  budgetUsedCredits?: number;
  billingWalletType?: "personal" | "organization";
  billingPolicy?: ProjectBillingPolicy;
  createdBy?: string;
  directorAgentName: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  projectId: string;
  tone: string;
  genre: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  visualStyle: string;
  audience: string;
  modelProfile: string;
  language: string;
  updatedAt: string;
};

export type Script = {
  id: string;
  projectId: string;
  version: number;
  title: string;
  content: string;
  updatedAt: string;
};

export type Asset = {
  id: string;
  projectId: string;
  assetType: string;
  name: string;
  description: string;
  previewUrl: string | null;
  mediaKind?: string | null;
  mediaUrl?: string | null;
  sourceTaskId?: string | null;
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageStatus?: string | null;
  imageModel?: string | null;
  aspectRatio?: string | null;
  negativePrompt?: string;
  scope: string;
  createdAt: string;
  updatedAt?: string;
};

export type AssetImageGenerateInput = {
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageModel?: string;
  aspectRatio?: string;
  negativePrompt?: string;
};

export type CreateAssetInput = {
  assetType: string;
  name: string;
  description?: string;
  previewUrl?: string | null;
  mediaKind?: string | null;
  mediaUrl?: string | null;
  sourceTaskId?: string | null;
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageModel?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  scope?: string;
};

export type Storyboard = {
  id: string;
  projectId: string;
  shotNo: number;
  title: string;
  script: string;
  imageStatus: string;
  videoStatus: string;
  durationSeconds: number;
  promptSummary: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  assetIds?: string[];
  composition?: string;
  shotType?: string;
  focalLength?: string;
  colorTone?: string;
  lighting?: string;
  technique?: string;
  modelName?: string;
  aspectRatio?: string;
  imageQuality?: string;
  videoMode?: string;
  videoPrompt?: string;
  motionPreset?: string;
  motionDescription?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoResolution?: string;
  videoDuration?: string;
  referenceImageUrls?: string[];
  startFrameUrl?: string | null;
  endFrameUrl?: string | null;
};

export type VideoItem = {
  id: string;
  projectId: string;
  storyboardId: string;
  version: number;
  status: string;
  durationSeconds: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Dubbing = {
  id: string;
  projectId: string;
  storyboardId: string;
  speakerName: string;
  voicePreset: string;
  text: string;
  status: string;
  audioUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimelineClip = {
  id: string;
  type: string;
  sourceType: string;
  sourceId: string | null;
  storyboardId: string | null;
  title: string;
  startTimeSeconds: number;
  durationSeconds: number;
  trimStartSeconds: number;
  enabled: boolean;
  muted?: boolean;
  url: string | null;
  thumbnailUrl?: string | null;
  text?: string;
};

export type TimelineTrack = {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  muted?: boolean;
  volume?: number;
  itemCount: number;
  clips: TimelineClip[];
};

export type Timeline = {
  projectId: string;
  version: number;
  totalDurationSeconds: number;
  tracks: TimelineTrack[];
  updatedAt: string;
};

export type Task = {
  id: string;
  type: string;
  domain: string;
  projectId: string | null;
  storyboardId: string | null;
  actorId?: string;
  actionCode?: string;
  walletId?: string | null;
  status: string;
  progressPercent: number;
  currentStage: string;
  etaSeconds: number;
  inputSummary: string | null;
  outputSummary: string | null;
  quotedCredits?: number;
  frozenCredits?: number;
  settledCredits?: number;
  billingStatus?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Wallet = {
  id?: string;
  ownerType?: WalletOwnerType;
  walletOwnerType?: WalletOwnerType;
  ownerId: string;
  displayName?: string;
  availableCredits?: number;
  frozenCredits?: number;
  creditsAvailable: number;
  creditsFrozen: number;
  currency: string;
  status?: string;
  allowNegative?: boolean;
  updatedAt: string;
};

export type WalletLedgerEntry = {
  id: string;
  walletId: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  frozenBalanceAfter: number;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  orderId: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreditQuote = {
  actionCode: string;
  label: string;
  description: string;
  credits: number;
  quantity: number;
  currency: string;
  walletId: string | null;
  walletName: string | null;
  walletOwnerType: WalletOwnerType | null;
  availableCredits: number;
  frozenCredits: number;
  billingPolicy: ProjectBillingPolicy;
  projectId: string | null;
  projectOwnerType: "personal" | "organization" | null;
  budgetLimitCredits: number | null;
  budgetUsedCredits: number;
  budgetRemainingCredits: number | null;
  canAfford: boolean;
  reason: string | null;
};

export type PricingRule = {
  id: string;
  actionCode: string;
  label: string;
  baseCredits: number;
  unitLabel: string;
  description: string;
  updatedAt: string;
};

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  displayName: string;
  email: string | null;
  platformRole: PlatformRole;
  role: EnterpriseRole;
  membershipRole: "member" | "admin";
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminRechargeOrder = WalletRechargeOrder & {
  wallet?: Wallet | null;
};

export type WalletRechargeOrder = {
  id: string;
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: string;
  amount: number;
  credits: number;
  currency: string;
  status: string;
  actorId?: string;
  walletId?: string;
  walletOwnerType?: WalletOwnerType;
  walletOwnerId?: string;
  payerType?: WalletOwnerType;
  qrCodePayload: string;
  qrCodeHint: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type CreateWalletRechargeOrderInput = {
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: string;
  amount: number;
  credits: number;
  walletId?: string;
};

export type ToolboxCapability = {
  code: string;
  name: string;
  status: string;
  queue: string;
  description: string;
};

export type CreateImageResult = {
  id: string;
  taskId?: string | null;
  prompt: string;
  model: string;
  style: string;
  aspectRatio: string;
  resolution: string;
  referenceImageUrl?: string | null;
  imageUrl: string;
  createdAt: string;
};

export type CreateVideoResult = {
  id: string;
  taskId?: string | null;
  prompt: string;
  model: string;
  duration: string;
  aspectRatio: string;
  resolution: string;
  referenceImageUrl?: string | null;
  thumbnailUrl: string;
  videoUrl: string;
  createdAt: string;
};

export type ApiVendorModel = {
  id: string;
  name: string;
  domain: "text" | "vision" | "image" | "video" | "audio" | string;
  inputPrice: string;
  outputPrice: string;
  enabled: boolean;
};

export type ApiVendor = {
  id: string;
  name: string;
  connected: boolean;
  apiKeyConfigured?: boolean;
  lastCheckedAt: string | null;
  testedAt?: string | null;
  region?: string | null;
  supportedDomains: string[];
  models: ApiVendorModel[];
};

export type NodeModelAssignment = {
  nodeCode: string;
  nodeName: string;
  primaryModelId: string | null;
  fallbackModelIds?: string[];
  notes?: string;
};

export type ApiCenterConfig = {
  vendors: ApiVendor[];
  defaults: {
    textModelId: string;
    visionModelId: string;
    imageModelId: string;
    videoModelId: string;
    audioModelId: string;
  };
  strategies: Record<string, string>;
  nodeAssignments: NodeModelAssignment[];
  toolboxAssignments?: NodeModelAssignment[];
};

export type ApiVendorConnectionTestResult = {
  vendor: ApiVendor;
  checkedAt: string;
  modelCount: number;
};

export type UploadedFile = {
  id: string;
  kind: string;
  originalName: string;
  storedName: string;
  sizeBytes: number;
  contentType: string;
  url: string;
  urlPath: string;
};

export type ProjectOverview = {
  project: Project & {
    settings: Settings;
    script: Script;
    assetCount: number;
    storyboardCount: number;
    videoCount: number;
    dubbingCount: number;
  };
  settings: Settings;
  script: Script;
  assets: Asset[];
  storyboards: Storyboard[];
  videos: VideoItem[];
  dubbings: Dubbing[];
  timeline: Timeline;
  tasks: Task[];
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

type TaskAccepted = {
  taskId: string;
  status: string;
  task: Task;
};

function isRouteNotFoundError(error: unknown) {
  return error instanceof Error && /route not found/i.test(error.message);
}

function buildFallbackPermissionContext(actorId: string): PermissionContext {
  const organization: OrganizationSummary = {
    id: "org_demo_001",
    name: "小楼影业 Demo",
    role: "enterprise_member",
    membershipRole: "member",
    status: "active",
  };

  if (actorId === "guest") {
    return {
      actor: {
        id: "guest",
        displayName: "游客",
        email: null,
        platformRole: "guest",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "guest",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_member_001") {
    return {
      actor: {
        id: actorId,
        displayName: "企业成员",
        email: "member@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [organization],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_member",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "企业管理员",
        email: "admin@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [{ ...organization, role: "enterprise_admin", membershipRole: "admin" }],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_admin",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: true,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "ops_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "运营管理员",
        email: "ops@xiaolou.local",
        platformRole: "ops_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "ops_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "root_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "超级管理员",
        email: "root@xiaolou.local",
        platformRole: "super_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "super_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: true,
      },
    };
  }

  return {
    actor: {
      id: actorId,
      displayName: "注册用户",
      email: "user@xiaolou.local",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
    },
    platformRole: "customer",
    organizations: [],
    currentOrganizationId: null,
    currentOrganizationRole: null,
    permissions: {
      canCreateProject: true,
      canRecharge: true,
      canUseEnterprise: false,
      canManageOrganization: false,
      canManageOps: false,
      canManageSystem: false,
    },
  };
}

function normalizeWalletRecord(wallet: Wallet, actorId: string): Wallet {
  const fallbackContext = buildFallbackPermissionContext(actorId);
  const currentOrganization = fallbackContext.organizations.find(
    (item) => item.id === fallbackContext.currentOrganizationId,
  );
  const ownerType: WalletOwnerType =
    wallet.ownerType ?? wallet.walletOwnerType ?? (currentOrganization ? "organization" : "user");

  return {
    ...wallet,
    ownerType,
    displayName:
      wallet.displayName ??
      (ownerType === "organization"
        ? `${currentOrganization?.name || "企业"}钱包`
        : `${fallbackContext.actor.displayName}钱包`),
    status: wallet.status ?? "active",
    allowNegative: wallet.allowNegative ?? false,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const actorId = getCurrentActorId();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Actor-Id": actorId,
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "接口请求失败");
  }

  return payload.data;
}

export function mapStepToComicPath(step: ProjectStep | string) {
  const normalized =
    step === "storyboards"
      ? "storyboard"
      : step === "videos"
        ? "video"
        : step;

  return `/comic/${normalized}`;
}

export async function getMe() {
  try {
    return await request<PermissionContext>("/api/me");
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      return buildFallbackPermissionContext(getCurrentActorId());
    }
    throw error;
  }
}

export async function listProjects() {
  return request<{ items: Project[]; total: number }>("/api/projects");
}

export async function listCreateImages() {
  return request<{ items: CreateImageResult[] }>("/api/create/images");
}

export async function generateCreateImages(input: {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  style?: string;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  referenceImageUrl?: string;
}) {
  return request<TaskAccepted>("/api/create/images/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCreateVideos() {
  return request<{ items: CreateVideoResult[] }>("/api/create/videos");
}

export async function generateCreateVideos(input: {
  prompt: string;
  model?: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  motionStrength?: number;
  keepConsistency?: boolean;
  referenceImageUrl?: string;
}) {
  return request<TaskAccepted>("/api/create/videos/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createProject(input: {
  title: string;
  summary?: string;
  ownerType?: "personal" | "organization";
  organizationId?: string;
  budgetLimitCredits?: number;
}) {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(projectId: string, input: Partial<Project>) {
  return request<Project>(`/api/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getProjectOverview(projectId: string) {
  return request<ProjectOverview>(`/api/projects/${projectId}/overview`);
}

export async function getSettings(projectId: string) {
  return request<Settings>(`/api/projects/${projectId}/settings`);
}

export async function updateSettings(projectId: string, input: Partial<Settings>) {
  return request<Settings>(`/api/projects/${projectId}/settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getScript(projectId: string) {
  return request<Script>(`/api/projects/${projectId}/script`);
}

export async function updateScript(projectId: string, content: string) {
  return request<Script>(`/api/projects/${projectId}/script`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function rewriteScript(projectId: string, instruction: string) {
  return request<TaskAccepted>(`/api/projects/${projectId}/script/rewrite`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export async function listAssets(projectId: string, assetType?: string) {
  const search = assetType ? `?assetType=${encodeURIComponent(assetType)}` : "";
  return request<{ items: Asset[] }>(`/api/projects/${projectId}/assets${search}`);
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput,
) {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAsset(projectId: string, assetId: string, input: Partial<Asset>) {
  return request<Asset>(`/api/projects/${projectId}/assets/${assetId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAsset(projectId: string, assetId: string) {
  return request<{ deleted: boolean; assetId: string }>(
    `/api/projects/${projectId}/assets/${assetId}`,
    {
      method: "DELETE",
    },
  );
}

export async function extractAssets(projectId: string, sourceText: string) {
  return request<TaskAccepted>(`/api/projects/${projectId}/assets/extract`, {
    method: "POST",
    body: JSON.stringify({ sourceText }),
  });
}

export async function generateAssetImage(
  projectId: string,
  assetId: string,
  input: AssetImageGenerateInput,
) {
  return request<TaskAccepted>(`/api/projects/${projectId}/assets/${assetId}/images/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listStoryboards(projectId: string) {
  return request<{ items: Storyboard[] }>(`/api/projects/${projectId}/storyboards`);
}

export async function updateStoryboard(
  projectId: string,
  storyboardId: string,
  input: Partial<Storyboard>,
) {
  return request<Storyboard>(`/api/projects/${projectId}/storyboards/${storyboardId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteStoryboard(projectId: string, storyboardId: string) {
  return request<{ deleted: boolean; storyboardId: string }>(
    `/api/projects/${projectId}/storyboards/${storyboardId}`,
    {
      method: "DELETE",
    },
  );
}

export async function autoGenerateStoryboards(projectId: string, sourceText?: string) {
  return request<TaskAccepted>(`/api/projects/${projectId}/storyboards/auto-generate`, {
    method: "POST",
    body: JSON.stringify(sourceText ? { sourceText } : {}),
  });
}

export async function getProjectCreditQuote(
  projectId: string,
  actionCode: string,
  input?: {
    sourceText?: string;
    text?: string;
    count?: number;
    shotCount?: number;
    storyboardId?: string;
  },
) {
  const search = new URLSearchParams({ action: actionCode });
  if (input?.sourceText) search.set("sourceText", input.sourceText);
  if (input?.text) search.set("text", input.text);
  if (input?.count) search.set("count", String(input.count));
  if (input?.shotCount) search.set("shotCount", String(input.shotCount));
  if (input?.storyboardId) search.set("storyboardId", input.storyboardId);

  return request<CreditQuote>(`/api/projects/${projectId}/credit-quote?${search.toString()}`);
}

export async function generateStoryboardImage(storyboardId: string, prompt?: string) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/images/generate`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

export async function listVideos(projectId: string) {
  return request<{ items: VideoItem[] }>(`/api/projects/${projectId}/videos`);
}

export async function generateVideo(
  storyboardId: string,
  input?: { motionPreset?: string; mode?: string },
) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/videos/generate`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export async function listDubbings(projectId: string) {
  return request<{ items: Dubbing[] }>(`/api/projects/${projectId}/dubbings`);
}

export async function updateDubbing(
  projectId: string,
  dubbingId: string,
  input: Partial<Dubbing>,
) {
  return request<Dubbing>(`/api/projects/${projectId}/dubbings/${dubbingId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function generateDubbing(
  storyboardId: string,
  input?: { text?: string; speakerName?: string; voicePreset?: string },
) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/dubbings/generate`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export async function generateLipSync(storyboardId: string) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/lipsync/generate`, {
    method: "POST",
  });
}

export async function getTimeline(projectId: string) {
  return request<Timeline>(`/api/projects/${projectId}/timeline`);
}

export async function updateTimeline(
  projectId: string,
  input: Pick<Timeline, "tracks" | "totalDurationSeconds">,
) {
  return request<Timeline>(`/api/projects/${projectId}/timeline`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function createExport(projectId: string, format = "mp4") {
  return request<TaskAccepted>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}

export async function listTasks(projectId?: string) {
  const search = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<{ items: Task[] }>(`/api/tasks${search}`);
}

export async function getTask(taskId: string) {
  return request<Task>(`/api/tasks/${taskId}`);
}

export async function getWallet() {
  return request<Wallet>("/api/wallet");
}

export async function listWallets() {
  try {
    return await request<{ items: Wallet[] }>("/api/wallets");
  } catch (error) {
    if (!isRouteNotFoundError(error)) throw error;

    const actorId = getCurrentActorId();
    if (actorId === "guest" || actorId === "ops_demo_001" || actorId === "root_demo_001") {
      return { items: [] };
    }

    const wallet = await getWallet();
    return { items: [normalizeWalletRecord(wallet, actorId)] };
  }
}

export async function listWalletLedger(walletId: string) {
  try {
    return await request<{ items: WalletLedgerEntry[] }>(`/api/wallets/${walletId}/ledger`);
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      return { items: [] };
    }
    throw error;
  }
}

export async function createWalletRechargeOrder(input: CreateWalletRechargeOrderInput) {
  return request<WalletRechargeOrder>("/api/wallet/recharge-orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getWalletRechargeOrder(orderId: string) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}`);
}

export async function confirmWalletRechargeOrder(orderId: string) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}/confirm`, {
    method: "POST",
  });
}

export async function getToolboxCapabilities() {
  return request<{ items: ToolboxCapability[]; stagingArea: string[] }>(
    "/api/toolbox/capabilities",
  );
}

export async function getCapabilities() {
  return request<{
    service: string;
    mode: string;
    implementedDomains: string[];
    toolbox: ToolboxCapability[];
  }>("/api/capabilities");
}

export async function getApiCenterConfig() {
  return request<ApiCenterConfig>("/api/api-center");
}

export async function updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
  return request<ApiCenterConfig["defaults"]>("/api/api-center/defaults", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
  return request<ApiVendor>(`/api/api-center/vendors/${vendorId}/api-key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function testApiCenterVendorConnection(vendorId: string) {
  return request<ApiVendorConnectionTestResult>(`/api/api-center/vendors/${vendorId}/test`, {
    method: "POST",
  });
}

export async function updateApiVendorModel(
  vendorId: string,
  modelId: string,
  input: Partial<Pick<ApiVendorModel, "enabled">>,
) {
  return request<ApiVendorModel>(`/api/api-center/vendors/${vendorId}/models/${modelId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function uploadFile(file: File, kind = "file") {
  const actorId = getCurrentActorId();
  const response = await fetch(
    `${API_BASE_URL}/api/uploads?kind=${encodeURIComponent(kind)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Upload-Filename": encodeURIComponent(file.name),
        "X-Actor-Id": actorId,
      },
      body: file,
    },
  );

  const payload = (await response.json()) as ApiEnvelope<UploadedFile>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "File upload failed");
  }

  return payload.data;
}

export async function listPricingRules() {
  return request<{ items: PricingRule[] }>("/api/admin/pricing-rules");
}

export async function listAdminOrders() {
  return request<{ items: AdminRechargeOrder[] }>("/api/admin/orders");
}

export async function listOrganizationMembers(organizationId: string) {
  return request<{ items: OrganizationMember[] }>(`/api/organizations/${organizationId}/members`);
}

export async function getOrganizationWallet(organizationId: string) {
  return request<Wallet>(`/api/organizations/${organizationId}/wallet`);
}

export async function runToolboxCapability(
  type: "character_replace" | "motion_transfer" | "upscale_restore",
  input: { projectId?: string; note?: string; target?: string; storyboardId?: string },
) {
  const endpointMap = {
    character_replace: "/api/toolbox/character-replace",
    motion_transfer: "/api/toolbox/motion-transfer",
    upscale_restore: "/api/toolbox/upscale-restore",
  };

  return request<TaskAccepted>(endpointMap[type], {
    method: "POST",
    body: JSON.stringify(input),
  });
}
