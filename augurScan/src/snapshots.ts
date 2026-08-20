import { type Abi, type Address, getAddress, type PublicClient, parseAbi } from './ethereum.ts'

export type StateSnapshotTarget = {
	readonly entityType: 'auction' | 'escalation' | 'pool' | 'vault'
	readonly entityIdentity: string
	readonly address: Address
	readonly poolAddress?: Address
	readonly coordinatorAddress?: Address
	readonly escalationAddress?: Address
}

export type EntityStateSnapshot = {
	readonly entityType: StateSnapshotTarget['entityType']
	readonly entityIdentity: string
	readonly sourceMethod: string
	readonly readStatus: 'failed' | 'success'
	readonly readResult?: Readonly<Record<string, unknown>>
	readonly readFailureReason?: string
}

const poolAbi = parseAbi([
	'function settlementCollateralAttoEth() view returns (uint256)',
	'function totalCapacityOwnershipAttoRep() view returns (uint256)',
	'function totalRepBackingUnits() view returns (uint256)',
	'function totalClaimableVaultFeesAttoEth() view returns (uint256)',
	'function totalAccruedFeesAttoEth() view returns (uint256)',
	'function getTotalPoolHeldAttoRep() view returns (uint256)',
	'function getCurrentMintingCapacityAttoEth() view returns (uint256)',
	'function totalBadDebtAttoEth() view returns (uint256)',
	'function systemState() view returns (uint8)',
	'function awaitingForkContinuation() view returns (bool)',
	'function isEscalationResolved() view returns (bool)',
	'function shareTokenSupplyAttoShares() view returns (uint256)',
	'function currentRetentionRate() view returns (uint256)',
	'function statoblastSecurityMultiplierBps() view returns (uint256)',
	'function securityVaults(address vault) view returns (uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 claimableFeesAttoEth, uint256 feeIndex)',
	'function vaultTargetHealthFactorBps(address vault) view returns (uint256)',
	'function getVaultOpenInterestAttoEth(address vault) view returns (uint256)',
	'function vaultBadDebtAttoEth(address vault) view returns (uint256)',
	'function backingUnitsToAttoRep(uint256 repBackingUnits) view returns (uint256)',
])

const coordinatorAbi = parseAbi([
	'function lastPrice() view returns (uint256)',
	'function lastSettlementTimestamp() view returns (uint256)',
	'function isPriceValid() view returns (bool)',
])

const escalationAbi = parseAbi([
	'function activationTime() view returns (uint256)',
	'function startBondAttoRep() view returns (uint256)',
	'function nonDecisionThresholdAttoRep() view returns (uint256)',
	'function nonDecisionTimestamp() view returns (uint256)',
	'function totalDisputeStakedAttoRep() view returns (uint256)',
	'function getEscalationGameEndDate() view returns (uint256)',
	'function getQuestionResolution() view returns (uint8)',
	'function getFinalQuestionResolution() view returns (uint8)',
	'function getBindingCapitalAttoRep() view returns (uint256)',
	'function getOutcomeBalancesAttoRep() view returns (uint256[3])',
	'function disputeStakedRepByVaultAttoRep(address vault) view returns (uint256)',
])

const auctionAbi = parseAbi([
	'function auctionStarted() view returns (uint256)',
	'function maxAttoRepBeingSold() view returns (uint256)',
	'function attoEthRaiseCap() view returns (uint256)',
	'function minBidSizeAttoEth() view returns (uint256)',
	'function finalized() view returns (bool)',
	'function clearingTick() view returns (int256)',
	'function ethFilledAtClearingAttoEth() view returns (uint256)',
	'function attoEthRaised() view returns (uint256)',
	'function totalAttoRepPurchased() view returns (uint256)',
	'function activeTickCount() view returns (uint256)',
	'function computeClearing() view returns (bool hitCap, int256 clearingTickOut, uint256 accumulatedBidAttoEth, uint256 bidAtClearingTickAttoEth)',
])

