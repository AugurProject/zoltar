import type { ProtocolAddressLinkOptions, RichListRecord } from './browser-types.ts'
import { capitalPositionCard, capitalPositionPath } from './capital-presentation.ts'
import { exactUnit, tokenDecimals } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'
import { canonicalOperationsPath } from './routes.ts'
import { retainedPaginationAvailable } from './refresh-presentation.ts'
import { richListContinuationAvailable } from '../src/rich-list-limits.ts'
import { renderRichListTable, richListWalletBalances } from './rich-list-table.ts'
import { captureViewState, restoreViewState } from './view-state.ts'

export interface RichListPageDeps {
	lookup(selector: '#rich-sort'): HTMLSelectElement
	lookup(selector: string): HTMLElement
	readonly pageUrl: URL
	readonly richListItems: readonly RichListRecord[]
	readonly richListTotal: number
	readonly selectedChainId: () => string
	readonly isDemo: boolean
	readonly setLiveRecord: <T extends HTMLElement>(node: T, key: string, value: unknown) => T
	readonly element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => HTMLElementTagNameMap[K]
	readonly protocolAddressLink: (address: string | null, options?: ProtocolAddressLinkOptions) => HTMLAnchorElement
	readonly nativeSymbol: (chainId?: string) => string
	readonly number: (value: string | number | bigint | null | undefined) => string
	readonly counted: (value: string | number | bigint | null | undefined, singular: string, plural?: string) => string
	readonly openAccountTransactions: (item: RichListRecord) => Promise<boolean>
	readonly canonicalRefreshRequired: boolean
}

// The canonical detail path on the card's chain; the demo flag is kept so the link survives a reload.
const capitalPositionHref = (ledger: string, owner: string, chainId: string, demo: boolean): string => `${canonicalOperationsPath(capitalPositionPath(ledger, owner))}?chainId=${encodeURIComponent(chainId)}${demo ? '&demo=1' : ''}`

/** The ranking the URL asks for; a URL without a known `sort` means the default ranking, the first option. */
export const richListSort = (pageUrl: URL, sortOptions: readonly string[]): string => {
	const requested = pageUrl.searchParams.get('sort')
	return requested !== null && sortOptions.includes(requested) ? requested : (sortOptions[0] ?? '')
}

