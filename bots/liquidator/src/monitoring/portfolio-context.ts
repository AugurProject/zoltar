import type { OperatorSettings } from '#config/settings'
import { OperatorStopping } from '#execution/execution-safety'
import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import type { Address, PublicClient, Transport, Chain } from '@zoltar/bot-shared/ethereum'
import { loadUniverseTree } from '@zoltar/bot-shared/monitoring/universe-policy'

/** Pins universe policy and wallet balances to the same block as portfolio positions. */
export async function scanPortfolioContext(client: PublicClient<Transport, Chain>, settings: OperatorSettings, wallet: Address | undefined, isStopping: () => boolean = () => false, blockNumber?: bigint) {
	const block = await client.getBlock(blockNumber === undefined ? undefined : { blockNumber })
	if (isStopping()) throw new OperatorStopping()
	if (block.hash === undefined || block.number === undefined) throw new Error('Portfolio scan block is missing canonical identity')
	const snapshotBlock = { hash: block.hash, number: block.number, timestamp: block.timestamp }
	const universes = (await loadUniverseTree(client, settings.deployment.zoltar, snapshotBlock.number)).map(universe => ({ ...universe, approved: settings.approvedUniverses.includes(universe.id) }))
	const walletRepByToken = new Map<string, bigint>()
	if (wallet !== undefined) {
		const selectedUniverses = new Set(settings.selectedPortfolios.map(selection => selection.universeId))
		for (const universe of universes) {
			if (isStopping()) throw new OperatorStopping()
			if (!selectedUniverses.has(universe.id)) continue
			walletRepByToken.set(universe.repToken.toLowerCase(), await client.readContract({ abi: erc20Abi, address: universe.repToken, functionName: 'balanceOf', args: [wallet], blockNumber: snapshotBlock.number }))
		}
	}
	if (isStopping()) throw new OperatorStopping()
	if ((await client.getBlock({ blockNumber: snapshotBlock.number })).hash?.toLowerCase() !== snapshotBlock.hash.toLowerCase()) throw new Error('Portfolio snapshot changed during discovery')
	return { block: snapshotBlock, universes, walletRepByToken }
}
