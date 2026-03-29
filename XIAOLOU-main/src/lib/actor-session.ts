import { useEffect, useState } from "react";

export const DEFAULT_ACTOR_ID = "user_demo_001";
const ACTOR_STORAGE_KEY = "xiaolou-current-actor-id";
const ACTOR_CHANGE_EVENT = "xiaolou:actor-change";

function normalizeActorId(actorId: string | null | undefined) {
  const normalized = typeof actorId === "string" ? actorId.trim() : "";
  return normalized || DEFAULT_ACTOR_ID;
}

export function getCurrentActorId() {
  if (typeof window === "undefined") {
    return DEFAULT_ACTOR_ID;
  }

  return normalizeActorId(window.localStorage.getItem(ACTOR_STORAGE_KEY));
}

export function setCurrentActorId(actorId: string) {
  if (typeof window === "undefined") return;
  const nextActorId = normalizeActorId(actorId);
  window.localStorage.setItem(ACTOR_STORAGE_KEY, nextActorId);
  window.dispatchEvent(new CustomEvent(ACTOR_CHANGE_EVENT, { detail: nextActorId }));
}

export function subscribeActorChange(listener: (actorId: string) => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACTOR_STORAGE_KEY) {
      listener(normalizeActorId(event.newValue));
    }
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    listener(normalizeActorId(customEvent.detail));
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ACTOR_CHANGE_EVENT, handleCustomEvent as EventListener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ACTOR_CHANGE_EVENT, handleCustomEvent as EventListener);
  };
}

export function useActorId() {
  const [actorId, setActorId] = useState(DEFAULT_ACTOR_ID);

  useEffect(() => {
    setActorId(getCurrentActorId());
    return subscribeActorChange(setActorId);
  }, []);

  return actorId;
}
