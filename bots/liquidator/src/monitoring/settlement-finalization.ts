import { securityPoolAbi, securityPoolFactoryAbi, securityPoolPortfolioAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { type Address, type PublicClient, zeroAddress } from '@zoltar/bot-shared/ethereum'

const settlementAbi = [
	{ type: 'function', stateMutability: 'view', name: 'ledger', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', stateMutability: 'view', name: 'bookIds', inputs: [{ type: 'uint248' }], outputs: [{ type: 'uint64' }] },
] as const
const bookAbi = [
	{
		type: 'function',
		stateMutability: 'view',
		name: 'question',
		inputs: [{ type: 'uint64' }, { type: 'uint256' }],
		outputs: [
			{
				type: 'tuple',
				components: [
					{ type: 'uint256', name: 'units' },
					{ type: 'uint256', name: 'outcomeSupplyAttoShares' },
					{ type: 'uint48', name: 'finalAfter' },
					{ type: 'uint256', name: 'feeRateAttoEthPerSecond' },
					{ type: 'uint48', name: 'feeStart' },
					{ type: 'uint48', name: 'feeEnd' },
					{ type: 'uint256', name: 'feePrincipalAttoEth' },
				],
			},
			{ type: 'uint64' },
		],
	},
	{
		type: 'function',
		stateMutability: 'view',
		name: 'hasLiveForkRecoveryRight',
		inputs: [{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint48' }],
		outputs: [{ type: 'bool' }],
	},
] as const

type Reader = Pick<PublicClient, 'getBlock' | 'readContract'>
type Deployment = { securityPool: Address; universeId: bigint; questionId: bigint }

export const finalizationRequest = (address: Address) => ({ address, abi: securityPoolAbi, functionName: 'updateSettlementCollateral' as const })

export async function settlementFinalizationCandidate(client: Reader, portfolio: Address, { securityPool, universeId, questionId }: Deployment, minimumCash: bigint, blockNumber: bigint) {
	const root = { abi: securityPoolPortfolioAbi, address: portfolio, blockNumber }
	const [pool, zoltar, settlement, cutoff] = await Promise.all([
		client.readContract({ ...root, functionName: 'getPool', args: [questionId, universeId] }),
		client.readContract({ ...root, functionName: 'zoltar' }),
		client.readContract({ ...root, functionName: 'settlement' }),
		client.readContract({ ...root, functionName: 'portfolioTime', args: [universeId] }),
	])
	if (pool.toLowerCase() !== securityPool.toLowerCase()) return undefined
	if ((await client.readContract({ address: zoltar, abi: zoltarAbi, functionName: 'getForkTime', args: [universeId], blockNumber })) !== 0n) return undefined
	const [ledger, bookId] = await Promise.all([client.readContract({ address: settlement, abi: settlementAbi, functionName: 'ledger', blockNumber }), client.readContract({ address: settlement, abi: settlementAbi, functionName: 'bookIds', args: [universeId], blockNumber })])
	if (bookId === 0n) return undefined
	const book = { abi: bookAbi, address: ledger, blockNumber }
	const [state, frozenBookId] = await client.readContract({ ...book, functionName: 'question', args: [bookId, questionId] })
	if (frozenBookId !== 0n || state.units === 0n || BigInt(state.finalAfter) === 0n || state.finalAfter >= cutoff) return undefined
	// This predicate also applies the child book's minimum finality time.
	if (await client.readContract({ ...book, functionName: 'hasLiveForkRecoveryRight', args: [bookId, questionId, cutoff] })) return undefined
	const cash = await client.readContract({ ...root, functionName: 'quoteQuestionSettlement', args: [pool, state.outcomeSupplyAttoShares] })
	if (cash < minimumCash) return undefined
	return { pool, universeId, questionId, cash }
}

export async function* scanSettlementFinalizations(client: Reader, portfolio: Address, minimumCash: bigint) {
	const block = await client.getBlock()
	if (block.number === undefined) throw new Error('Settlement scan requires a numbered block')
	const root = { abi: securityPoolPortfolioAbi, address: portfolio, blockNumber: block.number }
	const factory = await client.readContract({ ...root, functionName: 'factory' })
	if (factory === zeroAddress) throw new Error('Portfolio factory unavailable')
	const registry = { abi: securityPoolFactoryAbi, address: factory, blockNumber: block.number }
	const end = await client.readContract({ ...registry, functionName: 'securityPoolDeploymentCount' })
	const pageSize = 25n
	for (let start = 0n; start < end; start += pageSize) {
		const length = end - start < pageSize ? end - start : pageSize
		const page = await client.readContract({ ...registry, functionName: 'securityPoolDeploymentsRange', args: [start, length] })
		for (const deployment of page) {
			const registered = await client.readContract({ ...registry, functionName: 'getSecurityPoolPortfolio', args: [deployment.securityPool] })
			if (registered.toLowerCase() !== portfolio.toLowerCase()) continue
			const candidate = await settlementFinalizationCandidate(client, portfolio, deployment, minimumCash, block.number)
			if (candidate !== undefined) yield candidate
		}
	}
}
