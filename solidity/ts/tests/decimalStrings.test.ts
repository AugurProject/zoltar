import { describe, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import assert from '../testSupport/simulator/utils/assert'
import { createWriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES, MAX_UINT256 } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ReputationToken_ReputationToken as rep, statoblast_tokens_ShareToken_ShareToken as share, test_statoblast_CoverageHelpersHarness_CoverageHelpersHarness as helper } from '../types/contractArtifact'

describe('shared decimal strings', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()

	test('formats zero, decimal digit boundaries, and uint256 maximum exactly', async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		const client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		const address = await deployContract(client, encodeDeployData({ abi: helper.abi, bytecode: `0x${helper.evm.bytecode.object}` }))
		const values = [0n, 1n, MAX_UINT256]
		for (let digits = 1n; digits <= 77n; digits++) values.push(10n ** digits - 1n, 10n ** digits)
		for (const value of values) {
			assert.strictEqual(await client.readContract({ abi: helper.abi, address, functionName: 'uintToString', args: [value] }), value.toString())
		}
	})

	test('preserves share and REP token decimal metadata', async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		const client = createWriteClient(ethereum, TEST_ADDRESSES[0])
		for (const value of [0n, 9n, 10n, MAX_UINT256]) {
			const address = await deployContract(client, encodeDeployData({ abi: share.abi, bytecode: `0x${share.evm.bytecode.object}`, args: [client.account.address, client.account.address, value] }))
			assert.strictEqual(await client.readContract({ abi: share.abi, address, functionName: 'name' }), `Shares-${value}`)
			assert.strictEqual(await client.readContract({ abi: share.abi, address, functionName: 'symbol' }), `SHARE-${value}`)
		}
		for (const value of [1n, 9n, 10n, MAX_UINT256]) {
			const address = await deployContract(client, encodeDeployData({ abi: rep.abi, bytecode: `0x${rep.evm.bytecode.object}`, args: [client.account.address] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: rep.abi, address, functionName: 'initialize', args: [1n, 1n, value] }))
			assert.strictEqual(await client.readContract({ abi: rep.abi, address, functionName: 'name' }), `Augur Reputation ${value}`)
			assert.strictEqual(await client.readContract({ abi: rep.abi, address, functionName: 'symbol' }), `REP${value}`)
		}
	})
})
