import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

export function assertInvariantCatalogLifecycleBoundaries(invariantsHtml: string): void {
	for (const id of ['capital-health', 'capital-exit', 'share-settlement', 'escalation', 'forks', 'auctions', 'auction-refunds', 'oracle', 'lifecycle']) {
		assert.ok(invariantsHtml.includes(`id="${id}"`), `Invariant catalog must retain native ${id} ownership`)
	}
}

/** The static index repeats each entry's identifier, title, type, and status; keep it identical to the entries. */
export function assertInvariantIndexMatchesEntries(invariantsHtml: string): void {
	const window = new Window()
	try {
		window.document.write(invariantsHtml)
		const entries = Array.from(window.document.querySelectorAll('details.invariant-entry')).map(entry => {
			const metadata = (label: string) =>
				Array.from(entry.querySelectorAll('dt'))
					.find(node => node.textContent.trim() === label)
					?.nextElementSibling?.textContent.trim() ?? ''
			return { id: entry.id, identifier: entry.querySelector('summary code')?.textContent.trim(), title: entry.querySelector('.invariant-title')?.textContent.trim(), type: metadata('Type'), status: metadata('Enforcement status') }
		})
		const rows = Array.from(window.document.querySelectorAll('#invariant-index tbody tr')).map(row => {
			const cells = Array.from(row.querySelectorAll('td'))
			return { id: cells[0]?.querySelector('a')?.getAttribute('href')?.slice(1), identifier: cells[0]?.textContent.trim(), title: cells[1]?.textContent.trim(), type: cells[2]?.textContent.trim(), status: cells[3]?.textContent.trim() }
		})
		assert.ok(entries.length > 0, 'Invariant catalog must contain entries')
		assert.deepEqual(rows, entries, 'Invariant index must match entry metadata in order')
	} finally {
		window.close()
	}
}

/** The coordinator data file repeats event declarations and enum values; keep them identical to the compiled ABI and the Solidity source. */
export function assertCoordinatorDataEventAndEnumDeclarations(coordinatorData: string, compiledContractArtifacts: unknown, priceCoordinatorTypes: string): void {
	const coordinatorIndex: unknown = JSON.parse(coordinatorData)
	assert.ok(isPlainRecord(coordinatorIndex))
	assert.ok(isPlainRecord(compiledContractArtifacts))
	const compiledContracts = compiledContractArtifacts['contracts']
	assert.ok(isPlainRecord(compiledContracts))
	const coordinatorSourceArtifact = compiledContracts['contracts/statoblast/OpenOraclePriceCoordinator.sol']
	assert.ok(isPlainRecord(coordinatorSourceArtifact))
	const coordinatorArtifact = coordinatorSourceArtifact['OpenOraclePriceCoordinator']
	assert.ok(isPlainRecord(coordinatorArtifact))
	const coordinatorAbi = coordinatorArtifact['abi']
	assert.ok(Array.isArray(coordinatorAbi))
	const compiledEventDeclarations: Record<string, string> = {}
	const compiledEventParameterNames: Record<string, string[]> = {}
	const compiledIndexedEventParameterNames: Record<string, string[]> = {}
	for (const entry of coordinatorAbi) {
		if (!isPlainRecord(entry) || entry['type'] !== 'event') continue
		const eventName = entry['name']
		const inputs = entry['inputs']
		assert.ok(typeof eventName === 'string' && Array.isArray(inputs))
		const parameterNames: string[] = []
		const indexedParameterNames: string[] = []
		const parameters = inputs.map((input: unknown) => {
			assert.ok(isPlainRecord(input))
			const parameterType = input['type']
			const parameterName = input['name']
			assert.ok(typeof parameterType === 'string' && typeof parameterName === 'string')
			parameterNames.push(parameterName)
			if (input['indexed'] === true) indexedParameterNames.push(parameterName)
			return `${parameterType}${input['indexed'] === true ? ' indexed' : ''} ${parameterName}`
		})
		compiledEventDeclarations[eventName] = `${eventName}(${parameters.join(', ')})`
		compiledEventParameterNames[eventName] = parameterNames
		compiledIndexedEventParameterNames[eventName] = indexedParameterNames
	}
	assert.deepEqual(coordinatorIndex['eventDeclarations'], compiledEventDeclarations, 'Coordinator data event declarations must exactly match the compiled ABI, including parameter names')
	const documentedEvents = coordinatorIndex['events']
	assert.ok(Array.isArray(documentedEvents))
	assert.deepEqual(documentedEvents.toSorted(), Object.keys(compiledEventDeclarations).toSorted(), 'Coordinator data event inventory must exactly match the compiled ABI')
	assert.equal(coordinatorIndex['checkpoint'], undefined, 'Shared price state belongs to the feed; no coordinator operation checkpoint exists')
	const sourceEnumValues: Record<string, Record<string, string>> = {}
	for (const enumMatch of priceCoordinatorTypes.matchAll(/enum (\w+) \{([^}]*)\}/g)) {
		const enumName = enumMatch[1]
		const enumBody = enumMatch[2]
		assert.ok(enumName !== undefined && enumBody !== undefined)
		const members = enumBody
			.split(',')
			.map(member => member.trim())
			.filter(member => member !== '')
		sourceEnumValues[enumName] = Object.fromEntries(members.map((member, index) => [String(index), member]))
	}
	assert.deepEqual(coordinatorIndex['enumValues'], sourceEnumValues, 'Coordinator data enum values must exactly match OpenOraclePriceCoordinatorTypes.sol')
}