export const renderRichListPage = (deps: RichListPageDeps) => {
	const { lookup: $, pageUrl, richListItems, richListTotal, selectedChainId, isDemo, setLiveRecord, element, protocolAddressLink, nativeSymbol, number, counted, openAccountTransactions, canonicalRefreshRequired } = deps
	const richFieldLabel = (label: string) => element('span', 'sr-only rich-field-label', label)
	const richView = pageUrl.searchParams.get('view')
	const showCards = richView === 'cards' || (richView !== 'table' && window.matchMedia('(max-width: 799px)').matches)
	$('#richlist-table').hidden = showCards
	$('#richlist-shell').hidden = !showCards
	$('#rich-view-toggle').textContent = showCards ? 'Show table' : 'Show details'
	const tableState = captureViewState($('#richlist-table'))
	const rowsState = captureViewState($('#richlist-rows'))
	renderRichListTable($('#richlist-table'), richListItems, {
		chainId: selectedChainId(),
		sort: $('#rich-sort').value,
		demo: isDemo,
		onSort: sort => {
			if ($('#rich-sort').value === sort) return
			$('#rich-sort').value = sort
			$('#rich-sort').dispatchEvent(new Event('change'))
		},
	})
	const rows = $('#richlist-rows')
	const isInitialRender = rows.childElementCount === 0
	const openDetailKeys = new Set([...rows.querySelectorAll<HTMLElement>('details[open][data-detail-key]')].map(details => details.dataset['detailKey']))
	const focusedDetailKey = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('details[data-detail-key]')?.dataset['detailKey'] : undefined
	rows.replaceChildren()
	for (const item of richListItems) {
		const itemKey = `${item.chain_id}:${item.address}`
		const article = setLiveRecord(element('article', 'rich-row'), itemKey, item)
		const main = element('div', 'rich-row-main')
		const identity = element('div', 'rich-identity')
		const addressLink = protocolAddressLink(item.address, { knownLabel: item.label, chainId: item.chain_id, className: 'rich-address address-link' })
		identity.append(richFieldLabel('Address'), addressLink)
		const identityMeta = item.label ? item.address : undefined
		if (identityMeta) identity.append(element('span', '', identityMeta))
		const repComplete = Number(item.sampled_rep_token_count) >= Number(item.rep_token_count)
		const repTokens = Array.isArray(item.rep_balances) ? item.rep_balances : []
		const itemNativeSymbol = nativeSymbol(item.chain_id)
		const wallet = element('div', 'rich-wallet')
		const walletBalances = richListWalletBalances(item, itemNativeSymbol)
		wallet.append(richFieldLabel(`${itemNativeSymbol} / WETH`), element('strong', '', walletBalances.native), element('span', '', walletBalances.weth))
		const transactions = element('button', 'rich-count rich-transactions')
		transactions.type = 'button'
		transactions.dataset['dialogInvoker'] = `rich-list:${itemKey}`
		transactions.setAttribute('aria-label', `View ${number(item.transaction_count)} transactions sent by ${item.label ?? item.address}`)
		transactions.append(richFieldLabel('Transactions'), element('strong', '', number(item.transaction_count)))
		transactions.addEventListener('click', () => openAccountTransactions(item))
		const positions = element('div', 'rich-count')
		const capitalPositions = Array.isArray(item.capital_positions) ? item.capital_positions : []
		positions.append(richFieldLabel('Protocol involvement'), element('strong', '', counted(item.pool_count, 'pool')), element('span', '', counted(capitalPositions.length, 'capital position')))
		const rep = element('div', 'rich-rep')
		rep.append(richFieldLabel('REP tokens'))
		if (repTokens.length === 0) rep.append(element('strong', '', 'REP pending'))
		for (const token of repTokens) {
			const tokenLine = element('span', 'rich-rep-token')
			const tokenIdentity = element('span')
			tokenIdentity.append(
				protocolAddressLink(token.address, {
					knownLabel: token.contractLabel,
					chainId: item.chain_id,
					className: 'address-link',
				}),
			)
			if (token.universeId !== null && token.universeId !== undefined) tokenIdentity.append(document.createTextNode(` · universe ${shortIdentifier(token.universeId)}`))
			tokenLine.append(element('strong', '', exactUnit(token.balance, tokenDecimals(token.decimals), token.symbol ?? 'REP')), tokenIdentity)
			rep.append(tokenLine)
		}
		if (!repComplete) rep.append(element('span', '', `${number(item.sampled_rep_token_count)} of ${number(item.rep_token_count)} REP tokens sampled`))
		main.append(identity, rep, wallet, transactions, positions)
		article.append(main)
		const poolAssociations = Array.isArray(item.pool_associations) ? item.pool_associations : []
		const involvement = element('details', 'rich-assets rich-involvement')
		involvement.dataset['detailKey'] = `${itemKey}:involvement`
		involvement.open = openDetailKeys.has(involvement.dataset['detailKey']) || (isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		involvement.append(element('summary', '', capitalPositions.length === 0 ? 'Pool associations' : 'Pool associations and capital positions'))
		const involvementGrid = element('div', 'rich-position-grid')
		for (const pool of poolAssociations) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(pool.address, {
				knownLabel: pool.label,
				chainId: item.chain_id,
				className: 'rich-token-address address-link',
			})
			card.append(element('strong', '', pool.questionTitle ?? pool.label ?? 'Associated security pool'), element('span', '', pool.label ?? 'Observed in the same protocol transaction'), link)
			involvementGrid.append(card)
		}
		for (const position of capitalPositions) {
			const card = element('div', 'rich-position')
			const link = element('a', 'rich-token-address address-link', 'Position detail')
			link.href = capitalPositionHref(position.ledgerAddress, item.address, item.chain_id, isDemo)
			const presentation = capitalPositionCard(position)
			card.append(element('strong', '', presentation.title), element('span', '', presentation.summary), link)
			involvementGrid.append(card)
		}
		if (poolAssociations.length < Number(item.pool_count)) involvementGrid.append(element('span', 'data-note', 'Showing the first 100 associations.'))
		involvement.append(involvementGrid)
		if (Number(item.pool_count) > 0 || capitalPositions.length > 0) article.append(involvement)
		rows.append(article)
	}
	restoreViewState($('#richlist-table'), { focus: tableState.focus, openDetails: new Set() })
	restoreViewState(rows, { focus: rowsState.focus, openDetails: new Set() })
	if (focusedDetailKey) {
		const focusedDetails = [...rows.querySelectorAll<HTMLElement>('details[data-detail-key]')].find(details => details.dataset['detailKey'] === focusedDetailKey)
		focusedDetails?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
	}
	rows.setAttribute('aria-busy', 'false')
	const paginationEnded = richListItems.length < richListTotal && !richListContinuationAvailable(richListItems.length, richListTotal)
	$('#richlist-summary').textContent = `${number(richListItems.length)} of ${number(richListTotal)} known addresses${paginationEnded ? ` · the list ends here; only the top ${number(richListItems.length)} can be shown` : ''}`
	$('#richlist-more').hidden = !retainedPaginationAvailable(richListContinuationAvailable(richListItems.length, richListTotal), canonicalRefreshRequired)
}
