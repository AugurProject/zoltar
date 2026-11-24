import { identifySecurityPoolAdmission } from './securityPoolAdmission.js'
import { getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getZoltarContractAddresses } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'
import type { ReadClient, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import {
	statoblast_EscalationGame_EscalationGame,
	statoblast_QuestionLedger_QuestionLedger,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex,
	statoblast_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'
import { checkStatoblastEntries, type StatoblastEntryResult } from './statoblastEntries.js'
import { designQuestionId } from '../lib/routing.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { QUESTION_LEDGER_QUESTION_OUTCOME_ABI } from './questionLedgerAbi.js'
import { securityPoolCollateral } from './collateral.js'
import { reportingDepositStore } from './reportingDeposits.js'
import { reportingPrincipalRead } from './reportingDepositSearch.js'
import * as copy from '../copy/watchlist.js'
import { decodeStoredValue, type StoredValueReader } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ListedQuestionLedger, TradingShareBalances } from '../types/contracts.js'

export type WatchlistEntity = { id: string; kind: 'pool'; pool: Address } | { id: string; kind: 'question'; pool: Address; questionId: bigint }
export type WatchlistRow = {
	entity: WatchlistEntity
	status: StatoblastEntryResult['status']
	question?: Pick<ListedQuestionLedger, 'ordinaryEscalationGameStarted' | 'questionOutcome' | 'universeHasForked'> & { marketDetails: Pick<ListedQuestionLedger['marketDetails'], 'title' | 'endTime'> }
	shares?: TradingShareBalances
	missingDeposits?: bigint
	reportingPrincipal?: bigint
	escalationEnd?: bigint
	collateralDecimals?: number
	earnedCollateral?: bigint
	earnedRep?: bigint
	collateral?: string
	annualFee?: bigint
	purchaseFee?: bigint
	minimumFee?: bigint
	admission?: 'open' | 'fixed' | 'custom'
	observedAt?: bigint
	nonDecision?: boolean
	priceValid?: boolean
	capacity?: bigint
	commitment?: bigint
	demand?: bigint
	pledged?: bigint
	healthBps?: bigint
}

export function parseWatchlistEntity(id: string, kind: WatchlistEntity['kind']): WatchlistEntity | undefined {
	const [pool, rawId, ...rest] = id.split(':')
	if (pool === undefined || !isAddress(pool) || rest.length !== 0) return undefined
	if (kind === 'pool' && rawId === undefined) return { id, kind, pool: getAddress(pool) }
	if (kind !== 'question' || rawId === undefined) return undefined
	const questionId = designQuestionId(rawId)
	return questionId === undefined ? undefined : { id, kind, pool: getAddress(pool), questionId }
}

function decodeWatchlistRow(value: unknown): WatchlistRow | undefined {
	return decodeStoredValue(value, read => {
		const reference = read.record('entity')
		const entity = parseWatchlistEntity(reference.string('id'), reference.oneOf('kind', ['pool', 'question']))
		if (entity === undefined) return undefined
		const status = read.oneOf('status', ['pool', 'question', 'failed', 'invalid-pool', 'non-statoblast-contract', 'unregistered-question', 'unprepared-question'])
		const row: WatchlistRow = { entity, status }
		for (const key of ['missingDeposits', 'reportingPrincipal', 'escalationEnd', 'earnedCollateral', 'earnedRep', 'annualFee', 'purchaseFee', 'minimumFee', 'observedAt', 'capacity', 'commitment', 'demand', 'pledged', 'healthBps'] as const) {
			const amount = read.optional(key, read.bigint)
			if (amount !== undefined && amount >= 0n) row[key] = amount
		}
		const optional = <K extends 'collateralDecimals' | 'priceValid' | 'collateral' | 'shares' | 'question' | 'admission' | 'nonDecision'>(key: K, reader: (key: string) => NonNullable<WatchlistRow[K]>) => {
			const value = read.optional(key, reader)
			if (value !== undefined) row[key] = value
		}
		optional('collateralDecimals', key => Math.min(36, Math.max(0, Math.trunc(read.number(key)))))
		optional('collateral', read.string)
		optional('priceValid', read.boolean)
		optional('nonDecision', read.boolean)
		optional('admission', key => read.oneOf(key, ['open', 'fixed', 'custom'] as const))
		optional('shares', key => {
			const shares = read.record(key)
			return { yesAttoShares: shares.bigint('yesAttoShares'), noAttoShares: shares.bigint('noAttoShares'), invalidAttoShares: shares.bigint('invalidAttoShares') }
		})
		optional('question', key => readQuestionHeading(read.record(key)))
		return row
	})
}

function readQuestionHeading(read: StoredValueReader) {
	const details = read.record('marketDetails')
	return {
		marketDetails: { title: details.string('title'), endTime: details.bigint('endTime') },
		ordinaryEscalationGameStarted: read.boolean('ordinaryEscalationGameStarted'),
		universeHasForked: read.boolean('universeHasForked'),
		questionOutcome: read.oneOf('questionOutcome', ['none', 'yes', 'no', 'invalid']),
	}
}

export function decodeWatchlistRows(value: unknown): WatchlistRow[] | undefined {
	if (!Array.isArray(value)) return undefined
	return value.flatMap(entry => {
		const row = decodeWatchlistRow(entry)
		return row === undefined ? [] : [row]
	})
}

const poolAbi = statoblast_SecurityPool_SecurityPool.abi
const capitalAbi = statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger.abi
const reportingSides: readonly ReportingOutcomeKey[] = ['invalid', 'yes', 'no']

type ReadWatchlistBatch = <const Calls extends readonly unknown[]>(calls: Calls) => ReturnType<typeof readOptionalMulticall<Calls>>

/** Pool and question rows queue each stage together after their dependencies resolve. */
function watchlistBatch(client: ReadClient, block: bigint): ReadWatchlistBatch {
	type BatchResult = Awaited<ReturnType<typeof readOptionalMulticall>>
	let pending: { calls: readonly unknown[]; resolve: (value: BatchResult) => void; reject: (error: unknown) => void }[] = []
	return <const Calls extends readonly unknown[]>(calls: Calls) => {
		if (pending.length === 0)
			queueMicrotask(() => {
				const staged = pending
				pending = []
				void readOptionalMulticall(
					client,
					staged.flatMap(item => item.calls),
					block,
				).then(
					results => {
						let start = 0
						for (const { calls, resolve } of staged) {
							resolve(results.slice(start, start + calls.length))
							start += calls.length
						}
					},
					error => {
						for (const { reject } of staged) reject(error)
					},
				)
			})
		// Multicall preserves input order. Each call group receives the tuple at its original offsets.
		return new Promise<BatchResult>((resolve, reject) => pending.push({ calls, resolve, reject })) as ReturnType<typeof readOptionalMulticall<Calls>>
	}
}

function rowCollateral(profile: NetworkProfile, address: Address) {
	return (['WETH', 'USDC'] as const).map(symbol => securityPoolCollateral(profile, symbol)).find(token => token.address.toLowerCase() === address.toLowerCase())
}

async function readPoolRow(read: ReadWatchlistBatch, client: ReadClient, block: bigint, entity: WatchlistEntity, owner: Address | undefined, universeId: bigint, profile: NetworkProfile): Promise<WatchlistRow> {
	const address = entity.pool
	const [capital, collateral, fee, purchase, minimum, policy] = await read([
		{ abi: poolAbi, address, functionName: 'capitalLedger', args: [universeId] },
		{ abi: poolAbi, address, functionName: 'collateralToken' },
		{ abi: poolAbi, address, functionName: 'annualFeeBps' },
		{ abi: poolAbi, address, functionName: 'purchaseFeeBps' },
		{ abi: poolAbi, address, functionName: 'minimumPurchaseFeeAttoEth' },
		{ abi: poolAbi, address, functionName: 'questionAdmissionPolicy' },
	])
	const row: WatchlistRow = { entity, status: 'pool' }
	if (collateral.status === 'success') {
		const token = rowCollateral(profile, collateral.result)
		row.collateral = token?.symbol ?? copy.collateralUnits
		row.collateralDecimals = token?.decimals ?? 0
	}
	if (fee.status === 'success') row.annualFee = fee.result
	if (purchase.status === 'success') row.purchaseFee = purchase.result
	if (minimum.status === 'success') row.minimumFee = minimum.result
	if (policy.status === 'success' && policy.result !== zeroAddress) {
		const code = await client.getCode({ address: policy.result, blockNumber: block }).catch(error => {
			if (error instanceof Error) return undefined
			throw error
		})
		if (code !== undefined) row.admission = identifySecurityPoolAdmission(code)
	}
	if (capital.status !== 'success' || capital.result === zeroAddress) return row
	const ledger = capital.result
	const [price, demand, totals, position, account, index, conservativePrice, multiplier] = await read([
		{ abi: capitalAbi, address: ledger, functionName: 'isPriceValid' },
		{ abi: capitalAbi, address: ledger, functionName: 'demandAttoEth' },
		{ abi: capitalAbi, address: ledger, functionName: 'totals' },
		{ abi: capitalAbi, address: ledger, functionName: 'ownerCollateral', args: [owner ?? zeroAddress] },
		{ abi: capitalAbi, address: ledger, functionName: 'ownerAccount', args: [owner ?? zeroAddress] },
		{ abi: capitalAbi, address: ledger, functionName: 'commitmentIndex' },
		{ abi: capitalAbi, address: ledger, functionName: 'ownerConservativePrice', args: [owner ?? zeroAddress] },
		{ abi: capitalAbi, address: ledger, functionName: 'securityMultiplierBps' },
	])
	if (totals.status === 'success') row.capacity = totals.result[2]
	if (price.status === 'success') row.priceValid = price.result
	if (demand.status === 'success') row.demand = demand.result
	if (owner !== undefined && account.status === 'success') {
		row.earnedCollateral = account.result.feesAttoEth
		row.earnedRep = account.result.feesAttoRep
		if (position.status === 'success') {
			const [principal, commitment] = position.result
			row.commitment = commitment
			if (account.result.positionId === 0n) row.pledged = commitment === 0n ? 0n : principal - account.result.freeAttoRep
			else if (index.status === 'success' && index.result !== zeroAddress) {
				const [deposited] = await read([{ abi: statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex.abi, address: index.result, functionName: 'accountOf', args: [account.result.positionId] }])
				if (deposited.status === 'success') row.pledged = principal - account.result.freeAttoRep - deposited.result.releasedRep
			}
			if (row.pledged !== undefined && price.status === 'success' && price.result && conservativePrice.status === 'success' && multiplier.status === 'success') {
				// Match the capital ledger's nested upward rounding for full backing.
				const value = (commitment * conservativePrice.result + 10n ** 18n - 1n) / 10n ** 18n
				const backing = (value * multiplier.result + 9_999n) / 10_000n
				if (backing > 0n) row.healthBps = (row.pledged * 10_000n) / backing
			}
		}
	}
	return row
}

async function readQuestionRow(read: ReadWatchlistBatch, entity: Extract<WatchlistEntity, { kind: 'question' }>, ledger: Address, owner: Address | undefined, universeId: bigint, profile: NetworkProfile, includeDeposits: boolean): Promise<WatchlistRow> {
	const infrastructure = getInfraContractAddresses(profile)
	const questionData = getZoltarContractAddresses(profile).zoltarQuestionData
	const ledgerAbi = statoblast_QuestionLedger_QuestionLedger.abi
	const gameAbi = statoblast_EscalationGame_EscalationGame.abi
	const [token, game, collateral, market, outcome, fork] = await read([
		{ abi: ledgerAbi, address: ledger, functionName: 'shareToken' },
		{ abi: ledgerAbi, address: ledger, functionName: 'escalationGame' },
		{ abi: poolAbi, address: entity.pool, functionName: 'collateralToken' },
		{ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'questions', args: [entity.questionId] },
		{ abi: QUESTION_LEDGER_QUESTION_OUTCOME_ABI, address: infrastructure.questionForker, functionName: 'getQuestionOutcome', args: [ledger] },
		{ abi: Zoltar_Zoltar.abi, address: infrastructure.zoltar, functionName: 'getForkTime', args: [universeId] },
	])
	const row: WatchlistRow = { entity, status: 'question' }
	if (collateral.status === 'success') {
		const knownToken = rowCollateral(profile, collateral.result)
		row.collateral = knownToken?.symbol ?? copy.collateralUnits
		row.collateralDecimals = knownToken?.decimals ?? 0
	}
	const gameAddress = game.status === 'success' && game.result !== zeroAddress ? game.result : undefined
	const gameReads =
		gameAddress === undefined
			? undefined
			: read([
					{ abi: gameAbi, address: gameAddress, functionName: 'getEscalationGameEndDate' },
					{ abi: gameAbi, address: gameAddress, functionName: 'forkContinuation' },
					{ abi: gameAbi, address: gameAddress, functionName: 'hasReachedNonDecision' },
				])
	const sharesRead = owner !== undefined && token.status === 'success' && token.result !== zeroAddress ? read([{ abi: statoblast_tokens_ShareToken_ShareToken.abi, address: token.result, functionName: 'balanceOfShares', args: [universeId, owner] }]) : undefined
	const totalsRead = gameAddress === undefined || owner === undefined || !includeDeposits ? undefined : read(reportingSides.map(outcome => reportingPrincipalRead(gameAddress, { outcome, depositor: owner })))
	const [gameResult, sharesResult, totals] = await Promise.all([gameReads, sharesRead, totalsRead])
	const [deadline, continuation, nonDecision] = gameResult ?? []
	if (nonDecision?.status === 'success') row.nonDecision = nonDecision.result
	if (deadline?.status === 'success') row.escalationEnd = deadline.result
	if (market.status === 'success' && outcome.status === 'success' && fork.status === 'success' && game.status === 'success') {
		row.question = {
			marketDetails: { title: market.result[0], endTime: market.result[3] },
			ordinaryEscalationGameStarted: gameAddress !== undefined && continuation?.status === 'success' && !continuation.result,
			universeHasForked: fork.result > 0n,
			questionOutcome: getReportingOutcomeKey(outcome.result),
		}
	}
	const [shares] = sharesResult ?? []
	if (shares?.status === 'success') {
		const [invalidAttoShares, yesAttoShares, noAttoShares] = shares.result
		row.shares = { invalidAttoShares, yesAttoShares, noAttoShares }
	}
	if (gameAddress !== undefined && owner !== undefined && totals !== undefined && totals.every(result => result.status === 'success')) {
		const total = totals.reduce((sum, result) => sum + (result.status === 'success' ? result.result : 0n), 0n)
		row.reportingPrincipal = total
		if (total === 0n) return row
		const saved = reportingDepositStore(profile)
			.read()
			.filter(deposit => deposit.pool.toLowerCase() === entity.pool.toLowerCase() && deposit.questionId === entity.questionId && deposit.universeId === universeId && deposit.depositor.toLowerCase() === owner.toLowerCase())
		const indices = saved.map(({ outcome, index }) => ({ abi: gameAbi, address: gameAddress, functionName: 'getDepositsByOutcome', args: [reportingSides.indexOf(outcome), index, 1n] }) as const)
		const matches = indices.length === 0 ? [] : await read(indices)
		if (matches.some(result => result.status === 'failure')) return row
		const found = matches.reduce((sum, result) => {
			const deposit = result.status === 'success' ? result.result[0] : undefined
			return deposit?.depositor.toLowerCase() === owner.toLowerCase() ? sum + deposit.amountAttoRep : sum
		}, 0n)
		if (total > found) row.missingDeposits = total - found
	}
	return row
}

type WatchlistReadOptions = { includeDeposits?: boolean; onChunk?: (rows: readonly WatchlistRow[], finished: number, total: number, anchor: { number: bigint; timestamp: bigint }) => void }

export async function loadWatchlistRows(client: ReadClient, entries: readonly WatchlistEntity[], universeId: bigint, owner: Address | undefined, profile: NetworkProfile, { onChunk, includeDeposits = true }: WatchlistReadOptions = {}) {
	if (entries.length === 0) return []
	const head = await client.getBlock()
	if (head.number === undefined) throw new Error('Watchlist refresh requires a mined block.')
	const block = head.number
	const rows: WatchlistRow[] = []
	for (let offset = 0; offset < entries.length; offset += 25) {
		const chunk = entries.slice(offset, offset + 25)
		const checks = await checkStatoblastEntries(
			client,
			chunk.map(entry => ({ ...entry, universeId })),
			block,
			true,
		)
		const read = watchlistBatch(client, block)
		const batch = await Promise.all(
			chunk.map(async (entry, index): Promise<WatchlistRow> => {
				const result = checks[index]
				if (result?.status === 'failed') throw result.error
				if (result?.status === 'pool') return await readPoolRow(read, client, block, entry, owner, universeId, profile)
				if (result?.status === 'question' && entry.kind === 'question') return { ...(await readQuestionRow(read, entry, result.ledger, owner, universeId, profile, includeDeposits)), observedAt: head.timestamp }
				return { entity: entry, status: result?.status ?? 'failed' }
			}),
		)
		rows.push(...batch)
		onChunk?.(batch, Math.min(offset + 25, entries.length), entries.length, { number: block, timestamp: head.timestamp })
	}
	return rows
}
