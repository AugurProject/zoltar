import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import type { WriteClient } from './simulator/utils/clients'

export async function deployContract(client: WriteClient, deploymentData: Hex) {
	const hash = await client.sendTransaction({ data: deploymentData })
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (typeof receipt.contractAddress !== 'string') throw new Error('deployment address missing')
	return receipt.contractAddress
}
