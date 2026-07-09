import { createContext } from 'preact'
import { useContext, useMemo, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { ActionSafetyModal } from '../../components/ActionSafetyModal.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from '../forkAuction.js'
import type { ActionSafetyId } from './ids.js'
import { CURATED_TSX_STRINGS, TSX_STRINGS } from '../uiStrings.js'

type ActionSafetyPrompt = {
	acknowledgeLabel?: string
	checklist: readonly string[]
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
	acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy001,
	checklist: CURATED_TSX_STRINGS.actionSafety.zoltarForkChecklist,
	confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy002,
	severity: 'danger',
	summary: TSX_STRINGS.libActionSafetyRuntime.copy003,
	title: TSX_STRINGS.libActionSafetyRuntime.copy004,
}

const TRIGGER_ZOLTAR_FORK_PROMPT: ActionSafetyPrompt = {
	acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy005,
	checklist: CURATED_TSX_STRINGS.actionSafety.triggerZoltarForkChecklist,
	confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy006,
	severity: 'danger',
	summary: TSX_STRINGS.libActionSafetyRuntime.copy007,
	title: TSX_STRINGS.libActionSafetyRuntime.copy008,
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
	'fork-auction.claimAuctionProceeds',
	'fork-auction.settleAuctionRefunds',
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
		checklist: CURATED_TSX_STRINGS.actionSafety.childUniverseDeployChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy009,
		title: TSX_STRINGS.libActionSafetyRuntime.copy010,
	},
	'fork-auction.forkUniverse': ZOLTAR_FORK_PROMPT,
	'fork-auction.forkWithOwnEscalation': TRIGGER_ZOLTAR_FORK_PROMPT,
	'fork-auction.forkZoltar': ZOLTAR_FORK_PROMPT,
	'fork-auction.migrateEscalationDeposits': {
		checklist: CURATED_TSX_STRINGS.actionSafety.migrateEscalationDepositsChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy011,
		title: TSX_STRINGS.libActionSafetyRuntime.copy012,
	},
	'fork-auction.migrateRepToZoltar': {
		checklist: CURATED_TSX_STRINGS.actionSafety.migrateRepToZoltarChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy013,
		title: TSX_STRINGS.libActionSafetyRuntime.copy014,
	},
	'fork-auction.migrateUnresolvedEscalation': {
		checklist: CURATED_TSX_STRINGS.actionSafety.migrateUnresolvedEscalationChecklist,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy015,
		title: TSX_STRINGS.libActionSafetyRuntime.copy016,
	},
	'fork-auction.migrateVault': {
		checklist: CURATED_TSX_STRINGS.actionSafety.migrateVaultChecklist,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy017,
		title: TSX_STRINGS.libActionSafetyRuntime.copy018,
	},
	'fork-auction.startTruthAuction': {
		checklist: CURATED_TSX_STRINGS.actionSafety.startTruthAuctionChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy019,
		title: TSX_STRINGS.libActionSafetyRuntime.copy020,
	},
	'fork-auction.claimAuctionProceeds': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy021(AUCTIONED_BOND_ALLOWANCE_LABEL),
		checklist: CURATED_TSX_STRINGS.actionSafety.claimAuctionProceedsChecklist(AUCTIONED_BOND_ALLOWANCE_LABEL),
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy022,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy023(AUCTIONED_BOND_ALLOWANCE_LABEL),
		title: TSX_STRINGS.libActionSafetyRuntime.copy024,
	},
	'fork-auction.settleAuctionRefunds': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy025(AUCTIONED_BOND_ALLOWANCE_LABEL),
		checklist: CURATED_TSX_STRINGS.actionSafety.settleAuctionRefundsChecklist(AUCTIONED_BOND_ALLOWANCE_LABEL),
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy026,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy027,
		title: TSX_STRINGS.libActionSafetyRuntime.copy028,
	},
	'fork-auction.submitBid': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy029(AUCTIONED_BOND_ALLOWANCE_LABEL),
		checklist: CURATED_TSX_STRINGS.actionSafety.submitBidChecklist(AUCTIONED_BOND_ALLOWANCE_LABEL),
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy030,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy031,
		title: TSX_STRINGS.libActionSafetyRuntime.copy032,
	},
	'market.createQuestion': {
		checklist: CURATED_TSX_STRINGS.actionSafety.marketCreateQuestionChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy033,
		title: TSX_STRINGS.libActionSafetyRuntime.copy034,
	},
	'open-oracle.createReportInstance': {
		checklist: CURATED_TSX_STRINGS.actionSafety.openOracleCreateReportChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy035,
		title: TSX_STRINGS.libActionSafetyRuntime.copy036,
	},
	'open-oracle.dispute': {
		checklist: CURATED_TSX_STRINGS.actionSafety.openOracleDisputeChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy037,
		title: TSX_STRINGS.libActionSafetyRuntime.copy038,
	},
	'open-oracle.settle': {
		checklist: CURATED_TSX_STRINGS.actionSafety.openOracleSettleChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy039,
		title: TSX_STRINGS.libActionSafetyRuntime.copy040,
	},
	'open-oracle.submitInitialReport': {
		checklist: CURATED_TSX_STRINGS.actionSafety.openOracleSubmitInitialReportChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy041,
		title: TSX_STRINGS.libActionSafetyRuntime.copy042,
	},
	'reporting.reportOutcome': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy043,
		checklist: CURATED_TSX_STRINGS.actionSafety.reportOutcomeChecklist,
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy044,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy045,
		title: TSX_STRINGS.libActionSafetyRuntime.copy046,
	},
	'reporting.triggerZoltarFork': TRIGGER_ZOLTAR_FORK_PROMPT,
	'reporting.withdrawEscalation': {
		checklist: CURATED_TSX_STRINGS.actionSafety.withdrawEscalationChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy047,
		title: TSX_STRINGS.libActionSafetyRuntime.copy048,
	},
	'security-pool.createPool': {
		checklist: CURATED_TSX_STRINGS.actionSafety.createPoolChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy049,
		title: TSX_STRINGS.libActionSafetyRuntime.copy050,
	},
	'security-pool.queueLiquidation': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy051,
		checklist: CURATED_TSX_STRINGS.actionSafety.queueLiquidationChecklist,
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy052,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy053,
		title: TSX_STRINGS.libActionSafetyRuntime.copy054,
	},
	'security-vault.depositRep': {
		checklist: CURATED_TSX_STRINGS.actionSafety.depositRepChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy055,
		title: TSX_STRINGS.libActionSafetyRuntime.copy056,
	},
	'security-vault.queueSetSecurityBondAllowance': {
		checklist: CURATED_TSX_STRINGS.actionSafety.queueSetSecurityBondAllowanceChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy057,
		title: TSX_STRINGS.libActionSafetyRuntime.copy058,
	},
	'security-vault.queueWithdrawRep': {
		checklist: CURATED_TSX_STRINGS.actionSafety.queueWithdrawRepChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy059,
		title: TSX_STRINGS.libActionSafetyRuntime.copy060,
	},
	'trading.createCompleteSet': {
		checklist: CURATED_TSX_STRINGS.actionSafety.createCompleteSetChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy061,
		title: TSX_STRINGS.libActionSafetyRuntime.copy062,
	},
	'trading.migrateShares': {
		acknowledgeLabel: TSX_STRINGS.libActionSafetyRuntime.copy063,
		checklist: CURATED_TSX_STRINGS.actionSafety.migrateSharesChecklist,
		confirmLabel: TSX_STRINGS.libActionSafetyRuntime.copy064,
		severity: 'danger',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy065,
		title: TSX_STRINGS.libActionSafetyRuntime.copy066,
	},
	'trading.redeemCompleteSet': {
		checklist: CURATED_TSX_STRINGS.actionSafety.redeemCompleteSetChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy067,
		title: TSX_STRINGS.libActionSafetyRuntime.copy068,
	},
	'trading.redeemShares': {
		checklist: CURATED_TSX_STRINGS.actionSafety.redeemSharesChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy069,
		title: TSX_STRINGS.libActionSafetyRuntime.copy070,
	},
	'zoltar.forkZoltar': ZOLTAR_FORK_PROMPT,
	'zoltar-migration.prepareRep': {
		checklist: CURATED_TSX_STRINGS.actionSafety.prepareRepChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy071,
		title: TSX_STRINGS.libActionSafetyRuntime.copy072,
	},
	'zoltar-migration.splitRep': {
		checklist: CURATED_TSX_STRINGS.actionSafety.splitRepChecklist,
		severity: 'warning',
		summary: TSX_STRINGS.libActionSafetyRuntime.copy073,
		title: TSX_STRINGS.libActionSafetyRuntime.copy074,
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
