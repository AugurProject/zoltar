import { expect, setSystemTime, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { urlWithoutLogDetail } from '../../browser/activity-detail-dom.ts'
import { createActivityDetailState } from '../../browser/activity-detail-state.ts'
import { createActivityRoute } from '../../browser/activity-route.ts'
import { createActivityRouteState } from '../../browser/activity-route-state.ts'
import { logKeyFor, renderActivityRow } from '../../browser/activity-row.ts'
import { createAddressProfileRoute } from '../../browser/address-profile-route.ts'
import { element, lookup } from '../../browser/app-dom.ts'
import { applyLiveChanges, clearRetryStatus, firstVisibleHeading, liveSnapshot, renderRetryStatus, setLiveRecord, setTextIfChanged, tickRelativeTimes } from '../../browser/app-presentation.ts'
import type { ActivityRecord, ContractRecord, QuestionRecord } from '../../browser/browser-types.ts'
import { createCanonicalState } from '../../browser/canonical-state.ts'
import { renderContractsPage } from '../../browser/contracts-page.ts'
import { createEventDetailRoute } from '../../browser/event-detail-route.ts'
import { renderExplorerPage } from '../../browser/explorer-page.ts'
import { selectedChainId } from '../../browser/app-state.ts'
import { exactUnit } from '../../browser/format.ts'
import { createForegroundRefreshGate, liveRecordsMatch, shouldPollRouteRefresh, shouldRefreshRouteOnLiveEvent, streamReconnectDelay } from '../../browser/live-refresh.ts'
import { indexerRetryNotice, nativeSymbolFor, staleChainHeadNotice, unavailableNetworkNotice } from '../../browser/network-freshness.ts'
import { networkIndicator } from '../../browser/network-indicator.ts'
import { createNetworkRoute } from '../../browser/network-route.ts'
import { applyNetworkSelection, unappliedNetworkChoice } from '../../browser/network-selection.ts'
import { blockRangeError, filterFormDestination, operationsFailureMessage } from '../../browser/operations-presentation.ts'
import { questionStatus } from '../../browser/question-time.ts'
import { richListSort } from '../../browser/rich-list-page.ts'
import { navigationTarget, networkSwitchUrl, routeDataContext } from '../../browser/routes.ts'
import { mountSearch } from '../../browser/search-ui.ts'
import { createStateComponents } from '../../browser/state-components.ts'
import { createSystemRoute } from '../../browser/system-route.ts'
import { createSystemRouteState } from '../../browser/system-route-state.ts'
import { createScannerLiveState } from '../../browser/scanner-live-state.ts'
import { captureViewState, restoreViewState } from '../../browser/view-state.ts'
import type { EntityHistory, NetworkRecord, PoolRecord } from '../../browser/browser-types.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const withBrowser = async (url: string, html: string, run: (browser: Window) => Promise<void> | void): Promise<void> => {
	const browser = new Window({ url })
	browser.document.body.innerHTML = html
	const restoreGlobals = overrideGlobals({
		document: browser.document,
		location: browser.location,
		history: browser.history,
		window: browser,
		Node: browser.Node,
		Element: browser.Element,
		HTMLElement: browser.HTMLElement,
		HTMLInputElement: browser.HTMLInputElement,
		HTMLTextAreaElement: browser.HTMLTextAreaElement,
		HTMLSelectElement: browser.HTMLSelectElement,
		HTMLAnchorElement: browser.HTMLAnchorElement,
		HTMLButtonElement: browser.HTMLButtonElement,
		HTMLDialogElement: browser.HTMLDialogElement,
		HTMLFormElement: browser.HTMLFormElement,
	})
	try {
		await run(browser)
	} finally {
		restoreGlobals()
		await browser.happyDOM.close()
	}
}

test('token amounts that are not whole numbers render as unavailable instead of malformed digits', () => {
	expect(exactUnit('null', 18, 'REP')).toBe('—')
	expect(exactUnit('undefined', 18, 'ETH')).toBe('—')
	expect(exactUnit('1.5', 18, 'ETH')).toBe('—')
	expect(exactUnit(1e21, 18, 'ETH')).toBe('—')
	expect(exactUnit('-1500000000000000000', 18, 'ETH')).toBe('-1.5 ETH')
	expect(exactUnit(25n, 1, '')).toBe('2.5')
})

test('one helper names the native currency of every chain', () => {
	expect(nativeSymbolFor('1')).toBe('ETH')
	expect(nativeSymbolFor(1)).toBe('ETH')
	expect(nativeSymbolFor('11155111')).toBe('SepoliaETH')
})

test('a closed event stream is reopened with a bounded exponential delay', () => {
	expect(streamReconnectDelay(0)).toBe(1_000)
	expect(streamReconnectDelay(1)).toBe(2_000)
	expect(streamReconnectDelay(3)).toBe(8_000)
	expect(streamReconnectDelay(20)).toBe(30_000)
	expect(streamReconnectDelay(-1)).toBe(1_000)
})

test('the periodic poll leaves route refreshes to an event stream that is delivering them', () => {
	expect(shouldPollRouteRefresh(false, 1_000, 2_000, 12_000)).toBe(true)
	expect(shouldPollRouteRefresh(true, undefined, 2_000, 12_000)).toBe(true)
	expect(shouldPollRouteRefresh(true, 1_000, 2_000, 12_000)).toBe(false)
	expect(shouldPollRouteRefresh(true, 1_000, 13_000, 12_000)).toBe(true)
})

test('integrity history skips block refreshes but accepts invalidations, periodic polls and empty-view retries', () => {
	expect(shouldRefreshRouteOnLiveEvent('/operations/integrity', false, true)).toBe(false)
	expect(shouldRefreshRouteOnLiveEvent('/operations/integrity/', false, true)).toBe(false)
	expect(shouldRefreshRouteOnLiveEvent('/operations/integrity', true, true)).toBe(true)
	expect(shouldRefreshRouteOnLiveEvent('/operations/integrity', false, false)).toBe(true)
	expect(shouldRefreshRouteOnLiveEvent('/operations/reports', false, true)).toBe(true)
})

test('unchanged live records are recognised so their rows are not rebuilt', () => {
	const rows = [
		{ key: 'a', signature: '1' },
		{ key: 'b', signature: '2' },
	]
	expect(liveRecordsMatch(rows, [...rows])).toBe(true)
	expect(liveRecordsMatch(rows, [rows[0] ?? { key: '', signature: '' }])).toBe(false)
	expect(
		liveRecordsMatch(rows, [
			{ key: 'a', signature: '1' },
			{ key: 'b', signature: 'changed' },
		]),
	).toBe(false)
	expect(liveRecordsMatch(rows, rows.toReversed())).toBe(false)
})

