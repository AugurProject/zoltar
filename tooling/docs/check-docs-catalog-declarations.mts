import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositorySourceUrl } from './repository-source-links.mts'

export function assertInvariantCatalogLifecycleBoundaries(invariantsHtml: string): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const capacityOwnershipEntry = normalizedInvariants.match(/<details class="invariant-entry" id="bal-08"\s*>[\s\S]*?<\/details>/)?.[0]
	const vaultEntry = normalizedInvariants.match(/<details class="invariant-entry" id="vault-03"\s*>[\s\S]*?<\/details>/)?.[0]
	const activeAuctionEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-11"\s*>[\s\S]*?<\/details>/)?.[0]
	const auctionLiabilityEntry = normalizedInvariants.match(/<details class="invariant-entry" id="auc-12"\s*>[\s\S]*?<\/details>/)?.[0]
	assert.ok(capacityOwnershipEntry, 'Invariant catalog must retain BAL-08 lifecycle-qualified underwriting commitment accounting')
	assert.ok(vaultEntry, 'Invariant catalog must retain VAULT-03 append-only registry accounting')
	assert.ok(activeAuctionEntry, 'Invariant catalog must retain AUC-11 lifecycle-qualified clearing-tree accounting')
	assert.ok(auctionLiabilityEntry, 'Invariant catalog must retain AUC-12 ETH liability accounting')
	assert.match(capacityOwnershipEntry, /href="\.\.\/explanation\/truth-auctions\.html#clearing"/)
	assert.ok(vaultEntry.includes(`href="${repositorySourceUrl('solidity/contracts/statoblast/SecurityPool.sol')}"><code>_registerVault</code></a>`), 'VAULT-03 must link _registerVault to its repository source')
	assert.match(activeAuctionEntry, /href="#auc-12"><code>AUC-12<\/code><\/a>/)
}

/** The static index repeats each entry's identifier, title, type, and status; keep it identical to the entries. */
export function assertInvariantIndexMatchesEntries(invariantsHtml: string): void {
	const normalizedInvariants = invariantsHtml.replaceAll(/\s+/g, ' ')
	const metadataValue = (entry: string, label: string): string => entry.match(new RegExp(`<dt>${label}</dt> <dd>(.*?)</dd>`))?.[1]?.trim() ?? ''
	const catalogEntries = [...normalizedInvariants.matchAll(/<details class="invariant-entry" id="([^"]+)"> <summary><code>([^<]+)<\/code><span class="invariant-title">(.*?)<\/span><\/summary>([\s\S]*?)<\/details>/g)].map(match => ({
		id: match[1],
		identifier: match[2],
		title: match[3],
		type: metadataValue(match[4] ?? '', 'Type'),
		status: metadataValue(match[4] ?? '', 'Enforcement status'),
	}))
	const indexSection = normalizedInvariants.match(/<section id="invariant-index">[\s\S]*?<\/section>/)?.[0] ?? ''
	const indexRows = [...indexSection.matchAll(/<tr> <td> ?<a href="#([^"]+)"><code>([^<]+)<\/code><\/a> ?<\/td> <td>(.*?)<\/td> <td>(.*?)<\/td> <td>(.*?)<\/td> <\/tr>/g)].map(match => ({
		id: match[1],
		identifier: match[2],
		title: match[3],
		type: match[4],
		status: match[5],
	}))
	assert.ok(catalogEntries.length > 0, 'Invariant catalog must contain entries')
	assert.deepEqual(indexRows, catalogEntries, 'Invariant index rows must match the catalog entries in order, title, type, and enforcement status')
}

