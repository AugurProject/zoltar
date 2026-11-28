import { readCollateralMetadata } from './collateral-metadata.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { abiForKind } from './abi-catalog.ts'
import { capitalLedgerSnapshot, capitalOwnerSnapshot, capitalPositionSnapshot } from './capital-snapshots.ts'
import { sampleClaimPositions } from './claim-snapshots.ts'
import { type Abi, type AbiValue, type Address, getAddress } from './ethereum.ts'
import type { SystemContractKind } from './system-interfaces.ts'

const snapshotEntityTypes = ['auction', 'capital-ledger', 'capital-owner', 'capital-position', 'escalation', 'pool'] as const

export type StateSnapshotTarget = {
	readonly entityType: (typeof snapshotEntityTypes)[number]
	readonly entityIdentity: string
	readonly address: Address
	readonly coordinatorAddress?: Address | undefined
	// A capital owner's identity is its ledger and its address; `address` is the ledger.
	readonly ownerAddress?: Address | undefined
	// A capital position's identity is its ledger and its id; `address` is the ledger.
	readonly positionId?: bigint | undefined
}

export type EntityStateSnapshot = {
	readonly entityType: StateSnapshotTarget['entityType']
	readonly entityIdentity: string
	readonly sourceMethod: string
	readonly readStatus: 'failed' | 'success'
	readonly readResult?: Readonly<Record<string, unknown>>
	readonly readFailureReason?: string
}

const snapshotAbi = (kind: SystemContractKind): Abi => {
	const abi = abiForKind(kind)
	if (abi === undefined) throw new Error(`Missing snapshot ABI ${kind}`)
	return abi
}

const poolAbi = snapshotAbi('questionLedger')
const coordinatorAbi = snapshotAbi('sharedPoolPriceFeed')
const escalationAbi = snapshotAbi('escalationGame')
const auctionAbi = snapshotAbi('securityPoolUniformPriceRepairAuction')

export type StateRead = (address: Address, abi: Abi, functionName: string, args?: readonly AbiValue[]) => Promise<unknown>

const exact = (value: unknown, name: string): string => {
	if (typeof value !== 'bigint') throw new Error(`${name} returned an invalid value`)
	return value.toString()
}

const flag = (value: unknown, name: string): boolean => {
	if (typeof value !== 'boolean') throw new Error(`${name} returned an invalid value`)
	return value
}

