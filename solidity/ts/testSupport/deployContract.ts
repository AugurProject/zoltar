import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import type { WriteClient } from './simulator/utils/clients'

export async function deployContract(client: WriteClient, deploymentData: Hex, value?: bigint) {
	const hash = await client.sendTransaction(value === undefined ? { data: deploymentData } : { data: deploymentData, value })
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (typeof receipt.contractAddress !== 'string') throw new Error('deployment address missing')
	return receipt.contractAddress
}
