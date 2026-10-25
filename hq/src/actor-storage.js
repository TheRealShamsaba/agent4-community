// Scope private drafts to the account that created them. The provider is read
// lazily so blocked browser storage remains a recoverable convenience failure.
export function createActorStorage(namespace, actorId, provider) {
  const key = `${namespace}:${actorId}`;
  return {
    read(fallback) {
      if (!actorId) return fallback;
      try { return JSON.parse(provider().getItem(key) || 'null') ?? fallback; } catch { return fallback; }
    },
    write(value) {
      if (!actorId) return false;
      try { provider().setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    }
  };
}