test('the relative-time tick updates only the age of an activity time cell', async () => {
	await withBrowser('https://scanner.test/', '<time class="cell cell-time" data-time="t1"><span>2026-01-01 00:00:00 UTC</span><span class="activity-age">· 1s ago</span></time><span class="age" data-time="t2">1s ago</span>', browser => {
		tickRelativeTimes(document, value => `age of ${value}`)
		const cell = browser.document.querySelector('.cell-time')
		expect(cell?.children.length).toBe(2)
		expect(cell?.children[0]?.textContent).toBe('2026-01-01 00:00:00 UTC')
		expect(cell?.querySelector('.activity-age')?.textContent).toBe('· age of t1')
		expect(browser.document.querySelector('.age')?.textContent).toBe('age of t2')
	})
})

test('unchanged status text is not rewritten and a cleared retry status loses its error presentation', async () => {
	let writes = 0
	const node = {
		value: 'Live connection',
		get textContent() {
			return this.value
		},
		set textContent(text: string) {
			writes++
			this.value = text
		},
	}
	setTextIfChanged(node, 'Live connection')
	expect(writes).toBe(0)
	setTextIfChanged(node, 'Reconnecting')
	expect(writes).toBe(1)
	await withBrowser('https://scanner.test/', '<div id="status" class="system-status error"><span>Failed</span><button>Retry</button></div>', () => {
		const status = document.querySelector<HTMLElement>('#status')
		if (status === null) throw new Error('Status fixture is missing')
		clearRetryStatus(status)
		expect(status.hidden).toBe(true)
		expect(status.className).toBe('system-status')
		expect(status.childElementCount).toBe(0)
	})
})

test('page-level live regions announce changes once instead of re-reading content or a ticking age', async () => {
	const markup = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8')
	expect(markup).toMatch(/<div id="freshness-banner"[^>]*role="status"/u)
	expect(markup).not.toMatch(/id="explorer-content"[^>]*aria-live/u)
	expect(staleChainHeadNotice('2026-01-01T00:00:00Z')).toBe('Newest observed block is from 2026-01-01 00:00:00 UTC; block-based catch-up status may be misleading.')
})

test('indexer retries explain the failure count, the next attempt, and the last error', () => {
	expect(indexerRetryNotice({ phase: 'live', consecutive_failures: 0, next_retry_at: null, last_error: null })).toBeUndefined()
	expect(indexerRetryNotice(undefined)).toBeUndefined()
	expect(indexerRetryNotice({ phase: 'degraded', consecutive_failures: 3, next_retry_at: '2026-01-01T00:01:00Z', last_error: 'RPC timeout' })).toBe('3 consecutive failures; next retry at 2026-01-01 00:01:00 UTC. Last error: RPC timeout')
	expect(indexerRetryNotice({ phase: 'degraded', consecutive_failures: 1, next_retry_at: null, last_error: null })).toBe('1 consecutive failure; retry scheduled.')
	expect(indexerRetryNotice({ phase: 'degraded', consecutive_failures: 2, last_error: 'x'.repeat(400) })).toBe(`2 consecutive failures; retry scheduled. Last error: ${'x'.repeat(300)}…`)
})

test('route filters do not follow the user to another route while page-wide parameters do', () => {
	const target = navigationTarget(new URL('https://scanner.test/operations/timeline'), new URL('https://scanner.test/?chainId=1&demo=1&event=Transfer&address=0xabc&log=1:a:b:0&sort=rep'))
	expect(target.pathname).toBe('/operations/timeline')
	expect(target.searchParams.get('chainId')).toBe('1')
	expect(target.searchParams.get('demo')).toBe('1')
	for (const name of ['event', 'address', 'log', 'sort']) expect(target.searchParams.has(name)).toBe(false)
	const back = navigationTarget(new URL('https://scanner.test/?chainId=1'), new URL('https://scanner.test/operations/timeline?chainId=11155111&q=fork&entityType=vault&canonical=all&atBlock=5'))
	expect(back.search).toBe('?chainId=1')
})

test('rich list sort and view follow the user only to the rich list', () => {
	const richList = new URL('https://scanner.test/richlist?chainId=1&sort=rep&view=cards')
	expect(navigationTarget(new URL('https://scanner.test/contracts'), richList).search).toBe('?chainId=1')
	const returning = navigationTarget(new URL('https://scanner.test/richlist'), new URL('https://scanner.test/address/0x1?chainId=1&sort=rep&view=cards'))
	expect(returning.searchParams.get('sort')).toBe('rep')
	expect(returning.searchParams.get('view')).toBe('cards')
})

test('switching networks drops block numbers and details that belong to the previous chain', () => {
	const switched = networkSwitchUrl(new URL('https://scanner.test/operations/risk?chainId=1&demo=1&atBlock=5&fromBlock=1&toBlock=9&log=1:a:b:0&entity=1:0xabc&account=1:0xabc&contract=0xabc&tab=history&q=fork'))
	expect(switched.search).toBe('?chainId=1&demo=1&tab=history&q=fork')
	const adopted = networkSwitchUrl(new URL('https://scanner.test/system?chainId=11155111&fromBlock=1&toBlock=9&entity=1:0xabc'), { keepBlockNumbers: true })
	expect(adopted.search).toBe('?chainId=11155111&fromBlock=1&toBlock=9')
})

test('the rich list sort comes from the URL and falls back to the default ranking', () => {
	const options = ['transactions', 'eth', 'weth', 'rep']
	expect(richListSort(new URL('https://scanner.test/richlist?sort=rep'), options)).toBe('rep')
	expect(richListSort(new URL('https://scanner.test/richlist'), options)).toBe('transactions')
	expect(richListSort(new URL('https://scanner.test/richlist?sort=unknown'), options)).toBe('transactions')
})

test('contracts outside the protocol deployment carry a provenance badge', async () => {
	await withBrowser('https://scanner.test/contracts?chainId=1', '<div id="contract-list"></div>', () => {
		const contract = (address: string, kind: string, provenance: string, label: string): ContractRecord => ({
			chain_id: '1',
			address,
			label,
			kind,
			provenance,
			discovery_block: null,
			discovery_tx_hash: null,
			deployment_block: '1',
			deployment_timestamp: null,
			deployment_block_exact: true,
			deployment_checked_block: null,
			explorer_base_url: '',
		})
		renderContractsPage({
			lookup,
			contractItems: [contract(`0x${'1'.repeat(40)}`, 'securityPool', 'DeploySecurityPool', 'Security pool'), contract(`0x${'2'.repeat(40)}`, 'weth', 'manifest', 'WETH'), contract(`0x${'3'.repeat(40)}`, 'openOracle', 'manifest', 'OpenOracle')],
			element: (tag, className = '', text) => {
				const node = document.createElement(tag)
				node.className = className
				if (text !== undefined) node.textContent = text
				return node
			},
			internalEvidenceLink: (_base, type, value, label) => {
				const link = document.createElement('a')
				link.href = `/${type}/${value}`
				link.textContent = label
				return link
			},
			number: String,
			age: () => '1m ago',
			exactTimestamp: String,
		})
		const rows = [...document.querySelectorAll('.contract-row')].map(row => [row.querySelector('strong')?.textContent, row.querySelector('.contract-provenance')?.textContent])
		expect(rows).toEqual([
			['OpenOracle', undefined],
			['WETH', 'System dependency'],
			['Security pool', 'Discovered · not in deployment manifest'],
		])
	})
})

