const {
  accepted,
  ok,
  parsePagination,
  readJsonBody,
  sendEvent
} = require("./http");
const { createUploadFromRequest, getPublicUploadUrl, sendUpload } = require("./uploads");

function route(method, path, handler) {
  return { method, path, handler, statusCode: 200 };
}

function routeWithStatus(method, path, statusCode, handler) {
  return { method, path, handler, statusCode };
}

function failure(statusCode, code, message) {
  return {
    error: {
      statusCode,
      code,
      message
    }
  };
}

function getActorId(req, url) {
  const headerValue = req.headers["x-actor-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue) && headerValue[0]?.trim()) {
    return headerValue[0].trim();
  }

  const queryActorId = url?.searchParams?.get("actorId");
  if (queryActorId && queryActorId.trim()) {
    return queryActorId.trim();
  }

  return undefined;
}

function buildRoutes(store) {
  return [
    ...buildSystemRoutes(store),
    ...buildWalletRoutes(store),
    ...buildApiCenterRoutes(store),
    ...buildCreateRoutes(store),
    ...buildProjectRoutes(store),
    ...buildTaskRoutes(store),
    ...buildToolboxRoutes(store),
    ...buildAdminRoutes(store)
  ];
}

function buildSystemRoutes(store) {
  return [
    route("GET", "/uploads/:fileName", ({ params, res }) => {
      const served = sendUpload(res, params.fileName);
      if (!served) return failure(404, "NOT_FOUND", "upload not found");
    }),
    routeWithStatus("POST", "/api/uploads", 201, async ({ req, url }) => {
      const upload = await createUploadFromRequest(req, url.searchParams.get("kind") || "file");
      return ok({
        ...upload,
        url: getPublicUploadUrl(req, upload.urlPath)
      });
    }),
    route("GET", "/healthz", () =>
      ok({ status: "ok", service: "core-api", mode: store.mode || "mock" })
    ),
    routeWithStatus("POST", "/api/demo/reset", 200, () => {
      store.reset();
      return ok({
        reset: true,
        projectId: "proj_demo_001"
      });
    }),
    route("GET", "/api/capabilities", () =>
      ok({
        service: "core-api",
        mode: store.mode || "mock",
        implementedDomains: [
          "create",
          "uploads",
          "projects",
          "settings",
          "scripts",
          "assets",
          "storyboards",
          "videos",
          "dubbings",
          "timeline",
          "tasks",
          "wallet",
          "billing",
          "enterprise",
          "toolbox"
        ],
        toolbox: store.getToolboxCapabilities()
      })
    ),
    route("GET", "/api/me", ({ req, url }) =>
      ok(store.getPermissionContext(getActorId(req, url)))
    ),
    route("GET", "/api/tasks/stream", ({ req, res, url }) => {
      const actorId = getActorId(req, url);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      sendEvent(res, "ready", { connectedAt: new Date().toISOString() });
      sendEvent(res, "snapshot", { tasks: store.listTasks(url.searchParams.get("projectId"), actorId) });

      const onEvent = (event) => {
        const projectId = url.searchParams.get("projectId");
        if (projectId && event.payload.projectId && event.payload.projectId !== projectId) {
          return;
        }
        if (actorId) {
          try {
            if (event.payload?.projectId) {
              store.assertProjectAccess(event.payload.projectId, actorId);
            } else if (event.payload?.actorId && event.payload.actorId !== actorId) {
              return;
            }
          } catch {
            return;
          }
        }
        sendEvent(res, event.type, event);
      };

      const heartbeat = setInterval(() => {
        sendEvent(res, "heartbeat", { timestamp: new Date().toISOString() });
      }, 15000);

      store.events.on("event", onEvent);

      req.on("close", () => {
        clearInterval(heartbeat);
        store.events.off("event", onEvent);
      });
    })
  ];
}

