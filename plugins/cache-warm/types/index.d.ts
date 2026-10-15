// Contract for cache-warm: the values it keeps in $.state.

/** One main-thread response's prompt-cache figures, or a keep-warm ping's. */
export type CacheWarmReply = {
  /** When it landed, epoch milliseconds. */
  at: number
  /** Input tokens the cache served. */
  read: number
  /** Input tokens written to the cache. */
  written: number
  /** Input tokens neither read nor written. */
  uncached: number
  /** A keep-warm ping rather than a reply of the conversation. */
  isPing: boolean
}

/** Token sums over the session's main-thread replies (pings counted apart). */
export type CacheWarmTotals = {
  read: number
  written: number
  uncached: number
  /** Reads priced against an uncached token on the model that answered (0.1×, 0.025× on Claude Fable 5.1); absent in snapshots from before 1.0.1. */
  readCost?: number
}

/** What is known about the main conversation's prompt cache. */
export type CacheWarmSnapshot = {
  /** When the request that last wrote or read the cache started (the TTL runs from there); null when nothing is cached. */
  lastAt: number | null
  /** The cache's time to live in milliseconds (300000 or 3600000). */
  ttlMs: number
  /** True once the TTL was read from a real response or the engine. */
  isTtlKnown: boolean
  /** Prompt tokens the next request re-sends: what a cold cache rewrites. */
  prefixTokens: number
  /** The last replies, oldest first, at most 32. */
  replies: CacheWarmReply[]
  totals: CacheWarmTotals
  /** Keep-warm pings this session that reached the cache. */
  pings: number
  /** Tokens those pings read from the cache. */
  pingRead: number
  /** When the last ping landed; null before any. */
  lastPingAt: number | null
  /** Times the cache lapsed between two replies (a rewrite the next message paid). */
  lapses: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-warm': {
      snapshot: CacheWarmSnapshot | null
      /** The band is shown (the Cache button, /cache-warm). */
      isOpen: boolean
      /** Folded to one line, the default (the chevron, /cache-warm-collapse); mirrored to $.store. */
      isCollapsed: boolean
      /** Pings the cache by itself before it lapses while idle (/cache-warm-auto); mirrored to $.store. */
      isAuto: boolean
      /** A keep-warm ping is in flight. */
      isPinging: boolean
      /** The clock, written when a figure the band shows would change. */
      now: number
    }
  }
}
