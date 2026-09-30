import { shareTokenAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { validForkOutcomeRoutes } from '../fork-outcomes.ts'
import { amount, choose, eligible, encodeStep, erc1155WalletDebit, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { MIGRATION_TIME_SECONDS, shareTokenId, walletShares } from '../statoblast/planning.ts'
import { timestampDeadlineHasRequiredSafety } from '../timing.ts'
import type { EcosystemSnapshot, OperationDefinition, PlanningOptions, PoolSnapshot, ShareInventory } from '../types.ts'

type ShareMigrationRoute = {
	deadline?: bigint
	fromId: bigint
	shares: ShareInventory
	sourceBalance: bigint
	targetOutcome: string
}

function shareMigrationPoolReady(pool: PoolSnapshot, forkTime: string) {
	if (pool.systemState === 1) return true
	if (pool.systemState !== 0 || pool.forkActivationTime !== '0') return false
	return pool.escalationGame === zeroAddress || pool.questionOutcome === 3 || amount(pool.escalationGameEndTime) >= amount(forkTime)
}

function shareMigrationRouteAvailability(snapshot: EcosystemSnapshot, pool: PoolSnapshot, targetOutcome: string, options: PlanningOptions): { deadline?: bigint } | undefined {
	const childExists = snapshot.pools.some(child => sameAddress(child.parent, pool.address) && child.forkOutcomeIndex === targetOutcome)
	if (childExists || pool.systemState === 0) return {}
	const activation = amount(pool.forkActivationTime)
	if (activation === 0n) return undefined
	const deadline = activation + MIGRATION_TIME_SECONDS
	return timestampDeadlineHasRequiredSafety(amount(snapshot.anchor.timestamp), deadline, options) ? { deadline } : undefined
}

function shareMigrationRoutes(snapshot: EcosystemSnapshot, options: PlanningOptions): ShareMigrationRoute[] {
	return snapshot.pools.flatMap(pool => {
		const universe = snapshot.universes.find(candidate => candidate.id === pool.universeId)
		const forkQuestion = universe === undefined ? undefined : snapshot.questions.find(question => question.id === universe.forkQuestionId)
		const shares = walletShares(snapshot, pool)
		const targetOutcomes = validForkOutcomeRoutes(forkQuestion, universe?.knownChildOutcomes)
		if (universe === undefined || universe.forkTime === '0' || !shareMigrationPoolReady(pool, universe.forkTime) || targetOutcomes.length === 0 || shares === undefined) return []
		return [shares.invalid, shares.yes, shares.no].flatMap((balance, sourceOutcome) => {
			const sourceBalance = amount(balance)
			if (sourceBalance === 0n) return []
			return targetOutcomes.flatMap(targetOutcome => {
				const progress = amount(shares.migrationProgressByRoute[`${sourceOutcome.toString()}:${targetOutcome}`] ?? sourceBalance.toString())
				if (progress > sourceBalance) throw new Error(`Share migration progress for ${pool.address} route ${sourceOutcome.toString()}:${targetOutcome} exceeds the wallet source balance`)
				if (progress === sourceBalance) return []
				const availability = shareMigrationRouteAvailability(snapshot, pool, targetOutcome, options)
				return availability === undefined ? [] : [{ ...availability, fromId: shareTokenId(pool.universeId, sourceOutcome), shares, sourceBalance, targetOutcome }]
			})
		})
	})
}

export const migrateShares: OperationDefinition = {
	buildPlan(snapshot, options) {
		const route = choose(shareMigrationRoutes(snapshot, options), mixSeed(options.seed, migrateShares.id))
		if (route === undefined) return undefined
		return planBase({
			...(route.deadline === undefined ? {} : { deadlineTimestamp: route.deadline.toString() }),
			definitionId: migrateShares.id,
			ecosystem: 'trading',
			label: migrateShares.label,
			metadata: { fromId: route.fromId.toString(), shareToken: route.shares.shareToken, targetOutcome: route.targetOutcome },
			postconditions: ['Source shares lock and the previously unmigrated child-universe delta materializes'],
			risk: 'irreversible',
			snapshot,
			steps: [
				encodeStep({
					abi: shareTokenAbi,
					args: [route.fromId, [BigInt(route.targetOutcome)]],
					evidence: [eventEvidence(route.shares.shareToken, 'Migrate(address,uint256,uint256,uint256)')],
					functionName: 'migrate',
					id: 'migrate-shares',
					label: 'Migrate shares to child universe',
					to: route.shares.shareToken,
					walletAssetDebits: [erc1155WalletDebit(route.shares.shareToken, route.fromId, route.sourceBalance)],
				}),
			],
		})
	},
	classification: 'selectable',
	contract: 'ShareToken',
	description: 'Migrates wallet-owned source-universe shares into a canonical child branch.',
	discoveryInputs: ['forked source pool', 'share balances', 'child pool routing'],
	ecosystem: 'trading',
	evaluate(snapshot, options) {
		const found = shareMigrationRoutes(snapshot, options).length > 0
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', found ? undefined : 'No fork share route has anchored unmigrated progress')
	},
	id: 'trading.shares.migrate',
	label: 'Migrate forked shares',
	method: 'migrate',
	risk: 'irreversible',
}
