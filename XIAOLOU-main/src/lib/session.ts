import { useEffect, useState } from "react";
import { listProjects } from "./api";

export const DEFAULT_PROJECT_ID = "proj_demo_001";
const STORAGE_KEY = "xiaolou-current-project-id";
const SCRIPT_DRAFT_KEY_PREFIX = "xiaolou-script-draft:";

function normalizeProjectId(projectId: string | null | undefined) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  return normalizedProjectId || DEFAULT_PROJECT_ID;
}

export function getCurrentProjectId() {
  if (typeof window === "undefined") {
    return DEFAULT_PROJECT_ID;
  }

  return normalizeProjectId(window.localStorage.getItem(STORAGE_KEY));
}

export function setCurrentProjectId(projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, normalizeProjectId(projectId));
}

function getScriptDraftStorageKey(projectId: string) {
  return `${SCRIPT_DRAFT_KEY_PREFIX}${projectId}`;
}

export function getScriptDraft(projectId: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(getScriptDraftStorageKey(projectId));
}

export function setScriptDraft(projectId: string, content: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getScriptDraftStorageKey(projectId), content);
}

export function clearScriptDraft(projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getScriptDraftStorageKey(projectId));
}

export function useCurrentProjectId() {
  const [projectId, setProjectIdState] = useState(DEFAULT_PROJECT_ID);

  useEffect(() => {
    let active = true;

    const syncProjectId = async () => {
      const storedProjectId = getCurrentProjectId();

      try {
        const projectResponse = await listProjects();
        const availableProjectIds = projectResponse.items.map((item) => item.id);
        const nextProjectId =
          availableProjectIds.find((item) => item === storedProjectId) ||
          availableProjectIds.find((item) => item === DEFAULT_PROJECT_ID) ||
          availableProjectIds[0] ||
          DEFAULT_PROJECT_ID;

        setCurrentProjectId(nextProjectId);
        if (active) {
          setProjectIdState(nextProjectId);
        }
      } catch {
        if (active) {
          setProjectIdState(storedProjectId);
        }
      }
    };

    void syncProjectId();

    return () => {
      active = false;
    };
  }, []);

  const update = (nextProjectId: string) => {
    const normalizedProjectId = normalizeProjectId(nextProjectId);
    setCurrentProjectId(normalizedProjectId);
    setProjectIdState(normalizedProjectId);
  };

  return [projectId, update] as const;
}