export type StateRead = (address: Address, abi: Abi, functionName: string, args?: readonly unknown[]) => Promise<unknown>

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
		read(address, poolAbi, 'totalCapacityOwnershipAttoRep'),
		read(address, poolAbi, 'totalRepBackingUnits'),
		read(address, poolAbi, 'totalClaimableVaultFeesAttoEth'),
		read(address, poolAbi, 'totalAccruedFeesAttoEth'),
		read(address, poolAbi, 'getTotalPoolHeldAttoRep'),
		read(address, poolAbi, 'getCurrentMintingCapacityAttoEth'),
		read(address, poolAbi, 'totalBadDebtAttoEth'),
		read(address, poolAbi, 'systemState'),
		read(address, poolAbi, 'awaitingForkContinuation'),
		read(address, poolAbi, 'isEscalationResolved'),
		read(address, poolAbi, 'shareTokenSupplyAttoShares'),
		read(address, poolAbi, 'currentRetentionRate'),
		read(address, poolAbi, 'statoblastSecurityMultiplierBps'),
	])
	const result: Record<string, unknown> = {
		settlementCollateralAttoEth: exact(values[0], 'settlementCollateralAttoEth'),
		totalCapacityOwnershipAttoRep: exact(values[1], 'totalCapacityOwnershipAttoRep'),
		totalRepBackingUnits: exact(values[2], 'totalRepBackingUnits'),
		totalClaimableVaultFeesAttoEth: exact(values[3], 'totalClaimableVaultFeesAttoEth'),
		totalAccruedFeesAttoEth: exact(values[4], 'totalAccruedFeesAttoEth'),
		totalPoolHeldAttoRep: exact(values[5], 'getTotalPoolHeldAttoRep'),
		currentMintingCapacityAttoEth: exact(values[6], 'getCurrentMintingCapacityAttoEth'),
		totalBadDebtAttoEth: exact(values[7], 'totalBadDebtAttoEth'),
		systemState: exact(values[8], 'systemState'),
		awaitingForkContinuation: flag(values[9], 'awaitingForkContinuation'),
		escalationResolved: flag(values[10], 'isEscalationResolved'),
		shareTokenSupplyAttoShares: exact(values[11], 'shareTokenSupplyAttoShares'),
		currentRetentionRate: exact(values[12], 'currentRetentionRate'),
		securityMultiplierBps: exact(values[13], 'statoblastSecurityMultiplierBps'),
	}
	if (target.coordinatorAddress !== undefined) {
		const coordinator = target.coordinatorAddress
		const price = await Promise.all([
			read(coordinator, coordinatorAbi, 'lastPrice'),
			read(coordinator, coordinatorAbi, 'lastSettlementTimestamp'),
			read(coordinator, coordinatorAbi, 'isPriceValid'),
		])
		result['price'] = {
			repPerEth1e18: exact(price[0], 'lastPrice'),
			settlementTimestamp: exact(price[1], 'lastSettlementTimestamp'),
			protocolValid: flag(price[2], 'isPriceValid'),
			sourceContract: coordinator.toLowerCase(),
		}
	}
	return result
}

