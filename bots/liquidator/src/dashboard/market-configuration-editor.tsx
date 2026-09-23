import { render } from 'preact'
import { useState } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { nonnegativeAtomicValue } from '@zoltar/bot-shared/dashboard/amount'
import { isRecord } from '@zoltar/bot-shared/infrastructure/json-validation'

type Market = Record<string, unknown>
type Draft = { root: Market; children: Market[]; desiredPools: Market[] }

const numberFields = [
	['depthBps', 'Depth band (bps)', 1, 5000],
	['maximumDexDeviationBps', 'Maximum DEX deviation (bps)', 1, 10000],
	['maximumObservationAgeMilliseconds', 'Maximum observation age (ms)', 1000, 3600000],
	['maximumVenueDispersionBps', 'Maximum venue dispersion (bps)', 1, 10000],
	['minimumSourceCount', 'Minimum sources', 1, 100],
	['orderBookLimit', 'Order book levels', 1, 1000],
	['requestTimeoutMilliseconds', 'Request timeout (ms)', 250, 60000],
] as const

const decimalFields = [
	['minimumAskDepthEth', 'Minimum ask depth (ETH)'],
	['minimumBidDepthEth', 'Minimum bid depth (ETH)'],
] as const

const venueNumberFields = [
	['maximumGroupDeviationBps', 'Maximum group deviation (bps)', 1, 10000],
	['minimumDexSourceCount', 'Minimum DEX sources', 1, 100],
	['minimumSourceObservationCount', 'Observations per source', 1, 100],
	['minimumSourceObservationSpanMilliseconds', 'Observation span (ms)', 0, 3600000],
	['minimumTotalSourceCount', 'Minimum total sources', 2, 200],
] as const

const venueDecimalFields = [
	['dexProbeDepthEth', 'DEX probe depth (ETH)'],
	['minimumDexAskDepthEth', 'Minimum DEX ask depth (ETH)'],
	['minimumDexBidDepthEth', 'Minimum DEX bid depth (ETH)'],
] as const

const defaultVenue = {
	allowSingleGroupFallback: false,
	dexProbeDepthEth: '1',
	dexSources: [],
	maximumGroupDeviationBps: 500,
	minimumDexAskDepthEth: '0.5',
	minimumDexBidDepthEth: '0.5',
	minimumDexSourceCount: 2,
	minimumSourceObservationCount: 2,
	minimumSourceObservationSpanMilliseconds: 10000,
	minimumTotalSourceCount: 3,
}

function record(value: unknown): Market {
	return isRecord(value) ? value : {}
}

function records(value: unknown): Market[] {
	return Array.isArray(value) ? value.map(record) : []
}

function inputValue(value: unknown) {
	return value === undefined || value === null ? '' : String(value)
}

function textField(label: string, value: unknown, onInput: (value: string) => void, options: { inputMode?: 'decimal' | 'numeric'; pattern?: string; required?: boolean } = {}) {
	return (
		<label>
			<span>{label}</span>
			<input value={inputValue(value)} inputMode={options.inputMode} pattern={options.pattern} required={options.required ?? true} onInput={event => onInput(event.currentTarget.value)} />
		</label>
	)
}

function numericField(label: string, value: unknown, onInput: (value: string) => void, min: number, max: number) {
	return (
		<label>
			<span>{label}</span>
			<input type='number' value={inputValue(value)} min={min} max={max} step='1' required onInput={event => onInput(event.currentTarget.value)} />
		</label>
	)
}

function listEditor(title: string, fields: readonly string[], values: Market[], onChange: (values: Market[]) => void, blank: Market) {
	const labels: Record<string, string> = { exchangeId: 'Exchange ID', repMarket: 'REP market', ethMarket: 'ETH market', sourceId: 'Source ID', pair: 'Pair address', feeBps: 'Fee (bps)' }
	return (
		<div className='market-editor-list'>
			<div className='panel-heading'>
				<h4>{title}</h4>
				<button type='button' className='secondary' onClick={() => onChange([...values, { ...blank }])}>
					Add
				</button>
			</div>
			{values.map((item, index) => (
				<div className='market-editor-row' key={index}>
					{fields.map(field => textField(labels[field] ?? field, item[field], value => onChange(values.map((current, at) => (at === index ? { ...current, [field]: value } : current)))))}
					<button type='button' className='secondary' onClick={() => onChange(values.filter((_, at) => at !== index))}>
						Remove
					</button>
				</div>
			))}
		</div>
	)
}

