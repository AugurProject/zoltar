import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioMintRequest, loadPortfolioMintQuote, type PortfolioReadClient } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

/** `feeMarginBps` tolerates the fee accruing between the quoted block and the mined block. */
export async function prepareSeededPortfolioMint(client: PortfolioReadClient, owner: Address, portfolio: Address, questionId: bigint, mintAttoEth = 10n ** 18n, feeMarginBps = 0n) {
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio simulation requires a mined block')
	const quote = await loadPortfolioMintQuote({ client, portfolio, universeId: 0n, blockNumber: block.number, questionId, mintAttoEth })
	return buildPortfolioMintRequest({ trader: owner, portfolio, universeId: 0n, questionId, recipient: owner, minimumShares: 0n, mintAttoEth, maximumPurchaseFeeAttoEth: (quote.purchaseFeeAttoEth * (10_000n + feeMarginBps)) / 10_000n })
}
