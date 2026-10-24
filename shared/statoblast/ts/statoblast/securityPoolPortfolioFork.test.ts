import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	buildPortfolioVoluntaryRepairRequest,
	buildPortfolioForkChoiceRequest,
	buildPortfolioForkStartRequest,
	buildPortfolioForkFinalizeRequest,
	buildPortfolioForkRecoveryRequest,
	buildPortfolioRecoveryRightsTransferRequest,
	buildPortfolioRecapPurchaseRequest,
	loadPortfolioForkSnapshot,
	loadPortfolioRecapQuote,
	type PortfolioReadClient,
} from './securityPoolPortfolio.js'
const owner: Address = '0x0000000000000000000000000000000000000001'
const portfolio: Address = '0x0000000000000000000000000000000000000002'
const controller: Address = '0x0000000000000000000000000000000000000003'
const protocol: Address = '0x0000000000000000000000000000000000000004'
const capital: Address = '0x0000000000000000000000000000000000000005'
const hash: Hex = `0x${'11'.repeat(32)}`
const abi = parseAbi([
	'function recapitalizeUniverse(uint248 universeId) payable',
	'function choose(uint248 source,uint256 outcome)',
	'function startBranch(uint248 source,uint256 outcome) returns (uint248)',
	'function finalizeBranch(uint248 child)',
	'function recoverUnchosenCash(uint248 source,uint256 questionId,uint256 shares) returns (uint256)',
	'function transferPortfolioRecoveryRights(uint248 sourceUniverse,address recipient,uint256[3] amountsAttoShares)',
	'function buyRecapitalization(uint248 child,uint256 maximumRep,uint256 minimumRep,uint256 maximumCommitment,uint256 maximumOwnRep,uint256 targetHealth,uint256 executionReserve) payable returns (uint256,uint256)',
])
function fixture(overrides: Record<string, unknown> = {}) {
	const calls: { functionName: string; blockNumber: bigint }[] = []
	const values: Record<string, unknown> = {
		forkController: controller,
		portfolio,
		zoltar: protocol,
		getForkTime: 1_000n,
		getForkChoiceDeadline: 2_000n,
		getForkRecapitalizationDeadline: 3_000n,
		forks: [50n, 40n, 30n, 30n, 2n, 10n, 0n, 0n, true, false, true],
		choices: [7n, true],
		getChildUniverseId: 42n,
		branches: [8n, 7n, 20n, 16n, 10n, 0n, zeroAddress, true, false, false],
		getRepToken: owner,
		capitalLedger: capital,
		...overrides,
	}
	const client: PortfolioReadClient = {
		getChainId: async () => 1,
		getBlock: async () => ({ number: 10n, hash, timestamp: 1_500n }),
		readContract: async p => {
			calls.push({ functionName: p.functionName, blockNumber: p.blockNumber })
			if (p.functionName === 'requiredRep') {
				const commitment = p.args?.[0]
				if (typeof commitment !== 'bigint') throw new Error('Missing K')
				return commitment * 3n
			}
			if (!(p.functionName in values)) throw new Error(`Unexpected read ${p.functionName}`)
			return values[p.functionName]
		},
	}
	return { client, calls }
}
describe('bounded portfolio fork SDK', () => {
	test('voluntary repair donates exactly the chosen cash without buying shares or REP', () => {
		const request = buildPortfolioVoluntaryRepairRequest({ owner, portfolio, universeId: 42n, amountAttoEth: 50n })
		expect(request).toMatchObject({ account: owner, to: portfolio, value: 50n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'recapitalizeUniverse', args: [42n] })
		expect(() => buildPortfolioVoluntaryRepairRequest({ owner, portfolio, universeId: 42n, amountAttoEth: 0n })).toThrow('positive')
	})
	test('one owner choice, shared activation and source-only complete-set recovery encode exact identities', () => {
		const base = { owner, controller, universeId: 8n }
		expect(decodeFunctionData({ abi, data: buildPortfolioForkChoiceRequest({ ...base, outcomeIndex: 7n }).data })).toEqual({ functionName: 'choose', args: [8n, 7n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioForkStartRequest({ ...base, outcomeIndex: 7n }).data })).toEqual({ functionName: 'startBranch', args: [8n, 7n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioForkFinalizeRequest({ ...base, universeId: 42n }).data })).toEqual({ functionName: 'finalizeBranch', args: [42n] })
		expect(decodeFunctionData({ abi, data: buildPortfolioForkRecoveryRequest({ ...base, questionId: 123n, shares: 99n }).data })).toEqual({ functionName: 'recoverUnchosenCash', args: [8n, 123n, 99n] })
		expect(() => buildPortfolioForkRecoveryRequest({ ...base, questionId: 123n, shares: 0n })).toThrow('positive')
		expect(() => buildPortfolioForkChoiceRequest({ ...base, universeId: 1n << 248n, outcomeIndex: 7n })).toThrow('uint248')
	})
	test('independent recovery transfers bind the source, share token, recipient and all three outcome amounts', () => {
		const parameters = { owner, shareToken: capital, universeId: 8n, recipient: portfolio, amountsAttoShares: [4n, 0n, 7n] satisfies readonly [bigint, bigint, bigint] }
		const request = buildPortfolioRecoveryRightsTransferRequest(parameters)
		expect(request).toMatchObject({ account: owner, to: capital, value: 0n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'transferPortfolioRecoveryRights', args: [8n, portfolio, [4n, 0n, 7n]] })
		expect(() => buildPortfolioRecoveryRightsTransferRequest({ ...parameters, amountsAttoShares: [0n, 0n, 0n] })).toThrow('positive')
		expect(() => buildPortfolioRecoveryRightsTransferRequest({ ...parameters, amountsAttoShares: [-1n, 0n, 1n] })).toThrow('uint256')
		expect(() => buildPortfolioRecoveryRightsTransferRequest({ ...parameters, recipient: zeroAddress })).toThrow('nonzero')
		expect(() => buildPortfolioRecoveryRightsTransferRequest({ ...parameters, recipient: owner })).toThrow('another account')
	})

	test('recap purchase separately caps received REP, accepted obligation, own collateral and ETH budget', () => {
		const parameters = { owner, controller, universeId: 42n, maximumRep: 100n, minimumRep: 90n, maximumCommitment: 30n, maximumOwnRep: 7n, targetHealthFactorBps: 12_000n, executionReserveAttoEth: 4n, maximumCostAttoEth: 50n }
		const request = buildPortfolioRecapPurchaseRequest(parameters)
		expect(request).toMatchObject({ account: owner, to: controller, value: 54n })
		expect(decodeFunctionData({ abi, data: request.data })).toEqual({ functionName: 'buyRecapitalization', args: [42n, 100n, 90n, 30n, 7n, 12_000n, 4n] })
		expect(() => buildPortfolioRecapPurchaseRequest({ ...parameters, minimumRep: 101n })).toThrow('ordered')
		expect(() => buildPortfolioRecapPurchaseRequest({ ...parameters, targetHealthFactorBps: 9_999n })).toThrow('100%')
		expect(() => buildPortfolioRecapPurchaseRequest({ ...parameters, maximumCostAttoEth: (1n << 256n) - 1n })).toThrow('uint256')
	})
	test('reads one chosen branch at a pinned block without owner, question or ancestor history', async () => {
		const { client, calls } = fixture()
		const snapshot = await loadPortfolioForkSnapshot({ client, portfolio, owner, universeId: 8n })
		expect(snapshot.choice).toEqual({ outcomeIndex: 7n, recorded: true })
		expect(snapshot.branch).toMatchObject({ universeId: 42n, capitalLedger: capital, prepared: true, ready: false })
		expect(snapshot).toMatchObject({ forkTime: 1_000n, choiceDeadline: 2_000n, recapitalizationDeadline: 3_000n })
		expect(new Set(calls.map(c => c.blockNumber))).toEqual(new Set([10n]))
		expect(calls.length).toBeLessThan(20)
	})
	test('unprepared arbitrary outcomes do not require child deployment and foreign branches are rejected', async () => {
		const unborn = fixture({ choices: [0n, false], branches: [0n, 0n, 0n, 0n, 0n, 0n, zeroAddress, false, false, false] })
		const snapshot = await loadPortfolioForkSnapshot({ client: unborn.client, portfolio, owner, universeId: 8n, outcomeIndex: 2n ** 200n })
		expect(snapshot.branch).toMatchObject({ prepared: false, capitalLedger: zeroAddress })
		expect(unborn.calls.some(call => call.functionName === 'capitalLedger')).toBe(false)
		await expect(loadPortfolioForkSnapshot({ client: fixture({ branches: [9n, 7n, 0n, 0n, 0n, 0n, zeroAddress, true, false, false] }).client, portfolio, owner, universeId: 8n })).rejects.toThrow('different fork')
		await expect(loadPortfolioForkSnapshot({ client: fixture({ portfolio: owner }).client, portfolio, owner, universeId: 8n })).rejects.toThrow('different portfolio')
	})
	test('malformed deadlines, inconsistent accounting and reorgs fail closed', async () => {
		await expect(loadPortfolioForkSnapshot({ client: fixture({ getForkChoiceDeadline: 1_000n }).client, portfolio, owner, universeId: 8n })).rejects.toThrow('deadlines')
		await expect(loadPortfolioForkSnapshot({ client: fixture({ forks: [50n, 40n, 30n, 30n, 2n, 31n, 0n, 0n, true, false, true] }).client, portfolio, owner, universeId: 8n })).rejects.toThrow('accounting')
		const reorg = fixture()
		reorg.client.getBlock = async p => ({ number: 10n, hash: p?.blockNumber === undefined ? hash : `0x${'22'.repeat(32)}`, timestamp: 1_500n })
		await expect(loadPortfolioForkSnapshot({ client: reorg.client, portfolio, owner, universeId: 8n })).rejects.toThrow('changed')
	})
})

