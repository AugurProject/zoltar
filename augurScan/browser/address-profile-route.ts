import type { AccountTransaction, LoadOptions, NetworkRecord, RichListRecord } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-update.ts'
import { decodeOperationsResponseValue, operationRecords, type OperationsResponse } from './api-validation.ts'
import { decodeItemsPage, decodeValue, isAccountTransaction, isAddressIdentity, isRichListRecord } from './api-decoding.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest, mergeUniqueRecords, refreshPresentation } from './live-update.ts'
import { PORTFOLIO_KIND_LABELS, portfolioItems, portfolioItemKey, portfolioPage } from './portfolio-helpers.ts'

interface AddressProfileRouteDeps {
	renderAddressProfile: (item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], options?: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' }) => void
	lookup: {
		(selector: '#address-back'): HTMLAnchorElement
		(selector: string): HTMLElement
	}
	element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	api: (path: string) => Promise<unknown>
	getPageUrl: () => URL
	getViewContextVersion: () => number
	selectedChainId: () => string
	requiredChainId: () => string
	getNetworks: () => readonly NetworkRecord[]
	isDemo: boolean
	canonicalState: CanonicalState
	refreshGate: RefreshGate
	errorMessage: (error: unknown) => string
	retryCanonicalViewOr: (fallback: () => Promise<boolean>) => Promise<boolean>
}

