import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate as operationsArtifact, statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter as accountingArtifact } from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const errorSelector = '0x08c379a0'
const word = (value: bigint) => value.toString(16).padStart(64, '0')

// A pool reverts with `decodeError(revertData)` whenever a delegate call fails. Revert data that a
// delegate bubbles up from another contract need not be well formed, and decoding must not itself revert:
// that would replace the readable reason with an empty revert.
describe('Statoblast: delegate revert reasons', () => {
	const node = useIsolatedAnvilNode()
	let client: WriteClient
	const delegates: { name: string; address: Address }[] = []

	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
		client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		delegates.push({ name: 'operations', address: await deployContract(client, encodeDeployData({ abi: operationsArtifact.abi, bytecode: `0x${operationsArtifact.evm.bytecode.object}` })) })
		delegates.push({ name: 'accounting', address: await deployContract(client, encodeDeployData({ abi: accountingArtifact.abi, bytecode: `0x${accountingArtifact.evm.bytecode.object}` })) })
		await node.setBaselineSnapshot()
	})

	const decode = (address: Address, result: Hex) => client.readContract({ abi: operationsArtifact.abi, address, functionName: 'decodeError', args: [result] })

	test('well-formed reasons decode and malformed Error payloads fall back to the generic reason', async () => {
		const reason = 'Question active'
		const wellFormed: Hex = `${errorSelector}${encodeAbiParameters([{ type: 'string' }], [reason]).slice(2)}`
		const malformed: readonly Hex[] = [
			// An Error selector alone has no ABI string header.
			errorSelector,
			// The string offset points far outside the payload.
			`${errorSelector}${word(2n ** 255n)}${word(0n)}`,
			// The offset is in range, but the declared length runs past the end.
			`${errorSelector}${word(32n)}${word(1_000n)}`,
			// The offset leaves no room for a length word.
			`${errorSelector}${word(33n)}${word(0n)}`,
		]
		for (const delegate of delegates) {
			expect(await decode(delegate.address, wellFormed)).toBe(reason)
			expect(await decode(delegate.address, '0x')).toBe('Delegate call failed')
			expect(await decode(delegate.address, `0x4e487b71${word(0x11n)}`)).toBe('Delegate call failed')
			for (const result of malformed) expect(await decode(delegate.address, result)).toBe('Delegate call failed')
		}
	})
})