/** The coordinator parameter table and the worked request cost state literal values; keep them equal to the deployment configuration and source constants. */
export async function assertCoordinatorParameterTableValues(openOracleReferenceHtml: string, _priceCoordinatorSource: string, priceCoordinatorTypes: string): Promise<void> {
	const deploymentConfiguration = await readFile('shared/statoblast/ts/initialReport/oracleInitialReport.ts', 'utf8')
	const readInteger = (source: string, pattern: RegExp, label: string): bigint => {
		const literal = source.match(pattern)?.[1]
		assert.ok(literal !== undefined, `Could not read ${label}`)
		return literal
			.replaceAll('_', '')
			.split('*')
			.reduce((product, factor) => product * BigInt(factor.trim().replace(/n$/, '')), 1n)
	}
	const configured = (name: string): bigint => readInteger(deploymentConfiguration, new RegExp(`export const ${name} = ([0-9_n* ]+)\\n`), name)
	const durationSeconds = (name: string): bigint => {
		const duration = priceCoordinatorTypes.match(new RegExp(`uint256 constant ${name} = (\\d+) (minutes|hours);`))
		assert.ok(duration?.[1] !== undefined && duration[2] !== undefined, `Could not read ${name}`)
		return BigInt(duration[1]) * (duration[2] === 'hours' ? 3600n : 60n)
	}
	const feed = await readFile('solidity/contracts/statoblast/SharedPoolPriceFeed.sol', 'utf8')
	const callbackGasLimit = readInteger(feed, /FEED_SETTLEMENT_GAS_OVERHEAD = ([0-9_]+);/, 'FEED_SETTLEMENT_GAS_OVERHEAD')
	const bountyOffset = readInteger(priceCoordinatorTypes, /REQUEST_BOUNTY_OFFSET_ATTO_ETH = ([0-9_]+);/, 'REQUEST_BOUNTY_OFFSET_ATTO_ETH')
	assert.match(feed, /function getRequestPriceCostAttoEth\(\) public pure returns \(uint256\) \{\s*return REQUEST_BOUNTY_OFFSET_ATTO_ETH;/)
	const grouped = (value: bigint): string => value.toLocaleString('en-US')
	const parametersSection = openOracleReferenceHtml.match(/<section id="parameters">[\s\S]*?<\/section>/)?.[0]
	assert.ok(parametersSection !== undefined, 'OpenOracle reference must keep its parameters section')
	const valueByParameter = new Map<string, string>()
	for (const row of parametersSection.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
		const [parameter, value] = [row[1], row[2]].map(cell =>
			(cell ?? '')
				.replaceAll(/<[^>]+>/g, '')
				.replaceAll(/\s+/g, ' ')
				.trim(),
		)
		if (parameter !== undefined && value !== undefined) valueByParameter.set(parameter, value)
	}
	const assertStartsWith = (parameter: string, expected: string): void => {
		const value = valueByParameter.get(parameter)
		assert.ok(value?.startsWith(expected), `OpenOracle parameter ${parameter} must state ${expected}, found ${value ?? 'no row'}`)
	}
	assertStartsWith('callbackGasLimit', `${grouped(callbackGasLimit)} gas`)
	assertStartsWith('maxSettlementBaseFeeMultiplierBps', `${grouped(configured('ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS'))} bps`)
	assertStartsWith('settlementTime', `${grouped(configured('ORACLE_SETTLEMENT_TIME'))} seconds`)
	assertStartsWith('disputeDelay', grouped(configured('ORACLE_DISPUTE_DELAY')))
	assertStartsWith('multiplier', grouped(configured('ORACLE_MULTIPLIER')))
	assert.equal(durationSeconds('PRICE_VALID_FOR_SECONDS'), 300n, 'The page states a five-minute price freshness window')
	assert.equal(durationSeconds('SEPOLIA_PRICE_VALID_FOR_SECONDS'), 3600n, 'The page states a one-hour Sepolia price freshness window')
	assertStartsWith('getRequestPriceCostAttoEth()', `${bountyOffset} attoETH`)
}
