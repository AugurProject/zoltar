import type { RichListRecord } from './browser-types.ts'
import type { ScannerElements } from './app-dom.ts'
import type { ScannerState } from './app-state.ts'
import type { createQueryCache } from './query-cache.ts'

type ScannerApi = (path: string, options?: { signal?: AbortSignal }) => Promise<unknown>

/**
 * Cross-module operations whose implementations are created after their first consumers.
 * `startScanner` assigns each entry once the owning module exists; calling one earlier is a wiring bug.
 */
interface ScannerLinks {
	requestRouteRefresh: (count?: number, force?: boolean) => Promise<boolean>
	refreshCanonicalViews: (title: string, detail: string) => Promise<boolean>
	resetSelectedNetworkContext: () => void
	navigateInPlace: (url: URL, replace?: boolean) => Promise<void>
	richListItems: () => RichListRecord[]
	addressProfile: () => RichListRecord | undefined
}

const unlinked = (name: string) => (): never => {
	throw new Error(`AugurScan ${name} was used before it was initialized`)
}

export const createScannerLinks = (): ScannerLinks => ({
	requestRouteRefresh: unlinked('requestRouteRefresh'),
	refreshCanonicalViews: unlinked('refreshCanonicalViews'),
	resetSelectedNetworkContext: unlinked('resetSelectedNetworkContext'),
	navigateInPlace: unlinked('navigateInPlace'),
	richListItems: unlinked('richListItems'),
	addressProfile: unlinked('addressProfile'),
})

/** Page-wide services and state passed to every scanner module. */
export interface ScannerContext {
	readonly state: ScannerState
	readonly elements: ScannerElements
	readonly links: ScannerLinks
	readonly api: ScannerApi
	readonly queryCache: ReturnType<typeof createQueryCache>
	readonly selectedChainId: () => string
	readonly requiredChainId: () => string
	readonly nativeSymbol: (chainId?: string) => string
	readonly age: (value: string | number | Date | null | undefined) => string
	readonly until: (value: string | number | Date | null | undefined) => string
	readonly retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
}
