import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '../support/bot-shared.ts'
import { coordinatorAbi, erc20Abi } from '../../src/contracts/abi.ts'
import { assertOperationEthFunding } from '../../src/execution/safety.ts'
import { anchoredMinimumToken1ReportAttoEth, anchoredRequestPriceCostAttoEth, assertAnchoredOracleRequestFunding, assertOracleRequestFundingEnvelope, oracleRequestFundingBounds, oracleRequestFundingEnvelope, oracleRequestFundingForMaximumBaseFee } from '../../src/operations/oracle-request-funding.ts'
import { eligibleOperationPlans, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maximumBlockIntervalSeconds: 15,
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 0x1234_5678,
} as const

const simpleCoordinatorFunding = {
	escalationHaltMultiplierBps: '10000',
	feePercentage: '0',
	gasConsumedOpenOracleReportPrice: '3',
	gasUnitsForOneDispute: '1',
	initialReportPriorityFeeAttoEthPerGas: 1n.toString(),
	openOracleSecurityMultiplierBps: '10000',
	protocolFee: '0',
	settlementCallbackGasLimit: '2',
	targetPriceErrorForDispute: '10000000',
} as const

describe('oracle request funding bounds', () => {
	test('reproduces the coordinator getters at the anchor base fee', () => {
		expect(anchoredMinimumToken1ReportAttoEth({ baseFeePerGas: '1', coordinator: simpleCoordinatorFunding, settlementCollateralAttoEth: 100n.toString() })).toBe('4')
		expect(anchoredRequestPriceCostAttoEth({ baseFeePerGas: '1', coordinator: simpleCoordinatorFunding })).toBe('121')
	})

	test('fails closed when an anchored coordinator getter disagrees with its immutable inputs', () => {
		const observation = {
			baseFeePerGas: '1',
			coordinator: simpleCoordinatorFunding,
			minimumToken1ReportAttoEth: 4n.toString(),
			requestPriceCostAttoEth: 121n.toString(),
			settlementCollateralAttoEth: 100n.toString(),
		}
		expect(() => assertAnchoredOracleRequestFunding(observation)).not.toThrow()
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, minimumToken1ReportAttoEth: 5n.toString() })).toThrow('minimum oracle report does not match')
		expect(() => assertAnchoredOracleRequestFunding({ ...observation, requestPriceCostAttoEth: 122n.toString() })).toThrow('request-price cost does not match')
	})

	test('derives the exact inclusion bound from the signed transaction maximum fee', () => {
		expect(
			oracleRequestFundingBounds({
				anchorBaseFeePerGas: '1',
				coordinator: simpleCoordinatorFunding,
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralAttoEth: 100n.toString(),
			}),
		).toEqual({
			maximumBaseFeePerGas: '2000000046',
			maximumEscalationHaltAttoEth: 4_000_000_094n.toString(),
			maximumInitialAttoRep: 4_000_000_094n.toString(),
			maximumInitialAttoWeth: '4000000094',
			maximumRequestPriceCostAttoEth: 40_000_001_021n.toString(),
		})
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
			maximumBaseFeePerGas: '45454545454540',
			maximumEscalationHaltAttoEth: 90_909_090_909_082n.toString(),
			maximumInitialAttoRep: 90_909_090_909_082n.toString(),
			maximumInitialAttoWeth: '90909090909082',
			maximumRequestPriceCostAttoEth: 909_090_909_090_901n.toString(),
		})
		const nextBaseFee = oracleRequestFundingForMaximumBaseFee({
			coordinator: simpleCoordinatorFunding,
			maximumBaseFeePerGas: (BigInt(envelope.maximumBaseFeePerGas) + 1n).toString(),
			proposedRepPerEthPrice: (10n ** 18n).toString(),
			settlementCollateralAttoEth: 0n.toString(),
		})
		expect(BigInt(nextBaseFee.maximumInitialAttoWeth) + BigInt(nextBaseFee.maximumRequestPriceCostAttoEth)).toBeGreaterThan(10n ** 15n)
	})

	test('includes the collateral ceiling and validates a persisted envelope against current state', () => {
		const envelope = oracleRequestFundingEnvelope({
			coordinator: simpleCoordinatorFunding,
			maximumEthPrincipalAttoEth: 1_000n.toString(),
			maximumNativePrincipalAttoEth: 1_000n.toString(),
			maximumRepPrincipalAttoRep: 1_000n.toString(),
			maximumWethPrincipalAttoEth: 1_000n.toString(),
			proposedRepPerEthPrice: (10n ** 18n).toString(),
			settlementCollateralCeilingAttoEth: 50_000n.toString(),
		})
		expect(envelope).toEqual({
			maximumBaseFeePerGas: '19',
			maximumEscalationHaltAttoEth: 502n.toString(),
			maximumInitialAttoRep: 502n.toString(),
			maximumInitialAttoWeth: '502',
			maximumRequestPriceCostAttoEth: 481n.toString(),
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
				maximumEthPrincipalAttoEth: 124n.toString(),
				maximumNativePrincipalAttoEth: 124n.toString(),
				maximumRepPrincipalAttoRep: 4n.toString(),
				maximumWethPrincipalAttoEth: 124n.toString(),
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralCeilingAttoEth: 0n.toString(),
			}),
		).toThrow('cannot support a positive maximum base fee')
	})

	test('rejects bounds that cannot fit the coordinator report fields', () => {
		const uint128Maximum = (1n << 128n) - 1n
		expect(() =>
			oracleRequestFundingBounds({
				anchorBaseFeePerGas: '1',
				coordinator: simpleCoordinatorFunding,
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralAttoEth: ((uint128Maximum + 1n) * 100n).toString(),
			}),
		).toThrow('WETH report exceeds uint128')
		expect(() =>
			oracleRequestFundingBounds({
				anchorBaseFeePerGas: (1n << 94n).toString(),
				coordinator: simpleCoordinatorFunding,
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralAttoEth: 0n.toString(),
			}),
		).toThrow('settler reward exceeds uint96')
	})

	test('rejects immutable funding inputs that the coordinator constructor forbids', () => {
		const uint128Maximum = (1n << 128n) - 1n
		expect(() =>
			oracleRequestFundingEnvelope({
				coordinator: {
					...simpleCoordinatorFunding,
					initialReportPriorityFeeAttoEthPerGas: (uint128Maximum / 4n + 1n).toString(),
				},
				maximumEthPrincipalAttoEth: uint128Maximum.toString(),
				maximumNativePrincipalAttoEth: uint128Maximum.toString(),
				maximumRepPrincipalAttoRep: uint128Maximum.toString(),
				maximumWethPrincipalAttoEth: uint128Maximum.toString(),
				proposedRepPerEthPrice: (10n ** 18n).toString(),
				settlementCollateralCeilingAttoEth: 0n.toString(),
			}),
		).toThrow('initialReportPriorityFeeAttoEthPerGas exceeds OpenOracle limits')
	})

	test('replaces stale oversized allowances and declares the full inclusion debit bound', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		snapshot.anchor.baseFeePerGas = '1'
		pool.oraclePriceValid = false
		pool.oracleRequestFunding = { ...simpleCoordinatorFunding }
		pool.minimumToken1ReportAttoEth = '4'
		pool.requestPriceCostAttoEth = '121'
		pool.projectedSettlementCollateralAttoEth = '100'
		pool.settlementCollateralAttoEth = '100'
		for (const token of snapshot.wallet.tokens) token.allowances[pool.coordinator] = (10n ** 30n).toString()

		const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
		if (plan === undefined) throw new Error('Request-price plan missing')
		expect(plan.steps).toHaveLength(3)

		for (const approval of plan.steps.slice(0, 2)) {
			const decoded = decodeFunctionData({ abi: erc20Abi, data: approval.data })
			expect(decoded.functionName).toBe('approve')
			expect(decoded.args).toEqual([pool.coordinator, 90_909_090_909_082n])
		}

		const request = plan.steps[2]
		if (request === undefined) throw new Error('Request-price step missing')
		const decoded = decodeFunctionData({ abi: coordinatorAbi, data: request.data })
		expect(decoded.functionName).toBe('requestPrice')
		expect(decoded.args[1]).toBe(90_909_090_909_082n)
		expect(request.value).toBe('909090909090901')
		expect(plan.lastValidBlockNumber).toBeUndefined()
		expect(plan.terminalSubmission).toEqual({ kind: 'private-next-block', maximumFeePerGas: '45454545454540' })
		expect(plan.metadata).toMatchObject({
			maximumBaseFeePerGas: '45454545454540',
			maximumInitialAttoRep: 90_909_090_909_082n.toString(),
			maximumInitialAttoWeth: '90909090909082',
			maximumRequestPriceCostAttoEth: 909_090_909_090_901n.toString(),
			preparedAtBlock: snapshot.anchor.blockNumber,
			settlementCollateralCeilingAttoEth: 9_090_909_090_908_000n.toString(),
		})
		expect(request.walletAssetDebits).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ amount: '909090909090901', asset: 'ETH', kind: 'native' }),
				expect.objectContaining({ amount: '90909090909082', asset: snapshot.deployments.weth, category: 'weth', kind: 'erc20' }),
				expect.objectContaining({ amount: '90909090909082', asset: pool.repToken, category: 'rep', kind: 'erc20' }),
			]),
		)
		expect(request.evidence).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ emitter: snapshot.deployments.weth, equals: '90909090909082', field: 'value', indexed: { from: snapshot.wallet.address, to: pool.coordinator }, kind: 'decoded-event-field' }),
				expect.objectContaining({ emitter: pool.repToken, equals: '90909090909082', field: 'value', indexed: { from: snapshot.wallet.address, to: pool.coordinator }, kind: 'decoded-event-field' }),
				expect.objectContaining({ contract: snapshot.deployments.weth, expected: '0', functionName: 'allowance', kind: 'storage-postcondition' }),
				expect.objectContaining({ contract: pool.repToken, expected: '0', functionName: 'allowance', kind: 'storage-postcondition' }),
			]),
		)
	})

	test('makes an invalid funding candidate ineligible without aborting catalog evaluation', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		snapshot.anchor.baseFeePerGas = '1'
		pool.oraclePriceValid = false
		pool.oracleRequestFunding = { ...simpleCoordinatorFunding }
		pool.minimumToken1ReportAttoEth = '4'
		pool.requestPriceCostAttoEth = '121'
		pool.projectedSettlementCollateralAttoEth = '100'
		pool.settlementCollateralAttoEth = '100'

		pool.oracleRequestFunding.gasUnitsForOneDispute = '0'
		const blocked = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
		expect(blocked).toBeUndefined()
	})

	test('shrinks the funding envelope to available token inventory instead of rejecting a feasible request', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		snapshot.anchor.baseFeePerGas = '1'
		pool.oraclePriceValid = false
		pool.oracleRequestFunding = { ...simpleCoordinatorFunding }
		pool.minimumToken1ReportAttoEth = '4'
		pool.requestPriceCostAttoEth = '121'
		pool.settlementCollateralAttoEth = '100'
		const weth = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === snapshot.deployments.weth.toLowerCase())
		const rep = snapshot.wallet.tokens.find(token => token.address.toLowerCase() === pool.repToken.toLowerCase())
		if (weth === undefined || rep === undefined) throw new Error('Funding inventory missing')
		weth.balance = (10n ** 12n).toString()
		rep.balance = (10n ** 18n + 10n ** 12n).toString()

		const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
		expect(plan).toBeDefined()
		expect(plan?.metadata['maximumInitialAttoWeth']).toBe((10n ** 12n).toString())
		expect(plan?.metadata['maximumInitialAttoRep']).toBe((10n ** 12n).toString())
		expect(plan?.metadata['maximumBaseFeePerGas']).toBe('499999999999')
	})

	test('reuses a persisted envelope after approval finality and cleans up when it becomes unsafe', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		snapshot.anchor.baseFeePerGas = '1'
		pool.oraclePriceValid = false
		pool.oracleRequestFunding = { ...simpleCoordinatorFunding }
		pool.minimumToken1ReportAttoEth = '4'
		pool.requestPriceCostAttoEth = '121'
		pool.settlementCollateralAttoEth = '100'
		const initial = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.oracle.request-price')
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
		expect(decodeFunctionData({ abi: erc20Abi, data: remainingApproval.data }).args).toEqual([pool.coordinator, BigInt(initialRepAttoRep)])
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
		pool.settlementCollateralAttoEth = collateralCeiling
		const collateralGrowthContinuation = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(collateralGrowthContinuation.plan?.steps.map(step => step.id)).toEqual(['request-price'])
		pool.settlementCollateralAttoEth = (BigInt(collateralCeiling) + 1n).toString()
		const excessiveCollateralCleanup = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(excessiveCollateralCleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		pool.settlementCollateralAttoEth = '100'

		pool.pendingReportId = '7'
		const cleanup = reevaluateOperationContinuation(snapshot, initial, options, { confirmedStepIds: initial.steps.slice(0, 2).map(step => step.id) })
		expect(cleanup.plan?.continuationDisposition).toBe('cleanup-only')
		expect(cleanup.plan?.steps.map(step => step.id).sort()).toEqual(['revoke-oracle-rep', 'revoke-oracle-weth'])
		expect(cleanup.plan?.terminalSubmission).toBeUndefined()
		expect(cleanup.plan?.metadata).toEqual(initial.metadata)
		for (const step of cleanup.plan?.steps ?? []) {
			const decoded = decodeFunctionData({ abi: erc20Abi, data: step.data })
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
