import { getAddress, isAddress } from './ethereum.ts'
import { unixSecondsToDate } from './time.ts'
import type { StoredLog } from './types.ts'

type AtomicValue = string

type QuestionProjection = {
	type: 'question'
	questionId: string
	createdTimestamp: Date
	title: string
	description: string
	startTime: Date
	endTime: Date
	numTicks: string
	displayValueMin: string
	displayValueMax: string
	answerUnit: string
	outcomeOptions: readonly string[]
}

type PoolProjection = {
	type: 'pool'
	poolAddress: string
	parentAddress: string
	universeId: string
	questionId: string
	truthAuctionAddress: string
	coordinatorAddress: string
	shareTokenAddress: string
	securityMultiplierBps: string
	initialPriorityFeeAttoEthPerGas: AtomicValue
	initialRetentionRate: string
	initialSettlementCollateralAttoEth: AtomicValue
}

type PoolSnapshotProjection = {
	type: 'poolSnapshot'
	poolAddress: string
	reason: number
	vaultAddress: string
	settlementCollateralAttoEth: AtomicValue
	totalCapacityOwnershipAttoRep: AtomicValue
	feeEligibleCapacityOwnershipAttoRep: AtomicValue
	totalClaimableVaultFeesAttoEth: AtomicValue
	unallocatedAccruedFeesAttoEth: AtomicValue
	feeIndex: string
	feeIndexRemainder: string
	totalFeesOwedRemainder: string
	uncheckpointedFeeEligibleCapacityOwnershipAttoRep: AtomicValue
	lastUpdatedFeeAccumulator: Date
	currentRetentionRate: string
}

type VaultSnapshotProjection = {
	type: 'vaultSnapshot'
	poolAddress: string
	vaultAddress: string
	repBackingUnits: string
	capacityOwnershipAttoRep: AtomicValue
	claimableFeesAttoEth: AtomicValue
	feeIndex: string
	vaultFeeRemainder: string
	resultingTotalRepBackingUnits: string
	resultingFeeEligibleCapacityOwnershipAttoRep: AtomicValue
}

type PoolStateProjection = { type: 'poolState'; poolAddress: string; eventName: string; state: Readonly<Record<string, unknown>> }

type UniverseProjection = {
	type: 'universe'
	universeId: string
	eventName: string
	parentUniverseId?: string
	forkingOutcomeIndex?: string
	reputationTokenAddress?: string
	forkQuestionId?: string
	forkTime?: Date
	forkerAddress?: string
	forkThresholdAttoRep?: AtomicValue
	migrationRepBalanceAttoRep?: AtomicValue
	theoreticalSupplyAttoRep?: AtomicValue
}

export type Projection = QuestionProjection | PoolProjection | PoolSnapshotProjection | VaultSnapshotProjection | PoolStateProjection | UniverseProjection