test('choosing a network in the selector changes nothing until the choice is applied', async () => {
	await withBrowser('https://scanner.test/?chainId=1', '<select id="network"><option>Loading networks…</option></select>', () => {
		const select = document.querySelector<HTMLSelectElement>('#network')
		if (select === null) throw new Error('Network selector fixture is missing')
		const option = (label: string, value: string) => {
			const node = document.createElement('option')
			node.textContent = label
			node.value = value
			return node
		}
		const state = { initialChainId: '1' }
		expect(selectedChainId(state, select)).toBe('1')
		select.replaceChildren(option('Ethereum', '1'), option('Sepolia', '11155111'))
		applyNetworkSelection(select, '1')
		select.value = '11155111'
		expect(selectedChainId(state, select)).toBe('1')
		expect(unappliedNetworkChoice(select)).toBe('11155111')
		// A periodic refresh of the network list keeps the unapplied choice on screen.
		select.replaceChildren(option('Ethereum', '1'), option('Sepolia', '11155111'))
		applyNetworkSelection(select, '1', '11155111')
		expect(select.value).toBe('11155111')
		expect(selectedChainId(state, select)).toBe('1')
		applyNetworkSelection(select, '11155111')
		expect(selectedChainId(state, select)).toBe('11155111')
		expect(unappliedNetworkChoice(select)).toBeUndefined()
		select.replaceChildren(option('Ethereum', '1'))
		applyNetworkSelection(select, '1', '11155111')
		expect(select.value).toBe('1')
	})
})

test('a route data context changes with the filters that select a different result set', () => {
	const context = (path: string) => routeDataContext('1', new URL(`https://scanner.test${path}`))
	expect(context('/operations/timeline?chainId=1&event=ReportDisputed')).not.toBe(context('/operations/timeline?chainId=1'))
	expect(context('/operations/timeline?chainId=1&q=')).toBe(context('/operations/timeline?chainId=1'))
	expect(context('/operations/risk?atBlock=10')).not.toBe(context('/operations/risk'))
	expect(context('/pool/0xabc?atBlock=10')).not.toBe(context('/pool/0xabc'))
	expect(context('/pool/0xabc?tab=history')).toBe(context('/pool/0xabc'))
	expect(context('/richlist?sort=rep')).toBe('1:/richlist')
})

test('route focus skips headings that are not rendered', async () => {
	await withBrowser('https://scanner.test/pool/0xabc', '<main><section hidden><h2>Hidden section</h2></section><section><div class="operations-heading"><h2 id="section-heading">Protocol operations</h2></div><div><h2 id="entity-heading">Pool 0xabc</h2></div></section></main>', () => {
		const rendered = (heading: { id: string }) => heading.id !== 'section-heading'
		expect(firstVisibleHeading(document, rendered)?.id).toBe('entity-heading')
		expect(firstVisibleHeading(document, () => true)?.id).toBe('section-heading')
		expect(firstVisibleHeading(document, () => false)).toBeUndefined()
	})
})

const searchFixture = '<form id="global-search"><input id="global-search-input" /><div id="global-search-results" role="status" hidden></div></form><button id="elsewhere">Elsewhere</button>'

test('search shows a result count, the server detail, and closes when attention moves elsewhere', async () => {
	await withBrowser('https://scanner.test/', searchFixture, async browser => {
		mountSearch(
			async () => ({
				items: [
					{ type: 'pool', label: 'Will it rain?', href: '/pool/0xabc?chainId=1', detail: '0xabc' },
					{ type: 'block', label: 'Block #1', href: '/block/1?chainId=1' },
				],
			}),
			() => '1',
		)
		const input = document.querySelector<HTMLInputElement>('#global-search-input')
		const results = document.querySelector<HTMLElement>('#global-search-results')
		if (input === null || results === null) throw new Error('Search fixture is incomplete')
		input.value = 'rain'
		browser.document.querySelector('#global-search-input')?.dispatchEvent(new browser.Event('input', { bubbles: true }))
		await Bun.sleep(300)
		expect(results.hidden).toBe(false)
		expect(results.hasAttribute('role')).toBe(false)
		expect(results.querySelector('[role="status"]')?.textContent).toBe('2 results')
		expect(results.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Search results')
		const anchors = [...results.querySelectorAll('a')]
		expect(anchors.map(anchor => anchor.getAttribute('href'))).toEqual(['/pool/0xabc?chainId=1', '/block/1?chainId=1'])
		expect(anchors[0]?.querySelector('small')?.textContent).toBe('0xabc')
		expect(anchors[1]?.querySelector('small')).toBeNull()
		browser.document.querySelector('#elsewhere')?.dispatchEvent(new browser.Event('pointerdown', { bubbles: true }))
		expect(results.hidden).toBe(true)
		expect(input.value).toBe('rain')
	})
})

test('Enter opens the top search result', async () => {
	await withBrowser('https://scanner.test/', searchFixture, async browser => {
		const opened: string[] = []
		browser.document.addEventListener('click', event => {
			const target = event.target
			if (!(target instanceof browser.Element)) return
			const anchor = target.closest('a')
			if (anchor === null) return
			event.preventDefault()
			opened.push(anchor.getAttribute('href') ?? '')
		})
		mountSearch(
			async () => ({ items: [{ type: 'block', label: 'Block #7', href: '/block/7?chainId=1' }] }),
			() => '1',
		)
		const input = document.querySelector<HTMLInputElement>('#global-search-input')
		if (input === null) throw new Error('Search fixture is incomplete')
		input.value = '7'
		browser.document.querySelector('form')?.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }))
		await Bun.sleep(0)
		expect(opened).toEqual(['/block/7?chainId=1'])
	})
})

test('a live refresh with unchanged evidence leaves the explorer page untouched', async () => {
	await withBrowser('https://scanner.test/tx/0xabc?chainId=1', '<div id="explorer-content"></div>', async () => {
		const evidence = () => ({ transaction: { hash: '0xabc', block_number: '1', block_timestamp: '2026-09-23T00:00:00Z', explorer_base_url: 'https://etherscan.io', from_address: '0x1', to_address: '0x2', value: '0', gas_used: '21000', status: 'success' }, logs: [] })
		let response = evidence()
		const api = async () => response
		expect(await renderExplorerPage('/tx/0xabc', '1', api)).toBe(true)
		const content = document.querySelector('#explorer-content')
		const heading = content?.querySelector('h2')
		const link = content?.querySelector<HTMLElement>('a[href*="/block/"]')
		if (content === null || content === undefined || heading === null || heading === undefined || link === null || link === undefined) throw new Error('Explorer page did not render')
		link.focus()
		expect(await renderExplorerPage('/tx/0xabc', '1', api, true)).toBe(true)
		expect(content.querySelector('h2')).toBe(heading)
		expect(document.activeElement).toBe(link)
		expect(content.hasAttribute('aria-busy')).toBe(false)
		response = { ...evidence(), transaction: { ...evidence().transaction, status: 'reverted' } }
		expect(await renderExplorerPage('/tx/0xabc', '1', api, true)).toBe(true)
		expect(content.querySelector('h2')).not.toBe(heading)
		expect(document.activeElement?.getAttribute('href')).toBe(link.getAttribute('href'))
	})
})

