import { promises as fs } from 'node:fs'

type CdpMessage = Readonly<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown }>

const outputDirectory = process.env.TRADING_QA_OUTPUT ?? '/tmp/zoltar-trading-qa'
const baseUrl = process.env.TRADING_QA_URL ?? 'http://127.0.0.1:12346'
const debuggingPort = 9227
await fs.mkdir(outputDirectory, { recursive: true })
const userDataDirectory = await fs.mkdtemp('/tmp/zoltar-trading-qa-browser-')
const browser = Bun.spawn({
	cmd: ['chromium', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run', `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${userDataDirectory}`, 'about:blank'],
	stdout: 'ignore',
	stderr: 'ignore',
})

async function waitForDebugger() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`)
			if (response.ok) return
		} catch (error) {
			if (typeof error !== 'object' || error === null || !('code' in error) || !['ConnectionRefused', 'ECONNREFUSED', 'ECONNRESET'].includes(String(error.code))) throw error
		}
		await Bun.sleep(100)
	}
	throw new Error('Chromium debugging endpoint did not start')
}

await waitForDebugger()
const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?about:blank`, { method: 'PUT' })
const target: unknown = await targetResponse.json()
if (typeof target !== 'object' || target === null || !('webSocketDebuggerUrl' in target) || typeof target.webSocketDebuggerUrl !== 'string') throw new Error('Chromium target did not expose a debugger WebSocket')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise<void>((resolve, reject) => {
	socket.addEventListener('open', () => resolve(), { once: true })
	socket.addEventListener('error', () => reject(new Error('Debugger WebSocket failed')), { once: true })
})
let nextId = 1
const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(reason: unknown): void }>()
const runtimeErrors: string[] = []
socket.addEventListener('message', event => {
	const candidate: unknown = JSON.parse(String(event.data))
	if (typeof candidate !== 'object' || candidate === null) {
		runtimeErrors.push('Chromium returned a malformed debugger message')
		return
	}
	const message: CdpMessage = candidate
	if (message.id !== undefined) {
		const request = pending.get(message.id)
		if (request === undefined) return
		pending.delete(message.id)
		if (message.error !== undefined) request.reject(message.error)
		else request.resolve(message.result ?? {})
		return
	}
	if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(JSON.stringify(message.params ?? {}))
	if (message.method === 'Log.entryAdded') {
		const entry = message.params?.entry
		if (typeof entry === 'object' && entry !== null && 'level' in entry && entry.level === 'error') runtimeErrors.push(JSON.stringify(entry))
	}
})

function command(method: string, params: Record<string, unknown> = {}) {
	const id = nextId++
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params }))
	})
}