function marketEditor(market: Market, onChange: (next: Market) => void, child: boolean) {
	const set = (name: string, value: unknown) => onChange({ ...market, [name]: value })
	const venue = market['venueConsensus'] === undefined ? undefined : record(market['venueConsensus'])
	const setVenue = (name: string, value: unknown) => set('venueConsensus', { ...venue, [name]: value })
	return (
		<div className='market-editor-card'>
			<div className='field-grid'>
				{child ? textField('REP asset address', market['assetAddress'], value => set('assetAddress', value), { pattern: '0x[0-9a-fA-F]{40}' }) : undefined}
				{child ? numericField('Asset chain ID', market['assetChainId'], value => set('assetChainId', value), 1, 999999999) : undefined}
				{textField('Asset symbol', market['assetSymbol'], value => set('assetSymbol', value))}
				{numberFields.map(([key, label, min, max]) => numericField(label, market[key], value => set(key, value), min, max))}
				{decimalFields.map(([key, label]) => textField(label, market[key], value => set(key, value), { inputMode: 'decimal' }))}
			</div>
			<label className='switch-field'>
				<input type='checkbox' checked={market['requiredForExecution'] === true} onChange={event => set('requiredForExecution', event.currentTarget.checked)} />
				<span>Require reliable consensus for execution</span>
			</label>
			{listEditor('Centralized sources', ['exchangeId', 'repMarket', 'ethMarket'], records(market['sources']), values => set('sources', values), { exchangeId: '', repMarket: '', ethMarket: '' })}
			<label className='switch-field'>
				<input type='checkbox' checked={venue !== undefined} onChange={event => set('venueConsensus', event.currentTarget.checked ? { ...defaultVenue } : undefined)} />
				<span>Use DEX venue consensus</span>
			</label>
			{venue === undefined ? undefined : (
				<div className='market-venue-fields'>
					<div className='field-grid'>
						{venueNumberFields.map(([key, label, min, max]) => numericField(label, venue[key], value => setVenue(key, value), min, max))}
						{venueDecimalFields.map(([key, label]) => textField(label, venue[key], value => setVenue(key, value), { inputMode: 'decimal' }))}
					</div>
					<label className='switch-field'>
						<input type='checkbox' checked={venue['allowSingleGroupFallback'] === true} onChange={event => setVenue('allowSingleGroupFallback', event.currentTarget.checked)} />
						<span>Allow one venue group as fallback</span>
					</label>
					{listEditor('DEX sources', ['sourceId', 'pair', 'feeBps'], records(venue['dexSources']), values => setVenue('dexSources', values), { sourceId: '', pair: '', feeBps: '30' })}
				</div>
			)}
		</div>
	)
}

