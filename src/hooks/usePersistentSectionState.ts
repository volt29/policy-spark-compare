import { useCallback, useEffect, useMemo, useState } from "react";

export type SectionStateMap = Record<string, boolean>;

interface UsePersistentSectionStateOptions {
  defaults?: SectionStateMap;
}

const readStoredState = (storageKey: string): SectionStateMap => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SectionStateMap;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return {};
};

const writeStoredState = (storageKey: string, state: SectionStateMap) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    /* ignore */
  }
};

export const usePersistentSectionState = (
  comparisonId: string,
  sectionIds: string[],
  { defaults }: UsePersistentSectionStateOptions = {},
) => {
  const storageKey = useMemo(
    () => `comparison:${comparisonId}:sections`,
    [comparisonId],
  );

  const [state, setState] = useState<SectionStateMap>(() => {
    const stored = readStoredState(storageKey);
    return { ...(defaults ?? {}), ...stored };
  });

  useEffect(() => {
    const stored = readStoredState(storageKey);
    setState({ ...(defaults ?? {}), ...stored });
  }, [storageKey, defaults]);

  useEffect(() => {
    writeStoredState(storageKey, state);
  }, [state, storageKey]);

  const memoSectionIds = useMemo(() => [...sectionIds], [sectionIds]);

  useEffect(() => {
    setState((prev) => {
      const next = { ...prev };
      let changed = false;
      memoSectionIds.forEach((id) => {
        if (!(id in next) && defaults && id in defaults) {
          next[id] = defaults[id];
          changed = true;
        } else if (!(id in next)) {
          next[id] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [memoSectionIds, defaults]);

  const isSectionOpen = useCallback(
    (id: string, fallback = false) => {
      if (id in state) {
        return state[id];
      }
      if (defaults && id in defaults) {
        return defaults[id];
      }
      return fallback;
    },
    [state, defaults],
  );

  const toggleSection = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? (defaults ? defaults[id] : true)),
    }));
  }, [defaults]);

  const setSectionState = useCallback((id: string, open: boolean) => {
    setState((prev) => ({
      ...prev,
      [id]: open,
    }));
  }, []);

  return {
    state,
    isSectionOpen,
    toggleSection,
    setSectionState,
  };
};
