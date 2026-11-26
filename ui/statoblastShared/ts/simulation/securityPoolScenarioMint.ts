import { scenarioMint } from '../copy/simulation.js'
import { getMulticall3Address } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import type { Address, PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolMintRequest, loadSecurityPoolMintQuote, type SecurityPoolReadClient } from '@zoltar/statoblast-shared/statoblast/securityPool'

/** `feeMarginBps` tolerates the fee accruing between the quoted block and the mined block. */
export async function prepareSeededSecurityPoolMint(client: SecurityPoolReadClient & Pick<PublicClient, 'multicall'>, owner: Address, securityPool: Address, questionId: bigint, mintAttoEth = 10n ** 18n, feeMarginBps = 0n) {
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error(scenarioMint.blockMissing)
	const quote = await loadSecurityPoolMintQuote({ multicallAddress: getMulticall3Address(), client, securityPool, universeId: 0n, blockNumber: block.number, questionId, mintAttoEth })
	return buildSecurityPoolMintRequest({ trader: owner, securityPool, universeId: 0n, questionId, recipient: owner, minimumShares: 0n, mintAttoEth, maximumPurchaseFeeAttoEth: (quote.purchaseFeeAttoEth * (10_000n + feeMarginBps)) / 10_000n })
}