const vaultSnapshot = async (target: StateSnapshotTarget, read: StateRead): Promise<Readonly<Record<string, unknown>>> => {
	if (target.poolAddress === undefined) throw new Error('Vault snapshot target is missing its pool')
	const pool = target.poolAddress
	const vault = target.address
	const values = await Promise.all([
		read(pool, poolAbi, 'securityVaults', [vault]),
		read(pool, poolAbi, 'vaultTargetHealthFactorBps', [vault]),
		read(pool, poolAbi, 'getVaultOpenInterestAttoEth', [vault]),
		read(pool, poolAbi, 'vaultBadDebtAttoEth', [vault]),
		read(pool, poolAbi, 'statoblastSecurityMultiplierBps'),
	])
	const state = tuple(values[0], 4, 'securityVaults')
	const repBackingUnits = exact(state[0], 'securityVaults.repBackingUnits')
	const backingAttoRep = await read(pool, poolAbi, 'backingUnitsToAttoRep', [BigInt(repBackingUnits)])
	let disputeStakedAttoRep = '0'
	if (target.escalationAddress !== undefined)
		disputeStakedAttoRep = exact(
			await read(target.escalationAddress, escalationAbi, 'disputeStakedRepByVaultAttoRep', [vault]),
			'disputeStakedRepByVaultAttoRep',
		)
	return {
		poolAddress: pool.toLowerCase(),
		vaultAddress: vault.toLowerCase(),
		repBackingUnits,
		poolHeldBackingAttoRep: exact(backingAttoRep, 'backingUnitsToAttoRep'),
		capacityOwnershipAttoRep: exact(state[1], 'securityVaults.capacityOwnershipAttoRep'),
		claimableFeesAttoEth: exact(state[2], 'securityVaults.claimableFeesAttoEth'),
		feeIndex: exact(state[3], 'securityVaults.feeIndex'),
		targetHealthFactorBps: exact(values[1], 'vaultTargetHealthFactorBps'),
		openInterestAttoEth: exact(values[2], 'getVaultOpenInterestAttoEth'),
		badDebtAttoEth: exact(values[3], 'vaultBadDebtAttoEth'),
		securityMultiplierBps: exact(values[4], 'statoblastSecurityMultiplierBps'),
		disputeStakedAttoRep,
	}
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
	const values = await Promise.all([
		read(target.address, auctionAbi, 'auctionStarted'),
		read(target.address, auctionAbi, 'maxAttoRepBeingSold'),
		read(target.address, auctionAbi, 'attoEthRaiseCap'),
		read(target.address, auctionAbi, 'minBidSizeAttoEth'),
		read(target.address, auctionAbi, 'finalized'),
		read(target.address, auctionAbi, 'clearingTick'),
		read(target.address, auctionAbi, 'ethFilledAtClearingAttoEth'),
		read(target.address, auctionAbi, 'attoEthRaised'),
		read(target.address, auctionAbi, 'totalAttoRepPurchased'),
		read(target.address, auctionAbi, 'activeTickCount'),
		read(target.address, auctionAbi, 'computeClearing'),
	])
	const clearing = tuple(values[10], 4, 'computeClearing')
	return {
		auctionStarted: exact(values[0], 'auctionStarted'),
		maxAttoRepBeingSold: exact(values[1], 'maxAttoRepBeingSold'),
		attoEthRaiseCap: exact(values[2], 'attoEthRaiseCap'),
		minBidSizeAttoEth: exact(values[3], 'minBidSizeAttoEth'),
		finalized: flag(values[4], 'finalized'),
		clearingTick: exact(values[5], 'clearingTick'),
		ethFilledAtClearingAttoEth: exact(values[6], 'ethFilledAtClearingAttoEth'),
		attoEthRaised: exact(values[7], 'attoEthRaised'),
		totalAttoRepPurchased: exact(values[8], 'totalAttoRepPurchased'),
		activeTickCount: exact(values[9], 'activeTickCount'),
		indicativeClearing: {
			hitCap: flag(clearing[0], 'computeClearing.hitCap'),
			clearingTick: exact(clearing[1], 'computeClearing.clearingTick'),
			accumulatedBidAttoEth: exact(clearing[2], 'computeClearing.accumulatedBidAttoEth'),
			bidAtClearingTickAttoEth: exact(clearing[3], 'computeClearing.bidAtClearingTickAttoEth'),
		},
	}
}

export const sampleEntityStateWithRead = async (target: StateSnapshotTarget, read: StateRead): Promise<EntityStateSnapshot> => {
	const sourceMethod = `augurscan.${target.entityType}-state.v1`
	try {
		const readResult =
			target.entityType === 'pool'
				? await poolSnapshot(target, read)
				: target.entityType === 'vault'
					? await vaultSnapshot(target, read)
					: target.entityType === 'escalation'
						? await escalationSnapshot(target, read)
						: await auctionSnapshot(target, read)
		return { entityType: target.entityType, entityIdentity: target.entityIdentity, sourceMethod, readStatus: 'success', readResult }
	} catch (error) {
		return {
			entityType: target.entityType,
			entityIdentity: target.entityIdentity,
			sourceMethod,
			readStatus: 'failed',
			readFailureReason: failureReason(error),
		}
	}
}

export const sampleEntityState = async (
	client: Pick<PublicClient, 'readContract'>,
	target: StateSnapshotTarget,
	blockNumber: bigint,
): Promise<EntityStateSnapshot> => {
	const read: StateRead = async (address, abi, functionName, args) =>
		await client.readContract({ address, abi, functionName, ...(args === undefined ? {} : { args }), blockNumber })
	return await sampleEntityStateWithRead(target, read)
}

export const normalizeSnapshotTarget = (row: Record<string, unknown>): StateSnapshotTarget => {
	const entityType = String(row['entity_type'])
	if (entityType !== 'auction' && entityType !== 'escalation' && entityType !== 'pool' && entityType !== 'vault')
		throw new Error(`Unsupported snapshot entity type ${entityType}`)
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
