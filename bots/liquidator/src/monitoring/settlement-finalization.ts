import { securityPoolAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import type { Address, PublicClient } from '@zoltar/bot-shared/ethereum'

const settlementAbi = [
	{ type: 'function', stateMutability: 'view', name: 'ledger', inputs: [], outputs: [{ type: 'address' }] },
	{ type: 'function', stateMutability: 'view', name: 'bookIds', inputs: [{ type: 'uint248' }], outputs: [{ type: 'uint64' }] },
	{
		type: 'function',
		stateMutability: 'nonpayable',
		name: 'finalizeQuestion',
		inputs: [
			{ name: 'universeId', type: 'uint248' },
			{ name: 'questionId', type: 'uint256' },
		],
		outputs: [],
	},
] as const
const bookAbi = [
	{ type: 'function', stateMutability: 'view', name: 'quoteRedemptionAt', inputs: [{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint48' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
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

type Reader = Pick<PublicClient, 'getBlock' | 'readContract' | 'getLogs'>
type Question = { universeId: bigint; questionId: bigint }
const preparedEvent = {
	type: 'event',
	name: 'UniversePrepared',
	inputs: [
		{ name: 'universeId', type: 'uint248', indexed: true },
		{ name: 'capitalLedger', type: 'address', indexed: false },
	],
} as const

export const finalizationRequest = ({ settlement, universeId, questionId }: Question & { settlement: Address }) => ({ address: settlement, abi: settlementAbi, functionName: 'finalizeQuestion' as const, args: [universeId, questionId] as const })

export async function settlementFinalizationCandidate(client: Reader, securityPool: Address, { universeId, questionId }: Question, minimumCash: bigint, blockNumber: bigint) {
	const root = { abi: securityPoolAbi, address: securityPool, blockNumber }
	const [zoltar, settlement, cutoff] = await Promise.all([client.readContract({ ...root, functionName: 'zoltar' }), client.readContract({ ...root, functionName: 'settlement' }), client.readContract({ ...root, functionName: 'securityPoolTime', args: [universeId] })])
	if ((await client.readContract({ address: zoltar, abi: zoltarAbi, functionName: 'getForkTime', args: [universeId], blockNumber })) !== 0n) return undefined
	const [ledger, bookId] = await Promise.all([client.readContract({ address: settlement, abi: settlementAbi, functionName: 'ledger', blockNumber }), client.readContract({ address: settlement, abi: settlementAbi, functionName: 'bookIds', args: [universeId], blockNumber })])
	if (bookId === 0n) return undefined
	const book = { abi: bookAbi, address: ledger, blockNumber }
	const [state, frozenBookId] = await client.readContract({ ...book, functionName: 'question', args: [bookId, questionId] })
	if (frozenBookId !== 0n || state.units === 0n || BigInt(state.finalAfter) === 0n || state.finalAfter >= cutoff) return undefined
	// This predicate also applies the child book's minimum finality time.
	if (await client.readContract({ ...book, functionName: 'hasLiveForkRecoveryRight', args: [bookId, questionId, cutoff] })) return undefined
	const [cash] = await client.readContract({ ...book, functionName: 'quoteRedemptionAt', args: [bookId, questionId, state.outcomeSupplyAttoShares, cutoff] })
	if (cash < minimumCash) return undefined
	return { settlement, universeId, questionId, cash }
}

export async function* scanSettlementFinalizations(client: Reader, securityPool: Address, minimumCash: bigint) {
	const block = await client.getBlock()
	if (block.number === undefined) throw new Error('Settlement scan requires a numbered block')
	const root = { abi: securityPoolAbi, address: securityPool, blockNumber: block.number }
	const questionCount = await client.readContract({ ...root, functionName: 'questionCount' })
	const seenUniverses = new Set<bigint>()
	// Bound each historical RPC query and pin both discovery and eligibility to the same block.
	const blockPageSize = 10_000n
	for (let fromBlock = 0n; fromBlock <= block.number; fromBlock += blockPageSize) {
		const toBlock = fromBlock + blockPageSize - 1n < block.number ? fromBlock + blockPageSize - 1n : block.number
		const prepared = await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, blockPageSize, range => client.getLogs({ address: securityPool, event: preparedEvent, ...range }))
		for (const event of prepared) {
			if (event.args === undefined) throw new Error('Prepared universe event arguments unavailable')
			const { universeId } = event.args
			if (seenUniverses.has(universeId)) continue
			seenUniverses.add(universeId)
			const pageSize = 25n
			for (let start = 0n; start < questionCount; start += pageSize) {
				const questions = await client.readContract({ ...root, functionName: 'getQuestions', args: [start, pageSize] })
				for (const questionId of questions) {
					const candidate = await settlementFinalizationCandidate(client, securityPool, { universeId, questionId }, minimumCash, block.number)
					if (candidate !== undefined) yield candidate
				}
			}
		}
	}
}
