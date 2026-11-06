import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleActionResult } from '../types/contracts.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
export async function wrapWeth(client: WriteClient, amountAttoEth: bigint) {
	const hash = await writeContractAndWait(client, () => ({
		address: getWethAddress(),
		abi: [
			{
				type: 'function',
				name: 'deposit',
				stateMutability: 'payable',
				inputs: [],
				outputs: [],
			},
		],
		functionName: 'deposit',
		value: amountAttoEth,
	}))
	return {
		action: 'wrapWeth',
		hash,
	} satisfies OpenOracleActionResult
}