test('a failed live refresh claims prior evidence only when evidence is shown', async () => {
	await withBrowser('https://scanner.test/tx/0xabc?chainId=1', '<div id="explorer-content"></div>', async () => {
		let failing = true
		const api = async () => {
			if (failing) throw Object.assign(new Error('Transaction not found'), { status: 404 })
			return { transaction: { hash: '0xabc', block_number: '1', block_timestamp: '2026-09-23T00:00:00Z', explorer_base_url: 'https://etherscan.io', from_address: '0x1', to_address: '0x2', value: '0', gas_used: '21000', status: 'success' }, logs: [] }
		}
		expect(await renderExplorerPage('/tx/0xabc', '1', api)).toBe(false)
		const content = document.querySelector<HTMLElement>('#explorer-content')
		const retry = content?.querySelector<HTMLElement>('.explorer-retry')
		if (content === null || content === undefined || retry === null || retry === undefined) throw new Error('Failure view did not render')
		expect(content.querySelector('h2')?.textContent).toBe('Page not found')
		retry.focus()
		expect(await renderExplorerPage('/tx/0xabc', '1', api, true)).toBe(false)
		expect(content.textContent).not.toContain('prior evidence')
		expect(content.querySelector('.explorer-retry')).toBe(retry)
		expect(document.activeElement).toBe(retry)
		expect(content.hasAttribute('aria-busy')).toBe(false)
		failing = false
		expect(await renderExplorerPage('/tx/0xabc', '1', api, true)).toBe(true)
		failing = true
		expect(await renderExplorerPage('/tx/0xabc', '1', api, true)).toBe(false)
		expect(content.querySelector('.static-grid')).not.toBeNull()
		expect(content.querySelector('.explorer-refresh-error')?.textContent).toBe('Could not refresh indexed evidence. The prior evidence remains visible.')
	})
})

test('focus and open disclosures survive a container re-render', async () => {
	const markup = (extra: string) => `<article data-live-key="a"><a href="/tx/1">tx</a><details><summary>Decoded arguments</summary></details></article><article data-live-key="b"><details data-detail-key="b:args"><summary>Decoded arguments</summary></details>${extra}</article>`
	await withBrowser('https://scanner.test/', `<div id="view">${markup('')}</div>`, () => {
		const view = document.querySelector<HTMLElement>('#view')
		if (view === null) throw new Error('View fixture is missing')
		const details = [...view.querySelectorAll('details')]
		for (const item of details) item.open = true
		view.querySelector<HTMLElement>('a')?.focus()
		const snapshot = captureViewState(view)
		view.innerHTML = markup('<details><summary>Raw evidence</summary></details>')
		expect(document.activeElement).not.toBe(view.querySelector('a'))
		restoreViewState(view, snapshot)
		expect([...view.querySelectorAll('details')].map(item => item.open)).toEqual([true, true, false])
		expect(document.activeElement).toBe(view.querySelector('a'))
	})
})

const addressA = `0x${'a'.repeat(40)}`
const addressB = `0x${'b'.repeat(40)}`

test('an address profile never stays visible under another address', async () => {
	await withBrowser(`https://scanner.test/address/${addressA}?chainId=1`, '<a id="address-back"></a><div id="address-profile-content"></div>', async browser => {
		const rendered: string[] = []
		let failing = false
		const asOf = { blockNumber: '1', blockHash: `0x${'1'.repeat(64)}`, blockTimestamp: '1', indexedHead: '1', invalidationId: '0', abiSourceHash: 'a', applicationSourceHash: 'b', projectionSourceHash: 'c', phase: 'live', historical: false }
		const route = createAddressProfileRoute({
			renderAddressProfile: item => {
				rendered.push(item.address)
				const header = document.createElement('header')
				header.dataset['liveKey'] = 'identity'
				header.textContent = item.address
				lookup('#address-profile-content').replaceChildren(header)
			},
			lookup,
			element: (tag, className = '', text) => {
				const node = document.createElement(tag)
				node.className = className
				if (text !== undefined) node.textContent = text
				return node
			},
			api: async path => {
				if (failing) throw new Error('Scanner offline')
				if (path.startsWith('/api/v1/state/address-portfolio')) return { chainId: '1', asOf, data: {} }
				if (path.startsWith('/api/v1/address-identity')) return { chainId: 1, address: addressA }
				return { items: [], total: 0 }
			},
			getPageUrl: () => new URL(location.href),
			getViewContextVersion: () => 0,
			selectedChainId: () => '1',
			requiredChainId: () => '1',
			getNetworks: () => [],
			isDemo: false,
			canonicalState: createCanonicalState(),
			refreshGate: createForegroundRefreshGate(),
			errorMessage: error => (error instanceof Error ? error.message : 'Unknown error'),
			retryCanonicalViewOr: fallback => fallback(),
		})
		expect(await route.loadAddressProfile()).toBe(true)
		expect(rendered).toEqual([addressA])
		expect(await route.loadAddressProfile({ live: true })).toBe(true)
		expect(rendered).toEqual([addressA])
		browser.happyDOM.setURL(`https://scanner.test/address/${addressB}?chainId=1`)
		failing = true
		expect(await route.loadAddressProfile({ live: true })).toBe(false)
		const content = lookup('#address-profile-content')
		expect(content.textContent).not.toContain(addressA)
		expect(content.textContent).toContain('Could not load address: Scanner offline')
		expect(content.textContent).not.toContain('last known')
		expect(route.profile).toBeUndefined()
	})
})

test('operations filters open only filled-in fields and reject malformed block ranges', () => {
	const destination = filterFormDestination('/operations/timeline', 'https://scanner.test', [
		['chainId', '1'],
		['q', ' fork '],
		['entityType', ''],
		['fromBlock', '10'],
		['toBlock', ''],
	])
	expect(`${destination.pathname}${destination.search}`).toBe('/operations/timeline?chainId=1&q=fork&fromBlock=10')
	expect(blockRangeError('', '')).toBeUndefined()
	expect(blockRangeError('10', '20')).toBeUndefined()
	expect(blockRangeError('abc', '')).toEqual({ field: 'fromBlock', message: 'Enter a whole non-negative block number' })
	expect(blockRangeError('1', '1e5')).toEqual({ field: 'toBlock', message: 'Enter a whole non-negative block number' })
	expect(blockRangeError('20', '10')).toEqual({ field: 'toBlock', message: 'To block must be at or after from block' })
})

