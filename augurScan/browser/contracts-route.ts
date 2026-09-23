import type { ContractRecord, LoadOptions } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest, refreshPresentation } from './live-update.ts'
import { decodeItemsPage, isContractRecord } from './api-decoding.ts'
import { renderContractsPage } from './contracts-page.ts'

interface ContractsRouteDeps {
	lookup: (selector: string) => HTMLElement
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	internalEvidenceLink: (base: string, type: string, value: string | number, label: string) => HTMLAnchorElement
	number: (value: string | number | bigint | null | undefined) => string
	age: (value: string | number | Date | null | undefined) => string
	exactTimestamp: (value: string | number | Date | null | undefined) => string
	api: (path: string) => Promise<unknown>
	requiredChainId: () => string
	getViewContextVersion: () => number
	canonicalState: CanonicalState
	refreshGate: RefreshGate
	errorMessage: (error: unknown) => string
	renderRetryStatus: (status: HTMLElement, message: string, retry: () => Promise<boolean>) => void
	retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
}

export const createContractsRoute = (deps: ContractsRouteDeps) => {
	const { element, internalEvidenceLink, number, age, exactTimestamp, api, requiredChainId, canonicalState, errorMessage, renderRetryStatus, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let items: ContractRecord[] = []
	let version = 0
	const renderContracts = () => renderContractsPage({ lookup: $, contractItems: items, element, internalEvidenceLink, number, age, exactTimestamp })

	const performLoadContracts = async ({ live = false, contextVersion }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const requestVersion = ++version
		const status = $('#contracts-status')
		const presentation = refreshPresentation({ live })
		if (presentation.loadingState) {
			status.hidden = false
			status.className = items.length === 0 ? 'system-status' : 'system-status sr-only'
			status.textContent = items.length === 0 ? 'Loading system contracts…' : 'Refreshing system contracts…'
		}
		$('#contract-list').setAttribute('aria-busy', String(presentation.busy))
		try {
			const result = decodeItemsPage(await api(`/api/v1/contracts?${new URLSearchParams({ chainId: requiredChainId() })}`), isContractRecord, 'Contracts')
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, version) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			items = result.items
			renderContracts()
			if (presentation.loadingState) {
				status.className = 'system-status sr-only'
				status.textContent = 'System contracts updated.'
			} else status.hidden = true
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, version) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			$('#contract-list').setAttribute('aria-busy', 'false')
			renderRetryStatus(status, items.length === 0 ? `Contract registry unavailable: ${errorMessage(error)}` : `Refresh failed; showing the last registry: ${errorMessage(error)}`, () => retryCanonicalViewOr(loadContracts))
			return false
		}
	}

	const loadContracts = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = deps.getViewContextVersion()
		const operation = () => performLoadContracts({ ...options, contextVersion })
		return options.live === true ? deps.refreshGate.runBackground(operation) : deps.refreshGate.runForeground(operation)
	}

	return {
		get items() {
			return items
		},
		renderContracts,
		loadContracts,
		invalidate() {
			version++
		},
		clear() {
			items = []
		},
	}
}