await command('Page.enable')
await command('Runtime.enable')
await command('Log.enable')
const capacityFactsAssertion = `document.body.textContent?.includes('Total / fee-eligible capacity ownership') === true && document.body.textContent?.includes('10,000 / 9,500 REP') === true && document.body.textContent?.includes('Minting capacity') === true && document.body.textContent?.includes('2,468.5 / 10,000 ETH') === true && document.body.textContent?.includes('Available minting capacity') === false && document.body.textContent?.includes('Fork continuation') === false && document.body.textContent?.includes('Demo discovery snapshot') === false && document.documentElement.scrollWidth <= document.documentElement.clientWidth`
const poolInternalsHiddenAssertion = `!['Outcome token IDs', 'System state', 'Security multiplier', 'Total / fee-eligible capacity ownership', 'Minting capacity'].some(label => document.body.textContent?.includes(label) === true)`
const poolDetailsAssertion = `(${capacityFactsAssertion}) && document.body.textContent?.includes('Share token address') === true && document.body.textContent?.includes('Outcome token IDs') === true && document.body.textContent?.includes('System stateOperational') === true && document.body.textContent?.includes('Security multiplier2×') === true && document.body.textContent?.includes('OutcomeUnresolved') === false`
const removedCopyAssertion = `(() => { const text = (document.body.textContent ?? '').toLowerCase(); const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.toLowerCase() ?? ''; return !['binary shares for', 'invalid is insurance', 'invalid is not traded or priced by this amm', 'canonical securitypools', 'in a live transaction', 'illustrative', 'market signal', 'exact identity', 'preview ready', 'gwei', 'positions grouped by securitypool', 'securitypool used by this amm'].some(phrase => text.includes(phrase)) && !/\\b(?:yes|no|invalid) shares?\\b/.test(description); })()`
const universeSelectorAssertion = `document.querySelector('.universe-selector select')?.getAttribute('aria-label') === 'Select universe' && document.querySelector('.universe-selector > span') === null && document.querySelector('.universe-selector select')?.selectedOptions[0]?.textContent === 'Genesis universe'`
const genesisWalletSummaryAssertion = `(() => { const summary = document.querySelector('.wallet-summary'); const address = summary?.querySelector('.wallet-summary__address')?.textContent ?? ''; const eth = summary?.querySelector('[data-wallet-asset="ETH"] strong')?.textContent; const rep = summary?.querySelector('[data-wallet-asset="REP"] strong')?.textContent; return /^0x[0-9a-f]{40}$/i.test(address) && !address.includes('…') && eth === '64' && rep === '12,500' && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`
const walletBalanceBoundsAssertion = `(() => { const wallet = document.querySelector('.wallet-summary')?.getBoundingClientRect(); const values = [...document.querySelectorAll('.wallet-summary__balances strong')].map(value => value.getBoundingClientRect()).filter(value => value.width > 0 && value.height > 0); const compact = document.querySelector('.wallet-summary__address--compact')?.getBoundingClientRect(); const visibleContentFits = values.length === 2 ? values.every(value => value.left >= wallet.left && value.right <= wallet.right && value.top >= wallet.top && value.bottom <= wallet.bottom) : compact !== undefined && compact.width > 0 && compact.left >= wallet.left && compact.right <= wallet.right; return wallet !== undefined && visibleContentFits && document.documentElement.scrollWidth <= innerWidth })()`
const maximumWalletBalancesAssertion = `(${walletBalanceBoundsAssertion}) && [...document.querySelectorAll('.wallet-summary__balances strong')].every(value => value.textContent?.endsWith('.584007913129639935') === true)`
const smallWalletBalancesAssertion = `(${walletBalanceBoundsAssertion}) && [...document.querySelectorAll('.wallet-summary__balances strong')].every(value => value.textContent === '0.000000000000000001')`
const headerRowsAssertion = `(() => { const actions = document.querySelector('.header-actions')?.getBoundingClientRect(); const nav = document.querySelector('.site-header nav')?.getBoundingClientRect(); const header = document.querySelector('.site-header')?.getBoundingClientRect(); return actions !== undefined && nav !== undefined && header !== undefined && nav.top >= actions.bottom && actions.left >= header.left && actions.right <= header.right && nav.left >= header.left && nav.right <= header.right && document.documentElement.scrollWidth <= innerWidth })()`
const visibleHeaderContextAssertion = `(() => { const selectors = ['.demo-banner', '.brand', '.network-pill', '.universe-selector select']; const bounds = selectors.map(selector => document.querySelector(selector)?.getBoundingClientRect()); return bounds.every(value => value !== undefined && value.width > 0 && value.height > 0 && value.left >= 0 && value.right <= innerWidth && value.top >= 0 && value.bottom <= innerHeight) && document.querySelector('.demo-banner')?.textContent?.includes('SIMULATED DATA') === true && document.querySelector('.brand')?.textContent?.includes('Zoltar') === true && document.querySelector('.network-pill')?.textContent?.includes('Anvil 31337') === true && document.querySelector('.universe-selector select')?.selectedOptions[0]?.textContent === 'Genesis universe' })()`
const expandedWalletInFlowAssertion = `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const nav = document.querySelector('.site-header nav')?.getBoundingClientRect(); const main = document.querySelector('main')?.getBoundingClientRect(); return panel !== undefined && nav !== undefined && main !== undefined && panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= nav.top && panel.bottom <= main.top })()`
const transactionStateLayoutAssertion = `(() => { const panel = document.querySelector('.trade-panel')?.getBoundingClientRect(); const action = document.querySelector('.trade-action')?.getBoundingClientRect(); const status = document.querySelector('.transaction-message')?.getBoundingClientRect(); const hash = document.querySelector('.transaction-hash'); const hashBounds = hash?.getBoundingClientRect(); const hashCode = hash?.querySelector('code'); const hashFits = hash === null || (hashBounds !== undefined && hashBounds.left >= panel.left && hashBounds.right <= panel.right && hashCode?.textContent?.length === 66); return panel !== undefined && action !== undefined && status !== undefined && action.bottom <= status.top && hashFits && [...document.querySelectorAll('.trade-panel button, .trade-panel input')].every(control => control.disabled) && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`
const scenarios = [
	{
		name: 'disconnected-market-list',
		width: 1440,
		height: 900,
		path: '/#/markets',
		assertExpression: `document.querySelector('.wallet-status') === null && document.body.textContent?.includes('Connect in market view') !== true && [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Retry deployment')`,
	},
	{
		name: 'disconnected-market-list-mobile',
		width: 390,
		height: 844,
		path: '/#/markets',
		assertExpression: `[...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Retry deployment' && button.getBoundingClientRect().height >= 44) && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{ name: 'wrong-network', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/markets', assertExpression: `document.documentElement.scrollWidth <= document.documentElement.clientWidth` },
	{
		name: 'market-list-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/markets',
		assertExpression: `(() => { const checks = { poolInternalsHidden: ${poolInternalsHiddenAssertion}, removedCopy: ${removedCopyAssertion}, universeSelector: ${universeSelectorAssertion}, walletSummary: ${genesisWalletSummaryAssertion} }; if (Object.values(checks).some(value => !value)) throw new Error(JSON.stringify(checks)); return true })()`,
	},
	{ name: 'market-list-1280', width: 1280, height: 900, path: '/?demo=1&scenario=baseline#/markets', assertExpression: genesisWalletSummaryAssertion },
	{ name: 'market-list-1181', width: 1181, height: 900, path: '/?demo=1&scenario=baseline#/markets', assertExpression: genesisWalletSummaryAssertion },
	{ name: 'market-list-1501', width: 1501, height: 900, path: '/?demo=1&scenario=baseline#/markets', assertExpression: `(${genesisWalletSummaryAssertion}) && (${headerRowsAssertion})` },
	{ name: 'market-list-1600', width: 1600, height: 900, path: '/?demo=1&scenario=baseline#/markets', assertExpression: `(${genesisWalletSummaryAssertion}) && (${headerRowsAssertion})` },
	{
		name: 'wallet-ready-desktop-expanded',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `document.querySelector('.wallet-summary')?.hasAttribute('open') === true && document.querySelector('.wallet-summary__trigger')?.getAttribute('tabindex') !== '-1' && document.querySelector('.wallet-summary__identity')?.getBoundingClientRect().height > 0 && document.querySelector('.wallet-summary__detail-balances')?.getBoundingClientRect().height > 0 && document.documentElement.scrollWidth <= innerWidth`,
	},
	{
		name: 'wallet-balance-loading',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=wallet-balance-loading#/markets',
		assertExpression: `document.querySelector('.wallet-summary')?.getAttribute('aria-busy') === 'true' && document.querySelector('.wallet-summary [role="status"]')?.textContent?.includes('Loading wallet ETH') === true && [...document.querySelectorAll('.wallet-summary__balances strong')].every(value => value.textContent === '…')`,
	},
	{
		name: 'wallet-balance-loading-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=wallet-balance-loading#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `document.querySelector('.wallet-summary')?.getAttribute('aria-busy') === 'true' && document.querySelector('.wallet-summary__compact-loading')?.getBoundingClientRect().width > 0 && [...document.querySelectorAll('.wallet-summary__detail-balances strong')].every(value => value.textContent === '…' && value.getBoundingClientRect().width > 0) && (${expandedWalletInFlowAssertion}) && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{
		name: 'wallet-balance-error',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		assertExpression: `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const nav = document.querySelector('.site-header nav')?.getBoundingClientRect(); const main = document.querySelector('main')?.getBoundingClientRect(); return document.querySelector('.wallet-summary')?.getAttribute('aria-busy') === 'false' && document.querySelector('.wallet-summary [role="alert"]')?.textContent === 'Wallet balance read failed' && document.querySelector('.wallet-summary__retry') !== null && panel !== undefined && nav !== undefined && main !== undefined && panel.bottom <= nav.top && panel.bottom <= main.top && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
	},
	{
		name: 'wallet-balance-error-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		assertExpression: `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const nav = document.querySelector('.site-header nav')?.getBoundingClientRect(); const main = document.querySelector('main')?.getBoundingClientRect(); return document.querySelector('.wallet-summary')?.getAttribute('aria-busy') === 'false' && document.querySelector('.wallet-summary [role="alert"]')?.textContent === 'Wallet balance read failed' && document.querySelector('.wallet-summary__identity code')?.textContent === '${'0x8ba1f109551bD432803012645Ac136ddd64DBA72'}' && document.querySelector('.wallet-summary__retry')?.getBoundingClientRect().height === 44 && panel !== undefined && nav !== undefined && main !== undefined && panel.bottom <= nav.top && panel.bottom <= main.top && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
	},
	{
		name: 'wallet-balance-error-collapsed',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `document.querySelector('.wallet-summary')?.hasAttribute('open') === false && document.querySelector('.wallet-summary__details')?.getBoundingClientRect().height === 0 && document.querySelector('.wallet-summary__trigger')?.getAttribute('tabindex') !== '-1'`,
	},
	{ name: 'wallet-ready-900', width: 900, height: 844, path: '/?demo=1&scenario=baseline#/markets', assertExpression: genesisWalletSummaryAssertion },
	{
		name: 'wallet-balance-error-800',
		width: 800,
		height: 844,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		assertExpression: `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const universe = document.querySelector('.universe-selector')?.getBoundingClientRect(); const nav = document.querySelector('.site-header nav')?.getBoundingClientRect(); const main = document.querySelector('main')?.getBoundingClientRect(); const intersectsUniverse = panel !== undefined && universe !== undefined && panel.left < universe.right && panel.right > universe.left && panel.top < universe.bottom && panel.bottom > universe.top; return panel !== undefined && nav !== undefined && main !== undefined && panel.left >= 0 && panel.right <= innerWidth && panel.bottom <= nav.top && panel.bottom <= main.top && !intersectsUniverse && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
	},
	{
		name: 'wallet-discovery-error-761',
		width: 761,
		height: 844,
		path: '/?demo=1&scenario=wallet-discovery-error#/markets',
		assertExpression: `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const universe = document.querySelector('.universe-selector')?.getBoundingClientRect(); const intersects = panel !== undefined && universe !== undefined && panel.left < universe.right && panel.right > universe.left && panel.top < universe.bottom && panel.bottom > universe.top; return document.querySelector('.wallet-summary [role="alert"]')?.textContent === 'No SecurityPool in this universe' && panel !== undefined && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight && !intersects && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
	},
	{
		name: 'wallet-pool-error-900',
		width: 900,
		height: 844,
		path: '/?demo=1&scenario=wallet-pool-error#/markets',
		assertExpression: `(() => { const panel = document.querySelector('.wallet-summary__details')?.getBoundingClientRect(); const universe = document.querySelector('.universe-selector')?.getBoundingClientRect(); const intersects = panel !== undefined && universe !== undefined && panel.left < universe.right && panel.right > universe.left && panel.top < universe.bottom && panel.bottom > universe.top; return document.querySelector('.wallet-summary [role="alert"]')?.textContent === 'SecurityPool unavailable' && panel !== undefined && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight && !intersects && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
	},
	{
		name: 'wallet-max-balances-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=wallet-max-balances#/markets',
		assertExpression: maximumWalletBalancesAssertion,
	},
	{
		name: 'wallet-max-balances-900',
		width: 900,
		height: 844,
		path: '/?demo=1&scenario=wallet-max-balances#/markets',
		assertExpression: `(${maximumWalletBalancesAssertion}) && (${visibleHeaderContextAssertion})`,
	},
	{
		name: 'wallet-max-balances-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=wallet-max-balances#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `(${maximumWalletBalancesAssertion}) && [...document.querySelectorAll('.wallet-summary__detail-balances strong')].every(value => value.textContent?.endsWith('.584007913129639935') === true && value.getBoundingClientRect().width > 0) && (${expandedWalletInFlowAssertion})`,
	},
	{
		name: 'wallet-max-balances-1501',
		width: 1501,
		height: 900,
		path: '/?demo=1&scenario=wallet-max-balances#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `document.querySelector('.wallet-summary')?.hasAttribute('open') === false && (${maximumWalletBalancesAssertion}) && (${headerRowsAssertion})`,
	},
	{ name: 'wallet-max-balances-1600', width: 1600, height: 900, path: '/?demo=1&scenario=wallet-max-balances#/markets', assertExpression: `(${maximumWalletBalancesAssertion}) && (${headerRowsAssertion})` },
	{ name: 'wallet-small-balances-desktop', width: 1440, height: 900, path: '/?demo=1&scenario=wallet-small-balances#/markets', assertExpression: smallWalletBalancesAssertion },
	{ name: 'wallet-small-balances-900', width: 900, height: 844, path: '/?demo=1&scenario=wallet-small-balances#/markets', assertExpression: smallWalletBalancesAssertion },
	{
		name: 'wallet-small-balances-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=wallet-small-balances#/markets',
		clickSelector: '.wallet-summary__trigger',
		clickWaitMs: 50,
		assertExpression: `(${smallWalletBalancesAssertion}) && [...document.querySelectorAll('.wallet-summary__detail-balances strong')].every(value => value.textContent === '0.000000000000000001' && value.getBoundingClientRect().width > 0) && (${expandedWalletInFlowAssertion})`,
	},
	{
		name: 'wallet-balance-retry',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		clickSelector: '.wallet-summary__retry',
		clickWaitMs: 150,
		assertExpression: `document.querySelector('.wallet-summary [role="alert"]') === null && document.querySelector('[data-wallet-asset="ETH"] strong')?.textContent === '64' && document.querySelector('[data-wallet-asset="REP"] strong')?.textContent === '12,500'`,
	},
	{
		name: 'wallet-balance-retry-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=wallet-balance-error#/markets',
		clickSelector: '.wallet-summary__retry',
		clickWaitMs: 150,
		assertExpression: `document.querySelector('.wallet-summary [role="alert"]') === null && document.querySelector('[data-wallet-asset="ETH"] strong')?.textContent === '64' && document.querySelector('[data-wallet-asset="REP"] strong')?.textContent === '12,500' && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{
		name: 'market-list-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/markets',
		assertExpression: `(() => { const poolFacts = [...document.querySelectorAll('.market-row__pool div')]; const exactPoolVisible = poolFacts.some(fact => fact.querySelector('dt')?.textContent === 'Security pool' && fact.querySelector('.security-pool-link')?.textContent === '0x3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a'); const rowActionHeights = [...document.querySelectorAll('.row-action')].map(control => control.getBoundingClientRect().height); const poolLinkHeights = [...document.querySelectorAll('.security-pool-link')].map(control => control.getBoundingClientRect().height); const selectorBounds = document.querySelector('.universe-selector select')?.getBoundingClientRect(); const poolInternalsHidden = ${poolInternalsHiddenAssertion}; const walletSummaryVisible = ${genesisWalletSummaryAssertion}; if (!exactPoolVisible || !poolInternalsHidden || !walletSummaryVisible || !(${removedCopyAssertion}) || selectorBounds === undefined || selectorBounds.height < 44 || selectorBounds.width < 180 || rowActionHeights.some(height => height < 44) || poolLinkHeights.some(height => height < 44)) throw new Error(JSON.stringify({ exactPoolVisible, poolInternalsHidden, walletSummaryVisible, selectorBounds, rowActionHeights, poolLinkHeights, bodyText: document.body.textContent?.slice(0, 500) })); return true })()`,
	},
	{ name: 'wrong-network-market', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/market', assertExpression: `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, scrollY: 500 },
	{ name: 'wrong-network-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=wrong-network#/market', scrollY: 650 },
	{ name: 'loading', width: 1440, height: 900, path: '/?demo=1&scenario=loading#/markets', assertExpression: removedCopyAssertion },
	{
		name: 'market-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/market',
		assertExpression: `(${poolInternalsHiddenAssertion}) && (${removedCopyAssertion}) && document.querySelector('.trade-summary')?.textContent?.includes('You pay') === true && document.querySelector('.trade-action')?.getBoundingClientRect().bottom <= innerHeight && document.querySelector('.detail-aside')?.textContent?.includes('Conditional YES price') === false`,
	},
	{
		name: 'market-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/market',
		assertExpression: `(${poolInternalsHiddenAssertion}) && document.querySelector('.wallet-summary__address--compact')?.getBoundingClientRect().width > 0 && document.querySelector('.trade-summary')?.textContent?.includes('You receive') === true && [...document.querySelectorAll('.segmented button, .brand, .eyebrow[href], details summary, .security-pool-link')].every(control => control.getBoundingClientRect().height >= 44)`,
	},
	{ name: 'security-pool-desktop', width: 1440, height: 900, path: `/?demo=1&scenario=baseline#/security-pool/0x${'3a'.repeat(20)}`, assertExpression: poolDetailsAssertion },
	{ name: 'security-pool-mobile', width: 390, height: 844, path: `/?demo=1&scenario=baseline#/security-pool/0x${'3a'.repeat(20)}`, assertExpression: `(${poolDetailsAssertion}) && document.documentElement.scrollWidth <= document.documentElement.clientWidth` },
	{
		name: 'security-pool-unavailable-desktop',
		width: 1440,
		height: 900,
		path: `/?demo=1&scenario=baseline#/security-pool/0x${'99'.repeat(20)}`,
		assertExpression: `(() => { const alertVisible = document.querySelector('main [role="alert"]')?.textContent?.includes('This security pool is not available in the selected universe.') === true; const marketListHidden = document.querySelector('main')?.textContent?.includes('Trading open') !== true; if (!alertVisible || !marketListHidden) throw new Error(JSON.stringify({ alertVisible, marketListHidden, main: document.querySelector('main')?.textContent, hash: window.location.hash })); return true })()`,
	},
	{
		name: 'security-pool-unavailable-mobile',
		width: 390,
		height: 844,
		path: `/?demo=1&scenario=baseline#/security-pool/0x${'99'.repeat(20)}`,
		assertExpression: `document.querySelector('main [role="alert"]')?.textContent?.includes('This security pool is not available in the selected universe.') === true && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{ name: 'help-mobile', width: 390, height: 844, path: '/#/help', assertExpression: removedCopyAssertion },
	{ name: 'no-entry', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&side=no#/market' },
	{ name: 'insured-exit', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&mode=exit#/market' },
	{
		name: 'insufficient-invalid',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=insufficient-invalid&mode=exit#/market',
		scrollY: 650,
		postScrollAssertExpression: `(() => { const chrome = document.querySelector('.site-chrome'); return chrome instanceof HTMLElement && getComputedStyle(chrome).position === 'relative' && chrome.getBoundingClientRect().bottom < 0 })()`,
	},
	{ name: 'pair-missing', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/markets' },
	{ name: 'ended-pair-missing-list', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/markets' },
	{ name: 'pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/market', assertExpression: `document.body.textContent?.includes('Pair initialization required') === true && document.body.textContent?.includes('Waiting for input') !== true` },
	{ name: 'pair-missing-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/market', scrollY: 500 },
	{
		name: 'pair-uninitialized-market',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=uninitialized-pair#/market',
		assertExpression: `(() => { const action = [...document.querySelectorAll('a')].find(link => link.textContent?.includes('Initialize this pair in Liquidity')); const bounds = action?.getBoundingClientRect(); return document.querySelector('.trade-panel') === null && document.body.textContent?.includes('Conditional price unavailable') === true && document.body.textContent?.includes('Conditional YES price 0.0%') !== true && bounds !== undefined && bounds.top >= 0 && bounds.bottom <= innerHeight })()`,
	},
	{
		name: 'pair-uninitialized-market-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=uninitialized-pair#/market',
		assertExpression: `(() => { const action = [...document.querySelectorAll('a')].find(link => link.textContent?.includes('Initialize this pair in Liquidity')); const bounds = action?.getBoundingClientRect(); return document.querySelector('.trade-panel') === null && document.body.textContent?.includes('Conditional price unavailable') === true && bounds !== undefined && bounds.top >= 0 && bounds.bottom <= innerHeight })()`,
	},
	{ name: 'ended-pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/market', scrollY: 500 },
	{ name: 'ended-pair-missing-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/liquidity' },
	{
		name: 'liquidity-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=missing-pair#/liquidity',
		assertExpression: `document.body.textContent?.includes('LP tokens represent only YES and NO reserves') === true`,
	},
	{
		name: 'liquidity-fractional-price',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=missing-pair&qa=fractional#/liquidity',
		evaluate: `(() => { const input = document.querySelector('.field input:not([readonly])'); if (!(input instanceof HTMLInputElement)) return false; input.value = '70.25'; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
		assertExpression: `document.querySelector('.probability')?.getAttribute('aria-label')?.includes('70.3 percent') === true`,
	},
	{
		name: 'liquidity-invalid-price-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=missing-pair&qa=invalid#/liquidity',
		evaluate: `(() => { const input = document.querySelector('.field input:not([readonly])'); if (!(input instanceof HTMLInputElement)) return false; input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
		assertExpression: `document.body.textContent?.includes('must be below 100%') === true`,
		scrollY: 420,
	},
	{ name: 'liquidity-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/liquidity', scrollY: 420 },
	{
		name: 'portfolio-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/portfolio',
		assertExpression: `(() => { const text = document.body.textContent ?? ''; const mainText = document.querySelector('main')?.textContent ?? ''; const checks = { oneSelectedUniversePool: document.querySelectorAll('[data-portfolio-pool]').length === 1, removedCopy: ${removedCopyAssertion}, selector: ${universeSelectorAssertion}, noRepeatedUniverse: !mainText.includes('Genesis universe') && !mainText.includes('Child universe'), noRepeatedScopeFooter: !text.includes('These balances and LP claims belong only'), noLiveRpc: !text.includes('live RPC'), noBalanceScope: !text.includes('Balance scope'), noValidResolutionSlogan: !text.includes('Trade valid-resolution outcomes'), noInvalidReserveSlogan: !text.includes('INVALID is insurance, not a traded reserve'), noDerivedFrom: !text.includes('Derived from') }; if (Object.values(checks).some(value => !value)) throw new Error(JSON.stringify(checks)); return true })()`,
	},
	{
		name: 'portfolio-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/portfolio',
		assertExpression: `document.querySelectorAll('[data-portfolio-pool]').length === 1 && !document.body.textContent?.includes('Balance scope') && document.querySelector('.universe-selector select')?.getBoundingClientRect().height === 44 && [...document.querySelectorAll('.security-pool-link')].every(control => control.getBoundingClientRect().height >= 44) && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{
		name: 'portfolio-child-universe-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/portfolio',
		evaluate: `(() => { const select = document.querySelector('.universe-selector select'); if (!(select instanceof HTMLSelectElement)) return false; select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`,
		assertExpression: `document.querySelector('.universe-selector select')?.value === '2' && document.querySelectorAll('[data-portfolio-pool]').length === 1 && document.querySelector('main')?.textContent?.includes('0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b') === true && document.querySelector('[data-wallet-asset="REP"] strong')?.textContent === '1,750' && document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
	},
	{
		name: 'portfolio-max-token-ids-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=max-token-ids#/portfolio',
		assertExpression: `(() => { const selector = document.querySelector('.universe-selector select'); const longOptions = selector instanceof HTMLSelectElement ? [...selector.options].filter(option => option.value.length > 18) : []; return document.body.textContent?.includes('${((1n << 256n) - 256n).toString()}') === false && document.querySelector('.security-pool-link') !== null && selector?.value === '${((1n << 248n) - 1n).toString()}' && selector?.selectedOptions[0]?.textContent?.startsWith('Universe ') === true && selector?.selectedOptions[0]?.textContent?.includes('…') === true && selector?.selectedOptions[0]?.getAttribute('aria-label') === 'Universe ${((1n << 248n) - 1n).toString()}' && longOptions.length === 2 && longOptions[0]?.textContent !== longOptions[1]?.textContent && document.querySelector('.universe-selector > span') === null && document.documentElement.scrollWidth <= document.documentElement.clientWidth })()`,
		scrollY: 240,
	},
	{ name: 'ended', width: 1440, height: 900, path: '/?demo=1&scenario=ended#/market', assertExpression: `document.body.textContent?.includes('Trading closed') === true && document.body.textContent?.includes('Waiting for input') !== true` },
	{ name: 'truth-auction', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/market' },
	{ name: 'truth-auction-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/liquidity' },
	{
		name: 'truth-auction-liquidity-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=truth-auction#/liquidity',
		scrollY: 420,
		postScrollAssertExpression: `(() => { const chrome = document.querySelector('.site-chrome'); const header = document.querySelector('.site-header'); if (!(chrome instanceof HTMLElement) || !(header instanceof HTMLElement)) return false; const chromeStyle = getComputedStyle(chrome); const headerStyle = getComputedStyle(header); return chromeStyle.position === 'relative' && chromeStyle.isolation === 'isolate' && headerStyle.backdropFilter === 'none' && headerStyle.backgroundColor === 'rgb(9, 13, 18)' })()`,
	},
	{ name: 'forked-mobile', width: 390, height: 844, path: '/?demo=1&scenario=forked#/market' },
	{ name: 'resolved-invalid', width: 1440, height: 900, path: '/?demo=1&scenario=resolved-invalid#/market' },
	{ name: 'preparing', width: 1440, height: 900, path: '/?demo=1&scenario=preparing#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('Preparing Enter YES') === true`, scrollY: 900 },
	{ name: 'preparing-mobile', width: 390, height: 844, path: '/?demo=1&scenario=preparing#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('Preparing Enter YES') === true`, scrollY: 900 },
	{ name: 'approval', width: 1440, height: 900, path: '/?demo=1&scenario=approval&mode=exit#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('approval is pending in the wallet') === true`, scrollY: 900 },
	{ name: 'approval-mobile', width: 390, height: 844, path: '/?demo=1&scenario=approval&mode=exit#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('approval is pending in the wallet') === true`, scrollY: 900 },
	{ name: 'submitting', width: 1440, height: 900, path: '/?demo=1&scenario=submitting#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('pending in the wallet') === true`, scrollY: 900 },
	{ name: 'submitting-mobile', width: 390, height: 844, path: '/?demo=1&scenario=submitting#/market', assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('pending in the wallet') === true`, scrollY: 900 },
	{
		name: 'pending',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=pending#/market',
		assertExpression: `(${transactionStateLayoutAssertion}) && document.querySelector('.transaction-message')?.textContent?.includes('pending confirmation') === true && document.querySelector('.transaction-hash code')?.textContent?.length === 66`,
		scrollY: 900,
	},
	{ name: 'pending-mobile', width: 390, height: 844, path: '/?demo=1&scenario=pending#/market', assertExpression: transactionStateLayoutAssertion, scrollY: 900 },
	{ name: 'success', width: 1440, height: 900, path: '/?demo=1&scenario=success#/market', assertExpression: `document.querySelector('.transaction-hash code')?.textContent?.length === 66 && document.documentElement.scrollWidth <= document.documentElement.clientWidth`, scrollY: 900 },
	{ name: 'success-mobile', width: 390, height: 844, path: '/?demo=1&scenario=success#/market', assertExpression: `document.querySelector('.transaction-hash code')?.textContent?.length === 66 && document.documentElement.scrollWidth <= document.documentElement.clientWidth`, scrollY: 900 },
	{ name: 'failure', width: 1440, height: 900, path: '/?demo=1&scenario=failure#/market', assertExpression: `document.querySelector('.transaction-hash code')?.textContent?.length === 66 && document.documentElement.scrollWidth <= document.documentElement.clientWidth`, scrollY: 900 },
	{ name: 'failure-mobile', width: 390, height: 844, path: '/?demo=1&scenario=failure#/market', assertExpression: `document.querySelector('.transaction-hash code')?.textContent?.length === 66 && document.documentElement.scrollWidth <= document.documentElement.clientWidth`, scrollY: 900 },
	{
		name: 'clicked-pending',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/market',
		clickSelector: '.primary-action',
		afterClickExpression: `location.hash = '#/help'`,
		clickWaitMs: 150,
		assertExpression: `location.hash === '#/market' && [...document.querySelectorAll('.trade-panel button, .trade-panel input')].every(control => control.disabled) && document.querySelector('.transaction-message')?.textContent?.includes('pending confirmation') === true`,
		scrollY: 900,
	},
	{
		name: 'clicked-exit-approval',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline&mode=exit#/market',
		clickSelector: '.primary-action',
		clickWaitMs: 150,
		assertExpression: `document.querySelector('.transaction-message')?.textContent?.includes('Insured YES exit approval is pending') === true && document.querySelector('.primary-action')?.getAttribute('aria-busy') === 'true' && [...document.querySelectorAll('.trade-panel button, .trade-panel input')].every(control => control.disabled)`,
		scrollY: 900,
	},
	{ name: 'clicked-confirmed', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market', clickSelector: '.primary-action', clickWaitMs: 1_500, scrollY: 900 },
	{
		name: 'route-scroll-reset',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/market',
		evaluate: `(() => { window.scrollTo(0, 1200); location.hash = '#/liquidity'; return true })()`,
		assertExpression: `window.scrollY === 0 && document.querySelector('h1')?.textContent === 'Liquidity' && document.body.textContent?.includes('SIMULATED DATA') === true`,
	},
] as const

try {
	for (const scenario of scenarios) {
		await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false })
		await command('Page.navigate', { url: `${baseUrl}${scenario.path}` })
		await Bun.sleep(600)
		if ('evaluate' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.evaluate, returnByValue: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Setup expression failed for ${scenario.name}`)
			await Bun.sleep(100)
		}
		if ('clickSelector' in scenario) {
			await command('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(scenario.clickSelector)})?.click()` })
			if ('afterClickExpression' in scenario) await command('Runtime.evaluate', { expression: scenario.afterClickExpression })
			await Bun.sleep(scenario.clickWaitMs)
		}
		if ('assertExpression' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.assertExpression, returnByValue: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Browser assertion failed for ${scenario.name}: ${JSON.stringify(evaluated)}`)
		}
		if ('scrollY' in scenario) {
			await command('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, ${scenario.scrollY})` })
			await Bun.sleep(300)
		}
		if ('postScrollAssertExpression' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.postScrollAssertExpression, returnByValue: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Post-scroll browser assertion failed for ${scenario.name}: ${JSON.stringify(evaluated)}`)
		}
		const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
		if (typeof result.data !== 'string') throw new Error(`Screenshot data missing for ${scenario.name}`)
		await fs.writeFile(`${outputDirectory}/${scenario.name}.png`, Buffer.from(result.data, 'base64'))
		console.log(`${scenario.name}: ${scenario.width}x${scenario.height} ${scenario.path}`)
	}
	console.log(`Runtime errors: ${runtimeErrors.length}`)
	for (const error of runtimeErrors) console.log(error)
	if (runtimeErrors.length > 0) throw new Error(`Browser QA observed ${runtimeErrors.length} runtime error${runtimeErrors.length === 1 ? '' : 's'}`)
} finally {
	socket.close()
	browser.kill()
	await fs.rm(userDataDirectory, { recursive: true, force: true })
}
