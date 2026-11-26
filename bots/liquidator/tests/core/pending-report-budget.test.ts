import { loadSponsoredOperationReport } from '../../src/monitoring/security-pool-report.ts'
import { totalManagedPrincipalAttoRep } from '../../src/core/security-pool-exposure.ts'
import { securityPoolTakeoverPlan } from '../../src/core/security-pool-strategy.ts'
import { securityPoolObservation } from '../support/security-pool-observation.ts'
import { openOracleAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { expect, test } from 'bun:test'
import { createRpcEndpointPool, createWalletClient, encodeFunctionData, privateKeyToAccount, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { decodeFunctionResult, encodeAbiParameters, mainnet } from '@zoltar/core-shared/evm/ethereum'
import { executePendingSecurityPoolReport } from '../../src/execution/security-pool-report.ts'
import { SecurityPoolOpportunityExpired } from '../../src/execution/security-pool-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { securityPoolClient } from '../support/security-pool-client.ts'
import type { SecurityPoolObservation } from '../../src/monitoring/security-pool-monitor.ts'
import { ownerAddress, targetAddress } from '../support/security-pool-observation.ts'

// The fixture snapshot is at timestamp 3700 and the report observation at 1 + 480.
const freshWindow = 10_000n
const staleWindow = 780n

test.each([
	{ settledAt: 0n, baseFee: 1n, validityWindow: freshWindow },
	{ settledAt: 3600n, baseFee: 1n, validityWindow: freshWindow },
	{ settledAt: 0n, baseFee: 11n, validityWindow: freshWindow },
	{ settledAt: 3600n, baseFee: 11n, validityWindow: freshWindow },
	{ settledAt: 3600n, baseFee: 11n, validityWindow: staleWindow },
])('sponsored report gas budget defers settlement or recovery without a safety pause (settled %s)', async ({ settledAt, baseFee, validityWindow }) => {
	const stale = settledAt !== 0n && 1n + 480n + validityWindow <= 3700n
	const gameAbi = openOracleAbi.find(item => item.type === 'function' && item.name === 'storedGame')
	if (gameAbi === undefined || gameAbi.type !== 'function') throw new Error('Stored game ABI missing')
	const pending: NonNullable<SecurityPoolObservation['pendingOperationReport']> = {
		id: 7n,
		oracle: targetAddress,
		reservedRep: 0n,
		exposureKnown: true,
		maxSettlementBaseFee: 10n,
		staleAt: 1n + 480n + validityWindow,
		game: decodeFunctionResult({ abi: openOracleAbi, functionName: 'storedGame', data: encodeAbiParameters(gameAbi.outputs, [1n, 1n, targetAddress, 1n, settledAt, ownerAddress, 0n, 480n, 0n, zeroAddress, 101n, targetAddress, 1n, 0n, 0n, 100n, targetAddress, 7_000_000n, 0n, 1n]) }),
		helper: Object.assign([targetAddress, 0n, 0n] as const, { creator: targetAddress, blockTimestamp: 0n, blockNumber: 0n }),
	}
	const f = securityPoolClient({
		sponsorOperationReport: 7n,
		reportOutcome: 0n,
		reportCandidates: [targetAddress, ownerAddress, 10n],
		baseFeePerGas: baseFee,
		openOracle: targetAddress,
		storedGame: pending.game,
		storedHelper: pending.helper,
		tokenHolder: 0n,
		priceValidityWindowSeconds: validityWindow,
	})
	f.settings.runtime.execute = true
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected wallet RPC')
			},
		}),
	})
	// The approved owner must match the indexed report sponsor.
	f.values['reportCandidates'] = [targetAddress, account.address, 10n]
	const state = initialRuntimeState(false, account.address, 1)
	state.securityPoolScopes = [f.observation.nextScope]
	f.observation.pendingOperationReport = pending
	let submitted = false
	const execution = executePendingSecurityPoolReport(
		wallet,
		f.settings,
		state,
		createRpcEndpointPool(['https://read.example']),
		f.observation,
		async (_wallet, _settings, _state, _pool, call) => {
			submitted = true
			// Recovery may execute canonical operations, including for rejected stale candidates.
			expect(call.maxFeePerGasCap).toBe(10n)
			const settledLabel = 'Recover settled sponsored report'
			expect(call.label).toBe(settledAt === 0n ? 'Settle sponsored takeover report' : settledLabel)
			if (stale) expect(call.data).toBe(encodeFunctionData({ abi: sharedPoolPriceFeedAbi, functionName: 'recoverReport', args: [7n] }))
			call.gasBudgetExceeded?.()
			throw new Error('Gas budget failure would safety-pause')
		},
		[{ endpoint: 'https://read.example', client: f.client }],
	)
	if (baseFee > 10n) {
		expect(await execution).toBe('waiting')
		expect(submitted).toBe(false)
	} else {
		await expect(execution).rejects.toBeInstanceOf(SecurityPoolOpportunityExpired)
		expect(submitted).toBe(true)
	}
	expect(state.paused).toBe(false)
})

test('#1645 unpriced first-report WETH makes aggregate exposure unknown and blocks another pool acquisition', async () => {
	const gameAbi = openOracleAbi.find(item => item.type === 'function' && item.name === 'storedGame')
	if (gameAbi === undefined || gameAbi.type !== 'function') throw new Error('Stored game ABI missing')
	const f = securityPoolClient({
		sponsorOperationReport: 7n,
		reportOutcome: 0n,
		reportCandidates: [targetAddress, ownerAddress, 10n],
		openOracle: targetAddress,
		storedGame: decodeFunctionResult({ abi: openOracleAbi, functionName: 'storedGame', data: encodeAbiParameters(gameAbi.outputs, [10n ** 18n, 1n, targetAddress, 1n, 0n, ownerAddress, 0n, 480n, 0n, zeroAddress, 101n, targetAddress, 1n, 0n, 0n, 100n, targetAddress, 7_000_000n, 0n, 1n]) }),
		storedHelper: Object.assign([targetAddress, 0n, 0n] as const, { creator: targetAddress, blockTimestamp: 0n, blockNumber: 0n }),
		tokenHolder: 1n,
		priceValidityWindowSeconds: 10000n,
	})
	f.observation.snapshot.acceptedPrice = 0n
	f.observation.pendingOperationReport = await loadSponsoredOperationReport(f.client, f.observation.snapshot)
	expect(f.observation.pendingOperationReport?.exposureKnown).toBe(false)
	const other = securityPoolObservation()
	const total = totalManagedPrincipalAttoRep([f.observation, other])
	expect(total).toBeUndefined()
	const position = other.positions[0]
	if (position === undefined) throw new Error('Missing takeover fixture')
	expect(securityPoolTakeoverPlan(other, position, f.settings, 0n, true).plan).toBeDefined()
	expect(securityPoolTakeoverPlan(other, position, f.settings, total, true)).toMatchObject({ reason: 'Managed principal exposure is unknown' })
	f.observation.snapshot.acceptedPrice = 10n ** 18n
	f.observation.pendingOperationReport = await loadSponsoredOperationReport(f.client, f.observation.snapshot)
	expect(f.observation.pendingOperationReport?.reservedRep).toBeGreaterThan(0n)
	expect(totalManagedPrincipalAttoRep([f.observation, other])).toBeDefined()
})
