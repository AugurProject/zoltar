import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { createAddressProfileRoute } from '../../browser/address-profile-route.ts'
import { lookup } from '../../browser/app-dom.ts'
import { clearRetryStatus, firstVisibleHeading, setTextIfChanged, tickRelativeTimes } from '../../browser/app-presentation.ts'
import { createCanonicalState } from '../../browser/canonical-state.ts'
import { renderExplorerPage } from '../../browser/explorer-page.ts'
import { exactUnit } from '../../browser/format.ts'
import { createForegroundRefreshGate, liveRecordsMatch, shouldPollRouteRefresh, shouldRefreshRouteOnLiveEvent, streamReconnectDelay } from '../../browser/live-refresh.ts'
import { nativeSymbolFor, unavailableNetworkNotice } from '../../browser/network-freshness.ts'
import { networkIndicator } from '../../browser/network-indicator.ts'
import { blockRangeError, filterFormDestination, operationsFailureMessage } from '../../browser/operations-presentation.ts'
import { navigationTarget, routeDataContext } from '../../browser/routes.ts'
import { mountSearch } from '../../browser/search-ui.ts'
import { createStateComponents } from '../../browser/state-components.ts'
import { createSystemRoute } from '../../browser/system-route.ts'
import { createSystemRouteState } from '../../browser/system-route-state.ts'
import { captureViewState, restoreViewState } from '../../browser/view-state.ts'
import { overrideGlobals } from '../support/global-overrides.ts'

const withBrowser = async (url: string, html: string, run: (browser: Window) => Promise<void> | void): Promise<void> => {
	const browser = new Window({ url })
	browser.document.body.innerHTML = html
	const restoreGlobals = overrideGlobals({
		document: browser.document,
		location: browser.location,
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

test('route filters do not follow the user to another route while page-wide parameters do', () => {
	const target = navigationTarget(new URL('https://scanner.test/operations/timeline'), new URL('https://scanner.test/?chainId=1&demo=1&event=Transfer&address=0xabc&log=1:a:b:0&sort=rep'))
	expect(target.pathname).toBe('/operations/timeline')
	expect(target.searchParams.get('chainId')).toBe('1')
	expect(target.searchParams.get('demo')).toBe('1')
	expect(target.searchParams.get('sort')).toBe('rep')
	for (const name of ['event', 'address', 'log']) expect(target.searchParams.has(name)).toBe(false)
	const back = navigationTarget(new URL('https://scanner.test/?chainId=1'), new URL('https://scanner.test/operations/timeline?chainId=11155111&q=fork&entityType=vault&canonical=all&atBlock=5'))
	expect(back.search).toBe('?chainId=1')
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
})

test('a link to a network that is not indexed is explained', () => {
	expect(unavailableNetworkNotice('10', 'Ethereum Mainnet')).toBe('Chain 10 is not indexed by this scanner. Showing Ethereum Mainnet instead.')
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
