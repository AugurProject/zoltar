import type { AccountTransaction, ArgumentDefinition, LiveChangeOptions, LoadOptions, ProtocolAddressLinkOptions, RichListRecord } from './browser-types.ts'
import { operationRecords } from './api-validation.ts'
import { exactUnit } from './format.ts'
import { short, shortIdentifier } from './identifier-format.ts'
import { PORTFOLIO_KIND_LABELS, portfolioItems, portfolioPage } from './portfolio-helpers.ts'
import type { createOperationsComponents } from './operations-components.ts'

type Components = ReturnType<typeof createOperationsComponents>

export interface AddressProfileDeps {
	readonly lookup: (selector: string) => HTMLElement
	readonly liveSnapshot: (container: ParentNode, selector?: string) => Map<string, string>
	readonly nativeSymbol: (chainId?: string) => string
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly isDemo: boolean
	readonly setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement
	readonly operationsPanel: Components['operationsPanel']
	readonly operationRow: Components['operationRow']
	readonly operationCounted: (value: unknown, singular: string, plural?: string) => string
	readonly operationsHref: (pathname: string) => string
	readonly openAccountTransactions: (item: RichListRecord) => Promise<boolean>
	readonly internalEvidenceLink: (base: string, type: string, value: string | number, label: string) => HTMLAnchorElement
	readonly time: (value: string | number | Date | null | undefined) => string
	readonly decodedArgumentsTable: (schema: ArgumentDefinition[] | null | undefined, rawArguments: Record<string, unknown> | null | undefined, displayArguments: Record<string, unknown> | null | undefined, chainId: string) => HTMLElement
	readonly applyLiveChanges: (container: ParentNode, previous: ReadonlyMap<string, string>, options?: LiveChangeOptions) => unknown
	readonly loadAddressProfile: (options?: LoadOptions) => Promise<boolean>
}

