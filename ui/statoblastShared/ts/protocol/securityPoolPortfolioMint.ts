import { getAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioPosition, PortfolioSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
} from '../contractArtifact.js'

type MintPosition = Pick<PortfolioPosition, 'pool' | 'questionEndTime' | 'resolved' | 'systemState' | 'settlementCollateralAttoEth' | 'poolCommitmentAttoEth' | 'priceValid' | 'pendingReportId'>

/** Read one entered question through the authenticated portfolio, without scanning or changing its watchlist. */
export async function loadPortfolioMintQuestion(client: ReadClient, snapshot: PortfolioSnapshot, questionId: bigint): Promise<MintPosition | undefined> {
	const { portfolio, originUniverseId, blockNumber } = snapshot
	const origin = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'questionOriginIds', args: [questionId], blockNumber })
	if (origin === zeroHash) return undefined
	const pool = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [questionId, originUniverseId], blockNumber })
	const [nativeQuestionId, universeId, questionData, coordinator] = await Promise.all([
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionData', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'openOraclePriceCoordinator', blockNumber }),
	])
	if (nativeQuestionId !== questionId || universeId !== originUniverseId) throw new Error('Canonical pool identity mismatch.')
	const [questionEndTime, resolved, systemState, settlementCollateralAttoEth, poolCommitmentAttoEth, priceValid, pendingReportId] = await Promise.all([
		client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', args: [questionId], blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'isEscalationResolved', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'systemState', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'settlementCollateralAttoEth', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'totalUnderwritingLimitAttoEth', blockNumber }),
		client.readContract({ address: coordinator, abi: coordinatorArtifact.abi, functionName: 'isPriceValid', blockNumber }),
		client.readContract({ address: coordinator, abi: coordinatorArtifact.abi, functionName: 'pendingReportId', blockNumber }),
	])
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the question. Refresh and try again.')
	return { pool: getAddress(pool), questionEndTime, resolved, systemState: BigInt(systemState), settlementCollateralAttoEth, poolCommitmentAttoEth, priceValid, pendingReportId }
}

/** Estimate each used allocation separately; pool rounding can change once earlier allocations execute. */
export async function loadPortfolioMintReservationFee(client: ReadClient, snapshot: PortfolioSnapshot, position: MintPosition, questionId: bigint, mintAttoEth: bigint, contributions: readonly { vault: Address; maximumCommitmentIncreaseAttoEth: bigint }[]) {
	if (contributions.length > 16) throw new Error('Choose at most 16 contributing vaults.')
	const seen = new Set<Address>()
	for (const contribution of contributions) {
		const vault = getAddress(contribution.vault)
		if (seen.has(vault)) throw new Error('Contributing vaults must be unique.')
		seen.add(vault)
	}
	let remaining = position.settlementCollateralAttoEth + mintAttoEth > position.poolCommitmentAttoEth ? position.settlementCollateralAttoEth + mintAttoEth - position.poolCommitmentAttoEth : 0n
	let reservationFeeAttoEth = 0n
	for (const contribution of contributions) {
		if (remaining === 0n) break
		const increase = contribution.maximumCommitmentIncreaseAttoEth < remaining ? contribution.maximumCommitmentIncreaseAttoEth : remaining
		if (increase === 0n) continue
		const [, fee] = await client.readContract({ address: contribution.vault, abi: vaultArtifact.abi, functionName: 'quoteAllocationForMint', args: [questionId, increase], blockNumber: snapshot.blockNumber })
		if (typeof fee !== 'bigint' || fee < 0n) throw new Error('Invalid reservation fee quote.')
		reservationFeeAttoEth += fee
		remaining -= increase
	}
	if (remaining > 0n) throw new Error('Contributing vaults cannot supply the missing commitment.')
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber: snapshot.blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while estimating the fee. Refresh and try again.')
	return reservationFeeAttoEth
}
