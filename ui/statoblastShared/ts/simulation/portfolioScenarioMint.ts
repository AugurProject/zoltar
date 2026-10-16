import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioMintRequest, loadPortfolioMintQuote, type PortfolioReadClient } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

export async function prepareSeededPortfolioMint(client: PortfolioReadClient, owner: Address, portfolio: Address, questionId: bigint) {
	const [block, chainId] = await Promise.all([client.getBlock(), client.getChainId()])
	if (block.number === undefined || block.hash === undefined) throw new Error('Portfolio simulation requires a mined block')
	const mintAttoEth = 10n ** 18n
	const quote = await loadPortfolioMintQuote({ client, snapshot: { portfolio, blockNumber: block.number, blockHash: block.hash, chainId }, questionId, mintAttoEth })
	return buildPortfolioMintRequest({ trader: owner, portfolio, questionId, recipient: owner, minimumShares: 0n, mintAttoEth, maximumPurchaseFeeAttoEth: quote.purchaseFeeAttoEth })
}
