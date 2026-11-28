import type { AccountTransaction, LoadOptions, NetworkRecord, RichListRecord } from './browser-types.ts'
import type { CanonicalState } from './canonical-state.ts'
import type { RefreshGate } from './live-refresh.ts'
import { decodeOperationsResponseValue, operationsSnapshotIdentity, type OperationsResponse } from './api-validation.ts'
import { decodeItemsPage, decodeValue, isAccountTransaction, isAddressIdentity, isRichListRecord } from './api-decoding.ts'
import { mergeUniqueRecords } from './canonical-pagination.ts'
import { isCurrentCanonicalGeneration, isCurrentContextRequest } from './live-refresh.ts'
import { refreshPresentation } from './refresh-presentation.ts'
import { type SecurityPoolKind, mapSecurityPoolKinds, SECURITY_POOL_KIND_LABELS, securityPoolItems, securityPoolItemKey, securityPoolPage } from './security-pool-helpers.ts'

interface AddressProfileRouteDeps {
	renderAddressProfile: (item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], options?: { live?: boolean; securityPoolFocusKind?: SecurityPoolKind | undefined }) => void
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

const addressProfileKey = (chainId: string, address: string): string => `${chainId}:${address.toLowerCase()}`

export const createAddressProfileRoute = (deps: AddressProfileRouteDeps) => {
	const { renderAddressProfile, element, api, selectedChainId, requiredChainId, isDemo, canonicalState, errorMessage, retryCanonicalViewOr } = deps
	const $ = deps.lookup
	let version = 0
	let currentAddressProfile: RichListRecord | undefined
	let renderedProfileKey: string | undefined
	let renderedProfileSignature: string | undefined
	let currentAddressSecurityPoolDepths: { readonly chainId: string; readonly address: string; readonly depths: Readonly<Record<SecurityPoolKind, number>> } | undefined
	const decodeOperationsResponse = decodeOperationsResponseValue
	const loadAddressSecurityPoolSnapshot = async (address: string, targets: Readonly<Record<SecurityPoolKind, number>>): Promise<OperationsResponse> => {
		const initialQuery = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
		const first = decodeOperationsResponse(await api(`/api/v1/state/address-security-pool?${initialQuery.toString()}`))
		const snapshotIdentity = operationsSnapshotIdentity(first)
		const collections = mapSecurityPoolKinds(kind => securityPoolItems(first.data, kind))
		const pages = mapSecurityPoolKinds(kind => securityPoolPage(first.data, kind))
		for (const kind of ['lp', 'forks', 'reports', 'positions'] as const) {
			while (collections[kind].length < targets[kind] && pages[kind]['hasMore'] === true && typeof pages[kind]['nextCursor'] === 'string') {
				const query = new URLSearchParams({ chainId: requiredChainId(), address, limit: '100' })
				query.set(SECURITY_POOL_KIND_LABELS[kind].cursorParameter, pages[kind]['nextCursor'])
				const response = decodeOperationsResponse(await api(`/api/v1/state/address-security-pool?${query.toString()}`))
				const responseIdentity = operationsSnapshotIdentity(response)
				if (responseIdentity !== snapshotIdentity) throw new Error('Security pool history changed while older evidence was loading; retry from the latest available block')
				collections[kind] = mergeUniqueRecords(collections[kind], securityPoolItems(response.data, kind), item => securityPoolItemKey(kind, item))
				pages[kind] = securityPoolPage(response.data, kind)
			}
		}
		return {
			...first,
			data: {
				...first.data,
				escalation_positions: collections.positions,
				lp_positions: collections.lp,
				fork_participation: collections.forks,
				report_participation: collections.reports,
				securityPoolPagination: pages,
			},
		}
	}

	const performLoadAddressProfile = async ({ live = false, contextVersion, securityPoolTarget }: LoadOptions = {}): Promise<boolean> => {
		if (contextVersion !== deps.getViewContextVersion()) return false
		const canonicalGeneration = canonicalState.dataGeneration
		const requestVersion = ++version
		const content = $('#address-profile-content')
		const requestedAddress = (location.pathname.startsWith('/address/') ? location.pathname.slice('/address/'.length) : deps.getPageUrl().searchParams.get('address'))?.toLowerCase()
		const backParams = new URLSearchParams({ chainId: requiredChainId() })
		if (isDemo) backParams.set('demo', '1')
		$('#address-back').href = `/addresses?${backParams}`
		if (requestedAddress === undefined || !/^0x[0-9a-f]{40}$/.test(requestedAddress)) {
			content.replaceChildren(element('div', 'detail-error', 'A complete 20-byte address is required.'))
			content.setAttribute('aria-busy', 'false')
			return false
		}
		const address = requestedAddress
		const profileKey = addressProfileKey(requiredChainId(), address)
		// Only a profile rendered for this exact chain and address may stay visible while it refreshes.
		const hadProfile = renderedProfileKey === profileKey && content.querySelector<HTMLElement>('[data-live-key]') !== null
		if (!hadProfile) {
			currentAddressProfile = undefined
			renderedProfileKey = undefined
			renderedProfileSignature = undefined
		}
		const presentation = refreshPresentation({ live })
		content.setAttribute('aria-busy', String(presentation.busy))
		if (presentation.loadingState) content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
		if (!hadProfile) content.replaceChildren(element('p', 'detail-status', 'Loading address activity…'), element('div', 'loading-line'))
		try {
			const retained = currentAddressSecurityPoolDepths?.chainId === requiredChainId() && currentAddressSecurityPoolDepths.address === address ? currentAddressSecurityPoolDepths.depths : undefined
			const securityPoolTargets = mapSecurityPoolKinds(kind => (securityPoolTarget?.kind === kind ? securityPoolTarget.count : (retained?.[kind] ?? 0)))
			const [securityPool, identity, transactions, interactions] = await Promise.all([
				loadAddressSecurityPoolSnapshot(address, securityPoolTargets),
				api(`/api/v1/address-identity?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}`).then(value => decodeValue(value, isAddressIdentity, 'Address identity')),
				api(`/api/v1/address-transactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address transactions')),
				api(`/api/v1/address-interactions?chainId=${encodeURIComponent(requiredChainId())}&address=${encodeURIComponent(address)}&limit=10`).then(value => decodeItemsPage(value, isAccountTransaction, 'Address interactions')),
			])
			if (!isCurrentContextRequest(contextVersion, deps.getViewContextVersion(), requestVersion, version) || !isCurrentCanonicalGeneration(canonicalGeneration, canonicalState.dataGeneration)) return false
			const network = deps.getNetworks().find(candidate => String(candidate.chain_id) === selectedChainId())
			const profileItem = isRichListRecord(securityPool.data) ? securityPool.data : undefined
			const item = profileItem
				? { ...profileItem, ...securityPool.data, label: profileItem.label ?? identity.label, kind: profileItem.kind ?? identity.kind }
				: {
						chain_id: selectedChainId(),
						address,
						label: identity.label,
						kind: identity.kind,
						explorer_base_url: network?.explorer_base_url ?? '',
						transaction_count: transactions.total ?? transactions.items.length,
						interaction_count: interactions.total ?? interactions.items.length,
						pool_count: 0,
						largest_rep_token_address: null,
						largest_rep_balance: null,
						largest_rep_decimals: null,
						largest_rep_symbol: null,
						rep_balances: [],
						weth_balances: [],
						native_balance_detail: null,
						pool_associations: [],
						...securityPool.data,
					}
			const signature = JSON.stringify([item, transactions.items, interactions.items])
			if (live && hadProfile && securityPoolTarget === undefined && signature === renderedProfileSignature) {
				// An unchanged profile keeps its nodes so focus and open disclosures survive the refresh.
				content.querySelector<HTMLElement>('.address-refresh-error')?.remove()
				content.setAttribute('aria-busy', 'false')
			} else renderAddressProfile(item, transactions.items, interactions.items, { live: live && hadProfile, securityPoolFocusKind: securityPoolTarget?.kind })
			renderedProfileKey = profileKey
			renderedProfileSignature = signature
			currentAddressProfile = item
			currentAddressSecurityPoolDepths = {
				chainId: requiredChainId(),
				address,
				depths: mapSecurityPoolKinds(kind => securityPoolItems(securityPool.data, kind).length),
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
			currentAddressSecurityPoolDepths = undefined
			renderedProfileKey = undefined
			renderedProfileSignature = undefined
		},
	}
}
