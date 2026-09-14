import { test, expect } from 'bun:test'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { test_statoblast_RetentionCallHarness_RetentionCallHarness as harness } from '../types/contractArtifact'

const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
test('retention self-calls preserve failures and validate return data', async () => {
	const ethereum = getAnvilWindowEthereum()
	await setupTestAccounts(ethereum)
	const client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	const hash = await client.sendTransaction({ data: `0x${harness.evm.bytecode.object}` })
	const receipt = await client.waitForTransactionReceipt({ hash })
	const address = receipt.contractAddress
	if (address === undefined) throw new Error('Harness deployment did not return an address')
	for (const storageBasis of [false, true]) {
		await expect(client.readContract({ address, abi: harness.abi, functionName: 'evaluate', args: [storageBasis] })).rejects.toThrow('Retention unavailable')
	}
	await writeContractAndWait(client, () => client.writeContract({ address, abi: harness.abi, functionName: 'setMode', args: [1n] }))
	for (const storageBasis of [false, true]) {
		await expect(client.readContract({ address, abi: harness.abi, functionName: 'evaluate', args: [storageBasis] })).rejects.toThrow('Invalid retention response')
	}
	await writeContractAndWait(client, () => client.writeContract({ address, abi: harness.abi, functionName: 'setMode', args: [2n] }))
	for (const storageBasis of [false, true]) {
		expect(await client.readContract({ address, abi: harness.abi, functionName: 'evaluate', args: [storageBasis] })).toBe(42n)
	}
})
