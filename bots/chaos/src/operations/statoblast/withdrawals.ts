import { EcosystemSnapshot, OperationDefinition, PlanningOptions, PoolSnapshot } from '../types.ts'

import { ONE_TOKEN, amount, choose, eligible, encodePreflightCall, encodeStep, eventEvidence, mixSeed, optionAmount, planBase } from '../planning.ts'

import { BINARY_OUTCOME_NONE, STAGED_WITHDRAWAL_VALIDITY_SECONDS, compareDecimalStrings, decodedStagedSuccess, escalationWithdrawalSafe, lifecycleBatches, operationalPools, oracleRequestStagingParameters, safeOraclePriceDeadline, walletVault } from './planning.ts'

import { openOraclePriceCoordinatorAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'

import { walletVaultRegistrationCapacityBlocker } from './vaults.ts'

function previewWithdrawalAmount(pool: PoolSnapshot, vault: PoolSnapshot['vaults'][number], requestedAttoRep: bigint) {
	const totalBackingUnits = amount(pool.totalRepBackingUnits)
	const totalPoolHeldAttoRep = amount(pool.poolRepBalanceAttoRep)
	if (requestedAttoRep === 0n || totalBackingUnits === 0n || totalPoolHeldAttoRep === 0n) return 0n
	const requestedUnits = (requestedAttoRep * totalBackingUnits) / totalPoolHeldAttoRep
	const minimumRemainingUnits = (amount(pool.minimumVaultRepDepositAttoRep) * totalBackingUnits) / totalPoolHeldAttoRep
	const vaultUnits = amount(vault.repBackingUnits)
	const withdrawalUnits = requestedUnits + minimumRemainingUnits > vaultUnits ? vaultUnits : requestedUnits
	return (withdrawalUnits * totalPoolHeldAttoRep) / totalBackingUnits
}

export const queueWithdrawal: OperationDefinition = {
	buildPlan(snapshot, options) {
		const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const pool = choose(
			operationalPools(snapshot).filter(candidate => {
				const vault = walletVault(snapshot, candidate)
				if (vault === undefined || amount(vault.repBackingAttoRep) === 0n || amount(vault.disputeStakedAttoRep) !== 0n) return false
				const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
				return safeOraclePriceDeadline(snapshot, candidate, options) !== undefined && amount(candidate.settlementCollateralAttoEth) <= amount(candidate.totalBadDebtAttoEth) && previewWithdrawalAmount(candidate, vault, requested) > 0n
			}),
			mixSeed(options.seed, queueWithdrawal.id),
		)
		if (pool === undefined) return undefined
		const vault = walletVault(snapshot, pool)
		if (vault === undefined) return undefined
		const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
		if (requested === 0n || previewWithdrawalAmount(pool, vault, requested) === 0n) return undefined
		const oracleDeadline = safeOraclePriceDeadline(snapshot, pool, options)
		if (oracleDeadline === undefined) return undefined
		const funding = oracleRequestStagingParameters(pool)
		const steps = []
		const evidence = [eventEvidence(pool.coordinator, 'StagedOperationQueued(uint256,uint8,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)'), decodedStagedSuccess(pool.coordinator)]
		steps.push(
			encodeStep({
				abi: openOraclePriceCoordinatorAbi,
				args: [1, snapshot.wallet.address, requested, STAGED_WITHDRAWAL_VALIDITY_SECONDS, funding.price, funding.initialWethAttoEth],
				evidence,
				functionName: 'requestPriceIfNeededAndStageOperation',
				id: 'queue-withdrawal',
				label: 'Queue REP withdrawal',
				preflightCalls: [
					encodePreflightCall({
						abi: securityPoolAbi,
						args: [snapshot.wallet.address, requested],
						caller: pool.coordinator,
						expectedResult: '0x',
						functionName: 'withdrawRepFromVault',
						label: 'withdraw queued REP directly',
						to: pool.address,
					}),
				],
				to: pool.coordinator,
			}),
		)
		return planBase({
			deadlineTimestamp: oracleDeadline.toString(),
			definitionId: queueWithdrawal.id,
			ecosystem: 'statoblast',
			label: queueWithdrawal.label,
			metadata: { amountAttoRep: requested.toString(), pool: pool.address },
			postconditions: ['The staged operation either succeeds immediately or remains durably discoverable as a lifecycle obligation'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'OpenOraclePriceCoordinator',
	description: 'Queues an oracle-gated REP withdrawal and records any resulting settlement obligation.',
	discoveryInputs: ['wallet vault backing', 'oracle freshness and request cost', 'wallet ETH'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const configuredMaximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const pools = operationalPools(snapshot).filter(candidate => {
			const vault = walletVault(snapshot, candidate)
			return vault !== undefined && amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n
		})
		const ready = pools.some(pool => {
			const vault = walletVault(snapshot, pool)
			if (vault === undefined) return false
			const requested = amount(vault.repBackingAttoRep) < configuredMaximum ? amount(vault.repBackingAttoRep) : configuredMaximum
			return safeOraclePriceDeadline(snapshot, pool, options) !== undefined && amount(pool.settlementCollateralAttoEth) <= amount(pool.totalBadDebtAttoEth) && previewWithdrawalAmount(pool, vault, requested) > 0n
		})
		return eligible(
			pools.length === 0 ? 'No unescrowed wallet vault has withdrawable REP' : undefined,
			configuredMaximum === 0n ? 'Configured REP operation cap is zero' : undefined,
			pools.length > 0 && !ready ? 'No eligible pool has a safely fresh price, zero open interest, and a nonzero rounded withdrawal' : undefined,
		)
	},
	id: 'statoblast.staged.queue',
	label: 'Queue REP withdrawal',
	method: 'requestPriceIfNeededAndStageOperation',
	risk: 'medium',
}

function escalationWithdrawalCandidates(snapshot: EcosystemSnapshot) {
	return snapshot.pools.flatMap(pool => {
		if (pool.systemState !== 0 || pool.questionOutcome === BINARY_OUTCOME_NONE || !escalationWithdrawalSafe(snapshot, pool)) return []
		const deposits = snapshot.escalationDeposits.filter(deposit => !deposit.claimed && deposit.pool.toLowerCase() === pool.address.toLowerCase() && deposit.vault.toLowerCase() === snapshot.wallet.address.toLowerCase()).sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex))
		return [...new Set(deposits.map(deposit => deposit.outcome))].flatMap(outcome => lifecycleBatches(deposits.filter(deposit => deposit.outcome === outcome)).map(batch => ({ deposits: batch, outcome, pool })))
	})
}

function escalationWithdrawalCapacityBlocker(pool: PoolSnapshot, options: PlanningOptions) {
	const blocker = walletVaultRegistrationCapacityBlocker(pool, options, 'Escalation withdrawal beneficiary-vault registration')
	return blocker === undefined ? undefined : `${blocker}; raise discovery.maxVaultsPerPool before withdrawing`
}

function actionableEscalationWithdrawalCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return escalationWithdrawalCandidates(snapshot).filter(candidate => escalationWithdrawalCapacityBlocker(candidate.pool, options) === undefined)
}

function escalationWithdrawalIndexes(candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	return [...candidate.deposits].sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex)).map(deposit => BigInt(deposit.depositIndex))
}

