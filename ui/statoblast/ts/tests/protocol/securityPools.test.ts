import { expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { loadAllSecurityPools, loadRegisteredPortfolios } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { loadSecurityPoolMintCapacity } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { owner, portfolio, capital, token } from '../features/portfolios/capitalFixture.js'

const mode = 'active'
const block = { hash: `0x${'11'.repeat(32)}`, number: 99n, timestamp: 1000n } as const
const deployment = { securityPool: owner, parent: zeroAddress, universeId: 42n, questionId: 7n, initialReportPriorityFeeAttoEthPerGas: 1n, openOraclePriceCoordinator: token, statoblastSecurityMultiplierBps: 20000n, truthAuction: zeroAddress }
function centralRead(name: string) {
	switch (name) {
		case 'refreshPortfolioFees':
			return undefined
		case 'getCurrentBlockTimestamp':
			return 5_000n
		case 'portfolio':
			return portfolio
		case 'universeId':
			return 42n
		case 'totals':
			return [300n, 200n, 120n]
		case 'questionId':
			return 7n
		case 'isPriceValid':
			return mode !== 'stale'
		case 'ledger':
			return token
		case 'bookIds':
			return 1n
		case 'feeTimestamp':
			return 1000n
		case 'question':
			return [{ units: 60n, outcomeSupplyAttoShares: 100n, finalAfter: 0n, feeRateAttoEthPerSecond: 2n, feeStart: 1000n, feeEnd: 2000n, feePrincipalAttoEth: 100n }, mode === 'frozen' ? 1n : 0n]
		case 'books':
			return [mode === 'runoff' ? 50n : 100n, 100n, 0n, 1n, 0n, 0n, 123n, mode === 'sealed', 1n, 1n, 1n, mode !== 'disabled', 0n, 877n, 40n, mode === 'basket' ? 150n : 0n]
		case 'settlement':
			return token
		case 'availableMintCapacity':
			return 20n
		case 'snapshotQuestion':
			return { outcomeSupplyAttoShares: 100n, questionCashAttoEth: 60n, questionRecoveryAttoRep: mode === 'basket' ? 90n : 0n, demandAttoEth: 100n, earnedFeesAttoEth: 0n, timestamp: 123n }
		default:
			throw new Error(`Unexpected ${name}`)
	}
}
function fixture({ forked = false, reporting = false, missingPortfolio = false, reorg = false } = {}) {
	const reads: string[] = []
	let headReads = 0
	const client = createMockLoaderClient({
		getBlock: async () => {
			headReads++
			return reorg && headReads > 2 ? { ...block, hash: `0x${'22'.repeat(32)}` as const } : block
		},
		readContract: async request => {
			reads.push(request.functionName)
			if (request.functionName !== 'getOutcomeLabels') expect(request.blockNumber).toBe(99n)
			switch (request.functionName) {
				case 'securityPoolDeploymentCount':
					return 1n
				case 'securityPoolDeploymentsRange':
					return [deployment]
				case 'portfolioCustody':
					return missingPortfolio ? zeroAddress : capital
				case 'getSecurityPoolPortfolio':
					return portfolio
				case 'escalationGame':
					return reporting ? token : zeroAddress
				case 'forkContinuation':
					return forked
				case 'systemState':
					return 0n
				case 'getQuestionOutcome':
					return 3n
				case 'getForkTime':
					return forked ? 900n : 0n
				case 'lastPrice':
					return 10n
				case 'lastSettlementTimestamp':
					return 950n
				case 'priceValidUntil':
					return 1200n
				case 'questions':
					return ['Question', 'Description', 1n, 2n, 2n, 0n, 2000n, '']
				case 'getOutcomeLabels':
					return ['Invalid', 'Yes', 'No']
				default:
					throw new Error(`Unexpected read ${request.functionName}`)
			}
		},
		multicall: async request => {
			if (request.contracts[0]?.functionName !== 'questions') expect(request.blockNumber).toBe(99n)
			return request.contracts.map(call => {
				reads.push(call.functionName)
				if (call.functionName === 'questions') return ['Question', 'Description', 1n, 2000n, 2n, 0n, 2000n, '']
				if (call.functionName === 'questionCreatedTimestamp') return 1n
				if (call.functionName === 'portfolioCustody') return capital
				if (call.functionName === 'escalationGame') return reporting ? token : zeroAddress
				return centralRead(call.functionName)
			})
		},
	})
	return { client, reads }
}
test.each([false, true])('discovers native portfolio question snapshots (reporting: %s)', async reporting => {
	const { client, reads } = fixture({ reporting })
	const pools = await loadAllSecurityPools(client)
	expect(pools).toHaveLength(1)
	expect(pools[0]).toMatchObject({ portfolioAddress: portfolio, securityPoolAddress: owner, settlementCollateralAttoEth: 60n, totalPoolHeldAttoRep: 300n, mintingCapacityAttoEth: reporting ? 0n : 80n })
	expect(reads).not.toContain('getVaults')
	expect(reads).not.toContain('securityVaults')
})
test('rejects a question with no portfolio custody', async () => {
	await expect(loadAllSecurityPools(fixture({ missingPortfolio: true }).client)).rejects.toThrow('Question has no portfolio')
})
test('rejects a replaced discovery anchor after loading question snapshots', async () => {
	await expect(loadAllSecurityPools(fixture({ reorg: true }).client)).rejects.toThrow('deployments changed')
})
test('reflects a forked universe without per-question vault scans', async () => {
	const pools = await loadAllSecurityPools(fixture({ forked: true }).client)
	expect(pools[0]?.universeHasForked).toBe(true)
	expect(pools[0]?.hasForkActivity).toBe(true)
})
test.each([false, true])('mint capacity uses central fees and closes when reporting starts (%s)', async reporting => {
	const capacity = await loadSecurityPoolMintCapacity(fixture({ reporting }).client, owner)
	expect(capacity.feeEndTimestamp).toBe(2000n)
	expect(capacity.mintingCapacityAttoEth).toBe(reporting ? 0n : 80n)
})

test('registered portfolios list the pools of one universe by portfolio, newest registration first', async () => {
	const other = getAddress('0x00000000000000000000000000000000000000c1')
	const pool = (index: number) => getAddress(`0x${(0xa0 + index).toString(16).padStart(40, '0')}`)
	// Question 7 is registered in universe 0 and again in fork child 42; each universe lists its own registrations.
	const deployments = [
		{ ...deployment, securityPool: pool(0), universeId: 0n, questionId: 7n },
		{ ...deployment, securityPool: pool(1), universeId: 0n, questionId: 8n },
		{ ...deployment, securityPool: pool(2), universeId: 0n, questionId: 9n },
		{ ...deployment, securityPool: pool(3), universeId: 42n, questionId: 7n },
		{ ...deployment, securityPool: pool(4), universeId: 0n, questionId: 5n },
	]
	const owners = new Map([
		[pool(0), portfolio],
		[pool(1), other],
		[pool(2), zeroAddress],
		[pool(3), portfolio],
		[pool(4), portfolio],
	])
	const blocks: (bigint | undefined)[] = []
	const batches: number[] = []
	const client = createMockLoaderClient({
		getBlock: async () => block,
		readContract: async request => {
			blocks.push(request.blockNumber)
			if (request.functionName === 'securityPoolDeploymentCount') return BigInt(deployments.length)
			if (request.functionName === 'securityPoolDeploymentsRange') return deployments
			throw new Error(`Unexpected ${request.functionName}`)
		},
		multicall: async request => {
			batches.push(request.contracts.length)
			blocks.push(request.blockNumber)
			return request.contracts.map(contract => owners.get(getAddress(String(contract.args?.[0]))))
		},
	})
	expect(await loadRegisteredPortfolios(client, 0n)).toEqual([
		{ portfolio, questionCount: 2 },
		{ portfolio: other, questionCount: 1 },
	])
	expect(await loadRegisteredPortfolios(client, 42n)).toEqual([{ portfolio, questionCount: 1 }])
	// Each load resolves only its universe's pools, in one multicall request pinned with the registry to one block.
	expect(batches).toEqual([4, 1])
	expect(blocks.every(blockNumber => blockNumber === block.number)).toBe(true)
})
