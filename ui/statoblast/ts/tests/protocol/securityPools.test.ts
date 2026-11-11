import { expect, test } from 'bun:test'
import { getAddress, RpcError, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { loadAllSecurityPools, loadRegisteredPortfolios } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'
import { loadSecurityPoolMintCapacity } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { createMockLoaderClient } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { owner, portfolio, capital, token } from '../features/portfolios/capitalFixture.js'

const mode = 'active'
const block = { hash: `0x${'11'.repeat(32)}`, number: 99n, timestamp: 1000n } as const
const deployment = { securityPool: owner, parent: zeroAddress, universeId: 42n, questionId: 7n, initialReportPriorityFeeAttoEthPerGas: 1n, openOraclePriceCoordinator: token, statoblastSecurityMultiplierBps: 20000n, collateralRepairAuction: zeroAddress }
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

const second = getAddress('0x00000000000000000000000000000000000000c1')
const unopened = getAddress('0x00000000000000000000000000000000000000c2')
const stranger = getAddress('0x00000000000000000000000000000000000000c3')
const partial = getAddress('0x00000000000000000000000000000000000000c4')
// Nodes word an exhausted call differently; a lone read uses Anvil's wording and a batch uses Geth's.
const outOfGas = (shared: boolean) => new RpcError(shared ? 'out of gas' : 'EVM error OutOfGas', { code: -32_000 })
/**
 * A registry where the first portfolio also has a ledger in fork child 42. Any caller can register itself: the stranger
 * answers nothing, and the partial one has a ledger but no question count. `batch` decides how a read of more than one
 * address treats the stranger: it fails alone, or it exhausts the shared gas so every later call fails, or the whole
 * request runs out of gas. Read on its own, the stranger's request runs out of gas and every other address answers for
 * itself. `unavailable` fails every request at the provider; `flaky` fails a lone read of `second` with `providerError`.
 * `more` adds working portfolios, `junk` adds addresses whose calls fail on their own, and `burning` adds contracts that
 * burn all their gas, starving every later call; all come after the others. Each request ends with the factory's
 * `portfolioCount`, which answers unless the calls before it were starved. Requests take a moment, so overlapping
 * ones are counted in `mostInFlight`. `empty` answers every request with empty data, as when Multicall3 is missing.
 */
function registryClient(
	batch: 'isolated' | 'starving' | 'reverting' | 'unavailable' | 'flaky' | 'empty',
	{ more = [], junk = [], burning = [], providerError = () => new RpcError('HTTP 502 while calling eth_call', { code: 502 }) }: { more?: readonly Address[]; junk?: readonly Address[]; burning?: readonly Address[]; providerError?: () => Error } = {},
) {
	const registry = [portfolio, stranger, second, partial, unopened, ...more, ...junk, ...burning]
	const junkAddresses = new Set(junk)
	const burningAddresses = new Set(burning)
	let inFlight = 0
	let mostInFlight = 0
	const ledgers = new Map([[`${portfolio}:0`, capital], [`${second}:0`, token], [`${partial}:0`, token], [`${portfolio}:42`, token], ...more.map(address => [`${address}:0`, token] as const)])
	const questionCounts = new Map([[portfolio, 2n], [second, 0n], [unopened, 0n], ...more.map(address => [address, 1n] as const)])
	const blocks: (bigint | undefined)[] = []
	const batches: number[] = []
	const client = createMockLoaderClient({
		getBlock: async () => block,
		readContract: async request => {
			blocks.push(request.blockNumber)
			if (request.functionName === 'portfolioCount') return BigInt(registry.length)
			if (request.functionName === 'portfoliosRange') return registry.slice(Number(request.args?.[0]), Number(request.args?.[0]) + Number(request.args?.[1]))
			throw new Error(`Unexpected ${request.functionName}`)
		},
		multicall: async request => {
			batches.push(request.contracts.length)
			blocks.push(request.blockNumber)
			expect(request.allowFailure).toBe(true)
			inFlight += 1
			mostInFlight = Math.max(mostInFlight, inFlight)
			await Bun.sleep(1)
			inFlight -= 1
			if (batch === 'unavailable') throw new RpcError('HTTP 503 while calling eth_call', { code: 503 })
			if (batch === 'empty') throw Object.assign(new Error('The contract function "aggregate3" returned no data ("0x").'), { name: 'ContractFunctionZeroDataError' })
			const addresses = request.contracts.map(contract => getAddress(String(contract.address)))
			const shared = new Set(request.contracts.filter(contract => contract.functionName !== 'portfolioCount').map(contract => contract.address)).size > 1
			if (batch === 'flaky' && !shared && addresses.includes(second)) throw providerError()
			if (addresses.includes(stranger) && (!shared || batch === 'reverting' || batch === 'flaky')) throw outOfGas(shared)
			if (!shared && addresses.some(address => burningAddresses.has(address))) throw outOfGas(shared)
			const firstBurning = addresses.findIndex(address => burningAddresses.has(address))
			let starvedFrom = shared && batch === 'starving' ? addresses.indexOf(stranger) : -1
			if (firstBurning >= 0 && (starvedFrom < 0 || firstBurning < starvedFrom)) starvedFrom = firstBurning
			return request.contracts.map((contract, index) => {
				const address = addresses[index]
				if (address === undefined) throw new Error('Missing call address')
				if (address === stranger || junkAddresses.has(address) || (starvedFrom >= 0 && index >= starvedFrom) || (address === partial && contract.functionName === 'questionCount')) return { status: 'failure', error: new Error('execution reverted') }
				if (contract.functionName === 'portfolioCount') return { status: 'success', result: BigInt(registry.length) }
				if (contract.functionName === 'questionCount') return { status: 'success', result: questionCounts.get(address) }
				return { status: 'success', result: ledgers.get(`${address}:${String(contract.args?.[0])}`) ?? zeroAddress }
			})
		},
	})
	return { client, blocks, batches, mostInFlight: () => mostInFlight }
}

test('registered portfolios list those with a ledger in the universe, newest registration first', async () => {
	const { client, blocks, batches } = registryClient('isolated')
	expect(await loadRegisteredPortfolios(client, 0n)).toEqual([
		{ portfolio: second, questionCount: 0 },
		{ portfolio, questionCount: 2 },
	])
	expect(await loadRegisteredPortfolios(client, 42n)).toEqual([{ portfolio, questionCount: 2 }])
	// Both failures came before a later success, so each load is one batched read with nothing read again.
	expect(batches).toEqual([11, 11])
	expect(blocks.every(blockNumber => blockNumber === block.number)).toBe(true)
})

test.each([
	['starves', 'starving', [11, 9, 5, 5, 3, 3]],
	['reverts', 'reverting', [11, 7, 5, 5, 3, 3, 3]],
] as const)('a registered contract that %s the batched read cannot hide the other portfolios', async (_effect, batch, requests) => {
	const { client, blocks, batches } = registryClient(batch)
	expect(await loadRegisteredPortfolios(client, 0n)).toEqual([
		{ portfolio: second, questionCount: 0 },
		{ portfolio, questionCount: 2 },
	])
	// Unanswered sets are read again or split in half, so the stranger costs a few requests rather than one per portfolio.
	expect([...batches].sort((left, right) => right - left)).toEqual([...requests])
	expect(blocks.every(blockNumber => blockNumber === block.number)).toBe(true)
})

test('one failing contract among many registered portfolios costs a few requests, not one per portfolio', async () => {
	const more = Array.from({ length: 35 }, (_, index) => getAddress(`0x${(0xd00 + index).toString(16).padStart(40, '0')}`))
	const { client, batches } = registryClient('reverting', { more })
	const listed = await loadRegisteredPortfolios(client, 0n)
	expect(listed.map(entry => entry.portfolio)).toEqual([...more].reverse().concat([second, portfolio]))
	expect(batches.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(40)) + 1)
})

