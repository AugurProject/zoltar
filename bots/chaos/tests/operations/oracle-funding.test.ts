import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { sharedPoolPriceFeedAbi, genesisReputationTokenAbi } from '@zoltar/bot-shared/contracts/abi'
import { assertOperationEthFunding } from '../../src/execution/safety.ts'
import { assertAnchoredOracleRequestFunding, assertOracleRequestFundingEnvelope, oracleRequestFundingEnvelope } from '../../src/operations/oracle-request-funding.ts'
import { reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { address, planningOptionsFixture, snapshotFixture } from './fixture.ts'

const options = planningOptionsFixture()

const simpleCoordinatorFunding = {
	escalationHaltMultiplierBps: '10000',
	minimumReportCollateral: '5',
	minimumRepReportAttoRep: 0n.toString(),
	settlementBountyMultiplierBps: '10000',

	initialReportPriorityFeeAttoEthPerGas: 1n.toString(),

	settlementCallbackGasLimit: '2',
} as const

/** A snapshot whose first pool needs a fresh oracle price funded through its shared feed. */
function requestPriceSnapshot(projectedSettlementCollateralAttoEth?: bigint) {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Pool fixture missing')
	snapshot.anchor.baseFeePerGas = '1'
	pool.oraclePriceValid = false
	pool.oracleRequestFunding = { ...simpleCoordinatorFunding }
	pool.minimumToken1ReportAttoEth = '6'
	pool.requestPriceCostAttoEth = '784107'
	if (projectedSettlementCollateralAttoEth !== undefined) pool.projectedSettlementCollateralAttoEth = projectedSettlementCollateralAttoEth.toString()
	pool.settlementCollateralAttoEth = '100'
	pool.oracleExposureAttoEth = '100'
	return { pool, snapshot }
}

function requestPricePlan(snapshot: ReturnType<typeof snapshotFixture>) {
	return eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
}

describe('oracle request funding bounds', () => {
	test('#1493: request collateral also covers the REP inventory budget', () => {
		const envelope = oracleRequestFundingEnvelope({
			coordinator: { ...simpleCoordinatorFunding, minimumReportCollateral: '7', settlementBountyMultiplierBps: '30000', minimumRepReportAttoRep: 1000n.toString() },
			maximumEthPrincipalAttoEth: 10000000000n.toString(),
			maximumNativePrincipalAttoEth: 1000000000n.toString(),
			maximumRepPrincipalAttoRep: 10000000000n.toString(),
			maximumWethPrincipalAttoEth: 10000000000n.toString(),
			proposedRepPerEthPrice: '1000000000000000000',
			settlementCollateralCeilingAttoEth: 100n.toString(),
		})
		expect(envelope.maximumInitialAttoWeth).toBe('1000')
		expect(envelope.maximumInitialAttoRep).toBe('1000')
	})
	test('#1252 shared report envelopes fund gas-based public settlement at inclusion', () => {
		const coordinator = { ...simpleCoordinatorFunding, minimumReportCollateral: '7', settlementBountyMultiplierBps: '30000' }
		expect(() => assertAnchoredOracleRequestFunding({ baseFeePerGas: '1', coordinator, minimumToken1ReportAttoEth: 8n.toString(), requestPriceCostAttoEth: 2352119n.toString(), settlementCollateralAttoEth: 100n.toString() })).not.toThrow()
		const envelope = oracleRequestFundingEnvelope({
			coordinator,
			maximumEthPrincipalAttoEth: 10000000000n.toString(),
			maximumNativePrincipalAttoEth: 1000000000n.toString(),
			maximumRepPrincipalAttoRep: 10000000000n.toString(),
			maximumWethPrincipalAttoEth: 10000000000n.toString(),
			proposedRepPerEthPrice: (10n ** 18n).toString(),
			settlementCollateralCeilingAttoEth: 100n.toString(),
		})
		expect(BigInt(envelope.maximumRequestPriceCostAttoEth)).toBeGreaterThan(2352119n)
		expect(BigInt(envelope.maximumBaseFeePerGas)).toBeGreaterThan(1n)
		expect(() => assertOracleRequestFundingEnvelope({ coordinator, envelope, proposedRepPerEthPrice: (10n ** 18n).toString(), settlementCollateralAttoEth: 100n.toString() })).not.toThrow()
	})
	test('ETH-budget report automation excludes non-WETH collateral', () => {
		const { pool, snapshot } = requestPriceSnapshot()
		const prior = requestPricePlan(snapshot)
		if (prior === undefined) throw new Error('Missing report plan')
		pool.oracleRequestFunding.collateralToken = address(88)
		expect(requestPricePlan(snapshot)).toBeUndefined()
		expect(reevaluateOperationContinuation(snapshot, prior, options).plan).toBeUndefined()
	})

	test('shared report stakes use the configured collateral floor independently of gas prices', () => {
		const coordinator = { ...simpleCoordinatorFunding, minimumReportCollateral: '7', settlementBountyMultiplierBps: '30000' }
		for (const baseFeePerGas of ['0', '1', '1000000000000']) {
			expect(() => assertAnchoredOracleRequestFunding({ baseFeePerGas, coordinator, minimumToken1ReportAttoEth: 8n.toString(), requestPriceCostAttoEth: (392_003n * (BigInt(baseFeePerGas) + 1n) * 3n + 101n).toString(), settlementCollateralAttoEth: 100n.toString() })).not.toThrow()
		}
	})

	test('renews a fresh shared security pool price without allowing duplicate pending reports', () => {
		const { pool, snapshot } = requestPriceSnapshot()
		pool.oraclePriceValid = true
		expect(requestPricePlan(snapshot)).toBeDefined()
		pool.pendingReportId = '1'
		pool.reportEscrows = { '1': address(81) }
		expect(requestPricePlan(snapshot)).toBeUndefined()
	})

	test('uses shared aggregate exposure and the feed event while approving the question coordinator', () => {
		const { pool, snapshot } = requestPriceSnapshot()
		Object.assign(pool, { priceFeed: address(80), oracleExposureAttoEth: (10n ** 40n).toString() })
		expect(requestPricePlan(snapshot)).toBeUndefined()
		Object.assign(pool, { oracleExposureAttoEth: 100n.toString() })
		const plan = requestPricePlan(snapshot)
		const request = plan?.steps.find(step => step.id === 'request-price')
		expect(request?.to).toBe(pool.coordinator)
		expect(request?.evidence).toContainEqual(expect.objectContaining({ emitter: address(80) }))
		expect(plan?.steps.filter(step => step.id.startsWith('approve')).every(step => decodeFunctionData({ abi: genesisReputationTokenAbi, data: step.data }).args?.[0] === pool.coordinator)).toBe(true)
		if (plan === undefined) throw new Error('Missing shared feed request plan')
		const ceiling = plan.metadata['settlementCollateralCeilingAttoEth']
		if (typeof ceiling !== 'string') throw new Error('Missing exposure ceiling')
		pool.oracleExposureAttoEth = (BigInt(ceiling) + 1n).toString()
		const continued = reevaluateOperationContinuation(snapshot, plan, options, { confirmedStepIds: ['approve-oracle-weth'] })
		expect(continued.plan?.continuationDisposition).toBe('cleanup-only')
		expect(continued.plan?.steps.map(step => step.id)).toEqual(['revoke-oracle-weth'])
	})

	test('fails closed when an anchored coordinator getter disagrees with its immutable inputs', () => {
		const observation = {
			baseFeePerGas: '1',
			coordinator: simpleCoordinatorFunding,
			minimumToken1ReportAttoEth: 6n.toString(),
			requestPriceCostAttoEth: 784_107n.toString(),
			settlementCollateralAttoEth: 100n.toString(),
		}
		expect(() => assertAnchoredOracleRequestFunding(observation)).not.toThrow()
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, minimumToken1ReportAttoEth: 5n.toString() })).toThrow('minimum oracle report does not match')
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, requestPriceCostAttoEth: 784_108n.toString() })).toThrow('request-price cost does not match')
	})

	test('derives a base-fee-independent envelope from cumulative operation caps', () => {
		const envelope = oracleRequestFundingEnvelope({
			coordinator: simpleCoordinatorFunding,
			maximumEthPrincipalAttoEth: (10n ** 15n).toString(),
			maximumNativePrincipalAttoEth: (10n ** 15n).toString(),
			maximumRepPrincipalAttoRep: (10n ** 15n).toString(),
			maximumWethPrincipalAttoEth: (10n ** 15n).toString(),
			proposedRepPerEthPrice: (10n ** 18n).toString(),
			settlementCollateralCeilingAttoEth: 0n.toString(),
		})
		expect(envelope).toEqual({
			maximumBaseFeePerGas: '2551000884',
			maximumEscalationHaltAttoEth: 5n.toString(),
			maximumInitialAttoRep: 5n.toString(),
			maximumInitialAttoWeth: '5',
			maximumRequestPriceCostAttoEth: 999_999_999_922_756n.toString(),
		})
	})

	test('includes the collateral ceiling and validates a persisted envelope against current state', () => {
		const envelope = oracleRequestFundingEnvelope({
			coordinator: simpleCoordinatorFunding,
			maximumEthPrincipalAttoEth: 1_000_000n.toString(),
			maximumNativePrincipalAttoEth: 1_000_000n.toString(),
			maximumRepPrincipalAttoRep: 1_000_000n.toString(),
			maximumWethPrincipalAttoEth: 1_000_000n.toString(),
			proposedRepPerEthPrice: (10n ** 18n).toString(),
			settlementCollateralCeilingAttoEth: 50_000n.toString(),
		})
		expect(envelope).toEqual({
			maximumBaseFeePerGas: '1',
			maximumEscalationHaltAttoEth: 505n.toString(),
			maximumInitialAttoRep: 505n.toString(),
			maximumInitialAttoWeth: '505',
			maximumRequestPriceCostAttoEth: 784_107n.toString(),
		})
		expect(() =>
			assertOracleRequestFundingEnvelope({
				coordinator: simpleCoordinatorFunding,
				envelope,
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralAttoEth: 50_000n.toString(),
			}),
		).not.toThrow()
		expect(() =>
			assertOracleRequestFundingEnvelope({
				coordinator: simpleCoordinatorFunding,
				envelope,
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralAttoEth: 50_100n.toString(),
			}),
		).toThrow('no longer covers the current WETH report')
	})

	test('rejects caps that cannot fund a positive base fee', () => {
		expect(() =>
			oracleRequestFundingEnvelope({
				coordinator: simpleCoordinatorFunding,
				maximumEthPrincipalAttoEth: 784_111n.toString(),
				maximumNativePrincipalAttoEth: 784_111n.toString(),
				maximumRepPrincipalAttoRep: 6n.toString(),
				maximumWethPrincipalAttoEth: 784_111n.toString(),
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralCeilingAttoEth: 0n.toString(),
			}),
		).toThrow('cannot support a positive maximum base fee')
		expect(
			oracleRequestFundingEnvelope({
				coordinator: simpleCoordinatorFunding,
				maximumEthPrincipalAttoEth: 784_112n.toString(),
				maximumNativePrincipalAttoEth: 784_112n.toString(),
				maximumRepPrincipalAttoRep: 6n.toString(),
				maximumWethPrincipalAttoEth: 784_112n.toString(),
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralCeilingAttoEth: 0n.toString(),
			}).maximumBaseFeePerGas,
		).toBe('1')
	})

	test('rejects incomplete or invalid shared feed funding inputs', () => {
		const observation = { baseFeePerGas: '1', minimumToken1ReportAttoEth: 6n.toString(), requestPriceCostAttoEth: 784107n.toString(), settlementCollateralAttoEth: 100n.toString() }
		for (const minimumReportCollateral of ['0', (1n << 128n).toString()]) expect(() => assertAnchoredOracleRequestFunding({ ...observation, coordinator: { ...simpleCoordinatorFunding, minimumReportCollateral } })).toThrow('Invalid collateral report floor')
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, coordinator: { ...simpleCoordinatorFunding, settlementBountyMultiplierBps: '9999' } })).toThrow('Invalid shared settlement fee multiplier')
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, coordinator: { ...simpleCoordinatorFunding, settlementCallbackGasLimit: (1n << 32n).toString() } })).toThrow('settlementCallbackGasLimit exceeds uint32')
		const { minimumRepReportAttoRep: _minimumRepReportAttoRep, ...incomplete } = simpleCoordinatorFunding
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, coordinator: incomplete })).toThrow('Shared feed funding inputs missing')
	})

	test('reuses oversized allowances while preserving the full inclusion debit bound', () => {
		const { pool, snapshot } = requestPriceSnapshot(100n)
		for (const token of snapshot.wallet.tokens) token.allowances[pool.coordinator] = (10n ** 30n).toString()

		const plan = requestPricePlan(snapshot)
		if (plan === undefined) throw new Error('Request-price plan missing')
		expect(plan.steps).toHaveLength(1)
		expect(plan.maximumCleanupTransactionCount).toBeUndefined()
		const request = plan.steps[0]
		if (request === undefined) throw new Error('Request-price step missing')
		const decoded = decodeFunctionData({ abi: sharedPoolPriceFeedAbi, data: request.data })
		expect(decoded.functionName).toBe('requestSecurityPoolPrice')
		expect(decoded.args[1]).toBe(6n)
		expect(request.value).toBe('999999999922756')
		expect(plan.lastValidBlockNumber).toBeUndefined()
		expect(plan.terminalSubmission).toEqual({ kind: 'private-next-block', maximumFeePerGas: '2551000884' })
		expect(plan.metadata).toMatchObject({
			maximumBaseFeePerGas: '2551000884',
			maximumInitialAttoRep: 6n.toString(),
			maximumInitialAttoWeth: '6',
			maximumRequestPriceCostAttoEth: 999_999_999_922_756n.toString(),
			preparedAtBlock: snapshot.anchor.blockNumber,
			settlementCollateralCeilingAttoEth: 100n.toString(),
		})
		expect(request.walletAssetDebits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ amount: '999999999922756', asset: 'ETH', kind: 'native' }),
				expect.objectContaining({ amount: '6', asset: snapshot.deployments.weth, category: 'weth', kind: 'erc20' }),
				expect.objectContaining({ amount: '6', asset: pool.repToken, category: 'rep', kind: 'erc20' }),
			]),
		)
		expect(request.evidence).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ emitter: snapshot.deployments.weth, equals: '6', field: 'value', indexed: { from: snapshot.wallet.address }, kind: 'decoded-event-field' }),
				expect.objectContaining({ emitter: pool.repToken, equals: '6', field: 'value', indexed: { from: snapshot.wallet.address }, kind: 'decoded-event-field' }),
			]),
		)
		expect(request.evidence.some(item => item.kind === 'storage-postcondition' && item.functionName === 'allowance')).toBe(false)
	})

	test('makes an invalid funding candidate ineligible without aborting catalog evaluation', () => {
		const { pool, snapshot } = requestPriceSnapshot(100n)

		pool.oracleRequestFunding.minimumReportCollateral = '0'
		const blocked = requestPricePlan(snapshot)
		expect(blocked).toBeUndefined()
	})

	test('keeps the collateral floor fixed as gas and available inventory change', () => {
		const { snapshot } = requestPriceSnapshot()
		const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		if (weth === undefined) throw new Error('Funding inventory missing')
		weth.balance = '6'
		const plan = requestPricePlan(snapshot)
		expect(plan?.metadata['maximumInitialAttoWeth']).toBe('6')
		expect(plan?.metadata['maximumInitialAttoRep']).toBe('6')
		weth.balance = '5'
		expect(requestPricePlan(snapshot)).toBeUndefined()
	})

	test('reuses a persisted envelope after approval finality and cleans up when it becomes unsafe', () => {
		const { pool, snapshot } = requestPriceSnapshot()
		const initial = requestPricePlan(snapshot)
		if (initial === undefined) throw new Error('Request-price plan missing')
		expect(initial.maximumCleanupTransactionCount).toBe(2)
		const requestPrincipal = initial.steps.reduce((total, step) => total + BigInt(step.value ?? '0'), 0n)
		expect(assertOperationEthFunding(initial, requestPrincipal + 5n, { maximumGasCostAttoEth: 1n, minimumEthReserveAttoEth: 0n })).toMatchObject({ maximumGasCost: 5n, requiredBalance: requestPrincipal + 5n })
		const initialWethAttoEth = initial.metadata['maximumInitialAttoWeth']
		const initialRepAttoRep = initial.metadata['maximumInitialAttoRep']
		if (typeof initialWethAttoEth !== 'string' || typeof initialRepAttoRep !== 'string') throw new Error('Funding metadata missing')
		const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		const rep = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === pool.repToken.toLowerCase())
		if (weth === undefined || rep === undefined) throw new Error('Funding inventory missing')
		weth.allowances[pool.coordinator] = initialWethAttoEth
		rep.allowances[pool.coordinator] = '0'
		snapshot.anchor.blockNumber = '130'
		const oneConfirmedContinuation = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: ['approve-oracle-weth'] })
		expect(oneConfirmedContinuation.plan?.continuationDisposition).toBeUndefined()
		expect(oneConfirmedContinuation.plan?.steps.map(step => step.id)).toEqual(['approve-oracle-rep', 'request-price'])
		expect(oneConfirmedContinuation.plan?.maximumCleanupTransactionCount).toBe(2)
		const remainingApproval = oneConfirmedContinuation.plan?.steps[0]
		if (remainingApproval === undefined) throw new Error('Remaining REP approval missing')
		expect(decodeFunctionData({ abi: genesisReputationTokenAbi, data: remainingApproval.data }).args).toEqual([pool.coordinator, BigInt(initialRepAttoRep)])
		const oneConfirmedCleanup = reevaluateOperationContinuation(snapshot, initial, options, {
			confirmedStepIds: ['approve-oracle-weth'],
			continuationDisposition: 'cleanup-only',
		})
		expect(oneConfirmedCleanup.plan?.continuationDisposition).toBe('cleanup-only')
		expect(oneConfirmedCleanup.plan?.steps.map(step => step.id)).toEqual(['revoke-oracle-weth'])
		weth.allowances[pool.coordinator] = '0'
		const externallySpentApproval = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: ['approve-oracle-weth'] })
		expect(externallySpentApproval.plan?.continuationDisposition).toBe('cleanup-only')
		expect(externallySpentApproval.plan?.steps.map(step => step.id)).toEqual(['revoke-oracle-weth'])
		weth.allowances[pool.coordinator] = initialWethAttoEth
		rep.allowances[pool.coordinator] = initialRepAttoRep

		const continued = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(continued.plan?.continuationDisposition).toBeUndefined()
		expect(continued.plan?.steps.map(step => step.id)).toEqual(['request-price'])
		expect(continued.plan?.maximumCleanupTransactionCount).toBe(2)
		expect(continued.plan?.metadata).toEqual(initial.metadata)
		expect(continued.plan?.terminalSubmission).toEqual(initial.terminalSubmission)
		const finalizedFailureCleanup = reevaluateOperationContinuation(snapshot, initial, options, {
			confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id),
			continuationDisposition: 'cleanup-only',
		})
		expect(finalizedFailureCleanup.plan?.continuationDisposition).toBe('cleanup-only')
		expect(finalizedFailureCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		expect(finalizedFailureCleanup.plan?.terminalSubmission).toBeUndefined()
		const collateralCeiling = initial.metadata['settlementCollateralCeilingAttoEth']
		if (typeof collateralCeiling !== 'string') throw new Error('Collateral ceiling metadata missing')
		pool.oracleExposureAttoEth = collateralCeiling
		const collateralGrowthContinuation = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(collateralGrowthContinuation.plan?.steps.map(step => step.id)).toEqual(['request-price'])
		pool.oracleExposureAttoEth = (BigInt(collateralCeiling) + 1n).toString()
		const excessiveCollateralCleanup = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(excessiveCollateralCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		pool.settlementCollateralAttoEth = '100'
		pool.oracleExposureAttoEth = '100'

		pool.pendingReportId = '7'
		const cleanup = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(cleanup.plan?.continuationDisposition).toBe('cleanup-only')
		expect(cleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		expect(cleanup.plan?.terminalSubmission).toBeUndefined()
		expect(cleanup.plan?.metadata).toEqual(initial.metadata)
		for (const step of cleanup.plan?.steps ?? []) {
			const decoded = decodeFunctionData({ abi: genesisReputationTokenAbi, data: step.data })
			expect(decoded.functionName).toBe('approve')
			expect(decoded.args).toEqual([pool.coordinator, 0n])
			expect(step.walletAssetDebits).toEqual([])
		}

		pool.pendingReportId = '0'
		const publicCleanup = reevaluateOperationContinuation(snapshot, initial, { ...options, submissionMode: 'public' }, { confirmedStepIds: ['approve-oracle-weth', 'approve-oracle-rep'] })
		expect(publicCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		const reducedCapCleanup = reevaluateOperationContinuation(snapshot, initial, { ...options, maxEthSpendAttoEth: 1n.toString() }, { confirmedStepIds: ['approve-oracle-weth', 'approve-oracle-rep'] })
		expect(reducedCapCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		snapshot.anchor.blockNumber = '201'
		const expiredCleanup = reevaluateOperationContinuation(snapshot, initial, { ...options, workflowValidForBlocks: 100 }, { confirmedStepIds: ['approve-oracle-weth', 'approve-oracle-rep'] })
		expect(expiredCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
	})
})