function buildWalletRoutes(store) {
  return [
    route("GET", "/api/wallet", ({ req, url }) => ok(store.getWallet(getActorId(req, url)))),
    route("GET", "/api/wallets", ({ req, url }) =>
      ok({ items: store.listWallets(getActorId(req, url)) })
    ),
    route("GET", "/api/wallets/:walletId/ledger", ({ params, req, url }) =>
      ok({ items: store.listWalletLedger(params.walletId, getActorId(req, url)) })
    ),
    routeWithStatus("POST", "/api/wallet/recharge-orders", 201, async ({ req, url }) => {
      const body = await readJsonBody(req);
      const amount = Number(body.amount || 0);
      const credits = Number(body.credits || 0);

      if (!body.planId || !body.planName) {
        return failure(400, "BAD_REQUEST", "planId and planName are required");
      }

      if (body.paymentMethod !== "wechat_pay") {
        return failure(400, "BAD_REQUEST", "only wechat_pay is supported in current demo");
      }

      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(credits) || credits <= 0) {
        return failure(400, "BAD_REQUEST", "amount and credits must be positive numbers");
      }

      return ok(
        store.createWalletRechargeOrder(
          {
            planId: body.planId,
            planName: body.planName,
            billingCycle: body.billingCycle,
            paymentMethod: body.paymentMethod,
            amount,
            credits,
            walletId: body.walletId,
          },
          getActorId(req, url),
        ),
      );
    }),
    route("GET", "/api/wallet/recharge-orders/:orderId", ({ params, req, url }) => {
      const order = store.getWalletRechargeOrder(params.orderId, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
    routeWithStatus("POST", "/api/wallet/recharge-orders/:orderId/confirm", 200, ({ params, req, url }) => {
      const order = store.confirmWalletRechargeOrder(params.orderId, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
  ];
}

function buildApiCenterRoutes(store) {
  return [
    route("GET", "/api/api-center", ({ req, url }) =>
      ok(store.getApiCenterConfig(getActorId(req, url)))
    ),
    route("PUT", "/api/api-center/defaults", async ({ req, url }) => {
      const body = await readJsonBody(req);
      return ok(store.updateApiCenterDefaults(body, getActorId(req, url)));
    }),
    route("PUT", "/api/api-center/vendors/:vendorId/api-key", async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return ok(
        store.saveApiCenterVendorApiKey(params.vendorId, body.apiKey, getActorId(req, url))
      );
    }),
    route("POST", "/api/api-center/vendors/:vendorId/test", async ({ params, req, url }) =>
      ok(await store.testApiCenterVendorConnection(params.vendorId, getActorId(req, url)))
    ),
    route(
      "PUT",
      "/api/api-center/vendors/:vendorId/models/:modelId",
      async ({ params, req, url }) => {
        const body = await readJsonBody(req);
        return ok(
          store.updateApiVendorModel(
            params.vendorId,
            params.modelId,
            body,
            getActorId(req, url)
          )
        );
      }
    ),
  ];
}

function buildCreateRoutes(store) {
  return [
    route("GET", "/api/create/images", () =>
      ok({ items: store.listCreateImages() })
    ),
    routeWithStatus("POST", "/api/create/images/generate", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeCreateImageTask({
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    route("GET", "/api/create/videos", () =>
      ok({ items: store.listCreateVideos() })
    ),
    routeWithStatus("POST", "/api/create/videos/generate", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeCreateVideoTask({
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    })
  ];
}

function buildProjectRoutes(store) {
  return [
    route("GET", "/api/projects", ({ req, url }) => {
      const pagination = parsePagination(url);
      return ok(
        store.listProjects(pagination.page, pagination.pageSize, getActorId(req, url)),
        pagination,
      );
    }),
    routeWithStatus("POST", "/api/projects", 201, async ({ req, url }) => {
      const body = await readJsonBody(req);
      if (!body.title) return failure(400, "BAD_REQUEST", "title is required");
      return ok(store.createProject(body, getActorId(req, url)));
    }),
    route("GET", "/api/projects/:projectId", ({ params, req, url }) => {
      const project = store.getProject(params.projectId, getActorId(req, url));
      if (!project) return failure(404, "NOT_FOUND", "project not found");
      return ok(project);
    }),
    route("PUT", "/api/projects/:projectId", async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      const project = store.updateProject(params.projectId, body, getActorId(req, url));
      if (!project) return failure(404, "NOT_FOUND", "project not found");
      return ok(project);
    }),
    route("GET", "/api/projects/:projectId/overview", ({ params, req, url }) => {
      const overview = store.getProjectOverview(params.projectId, getActorId(req, url));
      if (!overview) return failure(404, "NOT_FOUND", "project not found");
      return ok(overview);
    }),
    route("GET", "/api/projects/:projectId/credit-quote", ({ params, req, url }) => {
      const actionCode = url.searchParams.get("action");
      if (!actionCode) {
        return failure(400, "BAD_REQUEST", "action is required");
      }

      return ok(
        store.getProjectCreditQuote(
          params.projectId,
          actionCode,
          {
            sourceText: url.searchParams.get("sourceText") || undefined,
            text: url.searchParams.get("text") || undefined,
            count: Number(url.searchParams.get("count") || "0") || undefined,
            shotCount: Number(url.searchParams.get("shotCount") || "0") || undefined,
            storyboardId: url.searchParams.get("storyboardId") || undefined,
          },
          getActorId(req, url),
        ),
      );
    }),
    route("GET", "/api/projects/:projectId/settings", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const settings = store.getSettings(params.projectId);
      if (!settings) return failure(404, "NOT_FOUND", "project settings not found");
      return ok(settings);
    }),
    route("PUT", "/api/projects/:projectId/settings", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const settings = store.updateSettings(params.projectId, body);
      if (!settings) return failure(404, "NOT_FOUND", "project settings not found");
      return ok(settings);
    }),
    route("GET", "/api/projects/:projectId/script", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const script = store.getScript(params.projectId);
      if (!script) return failure(404, "NOT_FOUND", "script not found");
      return ok(script);
    }),
    route("PUT", "/api/projects/:projectId/script", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      if (typeof body.content !== "string") return failure(400, "BAD_REQUEST", "content is required");
      const script = store.updateScript(params.projectId, body.content);
      if (!script) return failure(404, "NOT_FOUND", "script not found");
      return ok(script);
    }),
    routeWithStatus("POST", "/api/projects/:projectId/script/rewrite", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      if (!body.instruction) return failure(400, "BAD_REQUEST", "instruction is required");
      return accepted(
        store.makeScriptRewriteTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/assets", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const assetType = url.searchParams.get("assetType");
      return ok({ items: store.listAssets(params.projectId, assetType) });
    }),
    routeWithStatus("POST", "/api/projects/:projectId/assets/extract", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeAssetExtractTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    routeWithStatus("POST", "/api/projects/:projectId/assets", 201, async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      if (!body.assetType || !body.name) {
        return failure(400, "BAD_REQUEST", "assetType and name are required");
      }
      const asset = store.createAsset(params.projectId, body);
      if (!asset) return failure(404, "NOT_FOUND", "project not found");
      return ok(asset);
    }),
    route("GET", "/api/projects/:projectId/assets/:assetId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const asset = store.getAsset(params.projectId, params.assetId);
      if (!asset) return failure(404, "NOT_FOUND", "asset not found");
      return ok(asset);
    }),
    route("PUT", "/api/projects/:projectId/assets/:assetId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const asset = store.updateAsset(params.projectId, params.assetId, body);
      if (!asset) return failure(404, "NOT_FOUND", "asset not found");
      return ok(asset);
    }),
    routeWithStatus(
      "POST",
      "/api/projects/:projectId/assets/:assetId/images/generate",
      202,
      async ({ params, req, url }) => {
        store.assertProjectAccess(params.projectId, getActorId(req, url));
        const asset = store.getAsset(params.projectId, params.assetId);
        if (!asset) return failure(404, "NOT_FOUND", "asset not found");

        const body = await readJsonBody(req);
        return accepted(
          store.makeAssetImageGenerateTask(params.projectId, params.assetId, {
            ...body,
            actorId: getActorId(req, url),
          }),
        );
      }
    ),
    routeWithStatus("DELETE", "/api/projects/:projectId/assets/:assetId", 200, ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const removed = store.deleteAsset(params.projectId, params.assetId);
      if (!removed) return failure(404, "NOT_FOUND", "asset not found");
      return ok({ deleted: true, assetId: params.assetId });
    }),
    route("GET", "/api/projects/:projectId/storyboards", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listStoryboards(params.projectId) });
    }),
    routeWithStatus("POST", "/api/projects/:projectId/storyboards/auto-generate", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeStoryboardGenerateTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/storyboards/:storyboardId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const storyboard = store.getStoryboard(params.projectId, params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok(storyboard);
    }),
    route("PUT", "/api/projects/:projectId/storyboards/:storyboardId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const storyboard = store.updateStoryboard(params.projectId, params.storyboardId, body);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok(storyboard);
    }),
    routeWithStatus("DELETE", "/api/projects/:projectId/storyboards/:storyboardId", 200, ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const removed = store.deleteStoryboard(params.projectId, params.storyboardId);
      if (!removed) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok({ deleted: true, storyboardId: params.storyboardId });
    }),
    route("GET", "/api/projects/:projectId/videos", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listVideos(params.projectId) });
    }),
    route("GET", "/api/projects/:projectId/videos/:videoId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const video = store.getVideo(params.projectId, params.videoId);
      if (!video) return failure(404, "NOT_FOUND", "video not found");
      return ok(video);
    }),
    route("GET", "/api/projects/:projectId/dubbings", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listDubbings(params.projectId) });
    }),
    route("GET", "/api/projects/:projectId/dubbings/:dubbingId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const dubbing = store.getDubbing(params.projectId, params.dubbingId);
      if (!dubbing) return failure(404, "NOT_FOUND", "dubbing not found");
      return ok(dubbing);
    }),
    route("PUT", "/api/projects/:projectId/dubbings/:dubbingId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const dubbing = store.updateDubbing(params.projectId, params.dubbingId, body);
      if (!dubbing) return failure(404, "NOT_FOUND", "dubbing not found");
      return ok(dubbing);
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/images/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeImageGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/videos/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeVideoGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/dubbings/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeDubbingGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/lipsync/generate", 202, ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      return accepted(
        store.makeLipSyncTask(params.storyboardId, {
          actorId,
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/tasks", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listTasks(params.projectId, getActorId(req, url)) });
    }),
    route("GET", "/api/projects/:projectId/timeline", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const timeline = store.getTimeline(params.projectId);
      if (!timeline) return failure(404, "NOT_FOUND", "timeline not found");
      return ok(timeline);
    }),
    route("PUT", "/api/projects/:projectId/timeline", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const timeline = store.updateTimeline(params.projectId, body);
      if (!timeline) return failure(404, "NOT_FOUND", "timeline not found");
      return ok(timeline);
    }),
    routeWithStatus("POST", "/api/projects/:projectId/exports", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeExportTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    })
  ];
}

