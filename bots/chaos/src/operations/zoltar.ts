import { encodeAbiParameters, keccak256 } from '@zoltar/bot-shared/ethereum'
import { erc20Abi, questionDataAbi, zoltarAbi } from '../contracts/abi.ts'
import { allowance, amount, cappedSpend, choose, disabled, eligible, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, eventEvidence, eventTopic, mixSeed, ONE_TOKEN, optionAmount, planBase, tokenInventory } from './planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions, QuestionSnapshot, UniverseSnapshot } from './types.ts'
import { validForkOutcomeRoutes } from './fork-outcomes.ts'

function irreversibleEnabled(options: PlanningOptions) {
	return options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled'
}

function repSpend(snapshot: EcosystemSnapshot, universe: UniverseSnapshot, options: PlanningOptions, salt: string) {
	const inventory = tokenInventory(snapshot, universe.repToken)
	const balance = inventory === undefined ? 0n : amount(inventory.balance)
	return cappedSpend(balance, optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN), optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN), mixSeed(options.seed, salt))
}

function approveRepStep(snapshot: EcosystemSnapshot, universe: UniverseSnapshot, required: bigint) {
	const inventory = tokenInventory(snapshot, universe.repToken)
	if (allowance(inventory, snapshot.deployments.zoltar) >= required) return []
	return [
		encodeStep({
			abi: erc20Abi,
			args: [snapshot.deployments.zoltar, required],
			evidence: [erc20AllowanceEvidence(universe.repToken, snapshot.wallet.address, snapshot.deployments.zoltar, required)],
			functionName: 'approve',
			id: 'approve-rep',
			label: 'Approve REP for Zoltar',
			to: universe.repToken,
		}),
	]
}

function endedQuestion(snapshot: EcosystemSnapshot): QuestionSnapshot | undefined {
	const now = amount(snapshot.anchor.timestamp)
	return choose(
		snapshot.questions.filter(question => amount(question.endTime) <= now),
		mixSeed(Number(BigInt(snapshot.anchor.blockNumber) & 0xffff_ffffn), 'ended-question'),
	)
}

function forkOutcomes(snapshot: EcosystemSnapshot, universe: UniverseSnapshot) {
	const question = snapshot.questions.find(candidate => candidate.id === universe.forkQuestionId)
	const outcomes = validForkOutcomeRoutes(question, universe.knownChildOutcomes)
	return outcomes.length === 0 ? undefined : outcomes
}

const MIGRATION_REP_SPLIT_SIGNATURE = 'MigrationRepSplit(address,address,uint248,uint256,uint248,uint256,uint256)'
const MIGRATION_REP_SPLIT_ABI = 'event MigrationRepSplit(address indexed migrator, address recipient, uint248 indexed universeId, uint256 outcomeIndex, uint248 indexed childUniverseId, uint256 amountAttoRep, uint256 childMigrationRepAmountAttoRep)'

function childUniverseId(universeId: string, outcomeIndex: string) {
	return (BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [BigInt(universeId), BigInt(outcomeIndex)]))) & ((1n << 248n) - 1n)).toString()
}

function decodedMigrationSplitEvidence(snapshot: EcosystemSnapshot, route: { amountAttoRep: bigint; childUniverseId: string; outcomeIndex: string; resultingCumulativeAttoRep: bigint; universeId: string }): OperationEvidence[] {
	const indexed = {
		childUniverseId: route.childUniverseId,
		migrator: snapshot.wallet.address,
		universeId: route.universeId,
	}
	const evidence = (field: string, equals: string): OperationEvidence => ({
		abi: MIGRATION_REP_SPLIT_ABI,
		emitter: snapshot.deployments.zoltar,
		equals,
		field,
		indexed,
		kind: 'decoded-event-field',
		signature: MIGRATION_REP_SPLIT_SIGNATURE,
		topic0: eventTopic(MIGRATION_REP_SPLIT_SIGNATURE),
	})
	return [evidence('recipient', snapshot.wallet.address), evidence('outcomeIndex', route.outcomeIndex), evidence('amountAttoRep', route.amountAttoRep.toString()), evidence('childMigrationRepAmountAttoRep', route.resultingCumulativeAttoRep.toString())]
}

function migrationSplitCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const maximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
	if (maximum === 0n) return []
	return snapshot.universes.flatMap(universe => {
		if (universe.forkTime === '0') return []
		const balance = amount(universe.migrationBalance)
		const outcomes = forkOutcomes(snapshot, universe) ?? []
		return outcomes.flatMap(outcomeIndex => {
			const cumulative = amount(universe.migrationRepSplitProgressByOutcome[outcomeIndex] ?? '0')
			if (cumulative > balance) throw new Error(`Universe ${universe.id} outcome ${outcomeIndex} migration progress exceeds wallet credit`)
			const remaining = balance - cumulative
			const splitAmount = cappedSpend(remaining, 0n, maximum, mixSeed(options.seed, `migration-split:${universe.id}:${outcomeIndex}`))
			if (splitAmount === 0n) return []
			return [
				{
					amountAttoRep: splitAmount,
					childUniverseId: childUniverseId(universe.id, outcomeIndex),
					outcomeIndex,
					resultingCumulativeAttoRep: cumulative + splitAmount,
					startingCumulativeAttoRep: cumulative,
					universe,
				},
			]
		})
	})
}

function questionDefinition(kind: 'binary' | 'categorical' | 'scalar'): OperationDefinition {
	const id = `zoltar.question.create-${kind}`
	return {
		buildPlan(snapshot, options) {
			const createdAt = amount(snapshot.anchor.timestamp)
			const nonce = `${snapshot.anchor.blockNumber}-${mixSeed(options.seed, kind)}`
			let labels: string[] = []
			if (kind === 'binary') labels = ['Yes', 'No']
			else if (kind === 'categorical') {
				labels = ['Alpha', 'Beta', 'Gamma'].sort((left, right) => {
					const leftHash = keccak256(encodeAbiParameters([{ type: 'string' }], [left]))
					const rightHash = keccak256(encodeAbiParameters([{ type: 'string' }], [right]))
					if (leftHash > rightHash) return -1
					if (leftHash === rightHash) return 0
					return 1
				})
			}
			const question = {
				answerUnit: kind === 'scalar' ? 'points' : '',
				description: `Chaos bot protocol exercise ${nonce}`,
				displayValueMax: kind === 'scalar' ? 100n : 0n,
				displayValueMin: 0n,
				endTime: createdAt + 86_400n,
				numTicks: kind === 'scalar' ? 100n : 0n,
				startTime: createdAt,
				title: `Chaos ${kind} ${nonce}`,
			}
			return planBase({
				definitionId: id,
				ecosystem: 'zoltar',
				label: `Create ${kind} question`,
				metadata: { kind },
				postconditions: ['QuestionCreated is emitted and the question timestamp becomes nonzero'],
				risk: 'low',
				snapshot,
				steps: [
					encodeStep({
						abi: questionDataAbi,
						args: [question, labels],
						evidence: [eventEvidence(snapshot.deployments.questionData, 'QuestionCreated(uint256,uint256,(string,string,uint48,uint48,uint120,int256,int256,string),string[])')],
						functionName: 'createQuestion',
						id: 'create-question',
						label: `Create ${kind} question`,
						to: snapshot.deployments.questionData,
					}),
				],
			})
		},
		classification: 'selectable',
		contract: 'ZoltarQuestionData',
		description: `Creates a unique, well-formed ${kind} protocol question.`,
		discoveryInputs: ['anchor.timestamp', 'questionData'],
		ecosystem: 'zoltar',
		evaluate: () => eligible(),
		id,
		label: `Create ${kind} question`,
		method: 'createQuestion',
		risk: 'low',
	}
}

const forkUniverse: OperationDefinition = {
	buildPlan(snapshot, options) {
		const question = endedQuestion(snapshot)
		const reserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
		const maximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const candidates = snapshot.universes.filter(universe => {
			const threshold = amount(universe.forkThresholdAttoRep)
			const inventory = tokenInventory(snapshot, universe.repToken)
			return universe.forkTime === '0' && threshold > 0n && threshold <= maximum && inventory !== undefined && amount(inventory.balance) >= threshold + reserve
		})
		const universe = choose(candidates, mixSeed(options.seed, 'fork-universe'))
		if (question === undefined || universe === undefined) return undefined
		const threshold = amount(universe.forkThresholdAttoRep)
		const inventory = tokenInventory(snapshot, universe.repToken)
		if (inventory === undefined || amount(inventory.balance) < threshold + reserve) return undefined
		const steps = approveRepStep(snapshot, universe, threshold)
		steps.push(
			encodeStep({
				abi: zoltarAbi,
				args: [BigInt(universe.id), BigInt(question.id)],
				evidence: [eventEvidence(snapshot.deployments.zoltar, 'UniverseForked(address,uint248,uint256,uint256,uint256,uint256,uint256)')],
				functionName: 'forkUniverse',
				id: 'fork-universe',
				label: 'Fork universe with ended question',
				to: snapshot.deployments.zoltar,
				walletAssetDebits: [erc20WalletDebit(universe.repToken, threshold, 'rep')],
			}),
		)
		return planBase({
			definitionId: forkUniverse.id,
			ecosystem: 'zoltar',
			label: forkUniverse.label,
			metadata: { questionId: question.id, universeId: universe.id },
			postconditions: ['The universe fork time is nonzero and the wallet receives migration credit'],
			risk: 'irreversible',
			snapshot,
			steps,
		})
	},
	classification: 'selectable',
	contract: 'Zoltar',
	description: 'Burns the fork threshold and starts an irreversible universe fork.',
	discoveryInputs: ['ended questions', 'unforked universes', 'REP balance', 'fork threshold', 'REP allowance'],
	ecosystem: 'zoltar',
	evaluate(snapshot, options) {
		const question = endedQuestion(snapshot)
		const reserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
		const maximum = optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN)
		const affordable = snapshot.universes.some(universe => {
			const inventory = tokenInventory(snapshot, universe.repToken)
			const threshold = amount(universe.forkThresholdAttoRep)
			return universe.forkTime === '0' && inventory !== undefined && threshold > 0n && threshold <= maximum && amount(inventory.balance) >= threshold + reserve
		})
		return eligible(irreversibleEnabled(options), question === undefined ? 'No ended question is available' : undefined, affordable ? undefined : 'No unforked universe has an affordable fork threshold')
	},
	id: 'zoltar.universe.fork',
	label: 'Fork universe',
	method: 'forkUniverse',
	risk: 'irreversible',
}

