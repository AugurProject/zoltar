import type { Address, Hash } from '@zoltar/shared/ethereum'
import { peripherals_SecurityPool_SecurityPool } from '../contractArtifact.js'
import type { ForkAuctionAction, ForkAuctionActionResult, ReadClient, WriteClient } from '../types/contracts.js'

export async function readSecurityPoolUniverseId(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'universeId',
		args: [],
	})
}

export async function executeForkAuctionAction(client: WriteClient, action: ForkAuctionAction, securityPoolAddress: Address, universeId: bigint, request: () => Promise<Hash>) {
	const hash = await request()
	await client.waitForTransactionReceipt({ hash })
	return {
		action,
		hash,
		securityPoolAddress,
		universeId,
	} satisfies ForkAuctionActionResult
}