function buildTaskRoutes(store) {
  return [
    route("GET", "/api/tasks", ({ req, url }) =>
      ok({ items: store.listTasks(url.searchParams.get("projectId"), getActorId(req, url)) })
    ),
    route("GET", "/api/tasks/:taskId", ({ params, req, url }) => {
      const task = store.getTask(params.taskId, getActorId(req, url));
      if (!task) return failure(404, "NOT_FOUND", "task not found");
      return ok(task);
    })
  ];
}

function buildToolboxRoutes(store) {
  return [
    route("GET", "/api/toolbox", () =>
      ok({
        items: store.getToolboxCapabilities(),
        stagingArea: ["character_replace", "motion_transfer", "upscale_restore"]
      })
    ),
    route("GET", "/api/toolbox/capabilities", () =>
      ok({
        items: store.getToolboxCapabilities(),
        stagingArea: ["character_replace", "motion_transfer", "upscale_restore"]
      })
    ),
    routeWithStatus("POST", "/api/toolbox/character-replace", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("character_replace", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    routeWithStatus("POST", "/api/toolbox/motion-transfer", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("motion_transfer", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    routeWithStatus("POST", "/api/toolbox/upscale-restore", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("upscale_restore", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    })
  ];
}

function buildAdminRoutes(store) {
  return [
    route("GET", "/api/admin/pricing-rules", ({ req, url }) =>
      ok({ items: store.listPricingRules(getActorId(req, url)) })
    ),
    route("GET", "/api/admin/orders", ({ req, url }) =>
      ok({ items: store.listAdminOrders(getActorId(req, url)) })
    ),
    route("GET", "/api/organizations/:id/members", ({ params, req, url }) =>
      ok({ items: store.listOrganizationMembers(params.id, getActorId(req, url)) })
    ),
    route("GET", "/api/organizations/:id/wallet", ({ params, req, url }) =>
      ok(store.getOrganizationWallet(params.id, getActorId(req, url)))
    ),
    route("GET", "/api/enterprise-applications", ({ req, url }) =>
      ok({ items: store.listEnterpriseApplications(getActorId(req, url)) })
    ),
    routeWithStatus("POST", "/api/enterprise-applications", 201, async ({ req }) => {
      const body = await readJsonBody(req);
      if (!body.companyName || !body.contactName || !body.contactPhone) {
        return failure(400, "BAD_REQUEST", "companyName, contactName and contactPhone are required");
      }
      return ok(store.createEnterpriseApplication(body));
    })
  ];
}

module.exports = {
  buildRoutes
};