test('operations failures state their cause', () => {
	expect(operationsFailureMessage(false, 400, 'fromBlock must be a block number')).toBe('Could not load protocol operations: fromBlock must be a block number')
	expect(operationsFailureMessage(false, 404, 'Pool not found')).toBe('No indexed record matches this address or identifier on the selected network: Pool not found')
	expect(operationsFailureMessage(true, 500, 'Request failed (500)')).toBe('Could not refresh protocol operations; existing evidence remains visible: Request failed (500)')
})

test('the connection indicator reports the per-block number apart from the announced status', () => {
	const network = {
		chain_id: '1',
		id: 'mainnet',
		name: 'Ethereum Mainnet',
		start_block: '1',
		indexed_block: '100',
		indexed_hash: '0x1',
		indexed_timestamp: '2026-01-01T00:00:00Z',
		observed_block: '100',
		finalized_block: '90',
		phase: 'live',
		last_poll_at: '2026-01-01T00:00:05Z',
		last_success_at: '2026-01-01T00:00:05Z',
		consecutive_failures: 0,
		last_error: null,
		explorer_base_url: 'https://etherscan.io',
	}
	const now = new Date('2026-01-01T00:00:10Z').getTime()
	const indicator = networkIndicator({ network, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 })
	expect(indicator.statusLabel).toBe('Live connection')
	expect(indicator.blockLabel).toBe(' · #100')
	expect(indicator.label).toBe('Live connection · #100')
	const backfillNetwork = { ...network, phase: 'backfilling', observed_block: '12445', indexed_timestamp: '2025-12-29T21:00:10Z' }
	const backfill = networkIndicator({ network: backfillNetwork, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 })
	expect(backfill.statusLabel).toBe('Backfilling')
	const estimated = networkIndicator({ network: backfillNetwork, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000, progressSample: { indexedBlock: 100, sampledAt: now, blocksPerSecond: 10 } })
	expect(estimated.label).toBe('Backfilling · 2d 3h behind · 12,345 blocks behind · 0.80% complete · ETA 20m 35s')
	expect(backfill.label).toBe('Backfilling · 2d 3h behind · 12,345 blocks behind · 0.80% complete · Estimating ETA')
	const reconnecting = networkIndicator({ network: backfillNetwork, demo: false, streamState: 'connecting', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 })
	expect(reconnecting.label).toBe('Backfilling · Reconnecting · 2d 3h behind · 12,345 blocks behind · 0.80% complete · Estimating ETA')
	for (const indexed_timestamp of [null, 'invalid']) {
		expect(networkIndicator({ network: { ...backfillNetwork, indexed_timestamp }, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 }).label).toBe('Backfilling · 12,345 blocks behind · 0.80% complete · Estimating ETA')
	}
	expect(networkIndicator({ network: { ...backfillNetwork, observed_block: '101', indexed_timestamp: '2026-01-01T00:00:05Z' }, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 }).label).toBe(
		'Backfilling · 5s behind · 1 block behind · 99.01% complete · Estimating ETA',
	)
	expect(networkIndicator({ network: { ...backfillNetwork, indexed_timestamp: '2026-01-01T00:00:20Z' }, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 }).label).toBe('Backfilling · 0s behind · 12,345 blocks behind · 0.80% complete · Estimating ETA')
	const next = networkIndicator({ network: { ...network, indexed_block: '101', observed_block: '101' }, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 })
	expect(next.statusLabel).toBe(indicator.statusLabel)
	expect(networkIndicator({ demo: false, streamState: 'connecting', failed: false, streamHasOpened: false, now, freshnessThresholdMs: 48_000 }).blockLabel).toBe('')
	expect(indicator.title).not.toContain('Last error')
	const retrying = networkIndicator({ network: { ...network, phase: 'degraded', consecutive_failures: 2, next_retry_at: '2026-01-01T00:00:30Z', last_error: 'RPC timeout' }, demo: false, streamState: 'open', failed: false, streamHasOpened: true, now, freshnessThresholdMs: 48_000 })
	expect(retrying.statusLabel).toBe('Indexer retrying')
	expect(retrying.title).toContain('2 consecutive failures; next retry at 2026-01-01 00:00:30 UTC. Last error: RPC timeout')
})

test('a link to a network that is not indexed is explained', () => {
	expect(unavailableNetworkNotice('10', 'Ethereum Mainnet')).toBe('Chain 10 is not indexed by this scanner. Showing Ethereum Mainnet instead.')
})

const networkRecord = (chainId: string, name: string): NetworkRecord => ({
	chain_id: chainId,
	id: name.toLowerCase(),
	name,
	start_block: '1',
	indexed_block: '100',
	indexed_hash: null,
	indexed_timestamp: null,
	observed_block: '100',
	finalized_block: null,
	phase: 'live',
	last_poll_at: null,
	last_success_at: null,
	consecutive_failures: 0,
	last_error: null,
	explorer_base_url: 'https://etherscan.io',
})

const networkRouteFixture = '<select id="global-network-filter"></select><div id="network-cards"></div><nav class="product-nav"><a href="/operations">Operations</a></nav><span id="rich-native-sort-option"></span><span id="rich-native-heading"></span>'

// happy-dom has no Option constructor.
const optionConstructor = (browser: Window) =>
	function Option(text: string, value: string) {
		const option = browser.document.createElement('option')
		option.textContent = text
		option.value = value
		return option
	}

test('the periodic network status poll leaves an unchanged network picker, an unapplied choice, and the URL untouched', async () => {
	await withBrowser('https://scanner.test/operations?chainId=1', networkRouteFixture, browser => {
		const select = lookup('#global-network-filter')
		let replacements = 0
		const restoreHistory = overrideGlobals({
			Option: optionConstructor(browser),
			history: {
				replaceState: (_state: unknown, _title: string, url: URL) => {
					replacements++
					browser.history.replaceState(null, '', url.href)
				},
			},
		})
		try {
			const route = createNetworkRoute({
				lookup,
				globalNetworkFilter: select,
				networkCards: lookup('#network-cards'),
				selectedChainId: () => selectedChainId({ initialChainId: '1' }, select),
				isDemo: false,
				setPageUrl: () => undefined,
				liveState: createScannerLiveState(),
				canonicalState: createCanonicalState(),
				api: async () => ({ items: [] }),
				writeSnapshot: () => undefined,
				resetSelectedNetworkContext: () => undefined,
				renderNetworks: () => undefined,
				getLatestNetworks: () => [],
				updateFreshness: () => undefined,
				updateConnectionStatus: () => undefined,
				loadRouteAfterNetworkChange: async () => undefined,
			})
			const items = [networkRecord('1', 'Ethereum Mainnet'), networkRecord('11155111', 'Sepolia')]
			route.reconcileNetworkOptions(items)
			const options = [...select.options]
			expect(options.map(option => option.value)).toEqual(['1', '11155111'])
			expect(select.value).toBe('1')
			const navigationHref = document.querySelector<HTMLAnchorElement>('.product-nav a')?.href
			const replacementsAfterFirstPoll = replacements
			route.reconcileNetworkOptions(items.map(item => ({ ...item, indexed_block: '101' })))
			expect(select.options.length).toBe(options.length)
			expect([...select.options].every((option, index) => option === options[index])).toBe(true)
			expect(replacements).toBe(replacementsAfterFirstPoll)
			expect(document.querySelector<HTMLAnchorElement>('.product-nav a')?.href).toBe(navigationHref)
			// A poll that arrives while the reader has chosen, but not applied, another network keeps that choice on screen.
			select.value = '11155111'
			route.reconcileNetworkOptions(items.map(item => ({ ...item, indexed_block: '102' })))
			expect(select.value).toBe('11155111')
			expect(selectedChainId({ initialChainId: '1' }, select)).toBe('1')
			expect(new URL(location.href).searchParams.get('chainId')).toBe('1')
			expect(replacements).toBe(replacementsAfterFirstPoll)
			select.value = '1'
			// A renamed or added network rebuilds the options.
			route.reconcileNetworkOptions([...items, networkRecord('10', 'Optimism')])
			expect([...select.options].map(option => option.value)).toEqual(['1', '11155111', '10'])
			expect(select.value).toBe('1')
		} finally {
			restoreHistory()
		}
	})
})

