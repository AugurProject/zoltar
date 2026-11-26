import { readRequiredMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_QuestionLedger_QuestionLedger as poolArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { PublicClient, Address } from '@zoltar/core-shared/evm/ethereum'
import type { LiveMarket } from './liveMarket.js'

/** Quote after the purchase's own checkpoint so fractional fees and mint recovery use the same state. */
export async function loadMintPurchaseQuote(client: Pick<PublicClient, 'multicall'>, market: Pick<LiveMarket, 'pool' | 'universeId' | 'questionId'>, securityPool: Address, cash: bigint, blockNumber: bigint) {
	const [, value, recovery] = await readRequiredMulticall(
		client,
		[
			{ abi: poolArtifact.abi, address: market.pool, functionName: 'refreshSecurityPoolFees', args: [] },
			{ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'purchaseQuote', args: [market.universeId, market.questionId, cash] },
			{ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'quoteMintRecoveryRep', args: [market.universeId, market.questionId, cash] },
		],
		blockNumber,
	)
	if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'bigint' || typeof recovery !== 'bigint') throw new Error('Invalid purchase quote')
	return { fee: value[0], recovery }
}
