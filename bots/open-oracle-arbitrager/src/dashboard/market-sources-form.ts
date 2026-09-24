import { isRecord, parseDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import { element } from './dom.js'
import { refreshFormButton } from '@zoltar/bot-shared/dashboard/form-state'

type MarketSourceRow = { ethMarket: string | null; exchangeId: string; repMarket: string }

type MarketThresholdField = 'depthBps' | 'maximumDexDeviationBps' | 'maximumObservationAgeMilliseconds' | 'maximumVenueDispersionBps' | 'minimumAskDepthEth' | 'minimumBidDepthEth' | 'minimumSourceCount' | 'orderBookLimit' | 'requestTimeoutMilliseconds'

const NUMBER_FIELDS: readonly MarketThresholdField[] = ['depthBps', 'maximumDexDeviationBps', 'maximumObservationAgeMilliseconds', 'maximumVenueDispersionBps', 'minimumSourceCount', 'orderBookLimit', 'requestTimeoutMilliseconds']
const DECIMAL_FIELDS: readonly MarketThresholdField[] = ['minimumAskDepthEth', 'minimumBidDepthEth']

const VENUE_NUMBER_FIELDS = ['maximumGroupDeviationBps', 'minimumDexSourceCount', 'minimumSourceObservationCount', 'minimumSourceObservationSpanMilliseconds', 'minimumTotalSourceCount'] as const
const VENUE_DECIMAL_FIELDS = ['dexProbeDepthEth', 'minimumDexAskDepthEth', 'minimumDexBidDepthEth'] as const
const VENUE_DEFAULTS: Record<string, string> = { dexProbeDepthEth: '1', maximumGroupDeviationBps: '500', minimumDexAskDepthEth: '0.5', minimumDexBidDepthEth: '0.5', minimumDexSourceCount: '2', minimumSourceObservationCount: '2', minimumSourceObservationSpanMilliseconds: '10000', minimumTotalSourceCount: '3' }

let assetSymbol = 'REP'

function thresholdInput(name: MarketThresholdField) {
	const found = element('market-form', HTMLFormElement).querySelector(`[name="${name}"]`)
	if (!(found instanceof HTMLInputElement)) throw new Error(`Missing market threshold input: ${name}`)
	return found
}

function cell(name: string, value: string, placeholder: string, label: string) {
	const container = document.createElement('td')
	container.dataset['label'] = label
	const input = document.createElement('input')
	input.type = 'text'
	input.name = name
	input.value = value
	input.placeholder = placeholder
	input.spellcheck = false
	input.setAttribute('aria-label', placeholder)
	container.append(input)
	return container
}

function sourceRow(source: MarketSourceRow) {
	const row = document.createElement('tr')
	row.className = 'market-source-row'
	const remove = document.createElement('button')
	remove.type = 'button'
	remove.className = 'button button-secondary button-compact'
	remove.textContent = 'Remove'
	const nameRemove = (exchangeId: string) => remove.setAttribute('aria-label', `Remove ${exchangeId.trim() || 'source'}`)
	nameRemove(source.exchangeId)
	remove.addEventListener('click', () => {
		row.remove()
		syncEmptyState()
		refreshFormButton('market-form')
	})
	const actions = document.createElement('td')
	actions.append(remove)
	const exchange = cell('sourceExchangeId', source.exchangeId, 'exchange id', 'Exchange · CCXT id')
	exchange.addEventListener('input', event => {
		if (event.target instanceof HTMLInputElement) nameRemove(event.target.value)
	})
	row.append(exchange, cell('sourceRepMarket', source.repMarket, `${assetSymbol}/QUOTE`, `${assetSymbol} market`), cell('sourceEthMarket', source.ethMarket ?? '', 'ETH/QUOTE', 'ETH market · blank when quoted in ETH'), actions)
	return row
}

function rows() {
	return Array.from(element('market-source-rows', HTMLTableSectionElement).querySelectorAll('tr.market-source-row'))
}

function syncEmptyState() {
	element('market-sources-empty').hidden = rows().length !== 0
}

function rowValue(row: Element, name: string) {
	const input = row.querySelector(`[name="${name}"]`)
	return input instanceof HTMLInputElement ? input.value.trim() : ''
}

function readString(record: Record<string, unknown>, key: string) {
	const value = record[key]
	return typeof value === 'string' ? value : ''
}

function readNumber(record: Record<string, unknown>, key: string) {
	const value = record[key]
	if (typeof value === 'number') return value.toString()
	return typeof value === 'string' ? value : ''
}

function marketDepth(value: string, label: string) {
	parseDecimalAmount(value, label)
	return value
}

function readSources(value: unknown): MarketSourceRow[] {
	if (!Array.isArray(value)) return []
	return value.map(source => {
		const record: Record<string, unknown> = isRecord(source) ? source : {}
		const ethMarket = record['ethMarket']
		return { ethMarket: typeof ethMarket === 'string' ? ethMarket : null, exchangeId: readString(record, 'exchangeId'), repMarket: readString(record, 'repMarket') }
	})
}

function venueInput(name: string) {
	const input = element('market-form', HTMLFormElement).querySelector(`[name="venue-${name}"]`)
	if (!(input instanceof HTMLInputElement)) throw new Error(`Missing venue consensus field ${name}`)
	return input
}

function dexRows() {
	return Array.from(element('venue-dex-source-rows', HTMLTableSectionElement).querySelectorAll('tr'))
}

function dexRow(source: { sourceId: string; pair: string; feeBps: string }) {
	const row = document.createElement('tr')
	for (const [name, value] of Object.entries(source)) {
		const td = document.createElement('td')
		const input = document.createElement('input')
		input.name = name
		input.value = value
		input.required = true
		let label = 'DEX fee in basis points'
		if (name === 'sourceId') label = 'DEX source ID'
		else if (name === 'pair') label = 'DEX pair address'
		input.setAttribute('aria-label', label)
		if (name === 'feeBps') {
			input.type = 'number'
			input.min = '0'
			input.max = '1000'
			input.step = '1'
		}
		if (name === 'pair') input.pattern = '0x[0-9a-fA-F]{40}'
		td.append(input)
		row.append(td)
	}
	const action = document.createElement('td')
	const remove = document.createElement('button')
	remove.type = 'button'
	remove.className = 'button button-secondary button-compact'
	remove.textContent = 'Remove'
	remove.addEventListener('click', () => {
		row.remove()
		refreshFormButton('market-form')
	})
	action.append(remove)
	row.append(action)
	return row
}

function syncVenueEnabled() {
	const enabled = element('venue-consensus-enabled', HTMLInputElement).checked
	for (const input of element('market-form', HTMLFormElement).querySelectorAll<HTMLInputElement>('[name^="venue-"], #venue-allow-single-group-fallback, #venue-dex-source-rows input')) input.disabled = !enabled
	element('venue-dex-source-add', HTMLButtonElement).disabled = !enabled
}

/** Fills the source table, thresholds, and advanced venue-consensus editor from the stored `centralizedMarkets` document. */
export function loadMarketSources(document_: Record<string, unknown>) {
	assetSymbol = readString(document_, 'assetSymbol') || 'REP'
	element('market-source-rows', HTMLTableSectionElement).replaceChildren(...readSources(document_['sources']).map(sourceRow))
	syncEmptyState()
	element('market-required', HTMLInputElement).checked = document_['requiredForExecution'] === true
	for (const name of NUMBER_FIELDS) thresholdInput(name).value = readNumber(document_, name)
	for (const name of DECIMAL_FIELDS) thresholdInput(name).value = readString(document_, name)
	const venueConsensus = isRecord(document_['venueConsensus']) ? document_['venueConsensus'] : undefined
	element('venue-consensus-enabled', HTMLInputElement).checked = venueConsensus !== undefined
	element('venue-allow-single-group-fallback', HTMLInputElement).checked = venueConsensus?.['allowSingleGroupFallback'] === true
	for (const name of [...VENUE_NUMBER_FIELDS, ...VENUE_DECIMAL_FIELDS]) venueInput(name).value = String(venueConsensus?.[name] ?? VENUE_DEFAULTS[name] ?? '')
	const dexSources = Array.isArray(venueConsensus?.['dexSources']) ? venueConsensus['dexSources'] : []
	element('venue-dex-source-rows', HTMLTableSectionElement).replaceChildren(
		...dexSources.map(value => {
			const source = isRecord(value) ? value : {}
			return dexRow({ sourceId: readString(source, 'sourceId'), pair: readString(source, 'pair'), feeBps: readNumber(source, 'feeBps') })
		}),
	)
	syncVenueEnabled()
}

/** Rebuilds the stored document from the form; the bot validates it and binds the asset identity to the selected chain. */
export function marketSourcesDocument(): Record<string, unknown> {
	const sources = rows().map(row => {
		const ethMarket = rowValue(row, 'sourceEthMarket')
		return { ethMarket: ethMarket === '' ? null : ethMarket, exchangeId: rowValue(row, 'sourceExchangeId'), repMarket: rowValue(row, 'sourceRepMarket') }
	})
	const venueConsensus = element('venue-consensus-enabled', HTMLInputElement).checked
		? {
				allowSingleGroupFallback: element('venue-allow-single-group-fallback', HTMLInputElement).checked,
				dexSources: dexRows().map(row => {
					const read = (name: string) => {
						const field = row.querySelector(`[name="${name}"]`)
						return field instanceof HTMLInputElement ? field.value.trim() : ''
					}
					return { sourceId: read('sourceId'), pair: read('pair'), feeBps: Number(read('feeBps')) }
				}),
				...Object.fromEntries(VENUE_NUMBER_FIELDS.map(name => [name, Number(venueInput(name).value)])),
				...Object.fromEntries(VENUE_DECIMAL_FIELDS.map(name => [name, marketDepth(venueInput(name).value.trim(), `centralizedMarkets.venueConsensus.${name}`)])),
			}
		: undefined
	const document_: Record<string, unknown> = {
		assetSymbol,
		requiredForExecution: element('market-required', HTMLInputElement).checked,
		sources,
	}
	for (const name of NUMBER_FIELDS) document_[name] = Number(thresholdInput(name).value)
	for (const name of DECIMAL_FIELDS) document_[name] = marketDepth(thresholdInput(name).value.trim(), `centralizedMarkets.${name}`)
	if (venueConsensus !== undefined) document_['venueConsensus'] = venueConsensus
	return document_
}

export function registerMarketSourceControls() {
	element('venue-consensus-enabled', HTMLInputElement).addEventListener('change', syncVenueEnabled)
	element('venue-dex-source-add', HTMLButtonElement).addEventListener('click', () => {
		const row = dexRow({ sourceId: '', pair: '', feeBps: '30' })
		element('venue-dex-source-rows', HTMLTableSectionElement).append(row)
		refreshFormButton('market-form')
		row.querySelector('input')?.focus()
	})
	element('market-source-add', HTMLButtonElement).addEventListener('click', () => {
		const row = sourceRow({ ethMarket: null, exchangeId: '', repMarket: '' })
		element('market-source-rows', HTMLTableSectionElement).append(row)
		syncEmptyState()
		refreshFormButton('market-form')
		const first = row.querySelector('input')
		if (first instanceof HTMLInputElement) first.focus()
	})
}
