import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { tryParseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

export const migrationWizardStepIds = ['outcomes', 'amount', 'approve', 'review'] as const
export type MigrationWizardStepId = (typeof migrationWizardStepIds)[number]

/**
 * - `complete`: the step's input is done.
 * - `notNeeded`: the step does not apply to this migration (for example, no wallet REP needs approval).
 * - `ready`: every earlier step is done and this step can act.
 * - `incomplete`: the user still has to do something here; `reason` says what.
 * - `loading`: the step is waiting for balances or allowances.
 * - `blocked`: the step cannot continue with the current balances; `reason` says why.
 */
export type MigrationWizardStepStatus = 'complete' | 'notNeeded' | 'ready' | 'incomplete' | 'loading' | 'blocked'

export type MigrationWizardStep = {
	id: MigrationWizardStepId
	reason: string | undefined
	status: MigrationWizardStepStatus
}

export type MigrationWizardOutcome = {
	/** REP this wallet has already sent to the outcome universe from its migration balance. */
	alreadyMigratedAttoRep: bigint | undefined
	exists: boolean
	/** The migration balance is fully sent to this outcome; sending more requires wallet REP. */
	fullyMigrated: boolean
	/** Outcome-universe REP currently held by the wallet. */
	heldAttoRep: bigint | undefined
	label: string
	outcomeIndex: bigint
	selected: boolean
	universeId: bigint
}

export type MigrationWizardInput = {
	approvalLoading: boolean
	approvedAttoRep: bigint | undefined
	amountInput: string
	balancesLoading: boolean
	childHeldAttoRep: Record<string, bigint | undefined>
	childMigratedAttoRep: Record<string, bigint | undefined>
	childUniverses: readonly ZoltarChildUniverseSummary[]
	/** REP already burned in this universe and waiting to be sent to outcome universes. */
	migrationBalanceAttoRep: bigint | undefined
	/** Parent-universe REP needs an ERC-20 approval; child-universe REP is burned directly. */
	requiresApproval: boolean
	selectedOutcomeIndexes: readonly bigint[]
	walletRepAttoRep: bigint | undefined
}

export type MigrationWizard = {
	amountAttoRep: bigint | undefined
	/** Portion of the amount covered by the existing migration balance. */
	fromMigrationBalanceAttoRep: bigint | undefined
	/** Largest amount that can go to every selected outcome: reusable migration balance plus wallet REP. */
	maxAmountAttoRep: bigint | undefined
	/** Every outcome already received the whole migration balance and the wallet holds no REP. */
	migrationComplete: boolean
	outcomes: MigrationWizardOutcome[]
	/** Migration balance that every selected outcome can still receive without new wallet REP. */
	reusableMigrationBalanceAttoRep: bigint | undefined
	selectedOutcomes: MigrationWizardOutcome[]
	steps: MigrationWizardStep[]
	/** The furthest step the user can open: the first unfinished step, or review when everything is done. */
	reachableStepId: MigrationWizardStepId
	/** Wallet REP that the migration burns in this universe before minting outcome-universe REP. */
	walletRepToBurnAttoRep: bigint | undefined
}

function getAlreadyMigratedAttoRep(child: ZoltarChildUniverseSummary, childMigratedAttoRep: Record<string, bigint | undefined>) {
	if (!child.exists) return 0n
	return childMigratedAttoRep[child.universeId.toString()]
}

/** The largest amount every selected outcome can still receive from the existing migration balance. */
function getReusableMigrationBalance(outcomes: readonly Pick<MigrationWizardOutcome, 'alreadyMigratedAttoRep'>[], migrationBalanceAttoRep: bigint | undefined) {
	if (migrationBalanceAttoRep === undefined) return undefined
	let reusable: bigint | undefined = undefined
	for (const outcome of outcomes) {
		if (outcome.alreadyMigratedAttoRep === undefined) return undefined
		const remaining = migrationBalanceAttoRep > outcome.alreadyMigratedAttoRep ? migrationBalanceAttoRep - outcome.alreadyMigratedAttoRep : 0n
		reusable = reusable === undefined || remaining < reusable ? remaining : reusable
	}
	return reusable ?? 0n
}

export function formatOutcomeList(outcomes: readonly Pick<MigrationWizardOutcome, 'label'>[]) {
	return outcomes.map(outcome => outcome.label).join(', ')
}

function deriveAmountStep(input: MigrationWizardInput, hasSelection: boolean, amountAttoRep: bigint | undefined, reusable: bigint | undefined, walletRepToBurn: bigint | undefined, maxAmount: bigint | undefined): Omit<MigrationWizardStep, 'id'> {
	if (!hasSelection) return { reason: zoltarCopy.outcomeSelectionRequired, status: 'incomplete' }
	if (input.amountInput.trim() === '') return { reason: commonCopy.positiveAmountRequired, status: 'incomplete' }
	if (amountAttoRep === undefined) return { reason: zoltarCopy.migrationAmountInvalid, status: 'incomplete' }
	if (amountAttoRep <= 0n) return { reason: commonCopy.positiveAmountRequired, status: 'incomplete' }
	if (reusable === undefined || (walletRepToBurn !== undefined && walletRepToBurn > 0n && input.walletRepAttoRep === undefined)) {
		return input.balancesLoading ? { reason: zoltarCopy.outcomeBalancesLoading, status: 'loading' } : { reason: zoltarCopy.migrationBalancesReadFailed, status: 'blocked' }
	}
	if (maxAmount !== undefined && amountAttoRep > maxAmount) return { reason: zoltarCopy.formatMigrationAmountExceeded(formatCurrencyBalance(maxAmount)), status: 'blocked' }
	return { reason: undefined, status: 'complete' }
}

function deriveApproveStep(input: MigrationWizardInput, amountStatus: MigrationWizardStepStatus, walletRepToBurn: bigint | undefined): Omit<MigrationWizardStep, 'id'> {
	if (!input.requiresApproval) return { reason: zoltarCopy.migrationApprovalNotNeededChildRep, status: 'notNeeded' }
	if (amountStatus !== 'complete' || walletRepToBurn === undefined) return { reason: zoltarCopy.migrationApprovalNeedsAmount, status: 'incomplete' }
	if (walletRepToBurn === 0n) return { reason: zoltarCopy.migrationApprovalNotNeededNoWalletRep, status: 'notNeeded' }
	if (input.approvalLoading && input.approvedAttoRep === undefined) return { reason: zoltarCopy.migrationApprovalLoading, status: 'loading' }
	if (input.approvedAttoRep !== undefined && input.approvedAttoRep >= walletRepToBurn) return { reason: undefined, status: 'complete' }
	return { reason: zoltarCopy.formatMigrationApprovalRequired(formatCurrencyBalance(walletRepToBurn)), status: 'incomplete' }
}

const maxBigInt = (left: bigint, right: bigint) => (left > right ? left : right)
const minBigInt = (left: bigint, right: bigint) => (left < right ? left : right)

const isStepSatisfied = (step: MigrationWizardStep) => step.status === 'complete' || step.status === 'notNeeded'

/** Derives the migration wizard from balances and form input: choose outcomes, amount, approval, review. */
export function deriveMigrationWizard(input: MigrationWizardInput): MigrationWizard {
	const selectedIndexSet = new Set(input.selectedOutcomeIndexes.map(index => index.toString()))
	const outcomes = input.childUniverses.map(child => {
		const alreadyMigratedAttoRep = getAlreadyMigratedAttoRep(child, input.childMigratedAttoRep)
		const migrationBalance = input.migrationBalanceAttoRep
		return {
			alreadyMigratedAttoRep,
			exists: child.exists,
			fullyMigrated: migrationBalance !== undefined && migrationBalance > 0n && alreadyMigratedAttoRep !== undefined && alreadyMigratedAttoRep >= migrationBalance,
			heldAttoRep: child.exists ? input.childHeldAttoRep[child.universeId.toString()] : 0n,
			label: child.outcomeLabel,
			outcomeIndex: child.outcomeIndex,
			selected: selectedIndexSet.has(child.outcomeIndex.toString()),
			universeId: child.universeId,
		} satisfies MigrationWizardOutcome
	})
	// Keep the user's selection order so the review lists outcomes in the order they were picked.
	const selectedOutcomes = input.selectedOutcomeIndexes.flatMap(index => outcomes.filter(outcome => outcome.outcomeIndex === index))
	const parsedAmount = tryParseRepAmountInput(input.amountInput.trim())
	const amountAttoRep = parsedAmount !== undefined && parsedAmount > 0n ? parsedAmount : undefined
	const reusable = selectedOutcomes.length === 0 ? undefined : getReusableMigrationBalance(selectedOutcomes, input.migrationBalanceAttoRep)
	const canSplitAmount = amountAttoRep !== undefined && reusable !== undefined
	const walletRepToBurn = canSplitAmount ? maxBigInt(amountAttoRep - reusable, 0n) : undefined
	const fromMigrationBalance = canSplitAmount ? minBigInt(amountAttoRep, reusable) : undefined
	const maxAmount = reusable === undefined ? undefined : reusable + (input.walletRepAttoRep ?? 0n)

	const outcomesStep: MigrationWizardStep = selectedOutcomes.length === 0 ? { id: 'outcomes', reason: zoltarCopy.outcomeSelectionRequired, status: 'incomplete' } : { id: 'outcomes', reason: undefined, status: 'complete' }
	const amountStep: MigrationWizardStep = { id: 'amount', ...deriveAmountStep(input, selectedOutcomes.length > 0, parsedAmount, reusable, walletRepToBurn, maxAmount) }
	const approveStep: MigrationWizardStep = { id: 'approve', ...deriveApproveStep(input, amountStep.status, walletRepToBurn) }
	const earlierSteps = [outcomesStep, amountStep, approveStep]
	const firstUnfinished = earlierSteps.find(step => !isStepSatisfied(step))
	const reviewStep: MigrationWizardStep = firstUnfinished === undefined ? { id: 'review', reason: undefined, status: 'ready' } : { id: 'review', reason: firstUnfinished.reason, status: 'incomplete' }

	const balancesKnown = input.migrationBalanceAttoRep !== undefined && input.walletRepAttoRep !== undefined && outcomes.every(outcome => outcome.alreadyMigratedAttoRep !== undefined)
	const migrationComplete = balancesKnown && input.walletRepAttoRep === 0n && outcomes.length > 0 && outcomes.every(outcome => outcome.fullyMigrated)

	return {
		amountAttoRep,
		fromMigrationBalanceAttoRep: fromMigrationBalance,
		maxAmountAttoRep: maxAmount,
		migrationComplete,
		outcomes,
		reachableStepId: firstUnfinished?.id ?? 'review',
		reusableMigrationBalanceAttoRep: reusable,
		selectedOutcomes,
		steps: [...earlierSteps, reviewStep],
		walletRepToBurnAttoRep: walletRepToBurn,
	}
}

/** Clamps a requested step to the furthest step the wizard currently allows. */
export function resolveMigrationWizardStep(requested: MigrationWizardStepId, reachable: MigrationWizardStepId): MigrationWizardStepId {
	return migrationWizardStepIds.indexOf(requested) <= migrationWizardStepIds.indexOf(reachable) ? requested : reachable
}

/** Keeps only selected outcome indexes that the loaded universe has. Selections are also reset when the active universe changes. */
export function getSubmittableOutcomeIndexes(childUniverses: readonly ZoltarChildUniverseSummary[], selected: readonly bigint[]) {
	return selected.filter(outcomeIndex => childUniverses.some(child => child.outcomeIndex === outcomeIndex))
}

/** Names an outcome for transaction dialogs, falling back to its position when the universe summary is unavailable. */
export function getOutcomeLabelForIndex(childUniverses: readonly ZoltarChildUniverseSummary[] | undefined, outcomeIndex: bigint) {
	return childUniverses?.find(child => child.outcomeIndex === outcomeIndex)?.outcomeLabel ?? zoltarCopy.formatUnnamedOutcome(outcomeIndex + 1n)
}

/** Toggles an outcome while keeping the order in which outcomes were picked. */
export function toggleMigrationOutcome(selected: readonly bigint[], outcomeIndex: bigint) {
	return selected.includes(outcomeIndex) ? selected.filter(index => index !== outcomeIndex) : [...selected, outcomeIndex]
}
