/// <reference types="bun-types" />

import { beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { decodeFunctionResult, encodeFunctionData, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_Multicall3_Multicall3 as multicallArtifact } from '../../contractArtifact.js'
import { predictSimulationTokenAddresses } from '../../simulation/bootstrap.js'
import { getSimulationNode, initializeSimulationClock } from '../../simulation/clock.js'
import { createSimulationChain, type SimulationChain } from '../../simulation/simulationChain.js'
import { createSimulationProfile } from '../../wallet/networkProfile.js'

const SENDER = '0x00000000000000000000000000000000000000a1'
const RECIPIENT = '0x00000000000000000000000000000000000000b2'
const multicallAbi = multicallArtifact.abi

async function createFundedChain() {
	const chain = await createSimulationChain(createSimulationProfile({ ...predictSimulationTokenAddresses(SENDER, 'yes'), genesisOutcome: 'yes' }))
	await chain.memoryClient.impersonateAccount({ address: SENDER })
	await chain.memoryClient.setBalance({ address: SENDER, value: 10n ** 24n })
	await initializeSimulationClock(chain.memoryClient)
	return chain
}

async function sendFromSender(chain: SimulationChain, request: { data?: Hex; to?: Address; value?: bigint }) {
	const gas = (await chain.memoryClient.getBlock()).gasLimit
	return await chain.sendTransaction({ data: request.data ?? '0x', from: SENDER, gas, to: request.to, value: request.value }, 'test transaction')
}

async function getReceipt(chain: SimulationChain, hash: Hex) {
	const receipt = await chain.request({ method: 'eth_getTransactionReceipt', params: [hash] })
	if (typeof receipt !== 'object' || receipt === null) throw new Error('Expected a receipt')
	return receipt as Record<string, unknown>
}

function aggregateCall(target: Address, calls: readonly Hex[]) {
	return encodeFunctionData({ abi: multicallAbi, functionName: 'aggregate', args: [calls.map(callData => ({ callData, target }))] })
}

const balanceCall = (account: Address) => encodeFunctionData({ abi: multicallAbi, functionName: 'getEthBalance', args: [account] })

describe('simulation chain', () => {
	let chain: SimulationChain
	let multicall: Address

	beforeAll(async () => {
		chain = await createFundedChain()
		const deployment = await sendFromSender(chain, { data: `0x${multicallArtifact.evm.bytecode.object}` })
		const receipt = await getReceipt(chain, deployment)
		const contractAddress = receipt['contractAddress']
		if (typeof contractAddress !== 'string') throw new Error('Expected the Multicall3 deployment address')
		multicall = contractAddress as Address
	}, 30_000)

	test('mines each transaction once on the live VM and serves its receipt without re-execution', async () => {
		const blockBefore = await chain.memoryClient.getBlock()
		const nonceBefore = await chain.memoryClient.getTransactionCount({ address: SENDER })
		const hash = await sendFromSender(chain, { to: RECIPIENT, value: 5n })
		const receipt = await getReceipt(chain, hash)
		expect(receipt).toMatchObject({ blockNumber: toHex(blockBefore.number + 1n), gasUsed: '0x5208', status: '0x1', to: RECIPIENT, transactionHash: hash })
		expect(await chain.memoryClient.getBalance({ address: RECIPIENT })).toBe(5n)
		expect(await chain.memoryClient.getTransactionCount({ address: SENDER })).toBe(nonceBefore + 1)
		expect(await chain.request({ method: 'eth_getTransactionReceipt', params: [`0x${'ee'.repeat(32)}`] })).toBeNull()
	})

	test('eth_call runs nested calls against the latest state and leaves it untouched', async () => {
		const vm = await getSimulationNode(chain.memoryClient).getVm()
		const stateRootWrites = spyOn(vm.stateManager._baseState.stateRoots, 'set')
		const data = aggregateCall(multicall, [balanceCall(RECIPIENT), balanceCall(multicall)])
		const nonceBefore = await chain.memoryClient.getTransactionCount({ address: SENDER })
		const rootBefore = vm.stateManager._baseState.getCurrentStateRoot()

		const result = await chain.request({ method: 'eth_call', params: [{ data, from: SENDER, to: multicall, value: '0x3' }, 'latest'] })

		const [, returnData] = decodeFunctionResult({ abi: multicallAbi, data: result as Hex, functionName: 'aggregate' })
		// The call saw its own 3 attoETH arrive at the contract; the chain did not keep them.
		expect(returnData.map(value => BigInt(value))).toEqual([await chain.memoryClient.getBalance({ address: RECIPIENT }), 3n])
		expect(await chain.memoryClient.getTransactionCount({ address: SENDER })).toBe(nonceBefore)
		expect(await chain.memoryClient.getBalance({ address: multicall })).toBe(0n)
		expect(vm.stateManager._baseState.getCurrentStateRoot()).toBe(rootBefore)
		// A reverted call never records state, however many nested calls it made.
		expect(stateRootWrites).toHaveBeenCalledTimes(0)
		stateRootWrites.mockRestore()
	})

	test('a transaction with nested calls records state once per block instead of once per call', async () => {
		const vm = await getSimulationNode(chain.memoryClient).getVm()
		const stateRootWrites = spyOn(vm.stateManager._baseState.stateRoots, 'set')
		const data = aggregateCall(multicall, [balanceCall(RECIPIENT), balanceCall(SENDER), balanceCall(multicall)])

		const hash = await sendFromSender(chain, { data, to: multicall, value: 1n })

		expect(await getReceipt(chain, hash)).toMatchObject({ status: '0x1', to: multicall })
		expect(await chain.memoryClient.getBalance({ address: multicall })).toBe(1n)
		// The block's new root and the builder's final commit; three nested calls add nothing.
		expect(stateRootWrites).toHaveBeenCalledTimes(2)
		stateRootWrites.mockRestore()
	})

	test('reports reverts with the same error tevm produces and leaves nothing in the pool', async () => {
		const data = aggregateCall(multicall, ['0xdeadbeef'])
		const call = { data, from: SENDER, to: multicall }
		const describeError = (error: unknown) => (error instanceof Error ? { code: 'code' in error ? error.code : undefined, message: error.message } : { code: undefined, message: String(error) })
		const expected = await getSimulationNode(chain.memoryClient)
			.request({ method: 'eth_call', params: [call, 'latest'] })
			.then(() => undefined, describeError)
		expect(expected?.message).toContain('Multicall3: call failed')

		const actual = await chain.request({ method: 'eth_call', params: [call, 'latest'] }).then(() => undefined, describeError)
		expect(actual).toEqual(expected)
		const blockBefore = await chain.memoryClient.getBlock()
		// Transactions fail the way `tevmCall` fails: with tevm's revert error, which carries no reason string.
		const expectedTransactionError = await chain.memoryClient.tevmCall({ ...call, throwOnFail: true }).then(() => undefined, describeError)
		expect(expectedTransactionError?.message).toContain('revert')
		expect(await sendFromSender(chain, { data, to: multicall }).then(() => undefined, describeError)).toEqual(expectedTransactionError)
		expect((await chain.memoryClient.getBlock()).number).toBe(blockBefore.number)
		expect((await getSimulationNode(chain.memoryClient).getTxPool()).txsInPool).toBe(0)
	})

	test('a call pinned to the head that a queued transaction moves still reads that block', async () => {
		const headBefore = (await chain.memoryClient.getBlock()).number
		const balanceBefore = await chain.memoryClient.getBalance({ address: RECIPIENT })
		const gas = (await chain.memoryClient.getBlock()).gasLimit
		const rawRequests = spyOn(chain.memoryClient, 'request')
		// The transaction takes the chain lock first, so the call compares its tag with a head the transaction has moved.
		const [, pinned] = await Promise.all([chain.sendTransaction({ data: '0x', from: SENDER, gas, to: RECIPIENT, value: 9n }, 'queued transfer'), chain.request({ method: 'eth_call', params: [{ data: balanceCall(RECIPIENT), to: multicall }, toHex(headBefore)] })])
		expect(BigInt(pinned as Hex)).toBe(balanceBefore)
		expect(await chain.memoryClient.getBalance({ address: RECIPIENT })).toBe(balanceBefore + 9n)
		expect(rawRequests.mock.calls.some(([request]) => request.method === 'eth_call')).toBe(true)
		rawRequests.mockRestore()
	})

	test('serves historical block tags from tevm while the latest block takes the fast path', async () => {
		const before = await chain.memoryClient.getBlock()
		await sendFromSender(chain, { to: RECIPIENT, value: 7n })
		const after = await chain.memoryClient.getBlock()
		const data = balanceCall(RECIPIENT)
		const [historical, latestByNumber, latest] = await Promise.all([
			chain.request({ method: 'eth_call', params: [{ data, to: multicall }, toHex(before.number)] }),
			chain.request({ method: 'eth_call', params: [{ data, to: multicall }, toHex(after.number)] }),
			chain.request({ method: 'eth_call', params: [{ data, to: multicall }, 'latest'] }),
		])
		expect(BigInt(latest as Hex) - BigInt(historical as Hex)).toBe(7n)
		expect(latestByNumber).toBe(latest)
	})

	test('direct state writes made under the chain lock survive concurrent calls', async () => {
		const data = aggregateCall(
			multicall,
			Array.from({ length: 12 }, () => balanceCall(RECIPIENT)),
		)
		const calls = Array.from({ length: 4 }, () => chain.request({ method: 'eth_call', params: [{ data, to: multicall }, 'latest'] }))
		const written = await chain.withLock(async () => {
			await chain.memoryClient.setBalance({ address: RECIPIENT, value: 123_456n })
			return await chain.memoryClient.getBalance({ address: RECIPIENT })
		})
		await Promise.all(calls)
		expect(written).toBe(123_456n)
		expect(await chain.memoryClient.getBalance({ address: RECIPIENT })).toBe(123_456n)
		expect(BigInt(String(await chain.request({ method: 'eth_call', params: [{ data: balanceCall(RECIPIENT), to: multicall }, 'latest'] })))).toBe(123_456n)
	})

	test('calls with state overrides take the tevm path', async () => {
		const data = balanceCall(RECIPIENT)
		const overridden = await chain.request({ method: 'eth_call', params: [{ data, to: multicall }, 'latest', { [RECIPIENT]: { balance: toHex(777n) } }] })
		expect(BigInt(String(overridden))).toBe(777n)
		expect(await chain.memoryClient.getBalance({ address: RECIPIENT })).not.toBe(777n)
	})

	test('serializes interleaved reads and writes', async () => {
		const balanceBefore = await chain.memoryClient.getBalance({ address: RECIPIENT })
		const data = balanceCall(RECIPIENT)
		const results = await Promise.all([
			sendFromSender(chain, { to: RECIPIENT, value: 1n }),
			chain.request({ method: 'eth_call', params: [{ data, to: multicall }, 'latest'] }),
			sendFromSender(chain, { to: RECIPIENT, value: 2n }),
			chain.request({ method: 'eth_call', params: [{ data, to: multicall }, 'latest'] }),
			sendFromSender(chain, { data: aggregateCall(multicall, [data, data]), to: multicall }),
		])
		// Each read ran between whole transactions, so it saw a balance the chain actually had.
		for (const read of [results[1], results[3]]) expect([balanceBefore, balanceBefore + 1n, balanceBefore + 3n]).toContain(BigInt(read as Hex))
		for (const hash of [results[0], results[2], results[4]]) expect(await getReceipt(chain, hash as Hex)).toMatchObject({ status: '0x1' })
		expect(await chain.memoryClient.getBalance({ address: RECIPIENT })).toBe(balanceBefore + 3n)
	})
})