const record = (value: unknown, name: string): Record<string, unknown> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object`)
	return value as Record<string, unknown>
}

const string = (value: unknown, name: string): string => {
	if (typeof value !== 'string') throw new Error(`${name} must be a string`)
	return value
}

const integerString = (value: unknown, name: string): string => {
	const result = string(value, name)
	if (!/^-?\d+$/.test(result)) throw new Error(`${name} must be an integer string`)
	return result
}

const address = (value: unknown, name: string): string => {
	const result = string(value, name)
	if (!isAddress(result)) throw new Error(`${name} must be an address`)
	return getAddress(result).toLowerCase()
}

const timestamp = (value: unknown, name: string): Date => {
	const seconds = BigInt(integerString(value, name))
	if (seconds < 0n) throw new Error(`${name} is outside the supported timestamp range`)
	return unixSecondsToDate(seconds, name)
}

const strings = (value: unknown, name: string): readonly string[] => {
	if (!Array.isArray(value)) throw new Error(`${name} must be a string array`)
	return value.map((item) => string(item, name))
}

const poolStateFields: Readonly<Record<string, readonly string[]>> = {
	AwaitingForkContinuationSet: ['awaitingForkContinuation'],
	CompleteSetCreated: ['resultingShareTokenSupplyAttoShares', 'resultingSettlementCollateralAttoEth'],
	CompleteSetRedeemed: ['resultingShareTokenSupplyAttoShares', 'resultingSettlementCollateralAttoEth'],
	EscalationGameSet: ['escalationGame'],
	PoolForkModeActivated: ['repTransferredAttoRep', 'currentRetentionRate', 'systemState'],
	ShareTokenSupplySet: ['shareTokenSupplyAttoShares'],
	SharesRedeemed: ['resultingShareTokenSupplyAttoShares', 'resultingSettlementCollateralAttoEth'],
	SystemStateSet: ['systemState'],
	TotalRepBackingUnitsSet: ['totalRepBackingUnits'],
}

export const projectionsFrom = (log: StoredLog): readonly Projection[] => {
	const name = log.decoded.name
	const args = log.decoded.arguments
	if (name === undefined || args === undefined || log.decoded.status !== 'decoded') return []
	if (name === 'QuestionCreated') {
		const data = record(args['questionData'], 'questionData')
		return [
			{
				type: 'question',
				questionId: integerString(args['questionId'], 'questionId'),
				createdTimestamp: timestamp(args['createdTimestamp'], 'createdTimestamp'),
				title: string(data['title'], 'title'),
				description: string(data['description'], 'description'),
				startTime: timestamp(data['startTime'], 'startTime'),
				endTime: timestamp(data['endTime'], 'endTime'),
				numTicks: integerString(data['numTicks'], 'numTicks'),
				displayValueMin: integerString(data['displayValueMin'], 'displayValueMin'),
				displayValueMax: integerString(data['displayValueMax'], 'displayValueMax'),
				answerUnit: string(data['answerUnit'], 'answerUnit'),
				outcomeOptions: strings(args['outcomeOptions'], 'outcomeOptions'),
			},
		]
	}
	if (name === 'DeploySecurityPool')
		return [
			{
				type: 'pool',
				poolAddress: address(args['securityPool'], 'securityPool'),
				parentAddress: address(args['parent'], 'parent'),
				universeId: integerString(args['universeId'], 'universeId'),
				questionId: integerString(args['questionId'], 'questionId'),
				truthAuctionAddress: address(args['truthAuction'], 'truthAuction'),
				coordinatorAddress: address(args['priceOracleManagerAndOperatorQueuer'], 'priceOracleManagerAndOperatorQueuer'),
				shareTokenAddress: address(args['shareToken'], 'shareToken'),
				securityMultiplierBps: integerString(args['statoblastSecurityMultiplierBps'], 'statoblastSecurityMultiplierBps'),
				initialPriorityFeeAttoEthPerGas: integerString(args['initialReportPriorityFeeAttoEthPerGas'], 'initialReportPriorityFeeAttoEthPerGas'),
				initialRetentionRate: integerString(args['currentRetentionRate'], 'currentRetentionRate'),
				initialSettlementCollateralAttoEth: integerString(args['settlementCollateralAttoEth'], 'settlementCollateralAttoEth'),
			},
		]
	if (name === 'PoolAccountingCheckpoint')
		return [
			{
				type: 'poolSnapshot',
				poolAddress: log.address.toLowerCase(),
				reason: Number(integerString(args['reason'], 'reason')),
				vaultAddress: address(args['vault'], 'vault'),
				settlementCollateralAttoEth: integerString(args['settlementCollateralAttoEth'], 'settlementCollateralAttoEth'),
				totalCapacityOwnershipAttoRep: integerString(args['totalCapacityOwnershipAttoRep'], 'totalCapacityOwnershipAttoRep'),
				feeEligibleCapacityOwnershipAttoRep: integerString(args['feeEligibleCapacityOwnershipAttoRep'], 'feeEligibleCapacityOwnershipAttoRep'),
				totalClaimableVaultFeesAttoEth: integerString(args['totalClaimableVaultFeesAttoEth'], 'totalClaimableVaultFeesAttoEth'),
				unallocatedAccruedFeesAttoEth: integerString(args['unallocatedAccruedFeesAttoEth'], 'unallocatedAccruedFeesAttoEth'),
				feeIndex: integerString(args['feeIndex'], 'feeIndex'),
				feeIndexRemainder: integerString(args['feeIndexRemainder'], 'feeIndexRemainder'),
				totalFeesOwedRemainder: integerString(args['totalFeesOwedRemainder'], 'totalFeesOwedRemainder'),
				uncheckpointedFeeEligibleCapacityOwnershipAttoRep: integerString(
					args['uncheckpointedFeeEligibleCapacityOwnershipAttoRep'],
					'uncheckpointedFeeEligibleCapacityOwnershipAttoRep',
				),
				lastUpdatedFeeAccumulator: timestamp(args['lastUpdatedFeeAccumulator'], 'lastUpdatedFeeAccumulator'),
				currentRetentionRate: integerString(args['currentRetentionRate'], 'currentRetentionRate'),
			},
		]
	if (name === 'VaultAccountingCheckpoint')
		return [
			{
				type: 'vaultSnapshot',
				poolAddress: log.address.toLowerCase(),
				vaultAddress: address(args['vault'], 'vault'),
				repBackingUnits: integerString(args['repBackingUnits'], 'repBackingUnits'),
				capacityOwnershipAttoRep: integerString(args['capacityOwnershipAttoRep'], 'capacityOwnershipAttoRep'),
				claimableFeesAttoEth: integerString(args['claimableFeesAttoEth'], 'claimableFeesAttoEth'),
				feeIndex: integerString(args['feeIndex'], 'feeIndex'),
				vaultFeeRemainder: integerString(args['vaultFeeRemainder'], 'vaultFeeRemainder'),
				resultingTotalRepBackingUnits: integerString(args['resultingTotalRepBackingUnits'], 'resultingTotalRepBackingUnits'),
				resultingFeeEligibleCapacityOwnershipAttoRep: integerString(
					args['resultingFeeEligibleCapacityOwnershipAttoRep'],
					'resultingFeeEligibleCapacityOwnershipAttoRep',
				),
			},
			{
				type: 'poolState',
				poolAddress: log.address.toLowerCase(),
				eventName: name,
				state: { totalRepBackingUnits: integerString(args['resultingTotalRepBackingUnits'], 'resultingTotalRepBackingUnits') },
			},
		]
	const poolFields = poolStateFields[name]
	if (poolFields !== undefined) {
		const state = Object.fromEntries(poolFields.flatMap((field) => (args[field] === undefined ? [] : [[field, args[field]]])))
		if (state['resultingShareTokenSupplyAttoShares'] !== undefined) {
			state['shareTokenSupplyAttoShares'] = state['resultingShareTokenSupplyAttoShares']
			delete state['resultingShareTokenSupplyAttoShares']
		}
		return [
			{
				type: 'poolState',
				poolAddress: log.address.toLowerCase(),
				eventName: name,
				state,
			},
		]
	}
	if (name === 'UniverseInitialized')
		return [
			{
				type: 'universe',
				eventName: name,
				universeId: integerString(args['universeId'], 'universeId'),
				parentUniverseId: integerString(args['parentUniverseId'], 'parentUniverseId'),
				forkingOutcomeIndex: integerString(args['forkingOutcomeIndex'], 'forkingOutcomeIndex'),
				reputationTokenAddress: address(args['reputationToken'], 'reputationToken'),
				forkQuestionId: integerString(args['forkQuestionId'], 'forkQuestionId'),
				forkTime: timestamp(args['forkTime'], 'forkTime'),
				theoreticalSupplyAttoRep: integerString(args['universeTheoreticalSupplyAttoRep'], 'universeTheoreticalSupplyAttoRep'),
			},
		]
	if (name === 'DeployChild')
		return [
			{
				type: 'universe',
				eventName: name,
				universeId: integerString(args['childUniverseId'], 'childUniverseId'),
				parentUniverseId: integerString(args['universeId'], 'universeId'),
				forkingOutcomeIndex: integerString(args['outcomeIndex'], 'outcomeIndex'),
				reputationTokenAddress: address(args['childReputationToken'], 'childReputationToken'),
				theoreticalSupplyAttoRep: integerString(args['childUniverseTheoreticalSupplyAttoRep'], 'childUniverseTheoreticalSupplyAttoRep'),
			},
		]
	if (name === 'UniverseForked')
		return [
			{
				type: 'universe',
				eventName: name,
				universeId: integerString(args['universeId'], 'universeId'),
				forkQuestionId: integerString(args['questionId'], 'questionId'),
				forkTime: timestamp(args['forkTime'], 'forkTime'),
				forkerAddress: address(args['forker'], 'forker'),
				forkThresholdAttoRep: integerString(args['forkThresholdAttoRep'], 'forkThresholdAttoRep'),
				migrationRepBalanceAttoRep: integerString(args['migrationRepBalanceAttoRep'], 'migrationRepBalanceAttoRep'),
				theoreticalSupplyAttoRep: integerString(args['universeTheoreticalSupplyAttoRep'], 'universeTheoreticalSupplyAttoRep'),
			},
		]
	if (name === 'MigrationRepAdded' || name === 'RepBurned')
		return [
			{
				type: 'universe',
				eventName: name,
				universeId: integerString(args['universeId'], 'universeId'),
				theoreticalSupplyAttoRep: integerString(args['universeTheoreticalSupplyAttoRep'], 'universeTheoreticalSupplyAttoRep'),
				...(name === 'MigrationRepAdded'
					? { migrationRepBalanceAttoRep: integerString(args['migrationRepBalanceAttoRep'], 'migrationRepBalanceAttoRep') }
					: {}),
			},
		]
	return []
}