test('block numbers survive only the first adoption of a default network, not a later poll that drops the applied network', async () => {
	await withBrowser('https://scanner.test/operations/risk?atBlock=50', networkRouteFixture, async browser => {
		const select = lookup('#global-network-filter')
		const restoreOption = overrideGlobals({ Option: optionConstructor(browser) })
		try {
			let items = [networkRecord('1', 'Ethereum Mainnet'), networkRecord('11155111', 'Sepolia')]
			const resets: boolean[] = []
			const route = createNetworkRoute({
				lookup,
				globalNetworkFilter: select,
				networkCards: lookup('#network-cards'),
				// The page was opened without a chain, so the first status adopts the default network.
				selectedChainId: () => selectedChainId({ initialChainId: '' }, select),
				isDemo: false,
				setPageUrl: () => undefined,
				liveState: createScannerLiveState(),
				canonicalState: createCanonicalState(),
				api: async () => ({ items }),
				writeSnapshot: () => undefined,
				resetSelectedNetworkContext: ({ keepBlockNumbers }) => {
					resets.push(keepBlockNumbers)
				},
				renderNetworks: () => undefined,
				getLatestNetworks: () => [],
				updateFreshness: () => undefined,
				updateConnectionStatus: () => undefined,
				loadRouteAfterNetworkChange: async () => undefined,
			})
			expect(await route.loadNetworks()).toBe(true)
			expect(selectedChainId({ initialChainId: '' }, select)).toBe('1')
			expect(resets).toEqual([true])
			// The indexer stops serving the applied network; the next poll switches to another chain, whose blocks differ.
			items = [networkRecord('11155111', 'Sepolia')]
			expect(await route.loadNetworks()).toBe(true)
			expect(selectedChainId({ initialChainId: '' }, select)).toBe('11155111')
			expect(resets).toEqual([true, false])
		} finally {
			restoreOption()
		}
	})
})

test('metric cards expose their full value', async () => {
	await withBrowser('https://scanner.test/', '', () => {
		const { metricCard } = createStateComponents(
			(tag, className = '', text) => {
				const node = document.createElement(tag)
				node.className = className
				if (text !== undefined) node.textContent = text
				return node
			},
			() => document.createElement('a'),
		)
		const card = metricCard('Theoretical REP supply', '11,000,000.000000000000000001 REP')
		expect(card.querySelector('strong')?.title).toBe('11,000,000.000000000000000001 REP')
	})
})

test("loading the registry keeps the entity search usable and never leaves another entity's details on screen", async () => {
	await withBrowser(
		'https://scanner.test/question/2?chainId=1',
		'<input id="entity-search" /><button data-state-tab="pools" id="tab-pools">Pools</button><button data-state-tab="questions" id="tab-questions">Questions</button><div id="entity-list"><button class="entity-row">Row</button></div><article id="state-detail"><h3>Question one</h3></article>',
		() => {
			const state = createSystemRouteState()
			const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
				const node = document.createElement(tag)
				node.className = className
				if (text !== undefined) node.textContent = text
				return node
			}
			const unused = async () => {
				throw new Error('Not used by this test')
			}
			const route = createSystemRoute({
				state,
				canonicalState: createCanonicalState(),
				lookup,
				element,
				number: String,
				counted: (value, singular) => `${value} ${singular}`,
				nativeSymbol: () => 'ETH',
				fetchEntityHistory: unused,
				renderPoolDetail: unused,
				renderVaultDetail: unused,
				renderQuestionDetail: unused,
				renderUniverseDetail: unused,
				systemDetailRefreshGate: createForegroundRefreshGate(),
				liveSnapshot: () => new Map(),
				setLiveRecord: node => node,
				applyLiveChanges: () => ({ added: 0, changed: 0 }),
				errorMessage: () => 'error',
				retryCanonicalViewOr: fallback => fallback(),
				navigateToCanonicalEntity: () => undefined,
			})
			const search = lookup('#entity-search')
			search.focus()
			route.setSystemControlsDisabled(true)
			expect(search.disabled).toBe(false)
			expect(document.activeElement).toBe(search)
			expect(document.querySelector<HTMLButtonElement>('.entity-row')?.disabled).toBe(true)
			route.setSystemControlsDisabled(false)
			state.renderedDetailKey = 'questions:1:1'
			route.setStateTab('questions', '1:2')
			expect(lookup('#state-detail').textContent).toBe('Loading historical checkpoints…')
			expect(state.renderedDetailKey).toBeUndefined()
			state.renderedDetailKey = 'questions:1:2'
			lookup('#state-detail').textContent = 'Question two'
			route.setStateTab('questions', '1:2')
			expect(lookup('#state-detail').textContent).toBe('Question two')
		},
	)
})

