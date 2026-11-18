import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact, Zoltar_Zoltar as zoltarArtifact } from '../../../../types/contractArtifact'
import { getChildUniverseId } from '../utilities'
import { writeContractAndWait, type WriteClient } from '../clients'
import { deployChild, getZoltarAddress } from './zoltar'

export async function stagePortfolioForkCapital(client: WriteClient, coordinator: Address, parent: bigint, outcome: bigint) {
	const portfolio = await client.readContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'portfolio' })
	const target = { address: portfolio, abi: portfolioArtifact.abi } as const
	const child = getChildUniverseId(parent, outcome)
	const [bound, pending, rep] = await Promise.all([
		client.readContract({ ...target, functionName: 'capitalLedger', args: [child] }),
		client.readContract({ ...target, functionName: 'pendingForkCapital', args: [child] }),
		client.readContract({ address: getZoltarAddress(), abi: zoltarArtifact.abi, functionName: 'getRepToken', args: [child] }),
	])
	if (bound !== zeroAddress || pending !== zeroAddress) return
	if (rep === zeroAddress) await deployChild(client, parent, outcome)
	await writeContractAndWait(client, () => client.writeContract({ ...target, functionName: 'prepareForkCapital', args: [parent, outcome] }))
}