function escalationWithdrawalMetadata(candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	const indexes = escalationWithdrawalIndexes(candidate)
	return { depositCount: indexes.length, depositIndexes: indexes.map(index => index.toString()).join(','), outcome: candidate.outcome, pool: candidate.pool.address }
}

function buildEscalationWithdrawalPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof escalationWithdrawalCandidates>[number]) {
	const indexes = escalationWithdrawalIndexes(candidate)
	const winning = candidate.outcome === candidate.pool.questionOutcome
	const signature = winning ? 'ClaimDeposit(address,uint8,uint256,uint256,uint256,uint256,bool)' : 'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'
	return planBase({
		definitionId: withdrawEscalation.id,
		ecosystem: 'statoblast',
		label: withdrawEscalation.label,
		metadata: escalationWithdrawalMetadata(candidate),
		postconditions: [winning ? 'Every selected winning deposit emits ClaimDeposit and is marked terminal by the canonical index' : 'Every selected losing deposit emits CarryDepositConsumed and is marked terminal by the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [encodeStep({ abi: securityPoolAbi, args: [candidate.outcome, indexes], evidence: [eventEvidence(candidate.pool.escalationGame, signature)], functionName: 'withdrawFromEscalationGame', id: 'withdraw-escalation', label: 'Withdraw resolved escalation deposits', to: candidate.pool.address })],
	})
}

export const withdrawEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(actionableEscalationWithdrawalCandidates(snapshot, options), mixSeed(options.seed, withdrawEscalation.id))
		return candidate === undefined ? undefined : buildEscalationWithdrawalPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return actionableEscalationWithdrawalCandidates(snapshot, options).map(candidate => buildEscalationWithdrawalPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return escalationWithdrawalCandidates(snapshot).map(escalationWithdrawalMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return escalationWithdrawalCandidates(snapshot).map(escalationWithdrawalMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPool',
	description: 'Withdraws indexed wallet escalation deposits after the pool question resolves.',
	discoveryInputs: ['canonical escalation deposit index', 'pool question outcome and lifecycle'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const candidates = escalationWithdrawalCandidates(snapshot)
		const actionable = actionableEscalationWithdrawalCandidates(snapshot, options)
		const capacityBlocker = candidates[0] === undefined || actionable.length > 0 ? undefined : escalationWithdrawalCapacityBlocker(candidates[0].pool, options)
		return eligible(capacityBlocker, candidates.length > 0 ? undefined : 'No resolved wallet escalation deposit is withdrawable')
	},
	id: 'statoblast.escalation.withdraw',
	label: 'Withdraw escalation deposits',
	method: 'withdrawFromEscalationGame',
	risk: 'low',
}
