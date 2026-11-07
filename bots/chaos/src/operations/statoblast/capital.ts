import { erc20Abi, securityPoolCapitalLedgerAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { PortfolioCapitalSnapshot } from '../portfolio-types.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, PlanningOptions } from '../types.ts'
import { allowance, amount, choose, eligible, encodePreflightCall, encodeStep, erc20AllowanceEvidence, erc20WalletDebit, mixSeed, ONE_TOKEN, optionAmount, planBase, tokenInventory } from '../planning.ts'
import { repSpend } from '../input-funding.ts'
import { inputInteger, inputMatches } from '../input-values.ts'
import { requiredVaultMetadataAmount, requiredVaultMetadataString } from './planning.ts'

function ownerCapital(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const target = options.genesisInitializationTarget
	const pool = target?.pool === undefined ? undefined : snapshot.pools.find(pool => pool.address.toLowerCase() === target.pool?.toLowerCase())
	return snapshot.portfolioCapital.filter(
		capital =>
			capital.owner.toLowerCase() === snapshot.wallet.address.toLowerCase() &&
			inputMatches(options, 'portfolio', capital.portfolio) &&
			inputMatches(options, 'universeId', capital.universeId) &&
			(target === undefined || (capital.universeId === target.universeId && (target.pool === undefined || pool?.portfolio.toLowerCase() === capital.portfolio.toLowerCase()))),
	)
}

function openCapital(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return ownerCapital(snapshot, options).filter(capital => !capital.frozen && !capital.importing && !capital.exported && amount(capital.forkTime) === 0n)
}

function approval(snapshot: EcosystemSnapshot, token: `0x${string}`, ledger: `0x${string}`, spend: bigint, revoke = false) {
	return encodeStep({
		abi: erc20Abi,
		args: [ledger, spend],
		evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, ledger, spend)],
		functionName: 'approve',
		id: revoke ? 'revoke-capital-rep' : 'approve-capital-rep',
		label: revoke ? 'Revoke portfolio capital approval' : 'Approve portfolio capital REP',
		to: token,
	})
}

function depositStep(snapshot: EcosystemSnapshot, token: `0x${string}`, ledger: `0x${string}`, spend: bigint) {
	return encodeStep({
		abi: securityPoolCapitalLedgerAbi,
		args: [snapshot.wallet.address, spend],
		functionName: 'depositFor',
		id: 'deposit-capital',
		label: 'Deposit REP into portfolio capital',
		to: ledger,
		walletAssetDebits: [erc20WalletDebit(token, spend, 'rep')],
		preflightCalls: [encodePreflightCall({ abi: securityPoolCapitalLedgerAbi, args: [snapshot.wallet.address, spend], caller: snapshot.wallet.address, expectedResult: '0x', functionName: 'depositFor', label: 'Revalidate portfolio REP deposit', to: ledger })],
	})
}

function depositCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return openCapital(snapshot, options)
		.map(capital => {
			// Automatic deposits should fund at least one commitment. Explicit top-ups may be smaller.
			const ceil = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor
			const base = ceil(amount(capital.minimumCommitmentAttoEth) * amount(capital.ownerConservativePrice), ONE_TOKEN)
			const secured = ceil(base * amount(capital.securityMultiplierBps), 10_000n)
			const required = ceil(secured * (amount(capital.targetHealthFactorBps) || 10_000n), 10_000n)
			const minimum = options.operationInputs?.['amount'] !== undefined || required === 0n ? 1n : required
			return { capital, spend: repSpend(snapshot, capital, options, depositCapital.id, minimum) }
		})
		.filter(candidate => candidate.spend > 0n)
}

function cleanup(snapshot: EcosystemSnapshot, context: OperationContinuationContext, token: `0x${string}`, ledger: `0x${string}`, spend: bigint) {
	const previous = context.previousPlan.steps.find(step => step.id === 'approve-capital-rep')
	const expected = approval(snapshot, token, ledger, spend)
	if (previous === undefined || previous.to.toLowerCase() !== expected.to.toLowerCase() || previous.data !== expected.data || !context.confirmedStepIds.includes(previous.id)) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: depositCapital.id,
		ecosystem: 'statoblast',
		label: 'Clean up portfolio capital approval',
		metadata: context.previousPlan.metadata,
		postconditions: ['Workflow-created capital allowance is zero'],
		risk: 'medium',
		snapshot,
		steps: [approval(snapshot, token, ledger, 0n, true)],
	})
}

