import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { test_statoblast_DelegateCallForwarderHarness_DelegateCallForwarderHarness as artifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const errorSelector = '0x08c379a0'
const word = (value: bigint) => value.toString(16).padStart(64, '0')

// The forwarding helper preserves string reasons and normalizes every other revert payload.
describe('Statoblast: delegate revert reasons', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	let harness: Address

	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		harness = await deployContract(client, encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		await node.setBaselineSnapshot()
	})

	const decode = (address: Address, result: Hex) => client.readContract({ abi: artifact.abi, address, functionName: 'decodeError', args: [result] })

	test('well-formed reasons decode and malformed Error payloads fall back to the generic reason', async () => {
		const reason = 'Question active'
		const wellFormed: Hex = `${errorSelector}${encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)}`
		const malformed: readonly Hex[] = [
			'0x',
			'0xdeadbeef',
			`0x4e487b71${word(0x11n)}`,
			// An Error selector alone has no ABI string header.
			errorSelector,
			// The string offset points far outside the payload.
			`${errorSelector}${word(2n ** 255n)}${word(0n)}`,
			// The offset is in range, but the declared length runs past the end.
			`${errorSelector}${word(32n)}${word(1_000n)}`,
			// The offset leaves no room for a length word.
			`${errorSelector}${word(33n)}${word(0n)}`,
		]
		const address = harness
		expect(await decode(address, wellFormed)).toBe(reason)
		expect(await decode(address, '0x')).toBe('Delegate call failed')
		expect(await decode(address, `0x4e487b71${word(0x11n)}`)).toBe('Delegate call failed')
		for (const result of malformed) {
			expect(await decode(address, result)).toBe('Delegate call failed')
			await expect(client.simulateContract({ abi: artifact.abi, address, functionName: 'forwardFailure', args: [result] })).rejects.toThrow('Delegate call failed')
		}
		await expect(client.simulateContract({ abi: artifact.abi, address, functionName: 'forwardFailure', args: [wellFormed] })).rejects.toThrow(reason)
	})

	test('preserves empty and long string reasons and successful return data', async () => {
		for (const reason of ['', 'x'.repeat(257)]) {
			const result: Hex = `${errorSelector}${encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)}`
			expect(await decode(harness, result)).toBe(reason)
		}
		// Preserve the old decoder's acceptance of in-range, noncanonical offsets.
		expect(await decode(harness, `${errorSelector}${word(33n)}00${word(3n)}616263`)).toBe('abc')
		expect(await decode(harness, `${errorSelector}${word(0n)}${word(0n)}`)).toBe('')
		const { result } = await client.simulateContract({ abi: artifact.abi, address: harness, functionName: 'forwardSuccess', args: [123n] })
		expect(result).toBe(123n)
	})
})
