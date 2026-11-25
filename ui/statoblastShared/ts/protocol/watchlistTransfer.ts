import { isAddress, getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { formatQuestionIdHex, normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import { localEntityScopeForNetwork, readFavoriteEntries, setEntityFavorite, setEntityFavoriteLabel } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { statoblast_QuestionLedger_QuestionLedger as ledgerArtifact } from '../contractArtifact.js'
import { readLocatedDeposit, reportingDepositStore } from './reportingDeposits.js'
import { reportingDepositRead } from './reportingDepositSearch.js'
import { checkStatoblastEntries } from './statoblastEntries.js'

type SavedWatchlistEntry = { kind: 'pool'; pool: Address; label?: string } | { kind: 'question'; pool: Address; questionId: bigint; label?: string }

function unsignedDecimal(value: unknown) {
	return typeof value === 'string' && /^\d{1,78}$/u.test(value) ? BigInt(value) : undefined
}

function readSavedEntry(value: unknown): SavedWatchlistEntry | undefined {
	if (!isStoredRecord(value) || typeof value['pool'] !== 'string' || !isAddress(value['pool']) || sameAddress(value['pool'], zeroAddress)) return undefined
	const pool = getAddress(value['pool'])
	const label = typeof value['label'] === 'string' ? { label: value['label'] } : {}
	if (value['kind'] === 'pool') return { kind: 'pool', pool, ...label }
	if (value['kind'] !== 'question') return undefined
	const questionId = unsignedDecimal(value['questionId'])
	return questionId === undefined || questionId >= 1n << 256n ? undefined : { kind: 'question', pool, questionId, ...label }
}

function readDeposit(value: unknown) {
	if (!isStoredRecord(value)) return undefined
	return readLocatedDeposit({ ...value, originalAttoRep: undefined, questionId: unsignedDecimal(value['questionId']), universeId: unsignedDecimal(value['universeId']), index: unsignedDecimal(value['index']) })
}

export function exportStatoblastWatchlist(profile: NetworkProfile) {
	const savedPools = readFavoriteEntries(localEntityScopeForNetwork(profile, 'statoblast', 'pool')).map(({ id, label }) => ({ kind: 'pool', pool: id, label }))
	const savedQuestions = readFavoriteEntries(localEntityScopeForNetwork(profile, 'statoblast', 'question')).flatMap(({ id, label }) => {
		const [pool, rawQuestionId] = id.split(':')
		const questionId = rawQuestionId === undefined ? undefined : normalizeQuestionId(rawQuestionId)
		if (pool === undefined || !isAddress(pool) || questionId === undefined) return []
		return [{ kind: 'question', pool, questionId: BigInt(questionId).toString(), label }]
	})
	const deposits = reportingDepositStore(profile)
		.read()
		.map(({ pool, questionId, universeId, outcome, depositor, index }) => ({ pool, questionId: questionId.toString(), universeId: universeId.toString(), outcome, depositor, index: index.toString() }))
	return JSON.stringify({ version: 1, chainId: profile.chain.id, saved: [...savedPools, ...savedQuestions], deposits })
}

export async function importStatoblastWatchlist(client: Pick<ReadClient, 'getBlock' | 'multicall'>, profile: NetworkProfile, activeUniverseId: bigint, contents: string, isCurrent = () => true) {
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		throw new Error('Not a Statoblast watchlist file.', { cause: error })
	}
	if (!isStoredRecord(value) || value['version'] !== 1 || !Number.isSafeInteger(value['chainId']) || !Array.isArray(value['saved']) || !Array.isArray(value['deposits'])) throw new Error('Not a Statoblast watchlist file.')
	if (value['chainId'] !== profile.chain.id) throw new Error('This file is for another network.')
	const saved = value['saved'].map(readSavedEntry).filter(entry => entry !== undefined)
	const deposits = value['deposits'].map(readDeposit).filter(deposit => deposit !== undefined)
	const acceptedSaved: SavedWatchlistEntry[] = []
	const acceptedDeposits: typeof deposits = []
	const block = await client.getBlock()
	if (block.number === undefined || block.hash === undefined) throw new Error('Watchlist import requires a mined block.')
	const blockNumber = block.number
	// Import checks factory membership before calling a pool. It never needs bytecode from a rejected address.
	const entryClient: Pick<ReadClient, 'multicall'> = { multicall: request => client.multicall(request) }
	const requireEnvironment = () => {
		if (!isCurrent()) throw new Error('The network changed during watchlist import. Try again.')
	}

	for (let start = 0; start < saved.length; start += 25) {
		requireEnvironment()
		const page = saved.slice(start, start + 25)
		const states = await checkStatoblastEntries(
			entryClient,
			page.map(entry => ({ ...entry, universeId: activeUniverseId })),
			blockNumber,
		)
		for (const [index, entry] of page.entries()) {
			const state = states[index]
			if (state?.status === 'failed') throw state.error
			if (state?.status === 'pool' || state?.status === 'question' || state?.status === 'unprepared-question') acceptedSaved.push(entry)
		}
	}
	for (let start = 0; start < deposits.length; start += 25) {
		requireEnvironment()
		const page = deposits.slice(start, start + 25)
		const states = await checkStatoblastEntries(entryClient, page, blockNumber)
		const located = page.flatMap((deposit, index) => {
			const state = states[index]
			if (state?.status === 'failed') throw state.error
			return state?.status === 'question' ? [{ deposit, ledger: state.ledger }] : []
		})
		if (located.length === 0) continue
		requireEnvironment()
		const games = await readOptionalMulticall(
			client,
			located.map(({ ledger }) => ({ abi: ledgerArtifact.abi, address: ledger, functionName: 'escalationGame' }) as const),
			blockNumber,
		)
		const candidates = located.flatMap(({ deposit }, index) => {
			const game = games[index]
			if (game?.status === 'failure') throw game.error
			return game?.status === 'success' && !sameAddress(game.result, zeroAddress) ? [{ deposit, game: game.result }] : []
		})
		if (candidates.length === 0) continue
		requireEnvironment()
		const checks = await readOptionalMulticall(
			client,
			candidates.map(({ deposit, game }) => reportingDepositRead(game, deposit.outcome, deposit.index, 1n)),
			blockNumber,
		)
		for (const [index, { deposit }] of candidates.entries()) {
			const result = checks[index]
			if (result?.status === 'failure') throw result.error
			if (result?.status === 'success' && sameAddress(result.result[0]?.depositor, deposit.depositor)) acceptedDeposits.push(deposit)
		}
	}
	if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error('The chain changed during watchlist import. Try again.')
	requireEnvironment()
	reportingDepositStore(profile).add(acceptedDeposits)
	for (const entry of acceptedSaved) {
		const id = entry.kind === 'pool' ? entry.pool : `${entry.pool}:${formatQuestionIdHex(entry.questionId)}`
		const scope = localEntityScopeForNetwork(profile, 'statoblast', entry.kind)
		if (entry.label === undefined) setEntityFavorite(scope, id, true)
		else setEntityFavoriteLabel(scope, id, entry.label, false)
	}
	return { skipped: value['saved'].length + value['deposits'].length - acceptedSaved.length - acceptedDeposits.length }
}