function integer(value: unknown, label: string, min: number, max: number) {
	const text = String(value)
	if (!/^(?:0|[1-9]\d*)$/.test(text)) throw new Error(`${label} must be a whole number.`)
	const parsed = Number(text)
	if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label} must be between ${min.toString()} and ${max.toString()}.`)
	return parsed
}

function uintString(value: unknown, label: string, minimum = 0n) {
	const text = String(value)
	if (!/^(?:0|[1-9]\d*)$/.test(text) || BigInt(text) < minimum || BigInt(text) >= 2n ** 256n) throw new Error(`${label} must be a whole number from ${minimum.toString()} to the uint256 limit.`)
	return text
}

function marketDocument(market: Market, child: boolean) {
	const result: Market = { assetSymbol: String(market['assetSymbol'] ?? ''), requiredForExecution: market['requiredForExecution'] === true }
	if (child) {
		const address = String(market['assetAddress'] ?? '')
		if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Child REP asset must be an address.')
		result['assetAddress'] = address
		result['assetChainId'] = integer(market['assetChainId'], 'Asset chain ID', 1, 999999999)
	}
	for (const [key, label, min, max] of numberFields) result[key] = integer(market[key], label, min, max)
	for (const [key, label] of decimalFields) {
		const value = String(market[key] ?? '')
		nonnegativeAtomicValue(value, label)
		result[key] = value
	}
	result['sources'] = records(market['sources']).map(source => {
		const exchangeId = String(source['exchangeId'] ?? '')
		const repMarket = String(source['repMarket'] ?? '')
		const ethMarket = String(source['ethMarket'] ?? '')
		if (!/^[a-z0-9]+$/.test(exchangeId) || !/^[A-Z0-9][A-Z0-9._-]*\/[A-Z0-9][A-Z0-9._-]*$/.test(repMarket) || (ethMarket !== '' && !/^[A-Z0-9][A-Z0-9._-]*\/[A-Z0-9][A-Z0-9._-]*$/.test(ethMarket))) throw new Error('Centralized sources need a lowercase CCXT ID and BASE/QUOTE market symbols.')
		return { exchangeId, repMarket, ethMarket: ethMarket === '' ? null : ethMarket }
	})
	if (market['venueConsensus'] !== undefined) {
		const venue = record(market['venueConsensus'])
		const next: Market = { allowSingleGroupFallback: venue['allowSingleGroupFallback'] === true }
		for (const [key, label, min, max] of venueNumberFields) next[key] = integer(venue[key], label, min, max)
		for (const [key, label] of venueDecimalFields) {
			const value = String(venue[key] ?? '')
			nonnegativeAtomicValue(value, label)
			next[key] = value
		}
		next['dexSources'] = records(venue['dexSources']).map(source => {
			const sourceId = String(source['sourceId'] ?? '')
			const pair = String(source['pair'] ?? '')
			if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId) || !/^0x[0-9a-fA-F]{40}$/.test(pair)) throw new Error('DEX sources need a source ID and pair address.')
			return { sourceId, pair, feeBps: integer(source['feeBps'], 'DEX fee (bps)', 0, 1000) }
		})
		result['venueConsensus'] = next
	}
	return result
}

let currentDraft: Draft | undefined

export function readMarketConfiguration() {
	if (currentDraft === undefined) throw new Error('Market configuration is still loading.')
	return {
		root: marketDocument(currentDraft.root, false),
		children: currentDraft.children.map(child => marketDocument(child, true)),
		desiredPools: currentDraft.desiredPools.map(pool => ({
			universeId: uintString(pool['universeId'], 'Universe ID'),
			questionId: uintString(pool['questionId'], 'Question ID'),
			statoblastSecurityMultiplierBps: uintString(pool['statoblastSecurityMultiplierBps'], 'Security multiplier (bps)', 10001n),
			initialReportPriorityFeeAttoEthPerGas: uintString(pool['initialReportPriorityFeeAttoEthPerGas'], 'Initial report priority fee (attoETH/gas)'),
		})),
	}
}

export function reviewableRootMarket(value: unknown) {
	const root = { ...record(value) }
	delete root['assetAddress']
	delete root['assetChainId']
	return root
}

export function renderMarketConfiguration(target: HTMLElement, configuration: { centralizedMarkets: unknown; childMarketConfigurations: unknown[]; desiredPools: unknown[]; network?: { chainId: number } | undefined }) {
	const initial: Draft = { root: record(configuration.centralizedMarkets), children: records(configuration.childMarketConfigurations), desiredPools: records(configuration.desiredPools) }
	currentDraft = initial
	function Editor() {
		const [draft, setDraft] = useState(initial)
		const update = (next: Draft) => {
			currentDraft = next
			setDraft(next)
		}
		return (
			<div className='market-configuration-editor'>
				<section>
					<h3>
						Root REP market <Badge tone='muted'>Root</Badge>
					</h3>
					{marketEditor(draft.root, root => update({ ...draft, root }), false)}
				</section>
				<section>
					<div className='panel-heading'>
						<h3>Child REP markets</h3>
						<button type='button' className='secondary' onClick={() => update({ ...draft, children: [...draft.children, { ...draft.root, assetAddress: '', assetChainId: configuration.network?.chainId ?? 1, assetSymbol: 'REP', sources: [] }] })}>
							Add child market
						</button>
					</div>
					{draft.children.map((child, index) => (
						<article key={index}>
							<div className='panel-heading'>
								<h4>Child market {index + 1}</h4>
								<button type='button' className='secondary' onClick={() => update({ ...draft, children: draft.children.filter((_, at) => at !== index) })}>
									Remove
								</button>
							</div>
							{marketEditor(child, next => update({ ...draft, children: draft.children.map((old, at) => (at === index ? next : old)) }), true)}
						</article>
					))}
				</section>
				<section>
					<div className='panel-heading'>
						<h3>Desired security pools</h3>
						<button type='button' className='secondary' onClick={() => update({ ...draft, desiredPools: [...draft.desiredPools, { universeId: '', questionId: '', statoblastSecurityMultiplierBps: '12500', initialReportPriorityFeeAttoEthPerGas: String(0n) }] })}>
							Add pool
						</button>
					</div>
					{draft.desiredPools.map((pool, index) => (
						<div className='market-editor-row' key={index}>
							{(['universeId', 'questionId', 'statoblastSecurityMultiplierBps', 'initialReportPriorityFeeAttoEthPerGas'] as const).map(key =>
								textField(key.replace(/([A-Z])/g, ' $1'), pool[key], value => update({ ...draft, desiredPools: draft.desiredPools.map((old, at) => (at === index ? { ...old, [key]: value } : old)) }), { inputMode: 'numeric' }),
							)}
							<button type='button' className='secondary' onClick={() => update({ ...draft, desiredPools: draft.desiredPools.filter((_, at) => at !== index) })}>
								Remove
							</button>
						</div>
					))}
				</section>
			</div>
		)
	}
	render(<Editor />, target)
}
