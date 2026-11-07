import { securityPoolAbi, securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import type { PoolSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { contractSimulationReverted } from './discovery-client.ts'

/** Quote the full payable amount and simulate the exact user entry point at the anchor. */
export async function discoverPurchaseQuote(context: EcosystemDiscoveryContext, pool: Pick<PoolSnapshot, 'address' | 'portfolio' | 'universeId' | 'questionId'>, blockNumber: bigint): Promise<PoolSnapshot['purchaseQuote']> {
	const { client, wallet } = context
	const mint = context.purchaseQuoteAttoEth ?? 10n ** 15n
	if (wallet === undefined || mint <= 0n) return undefined
	try {
		const args = [BigInt(pool.universeId), BigInt(pool.questionId), mint] as const
		const [fee, premium] = await client.readContract({ abi: securityPoolPortfolioAbi, address: pool.portfolio, functionName: 'purchaseQuote', args, blockNumber })
		const shares = await client.readContract({ abi: securityPoolAbi, address: pool.address, functionName: 'attoEthToAttoShares', args: [mint], blockNumber })
		if (shares === 0n) return undefined
		await client.simulateContract({ abi: securityPoolPortfolioAbi, address: pool.portfolio, account: wallet, functionName: 'createCompleteSet', args: [...args, wallet, shares], value: mint + fee + premium, blockNumber })
		return { mintAttoEth: mint.toString(), feeAttoEth: fee.toString(), premiumAttoEth: premium.toString(), minimumShares: shares.toString() }
	} catch (error) {
		if (!contractSimulationReverted(error)) throw error
		return undefined
	}
}
