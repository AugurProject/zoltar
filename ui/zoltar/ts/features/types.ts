import type { Address } from '@zoltar/shared/ethereum'
import type { AccountState, OpenOracleCreateFormState, OpenOracleFormState, ReportingFormState, ZoltarMigrationFormState } from '../types/app.js'
import type {
	DeploymentStatus,
	DeploymentStepId,
	MarketDetails,
	MarketDetailsPage,
	MarketCreationResult,
	OpenOracleActionResult,
	OpenOracleReportDetails,
	OpenOracleReportSummaryPage,
	OpenOracleWithdrawableBalances,
	ReportingActionResult,
	ReportingDetails,
	ReportingOutcomeKey,
	ZoltarUniverseSummary,
} from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import type { OpenOracleCreateContractFieldErrors, OpenOracleDisputeSubmissionDetails } from './open-oracle/lib/openOracle.js'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import type { UserMessagePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { ReadBackendStatus } from '@zoltar/ui-core-shared/lib/chainBackend.js'

export type * from '@zoltar/ui-core-shared/types/components.js'

type RepPerEthPriceProps = {
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
}

export type RepPriceFailure = 'no-liquidity' | 'rpc-error'

export type DeploymentSectionProps = {
	title: string
	completedGroup?: boolean
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	busyStepId: DeploymentStepId | undefined
	deploymentStateReady: boolean
	deploymentStatusReasonElementId?: string | undefined
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type OverviewPanelsProps = {
	applicationTitle: string
	activeUniverseId: bigint
	accountState: AccountState
	isConnectingWallet: boolean
	isManagingWallet: boolean
	walletBootstrapComplete: boolean
	parentUniverseId: bigint | undefined
	universeRepBalanceAttoRep: bigint | undefined
	isLoadingUniverseRepBalance: boolean
	universeForkTime?: bigint | undefined
	universeHasForked?: boolean | undefined
	universePresentation: UserMessagePresentation | undefined
	universeLabel: string
	isRefreshing: boolean
	repUsdcPrice: bigint | undefined
	repUsdcFailure: RepPriceFailure | undefined
	repUsdcSource: 'v4' | 'v3' | 'mock' | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	isRefreshingRepPrices: boolean
	onConnect: () => void
	onChangeWallet: () => void
	onDisconnectWallet: () => void
	onGoToGenesisUniverse: () => void
	onRefreshRepPrices: () => void
	onSwitchNetwork: () => void
	showRepPrices?: boolean
	readBackendStatus?: ReadBackendStatus
	repPerEthFailure: RepPriceFailure | undefined
} & RepPerEthPriceProps

export type ZoltarView = 'create' | 'fork' | 'migrate' | 'questions'

export type DeploymentRouteContentProps = {
	accountAddress: Address | undefined
	busyStepId: DeploymentStepId | undefined
	deploymentStateReady: boolean
	deploymentStatusError: string | undefined
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	isLoadingDeploymentStatuses: boolean
	isOnActiveAppChain: boolean
	deployNextMissingPending: boolean
	deploymentCompleteHref?: string
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
	onDeployNextMissing: () => void
	onRetryDeploymentStatus: () => void
}

export type MarketRouteContentProps = {
	accountState: AccountState
	activeUniverseId: bigint
	activeView: ZoltarView
	environmentRefreshKey: number
	onApproveZoltarForkRep: (amount?: bigint) => void
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	onForkZoltar: () => void
	onMigrateInternalRep: () => void
	onPrepareRepForMigration: () => void
	onActiveViewChange: (view: ZoltarView) => void
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestion: boolean
	loadingZoltarQuestions: boolean
	hasLoadedZoltarQuestions: boolean
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	loadingZoltarUniverse: boolean
	zoltarUniverseState: LoadableValueState
	onLoadZoltarQuestions: () => Promise<void>
	onLoadZoltarQuestion: (questionId: string) => Promise<void>
	onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>
	onCreateQuestion: () => void
	onQuestionFormChange: (update: Partial<import('../types/app.js').MarketFormState>) => void
	onResetQuestion: () => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestionLookupError: string | undefined
	zoltarQuestionLookupId: string | undefined
	zoltarQuestionPage: MarketDetailsPage | undefined
	questionCreating: boolean
	questionError: string | undefined
	questionForm: import('../types/app.js').MarketFormState
	questionResult: MarketCreationResult | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	loadingZoltarForkAccess: boolean
	zoltarChildUniverseError: string | undefined
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalanceAttoRep: bigint | undefined
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationChildRepBalancesAttoRep: Record<string, bigint | undefined>
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined
	zoltarQuestions: MarketDetails[]
	zoltarQuestionsError: string | undefined
	zoltarMigrationActiveAction: 'prepare' | 'split' | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	onZoltarForkQuestionIdChange: (questionId: string) => void
}

export type OpenOracleReportLookupState = 'unknown' | 'loading' | 'ready' | 'missing' | 'load-failed'

export type OpenOracleView = 'browse' | 'create' | 'selected-report'

export type OpenOracleSectionProps = OpenOracleRouteContentProps & {
	activeView: OpenOracleView
	environmentReady: boolean
	environmentRefreshKey: number
	loadBrowseReports?: (pageIndex: number, pageSize: number) => Promise<OpenOracleReportSummaryPage>
	onActiveViewChange: (view: OpenOracleView) => void
}

export type ReportingRouteContentProps = {
	accountState: AccountState
	loadingReportingDetails: boolean
	onLoadReporting: () => void
	onReportOutcome: () => void
	onReportingFormChange: (update: Partial<ReportingFormState>) => void
	onWithdrawEscalation: (outcome: ReportingOutcomeKey, depositIndexes?: bigint[]) => void
	reportingActiveAction: ReportingActionResult['action'] | undefined
	reportingDetails: ReportingDetails | undefined
	reportingError: string | undefined
	reportingForm: ReportingFormState
	reportingResult: ReportingActionResult | undefined
}

export type ReportingSectionProps = ReportingRouteContentProps & {
	currentTimestamp?: bigint | undefined
	embedInCard?: boolean
	forkAlreadyTriggered?: boolean | undefined
	lockedReason?: string | undefined
	mode?: 'full-reporting' | 'withdraw-only'
	onOpenForkWorkflow?: (() => void) | undefined
	onOpenPriceOracle?: (() => void) | undefined
	onTriggerZoltarFork?: (() => void) | undefined
	previewMarketDetails?: MarketDetails | undefined
	reportActionGuardMessage?: string | undefined
	showHeader?: boolean
	showSecurityPoolAddressInput?: boolean
	triggerZoltarForkAvailability?: ActionAvailability | undefined
	triggerZoltarForkPending?: boolean | undefined
}

type OpenOracleRouteContentProps = {
	accountState: AccountState
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onCancelOpenOracleWithdrawalBalanceCheck: () => void
	onCreateOpenOracleGame: () => void
	onDisputeReport: () => void
	onLoadOracleReport: (reportId?: string) => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onOpenOracleCreateFormChange: (update: Partial<OpenOracleCreateFormState>) => void
	onSettleReport: () => void
	onWithdrawOpenOracleBalance: (balance: keyof OpenOracleWithdrawableBalances, reviewedAmount: bigint) => void
	loadingOpenOracleCreate: boolean
	openOracleActiveAction: OpenOracleActionResult['action'] | undefined
	openOracleActiveWithdrawalBalance: keyof OpenOracleWithdrawableBalances | undefined
	openOracleError: string | undefined
	openOracleTokenAccessState: {
		token1Approval: TokenApprovalState
		token1Balance: bigint | undefined
		token1BalanceError: string | undefined
		token1Decimals: number | undefined
		token2Approval: TokenApprovalState
		token2Balance: bigint | undefined
		token2BalanceError: string | undefined
		token2Decimals: number | undefined
		tokenAccessLoadingInitial: boolean
		tokenAccessRefreshing: boolean
	}
	openOracleDisputeSubmission: OpenOracleDisputeSubmissionDetails | undefined
	openOracleCreateForm: OpenOracleCreateFormState
	openOracleCreateFieldErrors?: OpenOracleCreateContractFieldErrors
	openOracleForm: OpenOracleFormState
	openOracleReportLookupState: OpenOracleReportLookupState
	openOracleReportDetails: OpenOracleReportDetails | undefined
	openOracleResult: OpenOracleActionResult | undefined
	openOracleWithdrawalBalanceChecking: boolean
	openOracleWithdrawalReviewMessage: { balance: keyof OpenOracleWithdrawableBalances; message: string } | undefined
	openOracleWithdrawableBalances: OpenOracleWithdrawableBalances | undefined
	openOracleWithdrawableBalancesError: string | undefined
	openOracleWithdrawableBalancesLoading: boolean
}
