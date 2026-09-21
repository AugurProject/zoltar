import { isRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { element } from './dom.js'
import { refreshFormButton } from '@zoltar/bot-shared/dashboard/form-state'

type MarketSourceRow = { ethMarket: string | null; exchangeId: string; repMarket: string }

type MarketThresholdField = 'depthBps' | 'maximumDexDeviationBps' | 'maximumObservationAgeMilliseconds' | 'maximumVenueDispersionBps' | 'minimumAskDepthEth' | 'minimumBidDepthEth' | 'minimumSourceCount' | 'orderBookLimit' | 'requestTimeoutMilliseconds'

const NUMBER_FIELDS: readonly MarketThresholdField[] = ['depthBps', 'maximumDexDeviationBps', 'maximumObservationAgeMilliseconds', 'maximumVenueDispersionBps', 'minimumSourceCount', 'orderBookLimit', 'requestTimeoutMilliseconds']
const DECIMAL_FIELDS: readonly MarketThresholdField[] = ['minimumAskDepthEth', 'minimumBidDepthEth']

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

function readSources(value: unknown): MarketSourceRow[] {
	if (!Array.isArray(value)) return []
	return value.map(source => {
		const record: Record<string, unknown> = isRecord(source) ? source : {}
		const ethMarket = record['ethMarket']
		return { ethMarket: typeof ethMarket === 'string' ? ethMarket : null, exchangeId: readString(record, 'exchangeId'), repMarket: readString(record, 'repMarket') }
	})
}

/** Fills the source table, thresholds, and advanced venue-consensus editor from the stored `centralizedMarkets` document. */
export function loadMarketSources(document_: Record<string, unknown>) {
	assetSymbol = readString(document_, 'assetSymbol') || 'REP'
	element('market-source-rows', HTMLTableSectionElement).replaceChildren(...readSources(document_['sources']).map(sourceRow))
	syncEmptyState()
	element('market-required', HTMLInputElement).checked = document_['requiredForExecution'] === true
	for (const name of NUMBER_FIELDS) thresholdInput(name).value = readNumber(document_, name)
	for (const name of DECIMAL_FIELDS) thresholdInput(name).value = readString(document_, name)
	const venueConsensus = document_['venueConsensus']
	element('market-venue-consensus-json', HTMLTextAreaElement).value = venueConsensus === undefined ? '' : JSON.stringify(venueConsensus, undefined, 2)
}

/** Rebuilds the stored document from the form; the bot validates it and binds the asset identity to the selected chain. */
export function marketSourcesDocument(): Record<string, unknown> {
	const sources = rows().map(row => {
		const ethMarket = rowValue(row, 'sourceEthMarket')
		return { ethMarket: ethMarket === '' ? null : ethMarket, exchangeId: rowValue(row, 'sourceExchangeId'), repMarket: rowValue(row, 'sourceRepMarket') }
	})
	const venueText = element('market-venue-consensus-json', HTMLTextAreaElement).value.trim()
	const venueConsensus: unknown = venueText === '' ? undefined : JSON.parse(venueText)
	const document_: Record<string, unknown> = {
		assetSymbol,
		requiredForExecution: element('market-required', HTMLInputElement).checked,
		sources,
	}
	for (const name of NUMBER_FIELDS) document_[name] = Number(thresholdInput(name).value)
	for (const name of DECIMAL_FIELDS) document_[name] = thresholdInput(name).value.trim()
	if (venueConsensus !== undefined) document_['venueConsensus'] = venueConsensus
	return document_
}

export function registerMarketSourceControls() {
	element('market-source-add', HTMLButtonElement).addEventListener('click', () => {
		const row = sourceRow({ ethMarket: null, exchangeId: '', repMarket: '' })
		element('market-source-rows', HTMLTableSectionElement).append(row)
		syncEmptyState()
		refreshFormButton('market-form')
		const first = row.querySelector('input')
		if (first instanceof HTMLInputElement) first.focus()
	})
}
