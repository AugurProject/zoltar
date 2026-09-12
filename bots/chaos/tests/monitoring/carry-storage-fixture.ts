import { createPublicClient, decodeFunctionData, defineChain, encodeAbiParameters, getAddress, hexToBytes, isHex, toHex, zeroAddress, zeroHash, type AbiValue, type Address } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { carryStorageAbi } from '../../src/contracts/carry-storage-abi.ts'
import { escalationGameAbi, securityPoolAbi, securityPoolForkerAbi, zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { carryCommitment, hashCarryLeaf, sparseNullifierRoot, type CarryLeafSlot } from '../../src/monitoring/carry-proof-index.ts'
import { consumeSparseNullifier, emptySparseNullifierState } from '../support/carry-proof-verification.ts'

export const address = (value: number) => getAddress(`0x${value.toString(16).padStart(40, '0')}`)
export const wallet = address(1)
export const source = address(100)
export const child = address(200)
export const grandchild = address(300)
export const forker = address(900)
export const anchor = 11000000n
export const blockHash = toHex(anchor, { size: 32 })
const abi = [...carryStorageAbi, ...escalationGameAbi, ...securityPoolAbi, ...securityPoolForkerAbi, ...zoltarAbi]

export function slot(game: Address, index: number, depositor = wallet): CarryLeafSlot {
	const leaf = { depositor, outcome: 0 as const, amountAttoRep: 10n.toString(), parentDepositIndex: ((BigInt(game) << 96n) + BigInt(index)).toString(), cumulativeAmountAttoRep: ((index + 1) * 10).toString(), sourceNodeId: (index + 1).toString() }
	return { leaf, originGame: game, hash: hashCarryLeaf(leaf), consumedLocally: false }
}

type Game = { game: Address; parent: Address; inherited: CarryLeafSlot[]; local: CarryLeafSlot[]; consumed: string[]; direct: Set<string> }
export function storageFixture() {
	const leaf = slot(source, 0)
	const games: Game[] = [
		{ game: source, parent: zeroAddress, inherited: [], local: [leaf], consumed: [], direct: new Set() },
		{ game: child, parent: source, inherited: [leaf], local: [], consumed: [], direct: new Set() },
	]
	const calls: { method: string; functionName?: string; block?: unknown }[] = []
	let badSnapshot = false
	let badNullifier = false
	let cycle = false
	let badAnchor = false
	let badEconomics = false
	const pool = (game: Address) => getAddress(toHex(BigInt(game) + 1n, { size: 20 }))
	function resolve(target: Address) {
		return games.find(game => game.game.toLowerCase() === target.toLowerCase() || pool(game.game).toLowerCase() === target.toLowerCase())
	}
	function allConsumed(game: Game, visited = new Set<Address>()): string[] {
		if (visited.has(game.game)) return []
		visited.add(game.game)
		const parent = games.find(value => value.game === game.parent)
		return [...(parent === undefined ? [] : allConsumed(parent, visited)), ...game.consumed]
	}
	function state(game: Game, outcome: bigint) {
		const inherited = outcome === 0n ? game.inherited : []
		const local = outcome === 0n ? game.local : []
		const snapshot = carryCommitment(inherited)
		const current = carryCommitment([...inherited, ...local])
		let nullifier = emptySparseNullifierState()
		if (outcome === 0n) for (const index of new Set(allConsumed(game))) nullifier = consumeSparseNullifier(nullifier, index)
		return {
			balanceAttoRep: 10n,
			snapshotLeafCount: BigInt(snapshot.leafCount),
			snapshotPeaks: badSnapshot && game.game === child ? snapshot.peaks.map(() => zeroHash) : snapshot.peaks,
			inheritedUnresolvedTotalAttoRep: 10n,
			currentNullifierRoot: badNullifier ? zeroHash : sparseNullifierRoot(nullifier),
			localHeadNodeId: BigInt(local.length),
			currentLeafCount: BigInt(current.leafCount),
			currentPeaks: current.peaks,
			localUnresolvedTotalAttoRep: BigInt(local.length * 10),
			currentCarryRoot: current.root,
			currentCarryTotalAttoRep: 10n,
		}
	}
	function result(target: Address, name: string, args: readonly AbiValue[]): readonly AbiValue[] {
		const game = resolve(target)
		const outcome = args[0]
		switch (name) {
			case 'securityPool':
				if (game === undefined) break
				return [pool(game.game)]
			case 'parent':
				if (game === undefined) break
				return [game.parent === zeroAddress ? zeroAddress : pool(game.parent)]
			case 'escalationGame':
				if (game === undefined) break
				return [game.game]
			case 'securityPoolForker':
				return [forker]
			case 'forkContinuation':
				return [game?.parent !== zeroAddress]
			case 'rootClaimSourceGame':
				return [source]
			case 'getOutcomeState':
				if (game === undefined || typeof outcome !== 'bigint') break
				return [state(game, outcome)]
			case 'getProofConsumedCarriedDepositIndexesByOutcome':
				return [outcome === 0n ? (game?.consumed ?? []).slice(Number(args[1]), Number(args[1]) + Number(args[2])).map(BigInt) : []]
			case 'getCarryLeafPageByOutcome': {
				const available = outcome === 0n ? (game?.local ?? []).filter(slot => slot.hash !== zeroHash && !game?.direct.has(slot.leaf.parentDepositIndex) && (args[1] === 0n || BigInt(slot.leaf.sourceNodeId) <= BigInt(String(args[1])))).reverse() : []
				const page = available.slice(0, Number(args[2]))
				const last = page.at(-1)
				return [
					page.map(slot => ({ depositor: slot.leaf.depositor, amountAttoRep: BigInt(slot.leaf.amountAttoRep), parentDepositIndex: BigInt(slot.leaf.parentDepositIndex), cumulativeAmountAttoRep: BigInt(slot.leaf.cumulativeAmountAttoRep), sourceNodeId: BigInt(slot.leaf.sourceNodeId) })),
					available.length > page.length && last !== undefined ? BigInt(last.leaf.sourceNodeId) - 1n : 0n,
				]
			}
			case 'nodes': {
				const node = game?.local[Number(args[0]) - 1]
				if (node === undefined || game === undefined) break
				return [cycle ? BigInt(node.leaf.sourceNodeId) : BigInt(node.leaf.sourceNodeId) - 1n, node.leaf.depositor, 0n, BigInt(node.leaf.amountAttoRep), BigInt(node.leaf.parentDepositIndex), BigInt(node.leaf.cumulativeAmountAttoRep), BigInt(game.inherited.length) + BigInt(node.leaf.sourceNodeId) - 1n]
			}
			case 'isEscalationDepositClaimedDirectly': {
				const sourceGame = typeof args[0] === 'string' ? games.find(game => pool(game.game).toLowerCase() === args[0]?.toString().toLowerCase()) : undefined
				return [sourceGame?.direct.has(String(args[2])) ?? false]
			}
			case 'systemState':
				return [0n]
			case 'isEscalationResolved':
			case 'forkCarrySnapshotInitialized':
				return [true]
			case 'getFinalQuestionResolution':
			case 'getQuestionOutcome':
				return [0n]
			case 'applyInheritedClaimRetention':
				return [args[0] ?? 0n]
			case 'getBindingCapitalAttoRep':
			case 'nonDecisionThresholdAttoRep':
			case 'getForkThresholdAttoRep':
				return [10n]
			case 'getEscalationGameEndDate':
				return [100n]
			case 'getForkTime':
				return [200n]
			case 'universeId':
				return [1n]
			case 'zoltar':
				return [address(901)]
			case 'withdrawForkedEscalationDeposits':
				return []
			case 'withdrawDeposit':
				return [wallet, badEconomics ? 999n : 16n, 10n]
			default:
				break
		}
		throw new Error(`Unhandled fixture call ${name} at ${target}`)
	}
	const client = createPublicClient({
		chain: defineChain({ id: 31337, name: 'carry storage test', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://unused.invalid'] } } }),
		transport: custom({
			async request({ method, params }) {
				if (method === 'eth_getLogs') throw new Error('Carry proofs must not fetch logs')
				if (method === 'eth_getBlockByNumber') {
					calls.push({ method })
					return { number: toHex(anchor), hash: badAnchor ? zeroHash : blockHash, timestamp: '0x1', baseFeePerGas: '0x1', transactions: [], gasLimit: '0x1c9c380', gasUsed: '0x0', parentHash: zeroHash }
				}
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || !('to' in call) || typeof call.to !== 'string' || typeof call.data !== 'string' || !isHex(call.data)) throw new Error('Invalid call')
				const decoded = decodeFunctionData({ abi, data: toHex(hexToBytes(call.data)) })
				calls.push({ method, functionName: decoded.functionName, block: params[1] })
				const entry = abi.find(entry => entry.type === 'function' && entry.name === decoded.functionName && entry.inputs.length === decoded.args.length)
				if (entry === undefined || entry.type !== 'function') throw new Error('Missing ABI function')
				const values = result(getAddress(call.to), decoded.functionName, decoded.args)
				if (entry.outputs.length === 0) return '0x'
				return encodeAbiParameters(entry.outputs, values)
			},
		}),
	})
	return {
		client,
		calls,
		games,
		leaf,
		pool,
		setBadSnapshot: () => {
			badSnapshot = true
		},
		setBadNullifier: () => {
			badNullifier = true
		},
		setCycle: () => {
			cycle = true
		},
		setBadAnchor: () => {
			badAnchor = true
		},
		setBadEconomics: () => {
			badEconomics = true
		},
	}
}