export const createAddressProfileRoute = (deps: AddressProfileRouteDeps) => {
	const { renderAddressProfile, element, api, selectedChainId, requiredChainId, isDemo, canonicalState, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let version = 0
	let currentAddressProfile: RichListRecord | undefined
	let currentAddressPortfolioDepths: { readonly chainId: string; readonly address: string; readonly forks: number; readonly lp: number; readonly reports: number } | undefined
	const decodeOperationsResponse = decodeOperationsResponseValue
	const loadAddressPortfolioSnapshot = async (address: string, targets: Readonly<Record<'forks' | 'lp' | 'reports', number>>): Promise<OperationsResponse> => {
		const initialQuery = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
		const first = decodeOperationsResponse(await api(`/api/v1/state/address-portfolio?${initialQuery.toString()}`))
		const snapshotIdentity = `${first.chainId}:${String(first.asOf['blockNumber'] ?? '')}:${String(first.asOf['blockHash'] ?? '')}`
		const collections = {
			forks: portfolioItems(first.data, 'forks'),
			lp: portfolioItems(first.data, 'lp'),
			reports: portfolioItems(first.data, 'reports'),
		}
		const pages = {
			forks: portfolioPage(first.data, 'forks'),
			lp: portfolioPage(first.data, 'lp'),
			reports: portfolioPage(first.data, 'reports'),
		}
		for (const kind of ['lp', 'forks', 'reports'] as const) {
			while (collections[kind].length < targets[kind] && pages[kind]['hasMore'] === true && typeof pages[kind]['nextCursor'] === 'string') {
				const query = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
				query.set(PORTFOLIO_KIND_LABELS[kind].cursorParameter, pages[kind]['nextCursor'])
				const response = decodeOperationsResponse(await api(`/api/v1/state/address-portfolio?${query.toString()}`))
				const responseIdentity = `${response.chainId}:${String(response.asOf['blockNumber'] ?? '')}:${String(response.asOf['blockHash'] ?? '')}`
				if (responseIdentity !== snapshotIdentity) throw new Error('Portfolio history changed while older evidence was loading; retry from the latest available block')
				collections[kind] = mergeUniqueRecords(collections[kind], portfolioItems(response.data, kind), item => portfolioItemKey(kind, item))
				pages[kind] = portfolioPage(response.data, kind)
			}
		}
		return {
			...first,
			data: {
				...first.data,
				lp_positions: collections.lp,
				fork_participation: collections.forks,
				report_participation: collections.reports,
				portfolioPagination: pages,
			},
		}
	}

	const performLoadAddressProfile = async ({ live = false, contextVersion, portfolioTarget }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const requestVersion = ++version
		const content = $('#address-profile-content')
		const hadProfile = content.querySelector<HTMLElement>('[data-live-key]') !== null
		const requestedAddress = (location.pathname.startsWith('/address/') ? location.pathname.slice('/address/'.length) : deps.getPageUrl().searchParams.get('address'))?.toLowerCase()
		const backParams = new URLSearchParams({ chainId: requiredChainId() })
		if (isDemo) backParams.set('demo', '1')
		$('#address-back').href = `/richlist?${backParams}`
		if (requestedAddress === undefined || !/^0x[0-9a-f]{40}$/.test(requestedAddress)) {
			content.replaceChildren(element('div', 'detail-error', 'A complete 20-byte address is required.'))
			content.setAttribute('aria-busy', 'false')
			return false
		}
		const address = requestedAddress
		const presentation = refreshPresentation({ live })
		content.setAttribute('aria-busy', String(presentation.busy))
		if (presentation.loadingState) content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
		if (presentation.loadingState && !hadProfile) content.replaceChildren(element('p', 'detail-status', 'Loading address activity…'), element('div', 'loading-line'))
		try {
			const retainedPortfolioDepths = currentAddressPortfolioDepths?.chainId === requiredChainId() && currentAddressPortfolioDepths.address === address ? currentAddressPortfolioDepths : { chainId: requiredChainId(), address, forks: 0, lp: 0, reports: 0 }
			const portfolioTargets = {
				forks: portfolioTarget?.kind === 'forks' ? portfolioTarget.count : retainedPortfolioDepths.forks,
				lp: portfolioTarget?.kind === 'lp' ? portfolioTarget.count : retainedPortfolioDepths.lp,
				reports: portfolioTarget?.kind === 'reports' ? portfolioTarget.count : retainedPortfolioDepths.reports,
			}
			const [portfolio, identity, transactions, interactions] = await Promise.all([
				loadAddressPortfolioSnapshot(address, portfolioTargets),
				api(`/api/v1/address-identity?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}`).then(value => decodeValue(value, isAddressIdentity, 'Address identity')),
				api(`/api/v1/address-transactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address transactions')),
				api(`/api/v1/address-interactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address interactions')),
			])
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, version) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			const network = deps.getNetworks().find(candidate => String(candidate.chain_id) === selectedChainId())
			const profileItem = isRichListRecord(portfolio.data) ? portfolio.data : undefined
			const item = profileItem
				? { ...profileItem, ...portfolio.data, label: profileItem.label ?? identity.label, kind: profileItem.kind ?? identity.kind }
				: {
						chain_id: selectedChainId(),
						address,
						label: identity.label,
						kind: identity.kind,
						explorer_base_url: network?.explorer_base_url ?? '',
						transaction_count: transactions.total ?? transactions.items.length,
						interaction_count: interactions.total ?? interactions.items.length,
						pool_count: 0,
						vault_count: 0,
						largest_rep_token_address: null,
						largest_rep_balance: null,
						largest_rep_decimals: null,
						largest_rep_symbol: null,
						rep_balances: [],
						weth_balances: [],
						native_balance_detail: { balance: '0', blockNumber: network?.indexed_block ?? '0' },
						pool_associations: [],
						vault_positions: [],
						...portfolio.data,
					}
			renderAddressProfile(item, transactions.items, interactions.items, { live, portfolioFocusKind: portfolioTarget?.kind })
			currentAddressProfile = item
			currentAddressPortfolioDepths = {
				chainId: requiredChainId(),
				address,
				forks: operationRecords(portfolio.data['fork_participation']).length,
				lp: operationRecords(portfolio.data['lp_positions']).length,
				reports: operationRecords(portfolio.data['report_participation']).length,
			}
			return true
		} catch (error) {
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, version) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			if (hadProfile && canonicalState.refreshRequired) {
				content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
				content.setAttribute('aria-busy', 'false')
				return false
			}
			const alert = element('div', `detail-error${hadProfile ? ' address-refresh-error' : ''}`)
			alert.setAttribute('role', 'alert')
			alert.append(element('p', '', hadProfile ? `Refresh failed; showing last known address state: ${errorMessage(error)}` : `Could not load address: ${errorMessage(error)}`))
			const retry = element('button', 'state-retry', 'Retry')
			retry.type = 'button'
			retry.addEventListener('click', () => retryCanonicalViewOr(loadAddressProfile))
			alert.append(retry)
			if (hadProfile) {
				content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
				content.prepend(alert)
			} else content.replaceChildren(alert)
			content.setAttribute('aria-busy', 'false')
			return false
		}
	}

	const loadAddressProfile = (options: LoadOptions = {}): Promise<boolean> => {
		const contextVersion = deps.getViewContextVersion()
		const operation = () => performLoadAddressProfile({ ...options, contextVersion })
		return options.live === true ? deps.refreshGate.runBackground(operation) : deps.refreshGate.runForeground(operation)
	}

	return {
		get profile() {
			return currentAddressProfile
		},
		loadAddressProfile,
		invalidate() {
			version++
		},
		clear() {
			currentAddressProfile = undefined
			currentAddressPortfolioDepths = undefined
		},
	}
}
