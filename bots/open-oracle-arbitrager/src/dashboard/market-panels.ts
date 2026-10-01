import type { PublicOperatorSnapshot } from '#state/operator-state'
import { refreshFormButton } from '@zoltar/bot-shared/dashboard/form-state'
import { createUniverseExplorer } from '@zoltar/bot-shared/dashboard/universe-explorer'
import { amount, countLabel, marketPoolStrategyUse } from './dashboard-format.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { DashboardState } from './dashboard-state.ts'
import { type ExplorerLink, row, setText, shorten } from './dom.ts'

const TOKEN_MARKET_LABELS = ['Token', 'Address', 'Wallet balance', 'Exchange', 'Strategy use', 'Pool', 'Fee', 'Spot', 'Liquidity / reserves']

function poolAnchor(url: string, focusKey: string, address: string) {
	const poolLink = document.createElement('a')
	poolLink.href = url
	poolLink.dataset['focusKey'] = focusKey
	poolLink.target = '_blank'
	poolLink.rel = 'noreferrer'
	poolLink.textContent = shorten(address)
	return poolLink
}

function renderDisputePathList(container: HTMLElement, snapshot: PublicOperatorSnapshot, link: ExplorerLink) {
	const disclosureState = new Map(Array.from(container.querySelectorAll<HTMLDetailsElement>('details[data-report-id]')).map(details => [details.dataset['reportId'] ?? '', { focused: details.querySelector('summary') === document.activeElement, open: details.open }]))
	container.replaceChildren()
	for (const path of snapshot.reportPaths) {
		const details = document.createElement('details')
		details.className = 'dispute-path'
		details.dataset['reportId'] = path.reportId
		const summary = document.createElement('summary')
		summary.dataset['focusKey'] = `dispute:${path.reportId}:summary`
		summary.textContent = `Report ${path.reportId} · ${countLabel(path.steps.length, 'step')} · ${path.settled ? 'settled' : 'active'}`
		details.append(summary)
		for (const step of path.steps) {
			const item = document.createElement('div')
			item.className = 'dispute-step'
			const event = document.createElement('strong')
			event.textContent = step.event
			const block = document.createElement('span')
			block.textContent = `Block ${step.blockNumber}`
			const description = document.createElement('span')
			const amounts = step.amount1 === undefined ? '' : ` · amounts ${step.amount1} / ${step.amount2 ?? '—'}`
			description.textContent = `${step.reporter === undefined ? 'No reporter' : shorten(step.reporter)}${amounts}`
			if (step.transactionHash !== undefined) description.append(' · ', link(step.transactionHash, 'tx', `dispute:${path.reportId}:${step.blockNumber}:transaction`))
			item.append(event, block, description)
			details.append(item)
		}
		container.append(details)
		const previous = disclosureState.get(path.reportId)
		if (previous?.open === true) details.open = true
		if (previous?.focused === true) summary.focus({ preventScroll: true })
	}
}

/** Renders the approved-universe explorer, the token market table, and the dispute paths of observed reports. */
export function createMarketPanels(state: DashboardState, elements: DashboardElements, link: ExplorerLink) {
	let universeExplorer: ReturnType<typeof createUniverseExplorer> | undefined

	function renderTokenMarkets(snapshot: PublicOperatorSnapshot) {
		universeExplorer ??= createUniverseExplorer(elements.approvedUniverses, {
			onChange: next => {
				state.approvedUniverseIds = next
				refreshFormButton('tokens-form')
			},
			savedMessage: '',
		})
		universeExplorer.update({ universes: snapshot.universes ?? [], approved: state.approvedUniverseIds, network: snapshot.network, disabled: elements.tokensFieldset.disabled })

		const body = elements.tokenMarketsBody
		body.replaceChildren()
		const executableTokens = new Set(snapshot.tokenAddresses.map(address => address.toLowerCase()))
		for (const token of snapshot.tokenMarkets) {
			if (token.pools.length === 0) {
				body.append(row([token.symbol, link(token.address, 'address', `token:${token.address}:address`), amount(token.balance, token.symbol), '—', 'Monitoring only', 'No supported WETH pools found', '—', 'Unavailable', '0'], TOKEN_MARKET_LABELS))
				continue
			}
			for (const pool of token.pools) {
				const poolLink = poolAnchor(pool.url, `token:${token.address}:pool:${pool.address}`, pool.address)
				const strategyUse = marketPoolStrategyUse(executableTokens.has(token.address.toLowerCase()), pool.venue)
				body.append(row([token.symbol, link(token.address, 'address', `token:${token.address}:address:${pool.address}`), amount(token.balance, token.symbol), pool.venue, strategyUse, poolLink, `${(pool.fee / 10_000).toString()}%`, amount(pool.priceWeth, 'WETH'), pool.liquidity], TOKEN_MARKET_LABELS))
			}
		}
		elements.tokenMarketsEmpty.hidden = snapshot.tokenMarkets.length !== 0
		const poolCount = snapshot.tokenMarkets.reduce((total, token) => total + token.pools.length, 0)
		setText('token-count', `${countLabel(snapshot.tokenMarkets.length, 'token')} · ${countLabel(poolCount, 'pool')}`)
	}

	function renderDisputePaths(snapshot: PublicOperatorSnapshot) {
		renderDisputePathList(elements.disputePaths, snapshot, link)
		elements.disputePathsEmpty.hidden = snapshot.reportPaths.length !== 0
		setText('dispute-path-count', countLabel(snapshot.reportPaths.length, 'report path'))
	}

	return { renderTokenMarkets, renderDisputePaths }
}