export const depositCapital: OperationDefinition = {
	id: 'statoblast.capital.deposit',
	label: 'Deposit portfolio REP',
	method: 'depositFor',
	contract: 'SecurityPoolCapitalLedger',
	classification: 'selectable',
	ecosystem: 'statoblast',
	risk: 'medium',
	description: 'Deposits REP into the wallet’s portfolio position, backing all its questions without changing the chosen health target.',
	discoveryInputs: ['portfolio capital', 'wallet REP balances and capital ledger allowances'],
	evaluate: (snapshot, options) => eligible(depositCandidates(snapshot, options).length > 0 ? undefined : 'No active portfolio with spendable wallet REP'),
	buildPlan(snapshot, options) {
		const candidate = choose(depositCandidates(snapshot, options), mixSeed(options.seed, depositCapital.id))
		if (candidate === undefined) return undefined
		const { capital, spend } = candidate
		const needsApproval = allowance(tokenInventory(snapshot, capital.repToken), capital.capitalLedger) < spend
		return planBase({
			definitionId: depositCapital.id,
			ecosystem: 'statoblast',
			label: depositCapital.label,
			metadata: { portfolio: capital.portfolio, universeId: capital.universeId, capitalLedger: capital.capitalLedger, repToken: capital.repToken, amountAttoRep: spend.toString() },
			maximumCleanupTransactionCount: needsApproval ? 1 : undefined,
			postconditions: ['The owner’s portfolio REP principal increases'],
			risk: 'medium',
			snapshot,
			steps: [...(needsApproval ? [approval(snapshot, capital.repToken, capital.capitalLedger, spend)] : []), depositStep(snapshot, capital.repToken, capital.capitalLedger, spend)],
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const metadata = context.previousPlan.metadata
		const token = getAddress(requiredVaultMetadataString(metadata, 'repToken'))
		const ledger = getAddress(requiredVaultMetadataString(metadata, 'capitalLedger'))
		const portfolio = getAddress(requiredVaultMetadataString(metadata, 'portfolio'))
		const universeId = requiredVaultMetadataString(metadata, 'universeId')
		const spend = requiredVaultMetadataAmount(metadata, 'amountAttoRep')
		const revoke = () => cleanup(snapshot, context, token, ledger, spend)
		if (context.continuationDisposition === 'cleanup-only') return revoke()
		const capital = openCapital(snapshot, options).find(candidate => candidate.portfolio.toLowerCase() === portfolio.toLowerCase() && candidate.universeId === universeId && candidate.capitalLedger.toLowerCase() === ledger.toLowerCase() && candidate.repToken.toLowerCase() === token.toLowerCase())
		const previousApproval = context.previousPlan.steps.find(step => step.id === 'approve-capital-rep')
		const expectedApproval = approval(snapshot, token, ledger, spend)
		const expectedAction = spend > 0n ? depositStep(snapshot, token, ledger, spend) : undefined
		const previousAction = context.previousPlan.steps.find(step => step.id === 'deposit-capital')
		const inventory = tokenInventory(snapshot, token)
		const approved = allowance(inventory, ledger) >= spend
		if (
			capital === undefined ||
			inventory === undefined ||
			spend === 0n ||
			spend > optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) ||
			amount(inventory.balance) < spend + optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN) ||
			JSON.stringify(previousAction) !== JSON.stringify(expectedAction) ||
			(previousApproval !== undefined && (previousApproval.to.toLowerCase() !== expectedApproval.to.toLowerCase() || previousApproval.data !== expectedApproval.data)) ||
			(previousApproval === undefined && !approved) ||
			(previousApproval !== undefined && context.confirmedStepIds.includes(previousApproval.id) && !approved)
		)
			return revoke()
		if (expectedAction === undefined) return revoke()
		return planBase({
			definitionId: depositCapital.id,
			ecosystem: 'statoblast',
			label: depositCapital.label,
			metadata,
			maximumCleanupTransactionCount: previousApproval === undefined ? undefined : 1,
			postconditions: ['The owner’s portfolio REP principal increases'],
			risk: 'medium',
			snapshot,
			steps: [...(approved ? [] : [expectedApproval]), expectedAction],
		})
	},
}

