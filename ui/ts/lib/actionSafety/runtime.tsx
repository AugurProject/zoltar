import { createContext } from 'preact'
import { useContext, useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ActionSafetyModal } from '../../components/ActionSafetyModal.js'
import type { ActionSafetyId } from './ids.js'

type ActionSafetyPrompt = {
	acknowledgeLabel?: string
	checklist: string[]
	confirmLabel?: string
	severity: 'danger' | 'warning'
	summary: string
	title: string
}

type ActionSafetyRequest = {
	onConfirm: () => void
	prompt: ActionSafetyPrompt
}

type ActionSafetyRuntime = {
	requestConfirmation: (safetyId: ActionSafetyId, onConfirm: () => void) => void
}

const ZOLTAR_FORK_PROMPT: ActionSafetyPrompt = {
	acknowledgeLabel: 'I understand this moves the selected universe into the fork path.',
	checklist: ['Forking Zoltar changes the recovery path for the selected universe.', 'Users may need to split REP or migrate positions into child universes after this step.'],
	confirmLabel: 'Fork Zoltar',
	severity: 'danger',
	summary: 'Use this only when the universe should enter its fork process.',
	title: 'Review Zoltar Fork',
}

const TRIGGER_ZOLTAR_FORK_PROMPT: ActionSafetyPrompt = {
	acknowledgeLabel: 'I understand that triggering the fork moves this pool into fork recovery.',
	checklist: ['This pushes the pool out of local resolution and into fork recovery.', 'Follow-up migration and settlement work will continue in child universes, not this parent pool.'],
	confirmLabel: 'Trigger Fork',
	severity: 'danger',
	summary: 'Use this only after non-decision when you are ready to move the pool into fork recovery.',
	title: 'Trigger Zoltar Fork',
}

export const REQUIRES_CONFIRMATION_ACTION_IDS = [
	'child-universe.deploy',
	'fork-auction.forkUniverse',
	'fork-auction.forkWithOwnEscalation',
	'fork-auction.forkZoltar',
	'fork-auction.migrateEscalationDeposits',
	'fork-auction.migrateRepToZoltar',
	'fork-auction.migrateUnresolvedEscalation',
	'fork-auction.migrateVault',
	'fork-auction.startTruthAuction',
	'fork-auction.submitBid',
	'market.createQuestion',
	'open-oracle.createReportInstance',
	'open-oracle.dispute',
	'open-oracle.settle',
	'open-oracle.submitInitialReport',
	'reporting.reportOutcome',
	'reporting.triggerZoltarFork',
	'reporting.withdrawEscalation',
	'security-pool.createPool',
	'security-pool.queueLiquidation',
	'security-vault.depositRep',
	'security-vault.queueSetSecurityBondAllowance',
	'security-vault.queueWithdrawRep',
	'trading.createCompleteSet',
	'trading.migrateShares',
	'trading.redeemCompleteSet',
	'trading.redeemShares',
	'zoltar.forkZoltar',
	'zoltar-migration.prepareRep',
	'zoltar-migration.splitRep',
] as const satisfies readonly ActionSafetyId[]

type ConfirmationActionSafetyId = (typeof REQUIRES_CONFIRMATION_ACTION_IDS)[number]