const tuple = (value: unknown, length: number, name: string): readonly unknown[] => {
	if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} returned an invalid tuple`)
	return value
}

const failureReason = (error: unknown): string => {
	const raw = error instanceof Error ? error.message : 'Tagged contract read failed'
	return raw.replace(/\s+/gu, ' ').trim().slice(0, 500) || 'Tagged contract read failed'
}

// Sample the source book used by SecurityPoolSettlementBook._quoteRedemption. A matured question with no
// frozen book yet reserves its full-question cash first. In either case the wallet quote then uses two floors.
const settledClaimSnapshot = async (pool: Address, securityPool: Address, shareSupply: string, fullQuote: string, read: StateRead) => {
	const call = (target: Address, kind: SystemContractKind, name: string, args?: readonly AbiValue[]) => read(target, snapshotAbi(kind), name, args)
	const forker = getAddress(String(await read(pool, poolAbi, 'questionForker')))
	const outcome = exact(await call(forker, 'questionForker', 'getQuestionOutcome', [pool]), 'getQuestionOutcome')
	if (!['0', '1', '2'].includes(outcome)) return undefined
	const [rawSettlement, rawUniverse, rawQuestion] = await Promise.all([call(securityPool, 'securityPool', 'settlement'), read(pool, poolAbi, 'universeId'), read(pool, poolAbi, 'questionId')])
	const settlement = getAddress(String(rawSettlement))
	const universe = BigInt(exact(rawUniverse, 'universeId'))
	const question = BigInt(exact(rawQuestion, 'questionId'))
	const [rawBook, rawId] = await Promise.all([call(settlement, 'securityPoolSettlement', 'ledger'), call(settlement, 'securityPoolSettlement', 'bookIds', [universe])])
	const book = getAddress(String(rawBook))
	const bookId = BigInt(exact(rawId, 'bookIds'))
	const [rawState, rawFrozen] = tuple(await call(book, 'securityPoolSettlementBook', 'scaledQuestion', [bookId, question]), 2, 'scaledQuestion')
	if (!isPlainRecord(rawState)) throw new Error('scaledQuestion returned an invalid question')
	const questionUnits = exact(rawState['units'], 'question.units')
	const supply = exact(rawState['outcomeSupplyAttoShares'], 'question.supply')
	if (supply !== shareSupply) return undefined
	const frozen = BigInt(exact(rawFrozen, 'scaledQuestion.frozenBookId'))
	if (frozen !== 0n) {
		const [cash, units, source] = tuple(await call(book, 'securityPoolSettlementBook', 'frozenBooks', [frozen]), 4, 'frozenBooks')
		if (source !== bookId) return undefined
		return { outcome, supply, questionUnits, bookUnits: exact(units, 'frozenBook.units'), bookCash: exact(cash, 'frozenBook.cash') }
	}
	const [rawBookState, rawClock] = await Promise.all([call(book, 'securityPoolSettlementBook', 'books', [bookId]), call(securityPool, 'securityPool', 'securityPoolTime', [universe])])
	const bookState = tuple(rawBookState, 15, 'books')
	const clock = BigInt(exact(rawClock, 'securityPoolTime'))
	const deadline = BigInt(exact(rawState['finalAfter'], 'question.finalAfter'))
	if (bookState[7] !== false || deadline === 0n || deadline >= clock || BigInt(exact(bookState[11], 'book.minimumFinalAfter')) >= clock) return undefined
	return { outcome, supply, questionUnits, bookUnits: questionUnits, bookCash: fullQuote }
}

const poolSnapshot = async (target: StateSnapshotTarget, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const address = target.address
	const values = await Promise.all([
		read(address, poolAbi, 'settlementCollateralAttoEth'),
		read(address, poolAbi, 'systemState'),
		read(address, poolAbi, 'awaitingForkContinuation'),
		read(address, poolAbi, 'isEscalationResolved'),
		read(address, poolAbi, 'shareTokenSupplyAttoShares'),
		read(address, poolAbi, 'statoblastSecurityMultiplierBps'),
	])
	const supply = exact(values[4], 'shareTokenSupplyAttoShares')
	const settlement = exact(await read(address, poolAbi, 'attoSharesToAttoEth', [BigInt(supply)]), 'attoSharesToAttoEth(supply)')
	const result: Record<string, unknown> = {
		settlementCollateralAttoEth: exact(values[0], 'settlementCollateralAttoEth'),
		questionSettlementAttoEth: settlement,
		// Average value avoids requesting a whole share when less than one remains.
		averageValueAttoEthPerShare: undefined,
		systemState: exact(values[1], 'systemState'),
		awaitingForkContinuation: flag(values[2], 'awaitingForkContinuation'),
		escalationResolved: flag(values[3], 'isEscalationResolved'),
		shareTokenSupplyAttoShares: supply,
		securityMultiplierBps: exact(values[5], 'statoblastSecurityMultiplierBps'),
	}
	// ERC20 metadata is optional. A failed metadata read must not erase an otherwise valid accounting snapshot.
	try {
		const factory = getAddress(String(await read(address, poolAbi, 'securityPoolFactory')))
		const securityPool = getAddress(String(await read(factory, snapshotAbi('securityPoolFactory'), 'securityPoolOf', [address])))
		if (values[3] === true && result['systemState'] === '0') {
			try {
				const claim = await settledClaimSnapshot(address, securityPool, supply, settlement, read)
				if (claim !== undefined) result['settlementClaim'] = claim
			} catch (error) {
				result['settlementClaimError'] = errorMessage(error)
			}
		}
		const token = getAddress(String(await read(securityPool, snapshotAbi('securityPool'), 'collateralToken')))
		try {
			const metadata = await readCollateralMetadata(token, read)
			const { decimals } = metadata
			result['collateral'] = metadata
			result['averageValueAttoEthPerShare'] = BigInt(supply) === 0n ? '0' : ((BigInt(settlement) * 10n ** BigInt(decimals)) / BigInt(supply)).toString()
		} catch (error) {
			result['collateralMetadataError'] = errorMessage(error)
			result['collateral'] = { address: token.toLowerCase(), symbol: 'collateral units', decimals: 0 }
		}
	} catch (error) {
		result['collateralMetadataError'] = errorMessage(error)
		// Browser presentation uses explicit raw collateral units until token identity can be sampled.
	}
	if (target.coordinatorAddress !== undefined) {
		const coordinator = target.coordinatorAddress
		const price = await Promise.all([read(coordinator, coordinatorAbi, 'lastPrice'), read(coordinator, coordinatorAbi, 'lastSettlementTimestamp'), read(coordinator, coordinatorAbi, 'isPriceValid')])
		const feedAddress = coordinator
		if (typeof feedAddress !== 'string') throw new Error('priceFeed returned an invalid address')
		result['price'] = {
			repPerEth1e18: exact(price[0], 'lastPrice'),
			settlementTimestamp: exact(price[1], 'lastSettlementTimestamp'),
			protocolValid: flag(price[2], 'isPriceValid'),
			sourceContract: getAddress(feedAddress).toLowerCase(),
		}
	}
	return result
}

const escalationSnapshot = async (target: StateSnapshotTarget, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const values = await Promise.all([
		read(target.address, escalationAbi, 'activationTime'),
		read(target.address, escalationAbi, 'startBondAttoRep'),
		read(target.address, escalationAbi, 'nonDecisionThresholdAttoRep'),
		read(target.address, escalationAbi, 'nonDecisionTimestamp'),
		read(target.address, escalationAbi, 'totalDisputeStakedAttoRep'),
		read(target.address, escalationAbi, 'getEscalationGameEndDate'),
		read(target.address, escalationAbi, 'getQuestionResolution'),
		read(target.address, escalationAbi, 'getFinalQuestionResolution'),
		read(target.address, escalationAbi, 'getBindingCapitalAttoRep'),
		read(target.address, escalationAbi, 'getOutcomeBalancesAttoRep'),
	])
	const balances = tuple(values[9], 3, 'getOutcomeBalancesAttoRep')
	return {
		activationTime: exact(values[0], 'activationTime'),
		startBondAttoRep: exact(values[1], 'startBondAttoRep'),
		nonDecisionThresholdAttoRep: exact(values[2], 'nonDecisionThresholdAttoRep'),
		nonDecisionTimestamp: exact(values[3], 'nonDecisionTimestamp'),
		totalDisputeStakedAttoRep: exact(values[4], 'totalDisputeStakedAttoRep'),
		endTimestamp: exact(values[5], 'getEscalationGameEndDate'),
		questionResolution: exact(values[6], 'getQuestionResolution'),
		finalQuestionResolution: exact(values[7], 'getFinalQuestionResolution'),
		bindingCapitalAttoRep: exact(values[8], 'getBindingCapitalAttoRep'),
		outcomeBalancesAttoRep: balances.map((value, index) => exact(value, `getOutcomeBalancesAttoRep[${index}]`)),
	}
}

const auctionSnapshot = async (target: StateSnapshotTarget, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	const quantities = ['closesAt', 'lotAttoEth', 'targetLots', 'inventoryAttoRep', 'maximumBidAttoRepPerLot', 'repGrid', 'depositedAttoEth', 'bidCount'] as const
	const values = await Promise.all(quantities.map(name => read(target.address, auctionAbi, name)))
	const [initialized, finalized, rawClearing] = await Promise.all([read(target.address, auctionAbi, 'initialized'), read(target.address, auctionAbi, 'finalized'), read(target.address, auctionAbi, 'clearing')])
	const clearing = tuple(rawClearing, 5, 'clearing')
	// Bids, clearing proceeds and refunds are amounts of the auction's collateral token, not native ETH.
	// Token metadata is optional: a failed read keeps the accounting snapshot and leaves explicit raw collateral units.
	const collateral: Record<string, unknown> = {}
	try {
		const token = getAddress(String(await read(target.address, auctionAbi, 'collateralToken')))
		try {
			collateral['collateral'] = await readCollateralMetadata(token, read)
		} catch (error) {
			collateral['collateralMetadataError'] = errorMessage(error)
			collateral['collateral'] = { address: token.toLowerCase(), symbol: 'collateral units', decimals: 0 }
		}
	} catch (error) {
		collateral['collateralMetadataError'] = errorMessage(error)
	}
	return {
		...Object.fromEntries(quantities.map((name, index) => [name, exact(values[index], name)])),
		initialized: flag(initialized, 'initialized'),
		finalized: flag(finalized, 'finalized'),
		clearing: {
			attoRepPerLot: exact(clearing[0], 'clearing.attoRepPerLot'),
			filledLots: exact(clearing[1], 'clearing.filledLots'),
			raisedAttoEth: exact(clearing[2], 'clearing.raisedAttoEth'),
			soldAttoRep: exact(clearing[3], 'clearing.soldAttoRep'),
			raiseLimitReached: flag(clearing[4], 'clearing.raiseLimitReached'),
		},
		...collateral,
	}
}

const ENTITY_SNAPSHOTS: Record<StateSnapshotTarget['entityType'], (target: StateSnapshotTarget, read: StateRead) => Promise<Readonly<Record<string, unknown>>>> = {
	auction: auctionSnapshot,
	'capital-ledger': (target, read) => capitalLedgerSnapshot(target.address, read),
	'capital-owner': (target, read) => {
		if (target.ownerAddress === undefined) throw new Error('Capital owner snapshot is missing its owner')
		return capitalOwnerSnapshot(target.address, target.ownerAddress, read)
	},
	'capital-position': (target, read) => {
		if (target.positionId === undefined) throw new Error('Capital position snapshot is missing its id')
		return capitalPositionSnapshot(target.address, target.positionId, read)
	},
	escalation: escalationSnapshot,
	pool: poolSnapshot,
}

const entitySnapshot = (target: StateSnapshotTarget, read: StateRead) => ENTITY_SNAPSHOTS[target.entityType](target, read)

export const sampleEntityStateWithRead = async (target: StateSnapshotTarget, read: StateRead, onFailure: (error: unknown) => void = () => {}): Promise<EntityStateSnapshot> => {
	const sourceMethod = `augurscan.${target.entityType}-state.v1`
	const failures: unknown[] = []
	const pending = new Set<Promise<unknown>>()
	const observedRead: StateRead = (address, abi, functionName, args) => {
		const operation = read(address, abi, functionName, args).catch((error: unknown) => {
			failures.push(error)
			throw error
		})
		pending.add(operation)
		void operation.then(
			() => pending.delete(operation),
			() => pending.delete(operation),
		)
		return operation
	}
	try {
		let readResult = await entitySnapshot(target, observedRead)
		if (target.entityType === 'escalation') {
			try {
				readResult = { ...readResult, claimEvidence: await sampleClaimPositions(target.address, read, readResult) }
			} catch (error) {
				onFailure(error)
				readResult = { ...readResult, claimEvidence: { status: 'unavailable', reason: failureReason(error) } }
			}
		}
		return { entityType: target.entityType, entityIdentity: target.entityIdentity, sourceMethod, readStatus: 'success', readResult }
	} catch (error) {
		await Promise.allSettled([...pending])
		if (failures.length === 0) onFailure(error)
		else for (const failure of failures) onFailure(failure)
		return {
			entityType: target.entityType,
			entityIdentity: target.entityIdentity,
			sourceMethod,
			readStatus: 'failed',
			readFailureReason: failureReason(error),
		}
	}
}

export const normalizeSnapshotTarget = (row: Record<string, unknown>): StateSnapshotTarget => {
	const entityType = snapshotEntityTypes.find(type => type === row['entity_type'])
	if (entityType === undefined) throw new Error(`Unsupported snapshot entity type ${String(row['entity_type'])}`)
	const positionId = row['position_id']
	if (positionId !== null && positionId !== undefined && (typeof positionId !== 'string' || !/^\d+$/.test(positionId))) throw new Error('Snapshot target position id is invalid')
	const optionalAddress = (key: string): Address | undefined => {
		const value = row[key]
		return value === null || value === undefined ? undefined : getAddress(String(value))
	}
	return {
		entityType,
		entityIdentity: String(row['entity_identity']),
		address: getAddress(String(row['address'])),
		...(optionalAddress('coordinator_address') === undefined ? {} : { coordinatorAddress: optionalAddress('coordinator_address') }),
		...(optionalAddress('owner_address') === undefined ? {} : { ownerAddress: optionalAddress('owner_address') }),
		...(typeof positionId === 'string' ? { positionId: BigInt(positionId) } : {}),
	}
}
