import type { LiveEventPayload } from './browser-types.ts'
export type DemoContext = { readonly pageUrl: URL; readonly canonicalRefreshRequired: boolean; selectedChainId(): string }
type DemoRuntime = { api(path: string, options?: { signal?: AbortSignal }): Promise<unknown>; applyBlock(payload: LiveEventPayload): void; observeReorg(address: string | undefined): void }
export type DemoFactory = (context: DemoContext) => DemoRuntime
