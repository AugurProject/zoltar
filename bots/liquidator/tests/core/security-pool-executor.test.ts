import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { securityPoolClient } from '../support/security-pool-client.ts'
import { expect, test } from 'bun:test'
import { executeSecurityPoolTakeover, refreshSecurityPoolExecution } from '../../src/execution/security-pool-executor.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { createWalletClient, createRpcEndpointPool, decodeFunctionData, parseAbiItem, privateKeyToAccount, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { erc20Abi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import type { submitCall } from '../../src/execution/submit-call.ts'
import { securityPoolObservation, securityPoolSettings, unit } from '../support/security-pool-observation.ts'

const abi = [
	parseAbiItem('function depositFor(address owner,uint256 amount)'),
	parseAbiItem('function takeOverWithBounds(uint96 id,uint256 commitment,uint256 minimumAward,uint256 maximumOwnRep,(uint256 maximumOwnerPrincipal,uint256 maximumOwnerCommitment,uint256 expectedTargetHealthFactorBps,uint256 expectedAcceptedPriceEpoch,uint96 expectedSourceBatch) bounds) returns (uint96)'),
] as const
const confirmed: Hex = `0x${'1'.repeat(64)}`
function fixture() {
	const observation = securityPoolObservation()
	const settings = securityPoolSettings()
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
	state.securityPoolScopes = [observation.nextScope]
	const pool = createRpcEndpointPool(['https://read.example'])
	const calls: Parameters<typeof submitCall>[4][] = []
	let allowance = 0n
	let refreshes = 0
	let mutate = () => {}
	const refresh: typeof refreshSecurityPoolExecution = async () => {
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
		await executeSecurityPoolTakeover(wallet, settings, state, pool, observation, 1n, async () => true, { refresh, submit })
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

test('security pool lifecycle needs only REP approval, deposit and bounded acquisition without ETH funding', async () => {
	const fixtureValue = fixture()
	await fixtureValue.run()
	const first = fixtureValue.calls[0]
	if (first === undefined) throw new Error('Missing approval')
	expect(decodeFunctionData({ abi: erc20Abi, data: first.data })).toEqual({ functionName: 'approve', args: [fixtureValue.observation.snapshot.capitalLedger, 157_500_000_000_000_000_000n] })
	expect(fixtureValue.calls).toHaveLength(1)
	fixtureValue.setAllowance(1000n * unit)
	await fixtureValue.run()
	const second = fixtureValue.calls[1]
	if (second === undefined) throw new Error('Missing deposit')
	expect(decodeFunctionData({ abi, data: second.data })).toMatchObject({ functionName: 'depositFor', args: [fixtureValue.observation.snapshot.owner, 58_500_000_000_000_000_000n] })
	fixtureValue.observation.snapshot.ownerPrincipalAttoRep = 58_500_000_000_000_000_000n
	fixtureValue.observation.snapshot.ownerAccount.freeAttoRep = 58_500_000_000_000_000_000n
	await fixtureValue.run()
	const third = fixtureValue.calls[2]
	if (third === undefined) throw new Error('Missing acquisition')
	expect(decodeFunctionData({ abi, data: third.data })).toMatchObject({
		functionName: 'takeOverWithBounds',
		args: [1n, 100n * unit, 99n * unit, 58_500_000_000_000_000_000n, { maximumOwnerPrincipal: 1000n * unit, maximumOwnerCommitment: 1000n * unit, expectedTargetHealthFactorBps: 15_000n, expectedAcceptedPriceEpoch: 3n, expectedSourceBatch: 0n }],
	})
	expect(fixtureValue.calls).toHaveLength(3)
})

test('a healing cure is one transaction that asks for no award, consents to no exposure and leaves takeover funding recorded', async () => {
	const fixtureValue = fixture()
	const { observation } = fixtureValue
	const position = observation.positions[0]
	if (position === undefined) throw new Error('Fixture position missing')
	// Two targets; the spare covers either deficit but not both, so curing the first opens the second.
	position.rep = 100n * unit
	observation.positions.push({ ...position, id: 2n })
	observation.snapshot.totalCommitmentAttoEth = 200n * unit
	observation.snapshot.demandAttoEth = 195n * unit
	await fixtureValue.run()
	expect(fixtureValue.calls).toHaveLength(1)
	const call = fixtureValue.calls[0]
	if (call === undefined) throw new Error('Missing cure')
	expect(decodeFunctionData({ abi, data: call.data })).toMatchObject({
		functionName: 'takeOverWithBounds',
		args: [1n, 100n * unit, 0n, 0n, { maximumOwnerPrincipal: 0n, maximumOwnerCommitment: 0n, expectedTargetHealthFactorBps: 15_000n, expectedAcceptedPriceEpoch: 3n, expectedSourceBatch: 0n }],
	})
	expect(call.label).toBe('Cure security pool position 1 without an award')
	expect(call.securityPoolFunding).toBeUndefined()
	// If the spare is gone before signing, the target is a paid takeover and the cure is not sent.
	const drifted = fixture()
	const target = drifted.observation.positions[0]
	if (target === undefined) throw new Error('Fixture position missing')
	target.rep = 100n * unit
	drifted.observation.positions.push({ ...target, id: 2n })
	drifted.observation.snapshot.totalCommitmentAttoEth = 200n * unit
	drifted.observation.snapshot.demandAttoEth = 195n * unit
	drifted.setMutation(() => {
		drifted.observation.snapshot.demandAttoEth = 200n * unit
	})
	await expect(drifted.run()).rejects.toThrow('changed before submission')
	expect(drifted.calls).toHaveLength(0)
})

test('post-approval revalidation rejects deteriorated collateral, stale price epoch, or policy changes before signing', async () => {
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
	stopped.settings.securityPoolPolicy.allowFundedTakeovers = false
	await expect(stopped.run()).rejects.toThrow('disabled')
	expect(stopped.calls).toHaveLength(0)
	const recovery = fixture()
	recovery.state.pendingTransactions.push({
		hash: `0x${'ab'.repeat(32)}`,
		kind: 'deposit',
		label: 'Pending deposit',
		maxBlockNumber: 120n,
		mode: 'public',
		nonce: 1n,
		receiptExpectation: { type: 'transaction' },
		requiresMarketEvidence: false,
		sender: recovery.observation.snapshot.owner,
		serializedTransaction: '0x',
		submissionBlock: 1n,
	})
	await expect(recovery.run()).rejects.toThrow('recovery')
	expect(recovery.calls).toHaveLength(0)
})

test('ordinary security pool opportunity drift is classified for retry without submission', async () => {
	const changed = fixture()
	changed.setMutation(() => {
		changed.observation.snapshot.ownerAccount.targetHealthFactorBps = 10_000n
	})
	const error = await changed.run().then(
		() => undefined,
		error => error,
	)
	expect(error?.name).toBe('SecurityPoolOpportunityExpired')
	expect(changed.calls).toHaveLength(0)
})

test('runtime retries a healed target without pausing settings or creating an intent', async () => {
	const changed = fixture()
	const directory = await mkdtemp(join(tmpdir(), 'security-pool-expired-'))
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
		expect(error?.name).toBe('SecurityPoolOpportunityExpired')
		expect(await settleInterruptedCycle({ settings: changed.settings }, { state: changed.state, shutdown: { isRequested: () => false } }, error)).toBe(false)
		expect(changed.settings.paused).toBe(false)
		expect(changed.state.paused).toBe(false)
		expect(changed.state.status).toBe('running')
		expect(changed.calls).toHaveLength(0)
		expect(changed.state.pendingTransactions).toHaveLength(0)
		// Authentication and quorum faults must still reach the persistent safety-pause path.
		expect(await settleInterruptedCycle({ settings: changed.settings }, { state: changed.state, shutdown: { isRequested: () => false } }, new Error('Security pool runtime mismatch'))).toBeUndefined()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})

test('security pool final refresh reads one agreed height across staggered RPC heads', async () => {
	const f = fixture()
	const fixtures = [securityPoolClient({ allowance: 0n }), securityPoolClient({ allowance: 0n })]
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
	const result = await refreshSecurityPoolExecution(f.wallet, f.settings, f.state.securityPoolScopes, f.pool, f.observation, 1n, readers)
	expect(result.observation.snapshot.blockNumber).toBe(123n)
	for (const fixtureValue of fixtures) expect(fixtureValue.reads.every(read => read.blockNumber === 123n)).toBe(true)
})

test('virtual winner takeover uses the bid API and rejects materialization or identity drift before funding', async () => {
	const f = fixture()
	const position = f.observation.positions[0]
	if (position === undefined) throw new Error('Fixture target missing')
	const target = { auction: f.observation.snapshot.securityPool, bidId: 44n, vault: position.owner }
	position.auctionTarget = target
	position.id = 44n
	f.observation.snapshot.ownerPrincipalAttoRep = 100n * unit
	f.observation.snapshot.ownerAccount.freeAttoRep = 100n * unit
	const refresh: typeof refreshSecurityPoolExecution = async () => ({ observation: f.observation, totalPrincipal: 100n * unit, allowance: 0n })
	const submit: typeof submitCall = async (_wallet, _settings, _state, _pool, call) => {
		await call.preSubmit?.()
		f.calls.push(call)
		return confirmed
	}
	await executeSecurityPoolTakeover(f.wallet, f.settings, f.state, f.pool, f.observation, target, async () => true, { refresh, submit })
	const call = f.calls[0]
	if (call === undefined) throw new Error('Missing auction takeover')
	expect(decodeFunctionData({ abi: securityPoolCapitalLedgerAbi, data: call.data })).toMatchObject({
		functionName: 'takeOverAuctionBid',
		args: [44n, 100n * unit, 99n * unit, 100n * unit, { maximumOwnerPrincipal: 1000n * unit, maximumOwnerCommitment: 1000n * unit, expectedTargetHealthFactorBps: 15_000n, expectedAcceptedPriceEpoch: 3n, expectedSourceBatch: 0n }],
	})
	expect(call.label).toContain('auction bid 44')
	delete position.auctionTarget
	await expect(call.preSubmit?.()).rejects.toThrow('target position is missing')
})

test('final refresh rejects a block replacement during action-specific reads', async () => {
	const f = fixture()
	const source = securityPoolClient({ allowance: 0n })
	const client = new Proxy(source.client, {
		get(target, property) {
			if (property === 'getBlock') return async () => ({ number: 123n, hash: source.reads.some(read => read.functionName === 'allowance') ? `0x${'99'.repeat(32)}` : source.observation.snapshot.blockHash, timestamp: 3700n })
			return Reflect.get(target, property, target)
		},
	})
	await expect(refreshSecurityPoolExecution(f.wallet, f.settings, f.state.securityPoolScopes, f.pool, f.observation, 1n, [{ endpoint: 'https://rpc.example', client }])).rejects.toThrow('snapshot was replaced')
})