const deployChild: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidates = snapshot.universes.flatMap(universe => {
			if (universe.forkTime === '0') return []
			const outcomes = forkOutcomes(snapshot, universe)
			return outcomes === undefined ? [] : outcomes.filter(outcome => !universe.knownChildOutcomes.includes(outcome)).map(outcome => ({ outcome, universe }))
		})
		const candidate = choose(candidates, mixSeed(options.seed, deployChild.id))
		if (candidate === undefined) return undefined
		return planBase({
			definitionId: deployChild.id,
			ecosystem: 'zoltar',
			label: deployChild.label,
			metadata: { outcomeIndex: candidate.outcome, universeId: candidate.universe.id },
			postconditions: ['A child REP token exists for the selected outcome'],
			risk: 'high',
			snapshot,
			steps: [
				encodeStep({
					abi: zoltarAbi,
					args: [BigInt(candidate.universe.id), BigInt(candidate.outcome)],
					evidence: [eventEvidence(snapshot.deployments.zoltar, 'DeployChild(address,uint248,uint256,uint248,address,uint256)')],
					functionName: 'deployChild',
					id: 'deploy-child',
					label: 'Deploy child universe',
					to: snapshot.deployments.zoltar,
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'Zoltar',
	description: 'Permissionlessly deploys a missing child universe for a valid fork outcome.',
	discoveryInputs: ['forked universes', 'deployed child outcomes'],
	ecosystem: 'zoltar',
	evaluate(snapshot, options) {
		const missing = snapshot.universes.some(universe => universe.forkTime !== '0' && forkOutcomes(snapshot, universe)?.some(outcome => !universe.knownChildOutcomes.includes(outcome)) === true)
		return eligible(options.allowHighRisk === true ? undefined : 'High-risk operations are disabled', missing ? undefined : 'No discovered fork has a missing well-formed child outcome')
	},
	id: 'zoltar.child.deploy',
	label: 'Deploy child universe',
	method: 'deployChild',
	risk: 'high',
}

function migrationDefinition(mode: 'add' | 'split' | 'burn'): OperationDefinition {
	if (mode === 'split') {
		return {
			buildPlan(snapshot, options) {
				const route = choose(migrationSplitCandidates(snapshot, options), mixSeed(options.seed, 'zoltar.migration.split'))
				if (route === undefined) return undefined
				return planBase({
					definitionId: 'zoltar.migration.split',
					ecosystem: 'zoltar',
					label: 'Split migration REP',
					metadata: {
						amountAttoRep: route.amountAttoRep.toString(),
						childUniverseId: route.childUniverseId,
						outcomeIndex: route.outcomeIndex,
						resultingCumulativeAttoRep: route.resultingCumulativeAttoRep.toString(),
						startingCumulativeAttoRep: route.startingCumulativeAttoRep.toString(),
						universeId: route.universe.id,
					},
					postconditions: ['The exact child route cumulative REP split advances by the bounded positive amount'],
					risk: 'irreversible',
					snapshot,
					steps: [
						encodeStep({
							abi: zoltarAbi,
							args: [BigInt(route.universe.id), route.amountAttoRep, [BigInt(route.outcomeIndex)]],
							evidence: decodedMigrationSplitEvidence(snapshot, {
								amountAttoRep: route.amountAttoRep,
								childUniverseId: route.childUniverseId,
								outcomeIndex: route.outcomeIndex,
								resultingCumulativeAttoRep: route.resultingCumulativeAttoRep,
								universeId: route.universe.id,
							}),
							functionName: 'splitMigrationRep',
							id: `split-migration-rep-${route.universe.id}-${route.outcomeIndex}-${route.startingCumulativeAttoRep.toString()}-${route.resultingCumulativeAttoRep.toString()}`,
							label: 'Split migration REP into one child route',
							to: snapshot.deployments.zoltar,
						}),
					],
				})
			},
			classification: 'selectable',
			contract: 'Zoltar',
			description: 'Mints a bounded positive portion of wallet migration credit into one canonically indexed child route.',
			discoveryInputs: ['forked universes', 'authenticated fork outcomes', 'wallet migration credit', 'canonical cumulative MigrationRepSplit index'],
			ecosystem: 'zoltar',
			evaluate: (snapshot, options) => eligible(irreversibleEnabled(options), migrationSplitCandidates(snapshot, options).length > 0 ? undefined : 'No child route has bounded unsplit wallet migration credit'),
			id: 'zoltar.migration.split',
			label: 'Split migration REP',
			method: 'splitMigrationRep',
			risk: 'irreversible',
		}
	}
	const id = mode === 'add' ? 'zoltar.migration.add' : 'zoltar.rep.burn'
	const method = mode === 'add' ? 'addRepToMigrationBalance' : 'burnRep'
	return {
		buildPlan(snapshot, options) {
			const universe = choose(
				snapshot.universes.filter(candidate => (mode === 'burn' || candidate.forkTime !== '0') && repSpend(snapshot, candidate, options, id) > 0n),
				mixSeed(options.seed, id),
			)
			if (universe === undefined) return undefined
			const spend = repSpend(snapshot, universe, options, id)
			if (spend === 0n) return undefined
			const args = [BigInt(universe.id), spend]
			const steps = approveRepStep(snapshot, universe, spend)
			const signature = mode === 'add' ? 'MigrationRepAdded(address,uint248,uint256,uint256,uint256)' : 'RepBurned(address,uint248,uint256,uint256)'
			steps.push(
				encodeStep({
					abi: zoltarAbi,
					args,
					evidence: [eventEvidence(snapshot.deployments.zoltar, signature)],
					functionName: method,
					id: method,
					label: method,
					to: snapshot.deployments.zoltar,
					walletAssetDebits: [erc20WalletDebit(universe.repToken, spend, 'rep')],
				}),
			)
			return planBase({
				definitionId: id,
				ecosystem: 'zoltar',
				label: mode === 'add' ? 'Add REP to migration balance' : 'Burn REP',
				metadata: { amountAttoRep: spend.toString(), universeId: universe.id },
				postconditions: [mode === 'add' ? 'Migration credit increases by the spent amount' : 'Universe theoretical REP supply decreases'],
				risk: 'irreversible',
				snapshot,
				steps,
			})
		},
		classification: 'selectable',
		contract: 'Zoltar',
		description: mode === 'add' ? 'Burns parent REP into reusable fork migration credit.' : 'Permanently burns a bounded REP amount without migration credit.',
		discoveryInputs: ['universe lifecycle', 'REP inventory', 'migration balance', 'risk settings'],
		ecosystem: 'zoltar',
		evaluate(snapshot, options) {
			const candidate = snapshot.universes.some(universe => {
				if (mode === 'add' && universe.forkTime === '0') return false
				return repSpend(snapshot, universe, options, id) > 0n
			})
			return eligible(irreversibleEnabled(options), candidate ? undefined : 'No funded eligible universe')
		},
		id,
		label: mode === 'add' ? 'Add REP migration credit' : 'Burn REP',
		method,
		risk: 'irreversible',
	}
}

const approveRep: OperationDefinition = {
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'ReputationToken',
	description: 'Included automatically before a Zoltar or Statoblast workflow when allowance is insufficient.',
	discoveryInputs: ['REP allowances'],
	ecosystem: 'zoltar',
	evaluate: () => disabled('Prerequisites are composed into selectable plans'),
	id: 'token.rep.approve',
	label: 'Approve REP',
	method: 'approve',
	risk: 'medium',
}

export const ZOLTAR_OPERATIONS: readonly OperationDefinition[] = [questionDefinition('binary'), questionDefinition('categorical'), questionDefinition('scalar'), forkUniverse, deployChild, migrationDefinition('add'), migrationDefinition('split'), migrationDefinition('burn'), approveRep]
