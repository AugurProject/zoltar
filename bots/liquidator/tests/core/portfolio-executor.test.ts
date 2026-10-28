import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { portfolioClient } from '../support/portfolio-client.ts'
import { expect, test } from 'bun:test'
import { executePortfolioTakeover, refreshPortfolioExecution } from '../../src/execution/portfolio-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { createWalletClient, createRpcEndpointPool, decodeFunctionData, parseAbiItem, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import type { submitCall } from '../../src/execution/liquidation-executor.ts'
import { portfolioObservation, portfolioSettings, unit } from '../support/portfolio-observation.ts'

const abi = [
	parseAbiItem('function depositFor(address owner,uint256 amount)'),
	parseAbiItem('function fundExecutionReserve(address owner) payable'),
	parseAbiItem('function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns (uint96)'),
] as const
const confirmed: Hex = `0x${'1'.repeat(64)}`
function fixture() {
	const observation = portfolioObservation()
	const settings = portfolioSettings()
	settings.runtime.execute = true
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	observation.snapshot.owner = account.address
	const wallet = createWalletClient({
		chain: mainnet,
		account,
		transport: custom({
			request: async () => {
				throw new Error('Unexpected network operation')
			},
		}),
	})
	const state = initialRuntimeState(false, account.address, 1)
	state.portfolioScopes = [observation.nextScope]
	const pool = createRpcEndpointPool(['https://read.example'])
	const calls: Parameters<typeof submitCall>[4][] = []
	let allowance = 0n
	let refreshes = 0
	let mutate = () => {}
	const refresh: typeof refreshPortfolioExecution = async () => {
		refreshes++
		if (refreshes > 1) mutate()
		return { observation, totalPrincipal: observation.snapshot.ownerPrincipalAttoRep, allowance }
	}
	const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
		await call.preSubmit?.()
		await call.preSubmit?.()
		calls.push(call)
		return confirmed
	}
	const run = async () => {
		refreshes = 0
		await executePortfolioTakeover(wallet, settings, state, pool, observation, 1n, async () => true, { refresh, submit })
	}
	return {
		observation,
		wallet,
		pool,
		settings,
		state,
		calls,
		run,
		setAllowance: (value: bigint) => {
			allowance = value
		},
		setMutation: (value: () => void) => {
			mutate = value
		},
	}
}

test('portfolio lifecycle sends only one exact approval, deposit, reserve funding or bounded acquisition per cycle', async () => {
	const fixtureValue = fixture()
	await fixtureValue.run()
	const first = fixtureValue.calls[0]
	if (first === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi: erc20Abi, data: first.data })).toEqual({ functionName: 'approve', args: [fixtureValue.observation.snapshot.capitalLedger, (585n * unit) / 10n] })
	expect(fixtureValue.calls).toHaveLength(1)
	fixtureValue.setAllowance(1000n * unit)
	await fixtureValue.run()
	const second = fixtureValue.calls[1]
	if (second === undefined) throw new Error('Missing deposit')
	expect(decodeFunctionData({ abi, data: second.data })).toMatchObject({ functionName: 'depositFor', args: [fixtureValue.observation.snapshot.owner, (585n * unit) / 10n] })
	fixtureValue.observation.snapshot.ownerPrincipalAttoRep = (585n * unit) / 10n
	fixtureValue.observation.snapshot.ownerAccount.freeAttoRep = (585n * unit) / 10n
	await fixtureValue.run()
	const third = fixtureValue.calls[2]
	if (third === undefined) throw new Error('Missing reserve funding')
	expect(decodeFunctionData({ abi, data: third.data }).functionName).toBe('fundExecutionReserve')
	expect(third.value).toBe(unit / 10n)
	fixtureValue.observation.snapshot.ownerAccount.executionReserveAttoEth = unit / 10n
	await fixtureValue.run()
	const fourth = fixtureValue.calls[3]
	if (fourth === undefined) throw new Error('Missing acquisition')
	expect(decodeFunctionData({ abi, data: fourth.data })).toMatchObject({
		functionName: 'takeOverWithBounds',
		args: [1n, 100n * unit, 99n * unit, (585n * unit) / 10n, { maximumOwnerPrincipal: 1000n * unit, maximumOwnerCommitment: 1000n * unit, expectedTargetHealthFactorBps: 15_000n, expectedAcceptedPriceEpoch: 3n, expectedSourceBatch: 0n }],
	})
	expect(fixtureValue.calls).toHaveLength(4)
})

