import { EcosystemSnapshot, OperationDefinition, PlanningOptions, PoolSnapshot } from '../types.ts'

import { topologyMutationCapacityBlocker, vaultRegistrationCapacityBlocker } from '../topology-capacity.ts'

import {
	BINARY_OUTCOME_NONE,
	approvePool,
	canDeployOriginPool,
	childPoolForOutcome,
	childRouteTopologyCapacityBlocker,
	exactPreviousPoolApproval,
	feeCheckpointDue,
	operationalPools,
	poolAccountingCurrentEvidence,
	poolApprovalPrepared,
	poolApprovalStep,
	poolCleanupPlan,
	requiredVaultMetadataAmount,
	requiredVaultMetadataString,
	vaultFeeAccountingEvidence,
	walletVault,
} from './planning.ts'

import { ONE_TOKEN, amount, choose, eligible, encodeStep, erc20WalletDebit, eventEvidence, mixSeed, optionAmount, planBase, tokenInventory } from '../planning.ts'

import { securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'

import { inputMatches } from '../input-values.ts'

import { repSpend } from '../input-funding.ts'

import { getAddress } from '@zoltar/bot-shared/ethereum'

function poolDeploymentCapacityBlocker(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return topologyMutationCapacityBlocker(snapshot, options, { additionalPools: 1, additionalUniverses: 0, label: 'Pool deployment' })
}

export const deployPool: OperationDefinition = {
	buildPlan(snapshot, options) {
		if (poolDeploymentCapacityBlocker(snapshot, options) !== undefined) return undefined
		const deployed = new Set(snapshot.pools.map(pool => `${pool.universeId}:${pool.questionId}`))
		const binaryQuestions = snapshot.questions.filter(question => question.kind === 'binary')
		const candidates = snapshot.universes
			.flatMap(universe => binaryQuestions.map(question => ({ question, universe })))
			.filter(candidate => canDeployOriginPool(candidate.universe) && !deployed.has(`${candidate.universe.id}:${candidate.question.id}`))
			.filter(candidate => options.genesisInitializationTarget === undefined || (candidate.universe.id === options.genesisInitializationTarget.universeId && candidate.question.id === options.genesisInitializationTarget.questionId))
		const candidate = choose(candidates, mixSeed(options.seed, deployPool.id))
		if (candidate === undefined) return undefined
		const multiplier = 11_000n + BigInt(mixSeed(options.seed, 'pool-multiplier') % 9_001)
		const priorityFee = 1n + BigInt(mixSeed(options.seed, 'pool-priority-fee') % 1_000_000)
		return planBase({
			definitionId: deployPool.id,
			ecosystem: 'statoblast',
			label: deployPool.label,
			metadata: { questionId: candidate.question.id, universeId: candidate.universe.id },
			postconditions: ['The canonical factory registers a new origin security pool'],
			risk: 'medium',
			snapshot,
			steps: [
				encodeStep({
					abi: securityPoolFactoryAbi,
					args: [BigInt(candidate.universe.id), BigInt(candidate.question.id), multiplier, priorityFee],
					evidence: [eventEvidence(snapshot.deployments.securityPoolFactory, 'DeploySecurityPool(address,address,address,address,address,uint248,uint256,uint256,uint256,uint256,uint256)')],
					functionName: 'deployOriginSecurityPool',
					id: 'deploy-origin-pool',
					label: 'Deploy origin security pool',
					to: snapshot.deployments.securityPoolFactory,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'SecurityPoolFactory',
	description: 'Deploys a canonical pool for an unrepresented binary question and active universe.',
	discoveryInputs: ['binary questions', 'unforked universes', 'factory deployments', 'non-decision threshold and theoretical REP supply'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const deployed = new Set(snapshot.pools.map(pool => `${pool.universeId}:${pool.questionId}`))
		const found = snapshot.universes.some(universe => canDeployOriginPool(universe) && snapshot.questions.some(question => question.kind === 'binary' && !deployed.has(`${universe.id}:${question.id}`)))
		return eligible(poolDeploymentCapacityBlocker(snapshot, options), found ? undefined : 'No undeployed binary question/universe combination')
	},
	id: 'statoblast.pool.deploy',
	label: 'Deploy security pool',
	method: 'deployOriginSecurityPool',
	risk: 'medium',
}

export function checkpointDefinition(kind: 'collateral' | 'retention'): OperationDefinition {
	const id = `statoblast.pool.checkpoint-${kind}`
	const method = kind === 'collateral' ? 'updateSettlementCollateral' : 'updateRetentionRate'
	return {
		buildPlan(snapshot, options) {
			const pool = choose(
				snapshot.pools.filter(candidate => feeCheckpointDue(snapshot, candidate) && (kind === 'collateral' || candidate.systemState === 0)),
				mixSeed(options.seed, id),
			)
			if (pool === undefined) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: `Checkpoint pool ${kind}`,
				metadata: { pool: pool.address },
				postconditions: ['Pool accounting is current at the receipt block'],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, evidence: [poolAccountingCurrentEvidence(snapshot, pool)], functionName: method, id: method, label: `Update ${kind}`, to: pool.address })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Permissionlessly checkpoints ${kind} accounting.`,
		discoveryInputs: ['security pools'],
		ecosystem: 'statoblast',
		evaluate: snapshot => eligible(snapshot.pools.some(pool => feeCheckpointDue(snapshot, pool) && (kind === 'collateral' || pool.systemState === 0)) ? undefined : 'No eligible pool has an uncheckpointed accounting interval'),
		id,
		label: `Checkpoint ${kind}`,
		method,
		risk: 'low',
	}
}

export function walletVaultRegistrationCapacityBlocker(pool: PoolSnapshot, options: PlanningOptions, label: string) {
	return vaultRegistrationCapacityBlocker({ canonicalVaultCount: pool.canonicalVaultCount, registered: pool.walletVaultRegistered }, options, label)
}

function walletChildRouteCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	const topologyBlocker = childRouteTopologyCapacityBlocker(snapshot, pool, outcome, options, `${label} topology`)
	if (topologyBlocker !== undefined) return topologyBlocker
	const child = childPoolForOutcome(snapshot, pool, outcome)
	return child === undefined ? undefined : walletVaultRegistrationCapacityBlocker(child, options, `${label} vault registration`)
}

export function walletVaultMigrationRouteCapacityBlocker(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string, options: PlanningOptions, label: string) {
	const sourceBlocker = walletVaultRegistrationCapacityBlocker(pool, options, `${label} source-vault registration`)
	return sourceBlocker ?? walletChildRouteCapacityBlocker(snapshot, pool, outcome, options, `${label} target-child`)
}

function vaultDepositCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return operationalPools(snapshot)
		.filter(pool => inputMatches(options, 'pool', pool.address))
		.filter(pool => repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep)) >= amount(pool.minimumSafeWalletVaultDepositAttoRep) && walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined)
}

export const depositVault: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(
			vaultDepositCandidates(snapshot, options).filter(candidate => options.genesisInitializationTarget?.pool === undefined || candidate.address.toLowerCase() === options.genesisInitializationTarget.pool.toLowerCase()),
			mixSeed(options.seed, depositVault.id),
		)
		if (pool === undefined) return undefined
		const spend = repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep))
		const steps = approvePool(snapshot, pool, spend)
		steps.push(
			encodeStep({
				abi: securityPoolAbi,
				args: [spend, amount(pool.walletVaultTargetBackingFactorBps) || amount(pool.statoblastSecurityMultiplierBps)],
				evidence: [eventEvidence(pool.address, 'RepDepositedToVault(address,uint256,uint256,uint256)')],
				functionName: 'depositRepToVault',
				id: 'deposit-rep',
				label: 'Deposit REP into own vault',
				to: pool.address,
				walletAssetDebits: [erc20WalletDebit(pool.repToken, spend, 'rep')],
			}),
		)
		return planBase({
			definitionId: depositVault.id,
			ecosystem: 'statoblast',
			label: depositVault.label,
			maximumCleanupTransactionCount: steps.length > 1 ? 1 : undefined,
			metadata: { amountAttoRep: spend.toString(), pool: pool.address, repToken: pool.repToken },
			postconditions: ['Wallet vault REP backing units increase'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const spend = requiredVaultMetadataAmount(context.previousPlan.metadata, 'amountAttoRep')
		const poolAddress = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'pool'))
		const repToken = getAddress(requiredVaultMetadataString(context.previousPlan.metadata, 'repToken'))
		const cleanup = () => poolCleanupPlan(snapshot, context, repToken, poolAddress, spend)
		if (context.continuationDisposition === 'cleanup-only') return cleanup()
		const pool = operationalPools(snapshot).find(candidate => candidate.address.toLowerCase() === poolAddress.toLowerCase())
		const inventory = tokenInventory(snapshot, repToken)
		const safe =
			pool !== undefined &&
			pool.repToken.toLowerCase() === repToken.toLowerCase() &&
			walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined &&
			spend > 0n &&
			spend >= amount(pool.minimumSafeWalletVaultDepositAttoRep) &&
			spend <= optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) &&
			inventory !== undefined &&
			amount(inventory.balance) >= spend + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) &&
			poolApprovalPrepared(snapshot, context, repToken, poolAddress, spend)
		if (!safe) return cleanup()
		const previousApproval = exactPreviousPoolApproval(snapshot, context, repToken, poolAddress, spend)
		const steps = previousApproval !== undefined && !context.confirmedStepIds.includes(previousApproval.id) ? [poolApprovalStep(snapshot, repToken, poolAddress, spend)] : []
		steps.push(
			encodeStep({
				abi: securityPoolAbi,
				args: [spend, amount(pool.walletVaultTargetBackingFactorBps) || amount(pool.statoblastSecurityMultiplierBps)],
				evidence: [eventEvidence(poolAddress, 'RepDepositedToVault(address,uint256,uint256,uint256)')],
				functionName: 'depositRepToVault',
				id: 'deposit-rep',
				label: 'Deposit REP into own vault',
				to: poolAddress,
				walletAssetDebits: [erc20WalletDebit(repToken, spend, 'rep')],
			}),
		)
		return planBase({
			definitionId: depositVault.id,
			ecosystem: 'statoblast',
			label: depositVault.label,
			maximumCleanupTransactionCount: previousApproval === undefined ? undefined : 1,
			metadata: context.previousPlan.metadata,
			postconditions: ['Wallet vault REP backing units increase'],
			risk: 'medium',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'SecurityPool',
	description: 'Deposits a bounded REP amount into the wallet vault with a conservative health target.',
	discoveryInputs: ['pool lifecycle', 'post-transfer backing round-trip minimum', 'REP balance and allowance'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const affordable = operationalPools(snapshot).filter(pool => repSpend(snapshot, pool, options, depositVault.id, amount(pool.minimumSafeWalletVaultDepositAttoRep)) >= amount(pool.minimumSafeWalletVaultDepositAttoRep))
		const firstAffordable = affordable[0]
		const capacityBlocker = firstAffordable === undefined || affordable.some(pool => walletVaultRegistrationCapacityBlocker(pool, options, 'Wallet vault deposit registration') === undefined) ? undefined : walletVaultRegistrationCapacityBlocker(firstAffordable, options, 'Wallet vault deposit registration')
		return eligible(capacityBlocker, affordable.length > 0 ? undefined : 'No operational pool has an affordable round-trip-safe REP deposit')
	},
	id: 'statoblast.vault.deposit-rep',
	label: 'Deposit REP to vault',
	method: 'depositRepToVault',
	risk: 'medium',
}

export function vaultActionDefinition(kind: 'update-fees' | 'redeem-fees' | 'redeem-rep'): OperationDefinition {
	let method = 'updateVaultFees'
	let actionLabel = 'Update vault fees'
	let postcondition = 'Vault fee index is current'
	if (kind === 'redeem-fees') {
		method = 'redeemFees'
		actionLabel = 'Redeem vault fees'
		postcondition = 'Vault fees are redeemed or were already redeemed by another keeper'
	} else if (kind === 'redeem-rep') {
		method = 'redeemRepFromVault'
		actionLabel = 'Redeem finalized vault REP'
		postcondition = 'Redeemable REP is returned to the wallet'
	}
	const id = `statoblast.vault.${kind}`
	return {
		buildPlan(snapshot, options) {
			const pool = choose(
				snapshot.pools.filter(candidate => {
					const vault = walletVault(snapshot, candidate)
					if (vault === undefined) return false
					if (kind === 'redeem-fees') return amount(vault.claimableFeesAttoEth) > 0n
					if (kind === 'redeem-rep') return amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n && candidate.questionOutcome !== BINARY_OUTCOME_NONE && candidate.systemState === 0
					return (amount(vault.repBackingUnits) > 0n || amount(vault.capacityOwnershipAttoRep) > 0n) && (feeCheckpointDue(snapshot, candidate) || amount(vault.feeIndex) < amount(candidate.feeIndex))
				}),
				mixSeed(options.seed, id),
			)
			if (pool === undefined) return undefined
			const vault = walletVault(snapshot, pool)
			if (vault === undefined) return undefined
			const evidence = kind === 'redeem-rep' ? [eventEvidence(pool.address, 'RepRedeemedFromVault(address,address,uint256,uint256,uint256)')] : vaultFeeAccountingEvidence(snapshot, pool)
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label: actionLabel,
				metadata: { pool: pool.address, vault: snapshot.wallet.address },
				postconditions: [postcondition],
				risk: 'low',
				snapshot,
				steps: [encodeStep({ abi: securityPoolAbi, args: [snapshot.wallet.address], evidence, functionName: method, id: method, label: method, to: pool.address })],
			})
		},
		classification: 'selectable',
		contract: 'SecurityPool',
		description: `Runs the wallet's ${kind} vault path when it has an effect.`,
		discoveryInputs: ['wallet vault accounting', 'pool lifecycle'],
		ecosystem: 'statoblast',
		evaluate(snapshot) {
			const possible = snapshot.pools.some(pool => {
				const vault = walletVault(snapshot, pool)
				if (vault === undefined) return false
				if (kind === 'redeem-fees') return amount(vault.claimableFeesAttoEth) > 0n
				if (kind === 'redeem-rep') return amount(vault.repBackingAttoRep) > 0n && amount(vault.disputeStakedAttoRep) === 0n && pool.questionOutcome !== BINARY_OUTCOME_NONE && pool.systemState === 0
				return (amount(vault.repBackingUnits) > 0n || amount(vault.capacityOwnershipAttoRep) > 0n) && (feeCheckpointDue(snapshot, pool) || amount(vault.feeIndex) < amount(pool.feeIndex))
			})
			return eligible(possible ? undefined : 'No wallet vault has an eligible balance')
		},
		id,
		label: kind,
		method,
		risk: 'low',
	}
}
