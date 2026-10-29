import { expect, test } from 'bun:test'
import { portfolioCurePlan } from '../../src/core/portfolio-cure.ts'
import { executePortfolioCure, executePortfolioEarnings, type simulatePortfolioCureReward } from '../../src/execution/portfolio-cure.ts'
import type { refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import type { submitCall } from '../../src/execution/liquidation-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'
import { createWalletClient, createRpcEndpointPool, decodeFunctionData, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'

function fixture() {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.runtime.execute = true
	observation.snapshot.demandAttoEth = 50n * unit
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture target missing')
	const target = { auction: observation.selection.address, bidId: 99n, vault: position.owner }
	position.auctionTarget = target
	position.id = 99n
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	observation.snapshot.owner = account.address
	const wallet = createWalletClient({
		account,
		chain: mainnet,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected RPC')
			},
		}),
	})
	const pool = createRpcEndpointPool(['https://read.example'])
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [observation.nextScope]
	const refresh: typeof refreshPortfolioExecution = async () => ({ observation, totalPrincipal: 0n, allowance: 0n })
	let reward = unit / 10n
	let removed = unit
	const simulate: typeof simulatePortfolioCureReward = async () => ({ reward, removed })
	const calls: Parameters<typeof submitCall>[4][] = []
	const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
		await call.preSubmit?.()
		calls.push(call)
		return `0x${'1'.repeat(64)}`
	}
	const run = () => executePortfolioCure(wallet, settings, state, pool, observation, target, async () => true, { refresh, simulate, submit })
	return {
		observation,
		settings,
		position,
		target,
		wallet,
		pool,
		state,
		refresh,
		simulate,
		submit,
		calls,
		run,
		quote: (newReward: bigint, newRemoved = unit) => {
			reward = newReward
			removed = newRemoved
		},
	}
}

test('paid cure sends a single combined bid materialization and progress call with no capital funding', async () => {
	const f = fixture()
	expect(portfolioCurePlan(f.observation, f.position, f.settings, true)?.removed).toBeGreaterThan(0n)
	await f.run()
	expect(f.calls).toHaveLength(1)
	const call = f.calls[0]
	if (call === undefined) throw new Error('Cure missing')
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: call.data })).toEqual({
		functionName: 'cureAuctionBid',
		args: [99n, { expectedTotalCommitment: 100n * unit, expectedDemand: 50n * unit, expectedAcceptedPriceEpoch: 3n, minimumRemoved: unit, minimumReward: (3n * unit) / 1000n }],
	})
	expect(call.value).toBe(0n)
	f.quote(0n)
	await expect(call.preSubmit?.()).rejects.toThrow('cover cure, claim')
	f.quote(unit / 10n)
	f.observation.acceptedPriceEpoch++
	await expect(call.preSubmit?.()).rejects.toThrow('Cure state or minimum reward changed')
})

test('unpaid, zero-progress, over-reserve and already materialized cures never submit', async () => {
	for (const [reward, removed] of [
		[0n, unit],
		[unit / 10n, 0n],
		[2n * unit, unit],
	]) {
		const f = fixture()
		if (reward === undefined || removed === undefined) throw new Error('Invalid quote')
		f.quote(reward, removed)
		await expect(f.run()).rejects.toThrow('Simulated cure reward')
		expect(f.calls).toHaveLength(0)
	}
	const f = fixture()
	delete f.position.auctionTarget
	await expect(f.run()).rejects.toThrow('materialized or removed')
	expect(f.calls).toHaveLength(0)
})

test('cure progress and wallet budget respect ordinary floor, market evidence and pending recovery', async () => {
	const f = fixture()
	expect(portfolioCurePlan(f.observation, f.position, f.settings, false)).toBeUndefined()
	f.observation.walletAttoEth = 0n
	expect(portfolioCurePlan(f.observation, f.position, f.settings, true)).toBeUndefined()
	f.observation.walletAttoEth = unit
	f.observation.snapshot.demandAttoEth = f.observation.snapshot.totalCommitmentAttoEth - 1n
	expect(portfolioCurePlan(f.observation, f.position, f.settings, true)).toBeUndefined()
	f.state.pendingStagedOperations.push({ coordinator: f.observation.snapshot.capitalLedger, operationId: 1n, queuedBlock: 1n, target: f.position.owner })
	await expect(f.run()).rejects.toThrow('Pending recovery')
})

test('keeper pull credits are claimed in a later single transaction only when claim cost is covered', async () => {
	const f = fixture()
	await expect(executePortfolioEarnings(f.wallet, f.settings, f.state, f.pool, f.observation, f)).rejects.toThrow('cover claim gas')
	f.observation.snapshot.ownerAccount.feesAttoEth = unit
	await executePortfolioEarnings(f.wallet, f.settings, f.state, f.pool, f.observation, f)
	expect(f.calls).toHaveLength(1)
	const call = f.calls[0]
	if (call === undefined) throw new Error('Claim missing')
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: call.data }).functionName).toBe('claimEarnings')
})