const ACTION_SAFETY_PROMPTS: Record<ConfirmationActionSafetyId, ActionSafetyPrompt> = {
	'child-universe.deploy': {
		checklist: ['This deploys a child universe on-chain.', 'You may need to migrate positions or REP into the new universe before it becomes useful.'],
		severity: 'warning',
		summary: 'Create a child universe only when you are intentionally continuing post-fork recovery.',
		title: 'Review Child Universe Deployment',
	},
	'fork-auction.forkUniverse': ZOLTAR_FORK_PROMPT,
	'fork-auction.forkWithOwnEscalation': TRIGGER_ZOLTAR_FORK_PROMPT,
	'fork-auction.forkZoltar': ZOLTAR_FORK_PROMPT,
	'fork-auction.migrateEscalationDeposits': {
		checklist: ['The selected escalation deposits will move into the chosen child universe.', 'After migration, settlement continues in the child pool context rather than the parent pool.'],
		severity: 'warning',
		summary: 'Confirm that the selected child outcome is the one you want these deposits to follow.',
		title: 'Migrate Escalation Deposits',
	},
	'fork-auction.migrateRepToZoltar': {
		checklist: ['This prepares pool REP for the selected child universe.', 'Vault migration and child-pool recovery depend on the selected outcome path staying consistent.'],
		severity: 'warning',
		summary: 'Move pool REP only when you are confident this is the correct recovery universe.',
		title: 'Migrate Pool REP',
	},
	'fork-auction.migrateUnresolvedEscalation': {
		checklist: ['All unresolved escalation locks on this wallet move together with the selected outcome path.', 'If you choose the wrong child universe, follow-up settlement becomes harder to reason about.'],
		severity: 'danger',
		summary: 'This moves unresolved parent escalation state into one child universe.',
		title: 'Migrate Unresolved Escalation',
	},
	'fork-auction.migrateVault': {
		checklist: ['This moves the connected vault into the selected child universe.', 'Vault collateral, underwriting state, and later actions will continue there instead of the parent pool.'],
		severity: 'danger',
		summary: 'Migrate the vault only after confirming the correct child outcome and pool path.',
		title: 'Migrate Vault',
	},
	'fork-auction.startTruthAuction': {
		checklist: ['This starts the child-pool repair step or bypasses it when no auction is needed.', 'Once started, settlement and bidder behavior follow the truth-auction path for this child pool.'],
		severity: 'warning',
		summary: 'Starting the truth auction changes the recovery phase for this child pool.',
		title: 'Start Truth Auction',
	},
	'fork-auction.submitBid': {
		acknowledgeLabel: 'I understand this bid can lock ETH until the auction settles or refunds are available.',
		checklist: ['Your ETH may remain committed until the truth auction settles or losing bids are refunded.', 'Clearing can fill partially, clear at a uniform price, or leave you waiting for follow-up settlement actions.'],
		confirmLabel: 'Submit Bid',
		severity: 'danger',
		summary: 'Review the auction price and amount carefully before submitting a truth-auction bid.',
		title: 'Review Truth Auction Bid',
	},
	'market.createQuestion': {
		checklist: ['This writes a new Zoltar question on-chain.', 'Only exact binary Yes / No origin questions are currently eligible for Placeholder origin security pools.'],
		severity: 'warning',
		summary: 'Confirm the market type and question wording before creating the question.',
		title: 'Create Question',
	},
	'open-oracle.createReportInstance': {
		checklist: ['This creates a standalone Open Oracle report instance on-chain.', 'Report lifecycle, approvals, disputes, and settlement will follow from this deployment.'],
		severity: 'warning',
		summary: 'Create a standalone oracle game only when you are ready to operate its full report lifecycle.',
		title: 'Create Open Oracle Report',
	},
	'open-oracle.dispute': {
		checklist: ['This submits a new dispute state for the selected report.', 'You should confirm the new price and token amounts before continuing.'],
		severity: 'warning',
		summary: 'Disputing updates the active report path for this oracle game.',
		title: 'Dispute Report',
	},
	'open-oracle.settle': {
		checklist: ['This settles the currently active report state.', 'Settlement may finalize balances and end further dispute actions for this report.'],
		severity: 'warning',
		summary: 'Settle only when the report state is ready to finalize.',
		title: 'Settle Report',
	},
	'open-oracle.submitInitialReport': {
		checklist: ['This submits the initial report state on-chain.', 'The selected price and token amounts become the starting point for later disputes and settlement.'],
		severity: 'warning',
		summary: 'Confirm the fetched quote, source, and token approvals before submitting the initial report.',
		title: 'Submit Initial Report',
	},
	'reporting.reportOutcome': {
		acknowledgeLabel: 'I understand this can lock REP into the selected escalation path.',
		checklist: ['This can lock REP into the selected reporting side until local resolution or later settlement.', 'If the pool reaches non-decision or fork recovery, follow-up actions may move to child-universe workflows.'],
		confirmLabel: 'Report Outcome',
		severity: 'danger',
		summary: 'Review the selected outcome, contribution amount, and escalation state before reporting.',
		title: 'Review Outcome Report',
	},
	'reporting.triggerZoltarFork': TRIGGER_ZOLTAR_FORK_PROMPT,
	'reporting.withdrawEscalation': {
		checklist: ['This settles the selected escalation deposits for the chosen side.', 'Claim value depends on the current finalized or migrated settlement path shown in the UI.'],
		severity: 'warning',
		summary: 'Confirm which deposits you are settling and the value path they currently show.',
		title: 'Settle Escalation Deposits',
	},
	'security-pool.createPool': {
		checklist: ['This deploys a new Placeholder security pool for the selected question and multiplier.', 'Origin pool addresses are deterministic for the question and multiplier pair.'],
		severity: 'warning',
		summary: 'Create a pool only after confirming that the selected question is the intended binary origin market.',
		title: 'Create Security Pool',
	},
	'security-pool.queueLiquidation': {
		acknowledgeLabel: 'I understand this is a high-risk liquidation action against the selected vault.',
		checklist: ['This can queue or execute a liquidation against the selected vault.', 'Oracle timing and settlement mode can determine whether execution is immediate or requires manual follow-up.'],
		confirmLabel: 'Queue Liquidation',
		severity: 'danger',
		summary: 'Liquidation is a destructive operator action. Review the vault, oracle status, and amount carefully.',
		title: 'Review Vault Liquidation',
	},
	'security-vault.depositRep': {
		checklist: ['This deposits REP into the selected security vault.', 'Deposited REP backs underwriting capacity and may stay locked until later withdrawal or redemption conditions are met.'],
		severity: 'warning',
		summary: 'Confirm the REP amount and vault before adding collateral.',
		title: 'Deposit REP',
	},
	'security-vault.queueSetSecurityBondAllowance': {
		checklist: ['This changes the vault underwriting allowance using the latest oracle-backed value path.', 'Increasing or decreasing allowance changes how much open interest this vault backs.'],
		severity: 'warning',
		summary: 'Review the new bond allowance and oracle context before queueing the change.',
		title: 'Set Bond Allowance',
	},
	'security-vault.queueWithdrawRep': {
		checklist: ['This queues a REP withdrawal from the selected vault.', 'Execution may depend on oracle settlement timing and can require manual follow-up when auto-execution is unavailable.'],
		severity: 'warning',
		summary: 'Confirm the withdrawal amount and staged-operation timing before continuing.',
		title: 'Queue REP Withdrawal',
	},
	'trading.createCompleteSet': {
		checklist: ['This locks ETH collateral into the pool and mints Invalid, Yes, and No shares together.', 'Placeholder is not a secondary-market venue, so this is a minting action rather than an exchange trade.'],
		severity: 'warning',
		summary: 'Confirm the complete-set mint amount and remaining pool capacity before minting.',
		title: 'Mint Complete Sets',
	},
	'trading.migrateShares': {
		acknowledgeLabel: 'I understand the full selected parent share balance is burned and reproduced across the chosen child outcomes.',
		checklist: ['Share migration burns the entire selected parent balance for that outcome. Partial migration is not available.', 'The burned balance is reproduced into each valid child outcome you select, rather than being split pro rata.'],
		confirmLabel: 'Migrate Shares',
		severity: 'danger',
		summary: 'Review the source outcome and every selected child target before migrating shares.',
		title: 'Review Share Migration',
	},
	'trading.redeemCompleteSet': {
		checklist: ['This burns matching Invalid, Yes, and No shares together.', 'The corresponding collateral amount is returned from the pool.'],
		severity: 'warning',
		summary: 'Confirm the redeemable complete-set amount before burning shares.',
		title: 'Redeem Complete Sets',
	},
	'trading.redeemShares': {
		checklist: ['This burns finalized winning shares for collateral redemption.', 'Only the resolved winning path pays out here.'],
		severity: 'warning',
		summary: 'Confirm that the pool has resolved and you are redeeming the intended winning shares.',
		title: 'Redeem Resolved Shares',
	},
	'zoltar.forkZoltar': ZOLTAR_FORK_PROMPT,
	'zoltar-migration.prepareRep': {
		checklist: ['This prepares REP for later child-universe splitting.', 'Prepared balances are part of the post-fork migration path, not normal trading flow.'],
		severity: 'warning',
		summary: 'Prepare REP only when you intend to continue into migration.',
		title: 'Prepare REP',
	},
	'zoltar-migration.splitRep': {
		checklist: ['This splits prepared REP across the selected child universes.', 'After splitting, follow-up actions continue with the resulting child-universe REP balances.'],
		severity: 'warning',
		summary: 'Confirm the selected child outcomes before splitting prepared REP.',
		title: 'Split REP',
	},
}