test('a large registry is read in pages of 100 addresses, at most four requests at a time', async () => {
	const more = Array.from({ length: 150 }, (_, index) => getAddress(`0x${(0x1000 + index).toString(16).padStart(40, '0')}`))
	const { client, batches, mostInFlight } = registryClient('isolated', { more })
	const listed = await loadRegisteredPortfolios(client, 0n)
	expect(listed.map(entry => entry.portfolio)).toEqual([...more].reverse().concat([second, portfolio]))
	// Each page is two calls per address plus the factory's final call.
	expect([...batches].sort((left, right) => right - left)).toEqual([2 * 100 + 1, 2 * 55 + 1])
	expect(mostInFlight()).toBeLessThanOrEqual(4)
})

test('addresses that fail on their own at the end of the registry cost no further requests', async () => {
	// Registering costs one call from a fresh address, so the newest registrations can all be junk.
	const junk = Array.from({ length: 32 }, (_, index) => getAddress(`0x${(0xe00 + index).toString(16).padStart(40, '0')}`))
	const { client, batches } = registryClient('isolated', { junk })
	expect(await loadRegisteredPortfolios(client, 0n)).toEqual([
		{ portfolio: second, questionCount: 0 },
		{ portfolio, questionCount: 2 },
	])
	expect(batches).toEqual([2 * (5 + junk.length) + 1])
})