/** The coordinator data file repeats event declarations and enum values; keep them identical to the compiled ABI and the Solidity source. */
export function assertCoordinatorDataEventAndEnumDeclarations(coordinatorData: string, compiledContractArtifacts: unknown, priceCoordinatorTypes: string): void {
	const coordinatorIndex: unknown = JSON.parse(coordinatorData)
	assert.ok(isRecord(coordinatorIndex))
	assert.ok(isRecord(compiledContractArtifacts))
	const compiledContracts = compiledContractArtifacts['contracts']
	assert.ok(isRecord(compiledContracts))
	const coordinatorSourceArtifact = compiledContracts['contracts/statoblast/OpenOraclePriceCoordinator.sol']
	assert.ok(isRecord(coordinatorSourceArtifact))
	const coordinatorArtifact = coordinatorSourceArtifact['OpenOraclePriceCoordinator']
	assert.ok(isRecord(coordinatorArtifact))
	const coordinatorAbi = coordinatorArtifact['abi']
	assert.ok(Array.isArray(coordinatorAbi))
	const compiledEventDeclarations: Record<string, string> = {}
	const compiledEventParameterNames: Record<string, string[]> = {}
	const compiledIndexedEventParameterNames: Record<string, string[]> = {}
	for (const entry of coordinatorAbi) {
		if (!isRecord(entry) || entry['type'] !== 'event') continue
		const eventName = entry['name']
		const inputs = entry['inputs']
		assert.ok(typeof eventName === 'string' && Array.isArray(inputs))
		const parameterNames: string[] = []
		const indexedParameterNames: string[] = []
		const parameters = inputs.map((input: unknown) => {
			assert.ok(isRecord(input))
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
	const checkpoint = coordinatorIndex['checkpoint']
	assert.ok(isRecord(checkpoint))
	assert.deepEqual(checkpoint['fields'], compiledEventParameterNames['CoordinatorStateCheckpoint'], 'Coordinator data checkpoint fields must match the compiled CoordinatorStateCheckpoint event')
	assert.deepEqual(checkpoint['indexed'], compiledIndexedEventParameterNames['CoordinatorStateCheckpoint'], 'Coordinator data indexed checkpoint fields must match the compiled CoordinatorStateCheckpoint event')
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The coordinator parameter table and the worked request cost state literal values; keep them equal to the deployment configuration and source constants. */
export async function assertCoordinatorParameterTableValues(openOracleReferenceHtml: string, priceCoordinatorSource: string, priceCoordinatorTypes: string): Promise<void> {
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
	const settlementGas = configured('ORACLE_SETTLEMENT_GAS')
	const reportGas = configured('ORACLE_REPORT_GAS')
	const settlementOverhead = readInteger(priceCoordinatorSource, /SETTLEMENT_GAS_OVERHEAD = ([0-9_]+);/, 'SETTLEMENT_GAS_OVERHEAD')
	const maxPendingOperations = readInteger(priceCoordinatorSource, /MAX_PENDING_SETTLEMENT_OPERATIONS = ([0-9_]+);/, 'MAX_PENDING_SETTLEMENT_OPERATIONS')
	const bountyOffset = readInteger(priceCoordinatorTypes, /REQUEST_BOUNTY_OFFSET_ATTO_ETH = ([0-9_]+);/, 'REQUEST_BOUNTY_OFFSET_ATTO_ETH')
	assert.match(priceCoordinatorSource, /return 4 \* \(getSettlementCallbackGasLimit\(\) \+ gasConsumedOpenOracleReportPrice\);/, 'Request gas units must stay four times the callback limit plus report gas')
	const callbackGasLimit = (settlementGas + settlementOverhead) * maxPendingOperations
	const requestGasUnits = 4n * (callbackGasLimit + reportGas)
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
	assertStartsWith('gasConsumedSettlement', `${grouped(settlementGas)} gas`)
	assertStartsWith('SETTLEMENT_GAS_OVERHEAD', `${grouped(settlementOverhead)} gas`)
	assertStartsWith('MAX_PENDING_SETTLEMENT_OPERATIONS', grouped(maxPendingOperations))
	assertStartsWith('callbackGasLimit', `${grouped(callbackGasLimit)} gas`)
	assertStartsWith('gasConsumedOpenOracleReportPrice', `${grouped(reportGas)} gas`)
	assertStartsWith('maxSettlementBaseFeeMultiplierBps', `${grouped(configured('ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS'))} bps`)
	assertStartsWith('minLiquidationPriceDistanceBps', `${grouped(configured('ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS'))} bps`)
	assertStartsWith('settlementTime', `${grouped(configured('ORACLE_SETTLEMENT_TIME'))} seconds`)
	assertStartsWith('disputeDelay', grouped(configured('ORACLE_DISPUTE_DELAY')))
	assertStartsWith('multiplier', grouped(configured('ORACLE_MULTIPLIER')))
	assertStartsWith('MAX_OPERATION_VALID_FOR_SECONDS', `${grouped(durationSeconds('MAX_OPERATION_VALID_FOR_SECONDS'))} seconds`)
	assert.equal(durationSeconds('PRICE_VALID_FOR_SECONDS'), 300n, 'The page states a five-minute price freshness window')
	assert.equal(durationSeconds('SEPOLIA_PRICE_VALID_FOR_SECONDS'), 3600n, 'The page states a one-hour Sepolia price freshness window')
	const workedBaseFeeNanoEth = 30n
	const workedCostAttoEth = requestGasUnits * workedBaseFeeNanoEth * 10n ** 9n
	const workedCostEth = `${workedCostAttoEth / 10n ** 18n}.${(workedCostAttoEth % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')}`
	const requestCostNote = openOracleReferenceHtml.match(/<p class="equation-note">(?:(?!<\/p>)[\s\S])*REQUEST_BOUNTY_OFFSET_ATTO_ETH[\s\S]*?<\/p>/)?.[0]
	assert.ok(requestCostNote !== undefined, 'OpenOracle reference must keep its request-cost equation note')
	const workedValues = [`${grouped(callbackGasLimit)} gas`, `block.basefee × ${grouped(requestGasUnits)} + ${bountyOffset}`, `${workedCostEth} ETH`, `${workedBaseFeeNanoEth} nanoETH`]
	for (const workedValue of workedValues) assert.ok(requestCostNote.includes(`<code>${workedValue}</code>`), `OpenOracle request-cost note must state ${workedValue}`)
}