test.each([
	{ minimumFill: 1n, maximumSold: 100n, principal: 40n, batch: 0n, commitment: 10n, reserve: 2n, ownRep: 30n, reason: undefined },
	{ minimumFill: 10n, maximumSold: 100n, principal: 40n, batch: 0n, commitment: 10n, reserve: 2n, ownRep: 30n, reason: 'Purchase is below this recap sale’s minimum fill.' },
	{ minimumFill: 10n, maximumSold: 20n, principal: 40n, batch: 0n, commitment: 10n, reserve: 2n, ownRep: 30n, reason: undefined },
	{ minimumFill: 1n, maximumSold: 100n, principal: 100n, batch: 0n, commitment: 10n, reserve: 2n, ownRep: 0n, reason: undefined },
	{ minimumFill: 1n, maximumSold: 100n, principal: 40n, batch: 1n, commitment: 10n, reserve: 2n, ownRep: 30n, reason: 'Retiring principal cannot accept a recap commitment.' },
	{ minimumFill: 1n, maximumSold: 100n, principal: 40n, batch: 1n, commitment: 0n, reserve: 0n, ownRep: 0n, reason: undefined },
])('recap quote funds combined health and enforces minimum fill $minimumFill for remaining inventory $maximumSold', async ({ minimumFill, maximumSold, principal, batch, commitment, reserve, ownRep, reason }) => {
	const source = fixture({
		branches: [8n, 7n, 20n, 20n, 10n, 0n, owner, true, true, false],
		quote: [20n, commitment, 5n],
		minimumFillAttoEth: minimumFill,
		maximumRepSoldAttoRep: maximumSold,
		soldAttoRep: 0n,
		raisedAttoEth: 0n,
		missingCashAttoEth: 100n,
		originUniverseId: 8n,
		settlement: portfolio,
		ledger: portfolio,
		minimumOutcomeExchangeRate: 1n,
		purchaseFeeBps: 100n,
		annualFeeBps: 1000n,
		minimumPurchaseFeeAttoEth: 1n,
		minimumCommitmentAttoEth: 10n,
		minimumExecutionReserveAttoEth: 3n,
		rewardVestingSeconds: 100n,
		commitmentIndex: controller,
		repToken: owner,
		acceptedPrice: 1n,
		securityMultiplierBps: 10000n,
		priceValidUntil: 2000n,
		isPriceValid: false,
		demandAttoEth: 10n,
		totalFreeAttoRep: 0n,
		frozen: false,
		importing: true,
		exported: false,
		totals: [40n, 20n, 0n],
		currentBatch: 1n,
		nextBatch: 2n,
		ownerAccount: { freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, executionReserveAttoEth: 2n, targetHealthFactorBps: 10000n, positionId: 1n },
		ownerCollateral: [principal, 20n, 0n],
		accountOf: { owner, batch, rep: principal, commitment: 20n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n },
		positionExecutionReserveAttoEth: 5n,
		liquidationStarted: 0n,
	})
	const snapshot = await loadPortfolioForkSnapshot({ client: source.client, portfolio, owner, universeId: 8n })
	const quote = await loadPortfolioRecapQuote({ client: source.client, snapshot, maximumCostAttoEth: 10n, maximumRep: 30n, targetHealthFactorBps: 15000n })
	expect(quote.ownRep).toBe(ownRep)
	expect(quote.executionReserve).toBe(reserve)
	expect(quote.reason).toBe(reason)
})