test('post-approval revalidation rejects deteriorated reserve, stale price epoch, or policy changes before signing', async () => {
	const changed = fixture()
	changed.setMutation(() => {
		changed.observation.snapshot.ownerAccount.targetHealthFactorBps = 10_000n
	})
	await expect(changed.run()).rejects.toThrow('health target')
	expect(changed.calls).toHaveLength(0)
	const epoch = fixture()
	epoch.setMutation(() => {
		epoch.observation.acceptedPriceEpoch++
	})
	await expect(epoch.run()).rejects.toThrow('epoch changed')
	expect(epoch.calls).toHaveLength(0)
	const stopped = fixture()
	stopped.settings.portfolioPolicy.allowFundedTakeovers = false
	await expect(stopped.run()).rejects.toThrow('disabled')
	expect(stopped.calls).toHaveLength(0)
	const recovery = fixture()
	recovery.state.pendingStagedOperations.push({ coordinator: recovery.observation.snapshot.capitalLedger, operationId: 1n, queuedBlock: 1n, target: recovery.observation.snapshot.owner })
	await expect(recovery.run()).rejects.toThrow('recovery')
	expect(recovery.calls).toHaveLength(0)
})

test('ordinary portfolio opportunity drift is classified for retry without submission', async () => {
	const changed = fixture()
	changed.setMutation(() => {
		changed.observation.snapshot.ownerAccount.targetHealthFactorBps = 10_000n
	})
	const error = await changed.run().then(
		() => undefined,
		error => error,
	)
	expect(error?.name).toBe('PortfolioOpportunityExpired')
	expect(changed.calls).toHaveLength(0)
})

test('runtime retries a healed target without pausing settings or creating an intent', async () => {
	const changed = fixture()
	const directory = await mkdtemp(join(tmpdir(), 'portfolio-expired-'))
	changed.settings.runtime.stateFile = join(directory, 'state.json')
	changed.settings.runtime.once = false
	changed.settings.paused = false
	changed.setMutation(() => {
		const position = changed.observation.positions[0]
		if (position === undefined) throw new Error('Missing fixture target')
		position.maxHealthyPrice = changed.observation.snapshot.liquidationPrice
	})
	try {
		const error = await changed.run().then(
			() => undefined,
			error => error,
		)
		expect(error?.name).toBe('PortfolioOpportunityExpired')
		expect(await settleInterruptedCycle({ settings: changed.settings }, { state: changed.state, shutdown: { isRequested: () => false } }, error)).toBe(false)
		expect(changed.settings.paused).toBe(false)
		expect(changed.state.paused).toBe(false)
		expect(changed.state.status).toBe('running')
		expect(changed.calls).toHaveLength(0)
		expect(changed.state.pendingTransactions).toHaveLength(0)
		// Authentication and quorum faults must still reach the persistent safety-pause path.
		expect(await settleInterruptedCycle({ settings: changed.settings }, { state: changed.state, shutdown: { isRequested: () => false } }, new Error('Portfolio runtime mismatch'))).toBeUndefined()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('portfolio final refresh reads one agreed height across staggered RPC heads', async () => {
	const f = fixture()
	const fixtures = [portfolioClient({ allowance: 0n }), portfolioClient({ allowance: 0n })]
	f.settings.connectivity.rpcQuorum = 2
	const readers = fixtures.map((fixtureValue, index) => ({
		endpoint: `https://rpc${index}.example`,
		client: new Proxy(fixtureValue.client, {
			get(target, property) {
				if (property === 'getBlock')
					return async (parameters?: { blockNumber?: bigint }) => {
						const number = parameters?.blockNumber ?? (index === 0 ? 124n : 123n)
						return { number, hash: fixtureValue.observation.snapshot.blockHash, timestamp: 3700n }
					}
				return Reflect.get(target, property, target)
			},
		}),
	}))
	const result = await refreshPortfolioExecution(f.wallet, f.settings, f.state.portfolioScopes, f.pool, f.observation, 1n, readers)
	expect(result.observation.snapshot.blockNumber).toBe(123n)
	for (const fixtureValue of fixtures) expect(fixtureValue.reads.every(read => read.blockNumber === 123n)).toBe(true)
})
