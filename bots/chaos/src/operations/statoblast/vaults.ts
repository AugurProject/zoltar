import type { EcosystemSnapshot, OperationDefinition, PlanningOptions } from '../types.ts'
import { topologyMutationCapacityBlocker } from '../topology-capacity.ts'
import { feeCheckpointDue, poolAccountingCurrentEvidence } from './planning.ts'
import { choose, eligible, encodeStep, mixSeed, planBase } from '../planning.ts'
import { securityPoolAbi, securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import { inputMatches } from '../input-values.ts'

function questionCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return snapshot.portfolioCapital.flatMap(capital =>
		capital.admissibleQuestionIds
			.filter(
				questionId =>
					inputMatches(options, 'questionId', questionId) && inputMatches(options, 'portfolio', capital.portfolio) && (options.genesisInitializationTarget === undefined || (options.genesisInitializationTarget.universeId === capital.universeId && options.genesisInitializationTarget.questionId === questionId)),
			)
			.map(questionId => ({ capital, questionId })),
	)
}

export const deployPool: OperationDefinition = {
	id: 'statoblast.portfolio.add-question',
	label: 'Add question to portfolio',
	method: 'addQuestion',
	contract: 'SecurityPoolPortfolio',
	classification: 'selectable',
	ecosystem: 'statoblast',
	risk: 'medium',
	description: 'Adds a question to a discovered portfolio when its admission policy accepts the operator.',
	discoveryInputs: ['portfolio universe', 'question admission simulation', 'canonical question registry'],
	evaluate(snapshot, options) {
		return eligible(
			topologyMutationCapacityBlocker(snapshot, options, { additionalPools: 1, additionalUniverses: 0, label: 'Portfolio question admission' }),
			questionCandidates(snapshot, options).length > 0 ? undefined : 'No discovered portfolio admits a new question; create a portfolio through the deployment UI first',
		)
	},
	buildPlan(snapshot, options) {
		if (topologyMutationCapacityBlocker(snapshot, options, { additionalPools: 1, additionalUniverses: 0, label: 'Portfolio question admission' }) !== undefined) return undefined
		const candidate = choose(questionCandidates(snapshot, options), mixSeed(options.seed, deployPool.id))
		if (candidate === undefined) return undefined
		return planBase({
			definitionId: deployPool.id,
			ecosystem: 'statoblast',
			label: deployPool.label,
			metadata: { portfolio: candidate.capital.portfolio, questionId: candidate.questionId, universeId: candidate.capital.universeId },
			postconditions: ['The portfolio registers the question and its settlement ledger'],
			risk: 'medium',
			snapshot,
			steps: [encodeStep({ abi: securityPoolPortfolioAbi, args: [BigInt(candidate.questionId)], functionName: 'addQuestion', id: 'add-question', label: deployPool.label, to: candidate.capital.portfolio, gasLimit: 16_777_216n })],
		})
	},
}

export function checkpointDefinition(kind: 'collateral' | 'fees'): OperationDefinition {
	const id = `statoblast.pool.checkpoint-${kind}`
	const method = kind === 'collateral' ? 'updateSettlementCollateral' : 'refreshPortfolioFees'
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
