import { test_statoblast_CommitmentIndexHarness_CommitmentIndexHarness as harnessArtifact } from '../../types/contractArtifact'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'

/** Deploys the commitment index harness and returns it with the commitment index it owns. */
export async function deployCommitmentIndexHarness(client: WriteClient) {
	const receipt = await client.waitForTransactionReceipt({ hash: await client.sendTransaction({ data: `0x${harnessArtifact.evm.bytecode.object}` }) })
	if (receipt.contractAddress === undefined) throw new Error('Commitment harness deployment address missing')
	const harness = receipt.contractAddress
	const index = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'index' })
	return { harness, index }
}