const ActionSafetyContext = createContext<ActionSafetyRuntime>({
	requestConfirmation: (_safetyId, onConfirm) => {
		onConfirm()
	},
})

function isConfirmationActionSafetyId(safetyId: ActionSafetyId): safetyId is ConfirmationActionSafetyId {
	return REQUIRES_CONFIRMATION_ACTION_IDS.some(actionSafetyId => actionSafetyId === safetyId)
}

export function getActionSafetyPrompt(safetyId: ActionSafetyId) {
	return isConfirmationActionSafetyId(safetyId) ? ACTION_SAFETY_PROMPTS[safetyId] : undefined
}

export function ActionSafetyProvider({ children }: { children: ComponentChildren }) {
	const [pendingRequest, setPendingRequest] = useState<ActionSafetyRequest | undefined>(undefined)

	const runtime = useMemo<ActionSafetyRuntime>(
		() => ({
			requestConfirmation: (safetyId, onConfirm) => {
				const prompt = getActionSafetyPrompt(safetyId)
				if (prompt === undefined) {
					onConfirm()
					return
				}
				setPendingRequest({ onConfirm, prompt })
			},
		}),
		[],
	)

	return (
		<ActionSafetyContext.Provider value={runtime}>
			{children}
			<ActionSafetyModal
				request={pendingRequest}
				onCancel={() => setPendingRequest(undefined)}
				onConfirm={() => {
					if (pendingRequest === undefined) return
					const nextConfirm = pendingRequest.onConfirm
					setPendingRequest(undefined)
					nextConfirm()
				}}
			/>
		</ActionSafetyContext.Provider>
	)
}

export function useActionSafetyConfirmation() {
	return useContext(ActionSafetyContext)
}
