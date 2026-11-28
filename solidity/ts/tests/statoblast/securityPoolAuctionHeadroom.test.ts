import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { deployContract } from '../../testSupport/deployContract'
import { statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact, test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact } from '../../types/contractArtifact'

describe('auction cumulative collateral headroom', () => {
	const node = useIsolatedAnvilNode()
	beforeAll(async () => {
		await setupTestAccounts(node.getAnvilWindowEthereum())
	})
	test('#1652 exhausted deposit capacity closes the admission quote even for a better price', async () => {
		const client = createWriteClient(node.getAnvilWindowEthereum(), TEST_ADDRESSES[0])
		const token = await deployContract(client, encodeDeployData({ abi: tokenArtifact.abi, bytecode: `0x${tokenArtifact.evm.bytecode.object}`, args: [18] }))
		const engine = await deployContract(client, encodeDeployData({ abi: engineArtifact.abi, bytecode: `0x${engineArtifact.evm.bytecode.object}`, args: [client.account.address, token] }))
		const target = { abi: engineArtifact.abi, address: engine }
		const maximum = (1n << 128n) - 1n
		const now = (await client.getBlock()).timestamp
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'startRepairAuction', args: [now + 86400n, maximum, 1n, 2n, 1n] }))
		expect(await client.readContract({ ...target, functionName: 'maximumAdmissibleBidAttoRepPerLot' })).toBe(2n)
		await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [engine, maximum] }))
		await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'submitBid', args: [client.account.address, 1n, 2n] }))
		expect(await client.readContract({ ...target, functionName: 'maximumAdmissibleBidAttoRepPerLot' })).toBe(0n)
		await expect(client.simulateContract({ ...target, functionName: 'submitBid', args: [client.account.address, 1n, 1n] })).rejects.toThrow('Auction deposits exceed the supported range')
	})
})