test('contracts that burn all their gas are read again at most four at a time', async () => {
	const burning = Array.from({ length: 8 }, (_, index) => getAddress(`0x${(0xf00 + index).toString(16).padStart(40, '0')}`))
	const { client, batches, mostInFlight } = registryClient('isolated', { burning })
	expect(await loadRegisteredPortfolios(client, 0n)).toEqual([
		{ portfolio: second, questionCount: 0 },
		{ portfolio, questionCount: 2 },
	])
	// Each such contract must be read on its own, which halving reaches in about two requests per contract.
	expect(batches.length).toBeLessThanOrEqual(2 * burning.length + 1)
	expect(mostInFlight()).toBeLessThanOrEqual(4)
})

test('empty data from the batched read fails the list, since a registered contract cannot cause it', async () => {
	const { client, batches } = registryClient('empty')
	await expect(loadRegisteredPortfolios(client, 0n)).rejects.toThrow('returned no data')
	expect(batches).toHaveLength(1)
})

test('a provider that answers no portfolio read reports an error rather than an empty list', async () => {
	await expect(loadRegisteredPortfolios(registryClient('unavailable').client, 0n)).rejects.toThrow('HTTP 503')
})

// A timeout and a node that lost the block are not execution failures, though neither carries an HTTP status.
test.each([
	['an HTTP error', new RpcError('HTTP 502 while calling eth_call', { code: 502 })],
	['a timeout', new RpcError('The operation timed out.', { code: 23 })],
	['a missing block', new RpcError('header not found', { code: -32_000 })],
] as const)('%s while reading an address again fails the list instead of dropping that portfolio', async (_failure, error) => {
	await expect(loadRegisteredPortfolios(registryClient('flaky', { providerError: () => error }).client, 0n)).rejects.toThrow(error.message)
})

test('a reorganization during the portfolio reads is reported as such', async () => {
	const { client } = registryClient('isolated')
	// The block is replaced once the portfolio reads begin, after the registry itself was read on the canonical chain.
	let replaced = false
	const reorganized = {
		...client,
		getBlock: async () => (replaced ? { ...block, hash: `0x${'22'.repeat(32)}` } : block),
		multicall: async (request: Parameters<typeof client.multicall>[0]) => {
			replaced = true
			return await client.multicall(request)
		},
	}
	await expect(loadRegisteredPortfolios(reorganized, 0n)).rejects.toThrow('Portfolios changed during discovery')
})
