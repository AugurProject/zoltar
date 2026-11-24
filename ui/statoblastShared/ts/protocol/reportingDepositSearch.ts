import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { localEntityScopeForNetwork, parseStoredValue, serializeStoredValue } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { readRequiredMulticall, readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_EscalationGame_EscalationGame as gameArtifact } from '../contractArtifact.js'
import { locatedDepositKey, type LocatedDeposit } from './reportingDeposits.js'
import { isHex, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'

const pageSize = 30n
const confirmationDepth = 3n
type DepositSide = Omit<LocatedDeposit, 'index'>
export type DepositSearchCursor = { block: bigint; hash: Hash; nextIndex: bigint }

export function reportingDepositRead(game: Address, outcome: LocatedDeposit['outcome'], start: bigint, count: bigint) {
	return { abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcome', args: [getReportingOutcomeValue(outcome), start, count] } as const
}

export function reportingPrincipalRead(game: Address, side: Pick<DepositSide, 'depositor' | 'outcome'>) {
	return { abi: gameArtifact.abi, address: game, functionName: 'getLocalUnresolvedPrincipalByVaultAndOutcome', args: [side.depositor, getReportingOutcomeValue(side.outcome)] } as const
}

export async function readLocatedReportingDeposits(client: Pick<ReadClient, 'multicall'>, game: Address, side: DepositSide, located: readonly LocatedDeposit[], blockNumber: bigint) {
	const original = new Map(located.filter(deposit => sameAddress(deposit.pool, side.pool) && sameAddress(deposit.depositor, side.depositor) && deposit.questionId === side.questionId && deposit.universeId === side.universeId && deposit.outcome === side.outcome).map(deposit => [deposit.index, deposit.originalAttoRep]))
	const indexes = [...original.keys()]
	const [total, ...results] = await readRequiredMulticall(client, [reportingPrincipalRead(game, side), ...indexes.map(index => reportingDepositRead(game, side.outcome, index, 1n))], blockNumber)
	const deposits = results.flatMap(([deposit], offset) => {
		const depositIndex = indexes[offset]
		if (deposit === undefined || depositIndex === undefined || !sameAddress(deposit.depositor, side.depositor)) return []
		return [{ ...deposit, depositIndex, originalAttoRep: original.get(depositIndex) }]
	})
	return { total, deposits }
}

/** Searches two bounded pages. The caller can keep the live position in memory and save only the confirmed cursor. */
export async function searchReportingDepositsPage(client: Pick<ReadClient, 'getBlock' | 'multicall'>, game: Address, side: DepositSide, position?: DepositSearchCursor) {
	const head = await client.getBlock()
	if (head.number === undefined || head.hash === undefined) throw new Error('Deposit search requires a confirmed block.')
	const blockNumber = head.number
	const safeBlockNumber = blockNumber > confirmationDepth ? blockNumber - confirmationDepth : 0n
	const [safeBlock, previousBlock] = await Promise.all([client.getBlock({ blockNumber: safeBlockNumber }), position === undefined || position.block > blockNumber ? undefined : client.getBlock({ blockNumber: position.block })])
	const isContinuation = position !== undefined && previousBlock?.hash === position.hash
	const start = isContinuation ? position.nextIndex : 0n
	const [first, second] = await readRequiredMulticall(client, [reportingDepositRead(game, side.outcome, start, pageSize), reportingDepositRead(game, side.outcome, start + pageSize, pageSize)], blockNumber)
	const [safeCount] = await readOptionalMulticall(client, [{ abi: gameArtifact.abi, address: game, functionName: 'getDepositsByOutcomeLength', args: [getReportingOutcomeValue(side.outcome)] }] as const, safeBlockNumber)
	const [checkedHead, checkedSafeBlock] = await Promise.all([client.getBlock({ blockNumber }), client.getBlock({ blockNumber: safeBlockNumber })])
	if (checkedHead.hash !== head.hash || checkedSafeBlock.hash !== safeBlock.hash) throw new Error('The chain changed during the deposit search. Retry this page.')
	const nextIndex = start + BigInt(first.length + second.length)
	const matches = [...first, ...second].flatMap((deposit, offset) => (sameAddress(deposit.depositor, side.depositor) && deposit.amountAttoRep > 0n ? [{ deposit: { ...side, index: start + BigInt(offset), originalAttoRep: deposit.amountAttoRep }, principal: deposit.amountAttoRep }] : []))
	const safeIndex = safeCount.status === 'success' && safeCount.result < nextIndex ? safeCount.result : nextIndex
	return {
		matches,
		end: second.length < Number(pageSize),
		position: { block: blockNumber, hash: head.hash, nextIndex },
		confirmed: safeCount.status === 'success' && safeBlock.hash !== undefined ? { block: safeBlockNumber, hash: safeBlock.hash, nextIndex: safeIndex } : undefined,
	}
}

export function reportingDepositCursorStore(profile: NetworkProfile, side: DepositSide) {
	const { network, persistence } = localEntityScopeForNetwork(profile, 'statoblast', 'question')
	const storage = getBrowserStorage(persistence === 'session' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:deposit-cursor:v1:${network}:${locatedDepositKey({ ...side, index: 0n })}`
	return {
		read: (): DepositSearchCursor | undefined => {
			try {
				const text = storage?.getItem(key)
				if (text === undefined || text === null) return undefined
				const cursor = parseStoredValue(text)
				if (!isStoredRecord(cursor)) return undefined
				const { block, hash, nextIndex } = cursor
				if (typeof block !== 'bigint' || block < 0n || typeof nextIndex !== 'bigint' || nextIndex < 0n || typeof hash !== 'string' || hash.length !== 66 || !hash.startsWith('0x') || !isHex(hash, { strict: true })) return undefined
				return { block, hash: `0x${hash.slice(2)}`, nextIndex }
			} catch (error) {
				if (error instanceof SyntaxError || error instanceof DOMException) return undefined
				throw error
			}
		},
		write: (cursor: DepositSearchCursor | undefined) => {
			try {
				if (cursor === undefined) storage?.removeItem(key)
				else storage?.setItem(key, serializeStoredValue(cursor))
			} catch (error) {
				if (!(error instanceof DOMException)) throw error
			}
		},
	}
}