test('a live System refresh keeps unchanged details untouched and reopens disclosures when they change', async () => {
	await withBrowser(
		'https://scanner.test/system?chainId=1',
		'<input id="entity-search" /><button data-state-tab="pools" id="tab-pools">Pools</button><h3 id="entity-list-title"></h3><span id="entity-count"></span><button id="entity-load-more" hidden></button><div id="entity-list"></div><article id="state-detail"></article>',
		async () => {
			const state = createSystemRouteState()
			const pool: PoolRecord = {
				chain_id: '1',
				network_id: 'mainnet',
				pool_address: addressA,
				parent_address: addressB,
				universe_id: '0',
				question_id: '1',
				question_title: 'Question one',
				truth_auction_address: addressB,
				coordinator_address: addressB,
				share_token_address: addressB,
				security_multiplier_bps: '10000',
				initial_priority_fee_atto_eth_per_gas: '0',
				initial_retention_rate: '0',
				initial_settlement_collateral_atto_eth: '0',
				settlement_collateral_atto_eth: '0',
				total_capacity_ownership_atto_rep: '0',
				fee_eligible_capacity_ownership_atto_rep: '0',
				total_claimable_vault_fees_atto_eth: '0',
				unallocated_accrued_fees_atto_eth: '0',
				current_retention_rate: '0',
				vault_count: '0',
				child_count: '0',
				snapshot_block: '10',
			}
			state.data = { pools: [pool], vaults: [], questions: [], universes: [], catalogVersion: '1' }
			let history: EntityHistory = { snapshots: [{ block_number: '10', timestamp: '1', settlement_collateral_atto_eth: '0' }], events: [], ammPrices: [], repEthPrices: [], uniswapRepEthPrices: [], openOracleHistory: [], pools: [], forks: [] }
			let renders = 0
			const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
				const node = document.createElement(tag)
				node.className = className
				if (text !== undefined) node.textContent = text
				return node
			}
			const unused = async () => {
				throw new Error('Not used by this test')
			}
			const route = createSystemRoute({
				state,
				canonicalState: createCanonicalState(),
				lookup,
				element,
				number: String,
				counted: (value, singular) => `${value} ${singular}`,
				nativeSymbol: () => 'ETH',
				fetchEntityHistory: async () => history,
				renderPoolDetail: async (_item, _requestVersion, _generation, loaded) => {
					renders++
					const chart = element('details', 'chart-data-disclosure')
					chart.append(element('summary', '', 'View exact chart data'), element('p', '', `${loaded?.snapshots.length ?? 0} checkpoints`))
					lookup('#state-detail').replaceChildren(element('h3', '', 'Question one'), chart)
				},
				renderVaultDetail: unused,
				renderQuestionDetail: unused,
				renderUniverseDetail: unused,
				systemDetailRefreshGate: createForegroundRefreshGate(),
				liveSnapshot: () => new Map(),
				setLiveRecord: node => node,
				applyLiveChanges: () => ({ added: 0, changed: 0 }),
				errorMessage: () => 'error',
				retryCanonicalViewOr: fallback => fallback(),
				navigateToCanonicalEntity: () => undefined,
			})
			expect(await route.selectEntity(pool)).toBe(true)
			expect(renders).toBe(1)
			const chart = document.querySelector<HTMLDetailsElement>('.chart-data-disclosure')
			const summary = chart?.querySelector<HTMLElement>('summary')
			if (chart === null || chart === undefined || summary === null || summary === undefined) throw new Error('Pool detail did not render')
			chart.open = true
			summary.focus()
			expect(await route.renderEntityList({ refreshSelected: true, live: true })).toBe(true)
			expect(renders).toBe(1)
			expect(document.querySelector('.chart-data-disclosure')).toBe(chart)
			expect(document.activeElement).toBe(summary)
			history = { ...history, snapshots: [...history.snapshots, { block_number: '11', timestamp: '2', settlement_collateral_atto_eth: '1' }] }
			expect(await route.renderEntityList({ refreshSelected: true, live: true })).toBe(true)
			expect(renders).toBe(2)
			expect(document.querySelector('.chart-data-disclosure')).not.toBe(chart)
			expect(document.querySelector<HTMLDetailsElement>('.chart-data-disclosure')?.open).toBe(true)
			expect(document.querySelector('#state-detail')?.textContent).toContain('2 checkpoints')
			expect(document.activeElement?.textContent).toBe('View exact chart data')
		},
	)
})

test('a live System refresh re-renders an open question once its time window ends, even when its data is unchanged', async () => {
	await withBrowser(
		'https://scanner.test/system?chainId=1&tab=questions',
		'<input id="entity-search" /><button data-state-tab="questions" id="tab-questions">Questions</button><h3 id="entity-list-title"></h3><span id="entity-count"></span><button id="entity-load-more" hidden></button><div id="entity-list"></div><article id="state-detail"></article>',
		async () => {
			const question: QuestionRecord = {
				chain_id: '1',
				network_id: 'mainnet',
				question_id: '1',
				title: 'Question one',
				description: 'Will it end?',
				created_timestamp: '2026-01-01T00:00:00Z',
				start_time: '1000',
				end_time: '2000',
				num_ticks: '0',
				display_value_min: '0',
				display_value_max: '0',
				answer_unit: '',
				outcome_options: ['Yes', 'No'],
				pool_count: '0',
				fork_count: '0',
			}
			const state = createSystemRouteState()
			state.activeType = 'questions'
			state.data = { pools: [], vaults: [], questions: [question], universes: [], catalogVersion: '1' }
			const history: EntityHistory = { snapshots: [], events: [], ammPrices: [], repEthPrices: [], uniswapRepEthPrices: [], openOracleHistory: [], pools: [], forks: [] }
			let renders = 0
			const unused = async () => {
				throw new Error('Not used by this test')
			}
			const route = createSystemRoute({
				state,
				canonicalState: createCanonicalState(),
				lookup,
				element,
				number: String,
				counted: (value, singular) => `${value} ${singular}`,
				nativeSymbol: () => 'ETH',
				fetchEntityHistory: async () => history,
				renderPoolDetail: unused,
				renderVaultDetail: unused,
				renderQuestionDetail: async item => {
					renders++
					lookup('#state-detail').replaceChildren(element('p', 'question-time-window', questionStatus(item)))
				},
				renderUniverseDetail: unused,
				systemDetailRefreshGate: createForegroundRefreshGate(),
				liveSnapshot: () => new Map(),
				setLiveRecord: node => node,
				applyLiveChanges: () => ({ added: 0, changed: 0 }),
				errorMessage: () => 'error',
				retryCanonicalViewOr: fallback => fallback(),
				navigateToCanonicalEntity: () => undefined,
			})
			try {
				setSystemTime(new Date(1_500_000))
				expect(await route.selectEntity(question)).toBe(true)
				expect(lookup('#state-detail').textContent).toBe('Open')
				expect(await route.renderEntityList({ refreshSelected: true, live: true })).toBe(true)
				expect(renders).toBe(1)
				setSystemTime(new Date(2_500_000))
				expect(await route.renderEntityList({ refreshSelected: true, live: true })).toBe(true)
				expect(renders).toBe(2)
				expect(lookup('#state-detail').textContent).toBe('Ended')
			} finally {
				setSystemTime()
			}
		},
	)
})

const activityLog = (blockNumber: number): ActivityRecord => ({
	chain_id: '1',
	network_id: 'mainnet',
	block_number: String(blockNumber),
	block_hash: `0xblock${blockNumber}`,
	block_timestamp: '2026-01-01T00:00:00Z',
	transaction_index: 0,
	log_index: 0,
	tx_hash: `0xtx${blockNumber}`,
	emitter_address: addressA,
	contract_label: 'Pool',
	contract_kind: null,
	event_name: 'Transfer',
	summary: `Transfer in block ${blockNumber}`,
	decode_status: 'decoded',
	canonical: true,
	finalized: false,
	topics: [],
	data: '0x',
	arguments: null,
	display_arguments: null,
	argument_schema: null,
	origin_address: null,
	explorer_base_url: 'https://etherscan.io',
})

