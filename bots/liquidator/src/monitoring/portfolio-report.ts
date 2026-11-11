import { sharedPoolPriceFeedAbi, openOracleAbi } from '@zoltar/bot-shared/contracts/abi'
import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from './read-client.ts'

/** The onchain sponsor index survives process restarts and competing renewals. */
export async function loadSponsoredOperationReport(client: ReadClient, snapshot: PortfolioCapitalSnapshot) {
	const blockNumber = snapshot.blockNumber
	const feed = { abi: sharedPoolPriceFeedAbi, address: snapshot.priceFeed, blockNumber }
	const id = await client.readContract({ ...feed, functionName: 'sponsorOperationReport', args: [snapshot.owner] })
	if (id === 0n || (await client.readContract({ ...feed, functionName: 'reportOutcome', args: [id] })) !== 0n) return undefined
	const [escrow, sponsor] = await client.readContract({ ...feed, functionName: 'reportCandidates', args: [id] })
	if (sponsor.toLowerCase() !== snapshot.owner.toLowerCase()) throw new Error('Report sponsor index mismatch')
	const oracle = await client.readContract({ ...feed, functionName: 'openOracle' })
	const game = await client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'storedGame', args: [id], blockNumber })
	const helper = await client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id], blockNumber })
	if (game[16].toLowerCase() !== escrow.toLowerCase() || helper[0].toLowerCase() !== escrow.toLowerCase() || game[5].toLowerCase() === game[11].toLowerCase()) throw new Error('Report escrow binding mismatch')
	const credits = await Promise.all([game[5], game[11]].map(token => client.readContract({ address: oracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [escrow, token], blockNumber })))
	const ownReport = game[2].toLowerCase() === escrow.toLowerCase()
	const weth = (credits[0] ?? 0n) + (ownReport ? game[0] : 0n)
	const rep = (credits[1] ?? 0n) + (ownReport ? game[1] : 0n)
	return { id, oracle, game, helper, reservedRep: rep + (weth * snapshot.acceptedPrice) / 10n ** 18n }
}
