import { getAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../contractArtifact.js'
import type { PortfolioAccountSnapshot } from './securityPoolPortfolio.js'

/** Read exactly one question; the registry page never limits which question can be quoted. */
export async function loadPortfolioMintQuestion(client: ReadClient, snapshot: Pick<PortfolioAccountSnapshot, 'portfolio' | 'universeId' | 'blockNumber' | 'blockHash' | 'chainId'>, questionId: bigint) {
	const { portfolio, universeId, blockNumber } = snapshot
	const origin = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'questionOriginIds', args: [questionId], blockNumber })
	if (origin === zeroHash) return undefined
	const pool = await client.readContract({ address: portfolio, abi: portfolioArtifact.abi, functionName: 'getPool', args: [questionId, universeId], blockNumber })
	const [nativeQuestionId, nativeUniverseId, questionData, escalationGame, systemState] = await Promise.all([
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'questionData', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'escalationGame', blockNumber }),
		client.readContract({ address: pool, abi: poolArtifact.abi, functionName: 'systemState', blockNumber }),
	])
	if (nativeQuestionId !== questionId || nativeUniverseId !== universeId) throw new Error('Canonical pool identity mismatch.')
	const questionEndTime = await client.readContract({ address: questionData, abi: ZoltarQuestionData_ZoltarQuestionData.abi, functionName: 'getQuestionEndDate', args: [questionId], blockNumber })
	const [block, chainId] = await Promise.all([client.getBlock({ blockNumber }), client.getChainId()])
	if (block.hash !== snapshot.blockHash || chainId !== snapshot.chainId) throw new Error('Chain changed while reading the question. Refresh and try again.')
	return { pool: getAddress(pool), questionEndTime, escalationGame, systemState: BigInt(systemState) }
}
