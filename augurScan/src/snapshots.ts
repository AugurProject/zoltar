import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { abiForKind } from './abi-catalog.ts'
import { sampleClaimPositions } from './claim-snapshots.ts'
import { type Abi, type AbiValue, type Address, getAddress } from './ethereum.ts'
import type { SystemContractKind } from './system-interfaces.ts'

export type StateSnapshotTarget = {
	readonly entityType: 'auction' | 'escalation' | 'pool'
	readonly entityIdentity: string
	readonly address: Address
	readonly poolAddress?: Address | undefined
	readonly coordinatorAddress?: Address | undefined
	readonly escalationAddress?: Address | undefined
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

const poolAbi = snapshotAbi('securityPool')
const coordinatorAbi = snapshotAbi('priceCoordinator')
const escalationAbi = snapshotAbi('escalationGame')
const auctionAbi = snapshotAbi('securityPoolUniformPriceAuction')

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
		const portfolio = getAddress(String(await read(factory, snapshotAbi('securityPoolFactory'), 'getSecurityPoolPortfolio', [address])))
		const token = getAddress(String(await read(portfolio, snapshotAbi('securityPoolPortfolio'), 'collateralToken')))
		try {
			const [symbol, units] = await Promise.all([read(token, snapshotAbi('iERC20Metadata'), 'symbol'), read(token, snapshotAbi('iERC20Metadata'), 'decimals')])
			const decimals = Number(units)
			if (typeof symbol !== 'string' || symbol.trim() === '' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid collateral metadata')
			result['collateral'] = { address: token.toLowerCase(), symbol, decimals }
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
		const price = await Promise.all([read(coordinator, coordinatorAbi, 'lastPrice'), read(coordinator, coordinatorAbi, 'lastSettlementTimestamp'), read(coordinator, coordinatorAbi, 'isPriceValid'), read(coordinator, coordinatorAbi, 'priceFeed')])
		const feedAddress = price[3]
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
	const quantities = ['opensAt', 'closesAt', 'lotAttoEth', 'targetLots', 'inventoryAttoRep', 'maximumBidAttoRepPerLot', 'repGrid', 'depositedAttoEth', 'bidCount'] as const
	const values = await Promise.all(quantities.map(name => read(target.address, auctionAbi, name)))
	const [initialized, finalized, rawClearing] = await Promise.all([read(target.address, auctionAbi, 'initialized'), read(target.address, auctionAbi, 'finalized'), read(target.address, auctionAbi, 'clearing')])
	const clearing = tuple(rawClearing, 10, 'clearing')
	return {
		...Object.fromEntries(quantities.map((name, index) => [name, exact(values[index], name)])),
		initialized: flag(initialized, 'initialized'),
		finalized: flag(finalized, 'finalized'),
		clearing: {
			attoRepPerLot: exact(clearing[0], 'clearing.attoRepPerLot'),
			filledLots: exact(clearing[1], 'clearing.filledLots'),
			raisedAttoEth: exact(clearing[2], 'clearing.raisedAttoEth'),
			soldAttoRep: exact(clearing[3], 'clearing.soldAttoRep'),
			roundingAttoRep: exact(clearing[4], 'clearing.roundingAttoRep'),
			marginalMinimumAttoRepPerLot: exact(clearing[5], 'clearing.marginalMinimumAttoRepPerLot'),
			marginalFillLots: exact(clearing[6], 'clearing.marginalFillLots'),
			marginalDemandLots: exact(clearing[7], 'clearing.marginalDemandLots'),
			fullBeforeLots: exact(clearing[8], 'clearing.fullBeforeLots'),
			raiseLimitReached: flag(clearing[9], 'clearing.raiseLimitReached'),
		},
	}
}

const ENTITY_SNAPSHOTS: Record<StateSnapshotTarget['entityType'], (target: StateSnapshotTarget, read: StateRead) => Promise<Readonly<Record<string, unknown>>>> = {
	auction: auctionSnapshot,
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
	const entityType = String(row['entity_type'])
	if (entityType !== 'auction' && entityType !== 'escalation' && entityType !== 'pool') throw new Error(`Unsupported snapshot entity type ${entityType}`)
	const optionalAddress = (key: string): Address | undefined => {
		const value = row[key]
		return value === null || value === undefined ? undefined : getAddress(String(value))
	}
	return {
		entityType,
		entityIdentity: String(row['entity_identity']),
		address: getAddress(String(row['address'])),
		...(optionalAddress('pool_address') === undefined ? {} : { poolAddress: optionalAddress('pool_address') }),
		...(optionalAddress('coordinator_address') === undefined ? {} : { coordinatorAddress: optionalAddress('coordinator_address') }),
		...(optionalAddress('escalation_address') === undefined ? {} : { escalationAddress: optionalAddress('escalation_address') }),
	}
}
