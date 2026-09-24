import type { ProtocolAddressLinkOptions, RichListRecord } from './browser-types.ts'
import { exactUnit } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'
import { retainedPaginationAvailable } from './live-update.ts'
import { renderRichListTable } from './rich-list-table.ts'

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

const richBalance = (value: string | number | undefined, symbol: string) => exactUnit(value ?? '0', 18, symbol)

export const renderRichListPage = (deps: RichListPageDeps) => {
	const { lookup: $, pageUrl, richListItems, richListTotal, selectedChainId, isDemo, setLiveRecord, element, protocolAddressLink, nativeSymbol, number, counted, openAccountTransactions, canonicalRefreshRequired } = deps
	const richFieldLabel = (label: string) => element('span', 'sr-only rich-field-label', label)
	const richView = pageUrl.searchParams.get('view')
	const showCards = richView === 'cards' || (richView !== 'table' && window.matchMedia('(max-width: 799px)').matches)
	$('#richlist-table').hidden = showCards
	$('#richlist-shell').hidden = !showCards
	$('#rich-view-toggle').textContent = showCards ? 'Show table' : 'Show details'
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
	const openDetailKeys = new Set([...rows.querySelectorAll<HTMLElement>('details[open][data-detail-key]')].map(details => details.dataset.detailKey))
	const focusedDetailKey = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('details[data-detail-key]')?.dataset.detailKey : undefined
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
		const hasNative = Number(item.sampled_native_count) > 0
		const repComplete = Number(item.sampled_rep_token_count) >= Number(item.rep_token_count)
		const wethComplete = Number(item.sampled_weth_token_count) >= Number(item.weth_token_count)
		const repTokens = Array.isArray(item.rep_balances) ? item.rep_balances : []
		const itemNativeSymbol = nativeSymbol(item.chain_id)
		const wallet = element('div', 'rich-wallet')
		wallet.append(richFieldLabel(`${itemNativeSymbol} / WETH`), element('strong', '', hasNative ? richBalance(item.native_balance, itemNativeSymbol) : `${itemNativeSymbol} pending`), element('span', '', wethComplete ? richBalance(item.weth_balance, 'WETH') : `${richBalance(item.weth_balance, 'WETH')} · partial`))
		const transactions = element('button', 'rich-count rich-transactions')
		transactions.type = 'button'
		transactions.setAttribute('aria-label', `View ${number(item.transaction_count)} transactions sent by ${item.label ?? item.address}`)
		transactions.append(richFieldLabel('Transactions'), element('strong', '', number(item.transaction_count)))
		transactions.addEventListener('click', () => openAccountTransactions(item))
		const positions = element('div', 'rich-count')
		positions.append(richFieldLabel('Protocol involvement'), element('strong', '', counted(item.pool_count, 'pool')), element('span', '', `${counted(item.active_vault_count, 'active vault')} / ${counted(item.vault_count, 'known vault')}`))
		const rep = element('div', 'rich-rep')
		rep.append(richFieldLabel('REP tokens'))
		if (repTokens.length === 0) rep.append(element('strong', '', 'REP pending'))
		for (const token of repTokens) {
			const decimals = Number.isInteger(Number(token.decimals)) && Number(token.decimals) >= 0 && Number(token.decimals) <= 255 ? Number(token.decimals) : 18
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
			tokenLine.append(element('strong', '', exactUnit(token.balance, decimals, token.symbol ?? 'REP')), tokenIdentity)
			rep.append(tokenLine)
		}
		if (!repComplete) rep.append(element('span', '', `${number(item.sampled_rep_token_count)} of ${number(item.rep_token_count)} REP tokens sampled`))
		main.append(identity, rep, wallet, transactions, positions)
		article.append(main)
		const poolAssociations = Array.isArray(item.pool_associations) ? item.pool_associations : []
		const vaultPositions = Array.isArray(item.vault_positions) ? item.vault_positions : []
		const involvement = element('details', 'rich-assets rich-involvement')
		involvement.dataset.detailKey = `${itemKey}:involvement`
		involvement.open = openDetailKeys.has(involvement.dataset.detailKey) || (isInitialRender && isDemo && pageUrl.searchParams.get('expandRich') === '1' && item === richListItems[0])
		involvement.append(element('summary', '', `${counted(item.pool_count, 'pool association')} · ${counted(item.vault_count, 'vault position')}`))
		const involvementGrid = element('div', 'rich-position-grid')
		for (const pool of poolAssociations) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(pool.address, {
				knownLabel: pool.label,
				chainId: item.chain_id,
				className: 'rich-token-address address-link',
			})
			card.append(element('span', 'rich-position-kind', 'Pool association'), element('strong', '', pool.questionTitle ?? pool.label ?? 'Associated security pool'), element('span', '', pool.label ?? 'Observed in the same protocol transaction'), link)
			involvementGrid.append(card)
		}
		for (const position of vaultPositions) {
			const card = element('div', 'rich-position')
			const link = protocolAddressLink(position.poolAddress, { chainId: item.chain_id, className: 'rich-token-address address-link' })
			card.append(
				element('span', 'rich-position-kind', 'Vault position'),
				element('strong', '', position.questionTitle ?? 'Vault position'),
				element('span', '', `REP backing units ${exactUnit(position.repBackingUnits, 18, '')}`),
				element('span', '', `Capacity ownership ${exactUnit(position.capacityOwnershipAttoRep, 18, 'REP')}`),
				element('span', '', `Claimable fees ${exactUnit(position.claimableFeesAttoEth, 18, itemNativeSymbol)} · block #${number(position.blockNumber)}`),
				link,
			)
			involvementGrid.append(card)
		}
		if (poolAssociations.length < Number(item.pool_count) || vaultPositions.length < Number(item.vault_count)) involvementGrid.append(element('span', 'data-note', 'Showing the first 100 associations or positions.'))
		involvement.append(involvementGrid)
		if (Number(item.pool_count) > 0 || Number(item.vault_count) > 0) article.append(involvement)
		rows.append(article)
	}
	if (focusedDetailKey) {
		const focusedDetails = [...rows.querySelectorAll<HTMLElement>('details[data-detail-key]')].find(details => details.dataset.detailKey === focusedDetailKey)
		focusedDetails?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
	}
	rows.setAttribute('aria-busy', 'false')
	$('#richlist-summary').textContent = `${number(richListItems.length)} of ${number(richListTotal)} known addresses`
	$('#richlist-more').hidden = !retainedPaginationAvailable(richListItems.length < richListTotal, canonicalRefreshRequired)
}
