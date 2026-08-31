import { type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWait } from './core.js'

export async function approveErc20<Action extends string>(client: WriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: Action) {
	const hash = await writeContractAndWait(client, () => ({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	}))
	return { action, hash }
}