const activityFixture =
	'<p id="activity-summary"></p><form id="filters"><input id="event-filter" /><input id="address-filter" /><button type="submit">Apply filters</button><button id="clear-filters" type="button">Clear filters</button></form><div class="feed-shell"><div id="feed-state"></div><div id="feed"></div></div><div id="activity-more-status" hidden></div><button id="more" type="button" hidden>Show more</button>'

// Composes the activity feed and its log drawers as the scanner does; log details stay loading, since drawers are placed before their content arrives.
const createActivityHarness = (pages: Readonly<Record<string, { readonly items: ActivityRecord[]; readonly nextCursor?: string }>>) => {
	const feed = lookup('#feed')
	const activityDetailState = createActivityDetailState()
	const canonicalState = createCanonicalState()
	const clearDetailUrl = () => history.replaceState(null, '', urlWithoutLogDetail(new URL(location.href)))
	const card = () => element('div')
	const eventDetail = createEventDetailRoute({
		feed,
		activityDetailState,
		canonicalState,
		element,
		number: String,
		api: () => new Promise(() => undefined),
		syncCanonicalDialogStatus: () => undefined,
		clearDetailUrl,
		errorMessage: String,
		detailCard: card,
		evidenceDetailCard: card,
		addressDetailCard: card,
		decodedArgumentsTable: card,
	})
	const activity = createActivityRoute({
		lookup,
		feed,
		feedState: lookup('#feed-state'),
		activityRoute: createActivityRouteState({ event: '', address: '' }),
		activityDetailState,
		canonicalState,
		getViewContextVersion: () => 0,
		requiredChainId: () => '1',
		selectedChainId: () => '1',
		api: async path => pages[new URL(path, location.origin).searchParams.get('cursor') ?? ''] ?? { items: [] },
		rowFor: log =>
			renderActivityRow(
				{
					setLiveRecord,
					element,
					number: String,
					isDemo: false,
					time: String,
					age: String,
					exactTimestamp: String,
					eventDrawerFor: eventDetail.eventDrawerFor,
					closeEventDrawer: options => eventDetail.closeEventDrawer(options),
					openDetail: log => eventDetail.openDetail(log),
				},
				log,
			),
		liveSnapshot,
		applyLiveChanges,
		eventDrawers: eventDetail.eventDrawers,
		captureDetailContext: eventDetail.captureDetailContext,
		placeEventDrawer: eventDetail.placeEventDrawer,
		updateLogDisclosures: eventDetail.updateLogDisclosures,
		restoreDetailContext: eventDetail.restoreDetailContext,
		clearDetailUrl,
		getRequestRouteRefresh: () => async () => true,
		renderRetryStatus,
		errorMessage: String,
		element,
		logRefreshGate: createForegroundRefreshGate(),
	})
	return { activity, eventDetail }
}

test('a deep-linked log drawer pinned above the feed has a Close control that removes it and clears its link', async () => {
	const deepLog = activityLog(5)
	await withBrowser(`https://scanner.test/?chainId=1&log=${encodeURIComponent(logKeyFor(deepLog))}`, activityFixture, async () => {
		const { activity, eventDetail } = createActivityHarness({ '': { items: [activityLog(9), activityLog(8)], nextCursor: 'next' } })
		expect(await activity.loadLogs()).toBe(true)
		void eventDetail.openDetail(deepLog)
		const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
		if (drawer === null) throw new Error('The deep-linked drawer did not open')
		expect(drawer.dataset['placement']).toBe('pinned')
		const close = drawer.querySelector<HTMLButtonElement>('button[aria-label="Close log details"]')
		if (close === null) throw new Error('The pinned drawer has no Close control')
		close.focus()
		close.click()
		expect(document.querySelector('.event-detail-drawer')).toBeNull()
		// The drawer had no row to return focus to, so focus moves to the feed it was shown above.
		expect(document.activeElement).toBe(lookup('#feed'))
		expect(new URL(location.href).searchParams.get('log')).toBeNull()
		expect(new URL(location.href).searchParams.get('chainId')).toBe('1')
	})
})

test('loading more activity moves a pinned log drawer under its newly loaded row', async () => {
	const deepLog = activityLog(5)
	await withBrowser(`https://scanner.test/?chainId=1&log=${encodeURIComponent(logKeyFor(deepLog))}`, activityFixture, async () => {
		const { activity, eventDetail } = createActivityHarness({
			'': { items: [activityLog(9), activityLog(8)], nextCursor: 'next' },
			next: { items: [activityLog(6), deepLog, activityLog(4)] },
		})
		expect(await activity.loadLogs()).toBe(true)
		void eventDetail.openDetail(deepLog)
		const drawer = document.querySelector<HTMLElement>('.event-detail-drawer')
		if (drawer === null) throw new Error('The deep-linked drawer did not open')
		expect(drawer.dataset['placement']).toBe('pinned')
		expect(await activity.loadLogs({ append: true })).toBe(true)
		const deepRow = [...document.querySelectorAll<HTMLElement>('.log-row')].find(row => row.dataset['liveKey'] === logKeyFor(deepLog))
		if (deepRow === undefined) throw new Error('The deep-linked row did not load')
		expect(deepRow.nextElementSibling).toBe(drawer)
		expect(drawer.dataset['placement']).toBeUndefined()
		expect(deepRow.querySelector('.event-name')?.getAttribute('aria-expanded')).toBe('true')
		expect(document.querySelectorAll('.event-detail-drawer').length).toBe(1)
		expect(new URL(location.href).searchParams.get('log')).toBe(logKeyFor(deepLog))
	})
})

for (const traceStatus of ['not-requested', 'unavailable'] as const) {
	for (const status of ['success', 'reverted'] as const) {
		test(`explorer distinguishes trace availability and attempted values (${traceStatus}, ${status})`, async () => {
			await withBrowser('https://scanner.test/tx/0xabc?chainId=1', '<div id="explorer-content"></div>', async () => {
				await renderExplorerPage('/tx/0xabc', '1', async () => ({ transaction: { hash: '0xabc', block_number: '1', block_timestamp: '2026-09-23T00:00:00Z', explorer_base_url: 'https://etherscan.io', value: '0', gas_used: '21000', status, receipt: { callTraceStatus: traceStatus } }, logs: [] }))
				const text = document.querySelector('#explorer-content')?.textContent ?? ''
				expect(text).toContain(traceStatus === 'not-requested' ? 'Call traces were not requested' : 'Call traces unavailable')
				expect(text.includes('attempted value')).toBe(status === 'reverted')
			})
		})
	}
}