type CapitalAction = 'withdraw' | 'claim' | 'retire' | 'serve-retirement'
export function capitalAction(kind: CapitalAction): OperationDefinition {
	const id = `statoblast.capital.${kind}`
	const method = { withdraw: 'withdrawPrincipal', claim: 'claimEarnings', retire: 'setCommitment', 'serve-retirement': 'serveRetirement' }[kind]
	const label = { withdraw: 'Withdraw free portfolio REP', claim: 'Claim portfolio earnings', retire: 'Retire portfolio commitment', 'serve-retirement': 'Serve portfolio retirement' }[kind]
	function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
		return (kind === 'withdraw' || kind === 'claim' ? ownerCapital(snapshot, options) : openCapital(snapshot, options)).filter(capital => {
			if (kind === 'withdraw') return amount(capital.withdrawableAttoRep) > 0n
			if (kind === 'claim') return amount(capital.feesAttoEth) + amount(capital.feesAttoRep) > 0n
			if (kind === 'retire') return amount(capital.commitmentAttoEth) > 0n && !capital.retirementPending
			return capital.retirementReady
		})
	}
	function build(snapshot: EcosystemSnapshot, capital: PortfolioCapitalSnapshot) {
		let args: (bigint | string)[] = []
		if (kind === 'withdraw') args = [amount(capital.withdrawableAttoRep), snapshot.wallet.address]
		if (kind === 'retire') args = [0n]
		if (kind === 'serve-retirement') args = [amount(capital.positionId)]
		return planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label,
			metadata: { portfolio: capital.portfolio, universeId: capital.universeId, capitalLedger: capital.capitalLedger },
			postconditions: [label],
			risk: 'medium',
			snapshot,
			steps: [encodeStep({ abi: securityPoolCapitalLedgerAbi, args, functionName: method, id: kind, label, to: capital.capitalLedger })],
		})
	}
	return {
		id,
		label,
		method,
		contract: 'SecurityPoolCapitalLedger',
		classification: 'selectable',
		ecosystem: 'statoblast',
		risk: 'medium',
		description: `${label} through the owner’s shared capital ledger.`,
		discoveryInputs: ['portfolio owner capital and retirement preview'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No eligible portfolio capital'),
		buildPlan(snapshot, options) {
			const capital = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return capital === undefined ? undefined : build(snapshot, capital)
		},
	}
}

/** Invert the contract's three ceil divisions with floors, preserving its rounding. */
function affordableCommitment(capital: PortfolioCapitalSnapshot, health: bigint, principal = amount(capital.principalAttoRep)) {
	const price = amount(capital.ownerConservativePrice)
	const multiplier = amount(capital.securityMultiplierBps)
	if (price === 0n || multiplier === 0n) return 0n
	return (((((principal * 10_000n) / health) * 10_000n) / multiplier) * 10n ** 18n) / price
}

export function capitalPolicy(kind: 'commitment' | 'health'): OperationDefinition {
	const id = `statoblast.capital.set-${kind}`
	const method = kind === 'commitment' ? 'setCommitment' : 'setHealthTarget'
	const label = kind === 'commitment' ? 'Set portfolio commitment' : 'Set owner health target'
	function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
		return openCapital(snapshot, options).flatMap(capital => {
			const fresh = capital.priceValid && amount(capital.priceValidUntil) >= amount(snapshot.anchor.timestamp)
			const health = amount(capital.targetHealthFactorBps) || 10_000n
			if (kind === 'health') {
				const target = inputInteger(options, 'healthFactorBps', health, 10_000n)
				if (target === health || (amount(capital.commitmentAttoEth) > 0n && target > health && (!fresh || affordableCommitment(capital, target, amount(capital.pledgedAttoRep)) < amount(capital.commitmentAttoEth)))) return []
				return [{ capital, value: target }]
			}
			if (capital.retirementPending) return []
			const maximum = affordableCommitment(capital, health)
			const minimum = amount(capital.minimumCommitmentAttoEth)
			const target = inputInteger(options, 'commitmentAttoEth', minimum)
			const current = amount(capital.commitmentAttoEth)
			if (target < current && current - target < minimum) return []
			if (target === amount(capital.commitmentAttoEth) || target === 0n || target < minimum || (target > amount(capital.commitmentAttoEth) && (!fresh || target > maximum))) return []
			return [{ capital, value: target }]
		})
	}
	return {
		id,
		label,
		method,
		contract: 'SecurityPoolCapitalLedger',
		classification: 'selectable',
		ecosystem: 'statoblast',
		risk: 'medium',
		description: kind === 'health' ? 'Sets the wallet’s own health target above the protocol floor.' : 'Sets the wallet’s portfolio commitment within its chosen collateral target.',
		discoveryInputs: ['owner principal and health', 'fresh conservative price', 'retirement state'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No affordable portfolio policy change'),
		buildPlan(snapshot, options) {
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			if (candidate === undefined) return undefined
			return planBase({
				definitionId: id,
				ecosystem: 'statoblast',
				label,
				metadata: { portfolio: candidate.capital.portfolio, universeId: candidate.capital.universeId, capitalLedger: candidate.capital.capitalLedger, value: candidate.value.toString() },
				postconditions: [label],
				risk: 'medium',
				snapshot,
				steps: [encodeStep({ abi: securityPoolCapitalLedgerAbi, args: [candidate.value], functionName: method, id: kind, label, to: candidate.capital.capitalLedger })],
			})
		},
	}
}
