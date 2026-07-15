import { type Address } from '@zoltar/shared/ethereum'
import { ABIS } from '../abis.js'
import type { OpenOracleActionResult, SecurityVaultActionResult, WriteClient, ZoltarForkActionResult } from '../types/contracts.js'
import { writeContractAndWait } from './core.js'

export async function approveErc20<Action extends SecurityVaultActionResult['action'] | OpenOracleActionResult['action'] | ZoltarForkActionResult['action']>(client: WriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: Action) {
	const hash = await writeContractAndWait(client, () => ({
		address: tokenAddress,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		args: [spenderAddress, amount],
	}))
	return { action, hash }
}
