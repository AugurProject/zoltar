const metrics = [
	['centralized-market-price', 'CEX median REP / ETH'],
	['dex-market-price', 'DEX consensus REP / ETH'],
	['guarded-market-price', 'Guarded reference REP / ETH'],
	['dex-market-bid-depth', 'DEX bid depth'],
	['dex-market-ask-depth', 'DEX ask depth'],
	['centralized-market-bid-depth', 'CEX bid depth'],
	['centralized-market-ask-depth', 'CEX ask depth'],
	['centralized-market-source-count', 'Consensus sources'],
] as const
const columns = ['Exchange', 'Market', 'REP / ETH', 'Bid depth', 'Ask depth', 'Observed'] as const

/** Static template, shared by server rendering and DOM tests. No market policy lives here. */
export function repMarketConsensusPanel() {
	return `<div class="rep-market-consensus" aria-busy="true">
 <p id="centralized-market-status" class="muted" role="status" aria-live="polite">Loading market consensus…</p>
 <div id="centralized-market-summary" class="metric-grid">${metrics.map(([id, label]) => `<dl class="metric"><dt>${label}</dt><dd id="${id}">—</dd></dl>`).join('')}</div>
 <div class="table-shell table-scroll mobile-record-scroll" tabindex="0" aria-label="Centralized market observations"><table class="mobile-record-table"><caption>CEX observations</caption><thead><tr>${columns.map((label, index) => `<th id="market-heading-${index}" scope="col">${label}</th>`).join('')}</tr></thead><tbody id="centralized-market-rows"><tr><td colspan="6" class="empty">Loading observations…</td></tr></tbody></table></div></div>`
}

type Observation = { exchange: string; market: string; price: string; bidDepth: string; askDepth: string; observed: string }
type ConsensusValues = { cexPrice: string; dexPrice: string; guardedPrice: string; dexBidDepth: string; dexAskDepth: string; cexBidDepth: string; cexAskDepth: string; sources: string }

export function renderRepMarketConsensusPanel(root: ParentNode, model: { values: ConsensusValues; observations: readonly Observation[]; status: string; emptyText: string; state?: 'ready' | 'loading' | 'error' }) {
	const panel = root.querySelector('.rep-market-consensus')
	if (panel === null) throw new Error('Missing REP market consensus panel')
	panel.setAttribute('aria-busy', String(model.state === 'loading'))
	if (model.state === undefined || model.state === 'ready') panel.setAttribute('data-loaded', 'true')
	const status = panel.querySelector('#centralized-market-status')
	const body = panel.querySelector('#centralized-market-rows')
	if (status === null || body === null) throw new Error('Incomplete REP market consensus panel')
	if (status.textContent !== model.status) status.textContent = model.status
	status.setAttribute('role', model.state === 'error' ? 'alert' : 'status')
	status.setAttribute('aria-live', model.state === 'error' ? 'assertive' : 'polite')
	const values = [model.values.cexPrice, model.values.dexPrice, model.values.guardedPrice, model.values.dexBidDepth, model.values.dexAskDepth, model.values.cexBidDepth, model.values.cexAskDepth, model.values.sources]
	for (const [index, [id]] of metrics.entries()) {
		const value = panel.querySelector(`#${id}`)
		if (value !== null) value.textContent = values[index] ?? '—'
	}
	const rows = model.observations.map(observation => {
		const row = document.createElement('tr')
		for (const [index, value] of [observation.exchange, observation.market, observation.price, observation.bidDepth, observation.askDepth, observation.observed].entries()) {
			const cell = document.createElement('td')
			cell.textContent = value
			cell.dataset['label'] = columns[index]
			cell.headers = `market-heading-${index}`
			row.append(cell)
		}
		return row
	})
	if (rows.length === 0) {
		const row = document.createElement('tr')
		const cell = document.createElement('td')
		cell.colSpan = columns.length
		cell.className = 'empty'
		cell.textContent = model.emptyText
		if (model.state === 'loading') cell.textContent = 'Loading observations…'
		if (model.state === 'error') cell.textContent = model.status
		row.append(cell)
		rows.push(row)
	}
	body.replaceChildren(...rows)
}

/** Preserve last observations on failed refreshes, but replace the initial loading row. */
export function renderRepMarketConsensusError(root: ParentNode) {
	const panel = root.querySelector('.rep-market-consensus')
	const status = panel?.querySelector('#centralized-market-status')
	if (panel === null || status === null || status === undefined) return
	const loading = panel.getAttribute('data-loaded') !== 'true'
	const message = loading ? 'Market consensus unavailable. Reconnecting…' : 'Market consensus refresh failed. Showing last observations.'
	panel.setAttribute('aria-busy', 'false')
	if (status.textContent !== message) status.textContent = message
	status.setAttribute('role', 'alert')
	status.setAttribute('aria-live', 'assertive')
	if (loading) {
		const cell = panel.querySelector('td.empty')
		if (cell !== null) cell.textContent = message
	}
}