export const renderAddressProfilePage = (deps: AddressProfileDeps, item: RichListRecord, transactions: AccountTransaction[], interactions: AccountTransaction[], { live = false, portfolioFocusKind }: { live?: boolean; portfolioFocusKind?: 'forks' | 'lp' | 'reports' } = {}) => {
	const { lookup: $, liveSnapshot, nativeSymbol, element, isDemo, setLiveRecord, number, protocolAddressLink, operationsPanel, operationRow, operationCounted, operationsHref, openAccountTransactions, internalEvidenceLink, time, decodedArgumentsTable, applyLiveChanges, loadAddressProfile } = deps
	const content = $('#address-profile-content')
	const previousSections = liveSnapshot(content, '[data-live-key]')
	const chainId = String(item.chain_id)
	const itemNativeSymbol = nativeSymbol(chainId)
	const header = element('header', 'address-profile-header')
	const identity = element('div')
	const heading = element('h2', '', item.label ?? 'Address')
	heading.id = 'address-profile-heading'
	identity.append(element('p', 'eyebrow', item.kind ? 'Protocol contract' : 'Account'), heading, element('code', 'address-profile-value', item.address))
	const actions = element('div', 'address-profile-actions')
	const logParams = new URLSearchParams({ chainId, address: item.address })
	if (isDemo) logParams.set('demo', '1')
	const relatedLogs = element('a', 'explorer-link', 'View related logs')
	relatedLogs.href = `/?${logParams}`
	actions.append(relatedLogs)
	header.append(identity, actions)
	setLiveRecord(header, 'identity', { label: item.label, kind: item.kind, address: item.address })
	const metrics = element('div', 'state-stats address-profile-stats')
	for (const [label, value] of [
		['Sent transactions', number(item.transaction_count)],
		['Observed interactions', number(item.interaction_count)],
		['Pools', number(item.pool_count)],
		['Vault positions', number(item.vault_count)],
	]) {
		const card = element('div', 'state-stat')
		card.append(element('span', '', label), element('strong', '', value))
		metrics.append(card)
	}
	setLiveRecord(metrics, 'metrics', {
		transactions: item.transaction_count,
		interactions: item.interaction_count,
		pools: item.pool_count,
		vaults: item.vault_count,
	})
	const balances = element('section', 'address-profile-panel')
	balances.append(element('p', 'eyebrow', 'Balances'), element('h3', '', 'Assets observed by augurScan'))
	const balanceGrid = element('div', 'address-balance-grid')
	const nativeCard = element('div', 'rich-token')
	nativeCard.append(element('strong', '', item.native_balance_detail ? exactUnit(item.native_balance_detail.balance, 18, itemNativeSymbol) : `${itemNativeSymbol} pending`), element('span', '', item.native_balance_detail ? `Block #${number(item.native_balance_detail.blockNumber)}` : 'No balance snapshot yet'))
	balanceGrid.append(nativeCard)
	for (const token of [...(item.weth_balances ?? []), ...(item.rep_balances ?? [])]) {
		const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
		const card = element('div', 'rich-token')
		card.append(
			element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP')),
			element('span', '', `${token.universeId === undefined || token.universeId === null ? 'Token' : `Universe ${shortIdentifier(token.universeId)}`} · block #${number(token.blockNumber)}`),
			protocolAddressLink(token.address, {
				knownLabel: token.contractLabel,
				chainId,
				className: 'rich-token-address address-link',
			}),
		)
		balanceGrid.append(card)
	}
	balances.append(balanceGrid)
	setLiveRecord(balances, 'balances', {
		native: item.native_balance_detail,
		weth: item.weth_balances,
		rep: item.rep_balances,
	})
	const involvement = element('section', 'address-profile-panel')
	involvement.append(element('p', 'eyebrow', 'Augur involvement'), element('h3', '', 'Pools and vaults'))
	const involvementGrid = element('div', 'rich-position-grid')
	for (const pool of item.pool_associations ?? []) {
		const card = element('div', 'rich-position')
		card.append(element('span', 'rich-position-kind', 'Pool'), element('strong', '', pool.questionTitle ?? pool.label ?? 'Security pool'), protocolAddressLink(pool.address, { knownLabel: pool.label, chainId, className: 'rich-token-address address-link' }))
		involvementGrid.append(card)
	}
	for (const position of item.vault_positions ?? []) {
		const card = element('div', 'rich-position')
		card.append(
			element('span', 'rich-position-kind', 'Vault'),
			element('strong', '', position.questionTitle ?? 'Vault position'),
			element('span', '', `${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP')} capacity · ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol)} claimable`),
			protocolAddressLink(position.poolAddress, { chainId, className: 'rich-token-address address-link' }),
		)
		involvementGrid.append(card)
	}
	if (involvementGrid.childElementCount === 0) involvementGrid.append(element('p', 'data-note', 'No pool or vault involvement matches this view.'))
	involvement.append(involvementGrid)
	setLiveRecord(involvement, 'involvement', { pools: item.pool_associations, vaults: item.vault_positions })
	const escalationClaims = operationsPanel(
		'Escalation interactions',
		(item.escalation_claims ?? []).map(claim => operationRow(String(claim['type'] ?? 'Escalation position'), `${String(claim['provenance'] ?? 'historical interaction')} · current claimability is unavailable`, String(claim['entity'] ?? ''), claim['blockNumber'])),
		'No escalation interactions are associated with this address.',
	)
	const auctionClaims = operationsPanel(
		'Auction interactions',
		(item.auction_claims ?? []).map(claim => operationRow(String(claim['type'] ?? 'Auction position'), `${String(claim['provenance'] ?? 'historical interaction')} · current entitlement is unavailable`, String(claim['entity'] ?? ''), claim['blockNumber'])),
		'No truth-auction interactions are associated with this address.',
	)
	const lpPositions = operationsPanel(
		'AMM liquidity positions',
		operationRecords(item['lp_positions']).map(position =>
			operationRow(
				String(position['question_title'] ?? 'Augur AMM market'),
				`${exactUnit(String(position['balance'] ?? '0'), 18, 'LP tokens')} · ${operationCounted(position['transfer_count'], 'transfer')}`,
				String(position['market_address'] ?? ''),
				undefined,
				operationsHref(`/operations/trading/${encodeURIComponent(String(position['market_address'] ?? ''))}`),
			),
		),
		'No current AMM liquidity-token position has been reconstructed for this address.',
	)
	const forkParticipation = operationsPanel(
		'Fork and migration participation',
		operationRecords(item['fork_participation']).map(event =>
			operationRow(String(event['event_name'] ?? 'Fork migration'), 'Canonical event evidence naming this address as migrator, vault, or recipient', String(event['universe_identity'] ?? ''), event['block_number'], operationsHref(`/operations/fork/${encodeURIComponent(String(event['universe_identity'] ?? ''))}`)),
		),
		'No fork or migration participation matches this view.',
	)
	const reportParticipation = operationsPanel(
		'OpenOracle reporting participation',
		operationRecords(item['report_participation']).map(event =>
			operationRow(
				`${String(event['event_name'] ?? 'Report')} · report ${String(event['report_id'] ?? '—')}`,
				`Round ${String(event['round_number'] ?? '—')} · canonical reporter evidence`,
				String(event['open_oracle_address'] ?? ''),
				event['block_number'],
				operationsHref(`/operations/report/${encodeURIComponent(String(event['open_oracle_address'] ?? ''))}/${encodeURIComponent(String(event['report_id'] ?? ''))}`),
			),
		),
		'No OpenOracle rounds identify this address as the current reporter.',
	)
	const appendPortfolioPagination = (kind: 'forks' | 'lp' | 'reports', panel: HTMLElement) => {
		const page = portfolioPage(item, kind)
		const items = portfolioItems(item, kind)
		const singular = PORTFOLIO_KIND_LABELS[kind].singular
		const total = typeof page['total'] === 'number' ? page['total'] : undefined
		panel.querySelector('h3')?.after(element('p', 'operations-panel-scope', `${operationCounted(items.length, singular)} shown · ${operationCounted(total, singular)} total`))
		if (page['hasMore'] === true && typeof page['nextCursor'] === 'string') {
			const button = element('button', 'secondary compact portfolio-history-more', `Show more ${PORTFOLIO_KIND_LABELS[kind].plural}`)
			button.type = 'button'
			button.dataset['portfolioKind'] = kind
			const status = element('p', 'activity-summary')
			status.setAttribute('role', 'status')
			status.setAttribute('aria-live', 'polite')
			button.addEventListener('click', async () => {
				const scrollY = window.scrollY
				button.disabled = true
				button.setAttribute('aria-busy', 'true')
				button.textContent = `Showing more ${PORTFOLIO_KIND_LABELS[kind].plural}…`
				status.textContent = 'Loading older account evidence…'
				status.classList.add('sr-only')
				const loaded = await loadAddressProfile({ live: true, portfolioTarget: { kind, count: items.length + 100 } })
				if (loaded) {
					const next = $('#address-profile-content').querySelector<HTMLElement>(`[data-portfolio-kind="${kind}"]`)
					next?.focus({ preventScroll: true })
					window.scrollTo({ top: scrollY, behavior: 'auto' })
				} else if (button.isConnected) {
					button.disabled = false
					button.removeAttribute('aria-busy')
					button.textContent = `Retry more ${PORTFOLIO_KIND_LABELS[kind].plural}`
					status.textContent = 'Additional account evidence could not be loaded.'
					status.classList.remove('sr-only')
					button.focus({ preventScroll: true })
				}
			})
			panel.append(button, status)
		} else if (portfolioFocusKind === kind) {
			const complete = element('p', 'activity-summary operations-pagination-complete', `All available ${singular}${singular.endsWith('s') ? '' : 's'} are shown.`)
			complete.dataset['portfolioKind'] = kind
			complete.tabIndex = -1
			complete.setAttribute('role', 'status')
			complete.setAttribute('aria-live', 'polite')
			panel.append(complete)
		}
	}
	appendPortfolioPagination('lp', lpPositions)
	appendPortfolioPagination('forks', forkParticipation)
	appendPortfolioPagination('reports', reportParticipation)
	const activity = element('section', 'address-profile-panel')
	const activityHeader = element('div', 'address-section-heading')
	const activityCopy = element('div')
	activityCopy.append(element('p', 'eyebrow', 'Account activity'), element('h3', '', 'Recent sent transactions'))
	activityHeader.append(activityCopy)
	const allTransactions = element('button', 'secondary', 'View all sent transactions')
	allTransactions.type = 'button'
	allTransactions.addEventListener('click', () => openAccountTransactions(item))
	activityHeader.append(allTransactions)
	const transactionList = element('div', 'address-transaction-list')
	for (const transaction of transactions) {
		const row = element('article', 'address-transaction-row')
		const destination = transaction.to_address
			? protocolAddressLink(transaction.to_address, {
					knownLabel: transaction.to_label,
					chainId: transaction.chain_id,
					className: 'address-link',
				})
			: element('span', '', 'Contract creation')
		row.append(
			internalEvidenceLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
			destination,
			element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
			element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)}`),
			element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol)),
		)
		transactionList.append(row)
	}
	if (transactions.length === 0) transactionList.append(element('p', 'data-note', 'No sent transactions match this view.'))
	activity.append(activityHeader, transactionList)
	const interactionPanel = element('section', 'address-profile-panel')
	interactionPanel.append(element('p', 'eyebrow', 'Augur activity'), element('h3', '', 'Recent protocol references'))
	const interactionList = element('div', 'address-transaction-list')
	for (const transaction of interactions) {
		const row = element('article', 'address-transaction-row address-interaction-row')
		const destination = transaction.to_address
			? protocolAddressLink(transaction.to_address, {
					knownLabel: transaction.to_label,
					chainId: transaction.chain_id,
					className: 'address-link',
				})
			: element('span', '', 'Contract creation')
		row.append(
			internalEvidenceLink(transaction.explorer_base_url, 'tx', transaction.tx_hash, short(transaction.tx_hash, 10, 8)),
			destination,
			element('span', '', transaction.action_summary ?? transaction.function_name ?? 'Unknown call'),
			element('span', '', `#${number(transaction.block_number)} · ${time(transaction.block_timestamp)}`),
			element('strong', '', exactUnit(transaction.value, 18, itemNativeSymbol)),
		)
		if (transaction.action_arguments && Object.keys(transaction.action_arguments).length > 0) {
			const action = element('details', 'account-transaction-action')
			const argumentsContent = element('div', 'account-transaction-arguments')
			argumentsContent.append(decodedArgumentsTable(transaction.action_argument_schema, transaction.action_arguments, transaction.action_display_arguments, transaction.chain_id))
			action.append(element('summary', '', 'Decoded arguments'), argumentsContent)
			row.append(action)
		}
		interactionList.append(row)
	}
	if (interactions.length === 0) interactionList.append(element('p', 'data-note', 'No protocol references match this view.'))
	interactionPanel.append(interactionList)
	setLiveRecord(interactionPanel, 'references', interactions)
	setLiveRecord(activity, 'transactions', transactions)
	content.replaceChildren(header, metrics, balances, involvement, lpPositions, forkParticipation, reportParticipation, escalationClaims, auctionClaims, interactionPanel, activity)
	applyLiveChanges(content, previousSections, { live })
	content.setAttribute('aria-busy', 'false')
}
