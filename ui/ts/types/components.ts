import type { ComponentChildren } from 'preact'
import type { Address, Hash } from 'viem'
import type { AccountState, ForkAuctionFormState, MarketFormState, OpenOracleCreateFormState, OpenOracleFormState, ReportingFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState, ZoltarMigrationFormState } from './app.js'
import type {
	DeploymentStatus,
	DeploymentStepId,
	ForkAuctionActionResult,
	ForkAuctionDetails,
	ListedSecurityPool,
	MarketCreationResult,
	MarketDetails,
	MarketDetailsPage,
	OpenOracleActionResult,
	OpenOracleReportDetails,
	OracleManagerDetails,
	ReadClient,
	ReportingActionResult,
	ReportingDetails,
	ReportingOutcomeKey,
	SecurityPoolCreationResult,
	SecurityPoolPage,
	SecurityPoolOverviewActionResult,
	SecurityPoolVaultSummary,
	SecurityVaultActionResult,
	SecurityVaultDetails,
	TradingActionResult,
	TradingDetails,
	ZoltarMigrationActionResult,
	ZoltarUniverseSummary,
} from './contracts.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import type { ForkAuctionStageView } from '../lib/forkAuction.js'
import type { OpenOracleDisputeSubmissionDetails, OpenOracleInitialReportPriceSource, OpenOracleInitialReportSubmissionDetails } from '../lib/openOracle.js'
import type { LoadableValueState } from '../lib/loadState.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import type { ActionSafetyId } from '../lib/actionSafety/ids.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import type { OpenOracleInitialReportQuoteFailureKind, OpenOracleInitialReportQuoteSource } from '../lib/openOracle.js'
import type { ReadBackendStatus } from '../lib/chainBackend.js'

type RepPerEthPriceProps = {
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
}

export type ActionAvailability = {
	disabled: boolean
	reason: string | undefined
}

type NoticeTone = 'blocking' | 'warning' | 'pending' | 'success'

export type BadgeTone = 'blocked' | 'danger' | 'muted' | 'ok' | 'pending' | 'warning'

export type NoticeItem = {
	detail: ComponentChildren
	id: string
	title?: ComponentChildren
	tone: NoticeTone
}

type GlobalTransactionTone = 'preparing' | 'awaiting-wallet' | 'pending' | 'success' | 'warning' | 'error'

export type GlobalTransactionRow = {
	label: string
	value: ComponentChildren
}

export type TransactionIntent = {
	action: string
	requiresWalletConfirmation?: boolean | undefined
	rows?: GlobalTransactionRow[]
	source: string
	submittedDetail: ComponentChildren
	submittedTitle: ComponentChildren
}

export type GlobalTransactionPresentation = {
	detail: ComponentChildren
	dismissKey?: string
	hash?: Hash
	rows?: GlobalTransactionRow[]
	title: ComponentChildren
	tone: GlobalTransactionTone
}

export type StickyContextItem = {
	label: string
	value: ComponentChildren
}

export type LifecycleStagePresentation = {
	availableActions: string[]
	blockedActions: string[]
	detail: string
	key: string
	label: string
	tone: 'critical' | 'default' | 'success' | 'warning'
}

export type ReadinessBlocker = {
	detail?: string
	key: string
	label: string
	resolved: boolean
}

export type ReadinessAction = {
	actionLabel: string
	blocker?: string
	description: string
	onAction?: () => void
	readiness: 'blocked' | 'ready' | 'warning'
	safetyId: ActionSafetyId
	key: string
	title: string
}

export type TransactionStatusCardProps = {
	actions?: ComponentChildren
	badge: ComponentChildren
	className?: string
	detail?: ComponentChildren
	metrics?: ComponentChildren
	secondaryDetail?: ComponentChildren
	title: ComponentChildren
}
export type RouteHeaderProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	description?: ComponentChildren
	eyebrow?: ComponentChildren
	summary?: ComponentChildren
	title: ComponentChildren
}

export type SectionBlockProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	description?: ComponentChildren
	density?: 'balanced' | 'compact'
	headingLevel?: 2 | 3 | 4
	title?: ComponentChildren
	tone?: 'critical' | 'default' | 'muted'
	variant?: 'default' | 'embedded'
}

export type RouteWorkflowPanelProps = {
	children: ComponentChildren
	className?: string
	description?: ComponentChildren
	showHeader?: boolean
	title: ComponentChildren
}

export type DataGridProps = {
	children: ComponentChildren
	className?: string
	columns?: 2 | 3 | 4 | 'auto'
	dense?: boolean
}

export type MetricGridVariant = 'context' | 'default' | 'question' | 'summary' | 'vault'

export type MetricGridProps = {
	children: ComponentChildren
	className?: string
	columns?: 2 | 3 | 4 | 'auto'
	dense?: boolean
	variant?: MetricGridVariant
}

export type ProgressMeterProps = {
	className?: string
	detail?: ComponentChildren
	label: ComponentChildren
	maxValue?: bigint
	secondaryValue?: ComponentChildren
	tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
	value?: bigint
	valueText: ComponentChildren
}

export type RankedBarListProps = {
	className?: string
	emptyMessage?: ComponentChildren
	items: Array<{
		detail?: ComponentChildren
		key: string
		label: ComponentChildren
		tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
		value?: bigint
		valueText: ComponentChildren
	}>
}

export type OutcomeChipRowProps = {
	className?: string
	items: Array<{
		key: string
		label: ComponentChildren
		tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
	}>
}

export type CollateralizationCircleProps = {
	collateralizationPercent: bigint | undefined
	className?: string
	label?: string
	size?: 'small' | 'medium' | 'large'
	successThreshold?: number
	targetCollateralizationPercent: bigint | undefined
	tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
	warningThreshold?: number
}

export type ScalarOutcomePickerProps = {
	action?: ComponentChildren
	details: {
		maxValueLabel?: ComponentChildren
		minValueLabel?: ComponentChildren
		numTicks: bigint
	}
	disabled?: boolean
	isInvalid: boolean
	label: ComponentChildren
	onInvalidChange: (invalid: boolean) => void
	onSelectedTickChange: (tick: string) => void
	selectedOutcomeLabel: ComponentChildren
	selectedTick: string
	selectedTickLabel: ComponentChildren
	showMinMax?: boolean
}

export type OutcomeSelectionListProps = {
	className?: string
	emptyMessage?: ComponentChildren
	items: Array<{
		details?: ComponentChildren
		disabled?: boolean
		key: string
		label: ComponentChildren
		onSelect: () => void
		selected: boolean
	}>
}

export type VaultMetricGridProps = {
	className?: string
	layout?: 'grid' | 'preview'
	escalationEscrowedRep?: bigint | undefined
	priceValidUntilTimestamp?: bigint | undefined
	repDepositShare: bigint | undefined
	selectedPoolSecurityMultiplier: bigint | undefined
	securityBondAllowance: bigint | undefined
	unpaidEthFees: bigint | undefined
} & RepPerEthPriceProps

export type ViewTabOption<TValue extends string> = {
	disabled?: boolean
	href?: string
	id?: string
	label: ComponentChildren
	panelId?: string
	reason?: string
	value: TValue
}

export type ViewTabsProps<TValue extends string> = {
	ariaLabel: string
	className?: string
	/** When provided, only grouped values are rendered. Duplicate values render at their first grouped position. */
	groups?: Array<{
		ariaLabel: string
		className?: string
		values: readonly TValue[]
	}>
	onChange: (value: TValue) => void
	orientation?: 'horizontal' | 'vertical'
	options: ViewTabOption<TValue>[]
	size?: 'compact' | 'default'
	value: TValue
	variant?: 'route' | 'subroute'
}

export type TransactionActionButtonProps = {
	availability?: ActionAvailability
	className?: string
	disabled?: boolean
	idleLabel: ComponentChildren
	onClick: () => void
	pending?: boolean
	pendingLabel: ComponentChildren
	safetyId: ActionSafetyId
	showDisabledReason?: boolean
	tone?: 'primary' | 'secondary'
	type?: 'button' | 'submit'
}

export type OperationModalProps = {
	children: ComponentChildren
	description?: ComponentChildren
	isOpen: boolean
	onClose: () => void
	title: ComponentChildren
}

export type DeploymentSectionProps = {
	title: string
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | undefined
	isMainnet: boolean
	busyStepId: DeploymentStepId | undefined
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type OverviewPanelsProps = {
	activeUniverseId: bigint
	accountState: AccountState
	isConnectingWallet: boolean
	walletBootstrapComplete: boolean
	parentUniverseId: bigint | undefined
	universeRepBalance: bigint | undefined
	isLoadingUniverseRepBalance: boolean
	universeForkTime?: bigint | undefined
	universeHasForked?: boolean | undefined
	universePresentation: UserMessagePresentation | undefined
	universeLabel: string
	isRefreshing: boolean
	repUsdcPrice: bigint | undefined
	repUsdcSource: 'v4' | 'v3' | 'mock' | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	onConnect: () => void
	onGoToGenesisUniverse: () => void
	onRefreshRepPrices: () => void
	readBackendStatus?: ReadBackendStatus
} & RepPerEthPriceProps

export type TabNavigationProps = {
	route: Route
	showDeployTab?: boolean
	augurPlaceHolderDeployed: boolean
	deployRoute: string
	marketRoute: string
	openOracleRoute: string
	securityPoolsRoute: string
	onRouteChange: (route: Exclude<Route, 'not-found'>) => void
}

export type ZoltarView = 'create' | 'fork' | 'migrate' | 'questions'

export type SecurityPoolsView = 'browse' | 'create' | 'operate'

export type DeploymentRouteContentProps = {
	accountAddress: Address | undefined
	busyStepId: DeploymentStepId | undefined
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	isLoadingDeploymentStatuses: boolean
	isMainnet: boolean
	deployNextMissingPending: boolean
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
	onDeployNextMissing: () => void
}

export type MarketRouteContentProps = {
	accountState: AccountState
	activeUniverseId: bigint
	activeView: ZoltarView
	environmentRefreshKey: number
	onApproveZoltarForkRep: (amount?: bigint) => void
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	onCreateMarket: () => void
	onForkZoltar: () => void
	onMigrateInternalRep: () => void
	onPrepareRepForMigration: () => void
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onActiveViewChange: (view: ZoltarView) => void
	onResetMarket: () => void
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	hasLoadedZoltarQuestions: boolean
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	loadingZoltarUniverse: boolean
	zoltarUniverseState: LoadableValueState
	onLoadZoltarQuestions: () => Promise<void>
	onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestionPage: MarketDetailsPage | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	loadingZoltarForkAccess: boolean
	zoltarChildUniverseError: string | undefined
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalance: bigint | undefined
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationChildRepBalances: Record<string, bigint | undefined>
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalance: bigint | undefined
	zoltarMigrationResult: ZoltarMigrationActionResult | undefined
	zoltarQuestions: MarketDetails[]
	zoltarMigrationActiveAction: 'prepare' | 'split' | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	onZoltarForkQuestionIdChange: (questionId: string) => void
}

export type SecurityPoolRouteContentProps = {
	accountState: AccountState
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	onCreateSecurityPool: () => void
	onLoadMarket: () => void
	onLoadMarketById: (marketId: string) => Promise<void>
	onOpenCreatedPool?: (securityPoolAddress: Address) => void
	loadingMarketDetails: boolean
	marketDetails: MarketDetails | undefined
	poolCreationMarketDetails: MarketDetails | undefined
	onResetSecurityPoolCreation: () => void
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
	zoltarUniverseHasForked: boolean
	securityPools: ListedSecurityPool[]
	securityPoolCreating: boolean
	securityPoolError: string | undefined
	securityPoolForm: SecurityPoolFormState
	securityPoolResult: SecurityPoolCreationResult | undefined
} & RepPerEthPriceProps

export type MarketSectionProps = MarketRouteContentProps
export type SecurityPoolSectionProps = SecurityPoolRouteContentProps & {
	onReturnToBrowse?: () => void
	showHeader?: boolean
}

type LiquidationModalStateProps = {
	closeLiquidationModal: () => void
	liquidationAmount: string
	liquidationMaxAmount: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutMinutes: string
	loadingPoolOracleManager: boolean
	securityPoolOverviewActiveAction: SecurityPoolOverviewActionResult['action'] | undefined
	securityPoolOverviewError: string | undefined
	securityPoolLiquidationError: string | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTimeoutMinutesChange: (value: string) => void
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	poolOracleManagerDetails: OracleManagerDetails | undefined
}

export type SecurityPoolsOverviewRouteContentProps = {
	accountState: AccountState
	checkedSecurityPoolAddress: string | undefined
	environmentRefreshKey: number
	hasLoadedSecurityPools: boolean
	hasLoadedSecurityPoolPage: boolean
	loadingSecurityPoolPage: boolean
	loadingSecurityPools: boolean
	onCreateSecurityPool?: () => void
	onLoadSecurityPoolPage: (pageIndex: number, pageSize: number) => void
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => void
	onSelectSecurityPool?: (securityPoolAddress: string) => void
	onLoadSecurityPools: () => void
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPoolBrowseCount: bigint | undefined
	securityPoolPage: SecurityPoolPage | undefined
	securityPools: ListedSecurityPool[]
} & LiquidationModalStateProps &
	RepPerEthPriceProps

export type SecurityPoolsOverviewSectionProps = SecurityPoolsOverviewRouteContentProps

export type SecurityPoolWorkflowRouteContentProps = LiquidationModalStateProps & {
	accountState: AccountState
	activeUniverseId: bigint
	checkedSecurityPoolAddress: string | undefined
	forkAuction: ForkAuctionRouteContentProps
	loadingSecurityPools: boolean
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => void
	onExecutePendingPoolOperation: (managerAddress: Address, operationId: bigint) => void
	onRefreshSelectedPoolData: (securityPoolAddress?: string) => void
	onRequestPoolPrice: (managerAddress: Address) => void
	onSelectedPoolViewChange: (view: string | undefined) => void
	onViewPendingReport: (reportId: bigint) => void
	selectedPoolRefreshNonce: number
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	poolOracleActiveAction: OpenOracleActionResult['action'] | undefined
	poolOracleManagerError: string | undefined
	poolPriceOracleResult: OpenOracleActionResult | undefined
	universeForkTime?: bigint | undefined
	selectedPoolView: string
	securityPoolAddress: string
	onSecurityPoolAddressChange: (value: string) => void
	reporting: ReportingRouteContentProps
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	securityPools: ListedSecurityPool[]
	securityVault: SecurityVaultRouteContentProps
	trading: TradingRouteContentProps
}

export type SecurityPoolsSectionProps = {
	activeView: SecurityPoolsView
	createPool: SecurityPoolRouteContentProps
	onActiveViewChange: (view: SecurityPoolsView) => void
	overview: SecurityPoolsOverviewRouteContentProps
	workflow: SecurityPoolWorkflowRouteContentProps
}

export type SecurityVaultRouteContentProps = {
	accountState: AccountState
	loadingSecurityVault: boolean
	onApproveRep: (amount?: bigint) => void
	onDepositRep: () => void
	onLoadSecurityVault: (vaultAddress?: string) => void
	onRedeemFees: () => void
	onRedeemRep: () => void
	onSetSecurityBondAllowance: () => void
	onSecurityVaultFormChange: (update: Partial<SecurityVaultFormState>) => void
	onWithdrawRep: () => void
	securityVaultActiveAction: SecurityVaultActionResult['action'] | undefined
	securityVaultDetails: SecurityVaultDetails | undefined
	securityVaultError: string | undefined
	securityVaultForm: SecurityVaultFormState
	securityVaultMissing: boolean
	securityVaultRepApproval: TokenApprovalState
	securityVaultRepBalance: bigint | undefined
	securityVaultResult: SecurityVaultActionResult | undefined
	selectedPoolSecurityMultiplier: bigint | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	securityPoolVaults?: SecurityPoolVaultSummary[] | undefined
}

export type SecurityVaultSectionProps = SecurityVaultRouteContentProps & {
	compactLayout?: boolean
	extraReadinessActions?: ReadinessAction[]
	modalFirst?: boolean
	onViewStagedOperations?: () => void
	oracleManagerDetails?: OracleManagerDetails | undefined
	poolState?: SecurityPoolStateModel | undefined
	selectedPoolTotalRepDeposit?: bigint | undefined
	selectedPoolTotalSecurityBondAllowance?: bigint | undefined
	autoLoadVault?: boolean
	showLookupSection?: boolean
	showSummarySection?: boolean
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

type OpenOracleRouteContentProps = {
	accountState: AccountState
	loadingOracleReport: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onCreateOpenOracleGame: () => void
	onDisputeReport: () => void
	onLoadOracleReport: (reportId?: string) => void
	onRefreshPrice: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onOpenOracleCreateFormChange: (update: Partial<OpenOracleCreateFormState>) => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	onWrapWethForInitialReport: () => void
	loadingOpenOracleCreate: boolean
	openOracleActiveAction: OpenOracleActionResult['action'] | undefined
	openOracleError: string | undefined
	openOracleInitialReportState: {
		defaultPrice: string | undefined
		defaultPriceError: string | undefined
		defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
		defaultPriceSourceUrl: string | undefined
		ethBalance: bigint | undefined
		ethBalanceError: string | undefined
		quoteBlockNumber?: bigint | undefined
		quoteLoadedAtMs?: number | undefined
		quoteStale?: boolean
		quoteLoading: boolean
		quoteAttemptedSources: OpenOracleInitialReportQuoteSource[] | undefined
		quoteFailureKind: OpenOracleInitialReportQuoteFailureKind | undefined
		quoteFailureReason: string | undefined
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
	openOracleInitialReportSubmission: OpenOracleInitialReportSubmissionDetails | undefined
	openOracleCreateForm: OpenOracleCreateFormState
	openOracleForm: OpenOracleFormState
	openOracleReportDetails: OpenOracleReportDetails | undefined
	openOracleResult: OpenOracleActionResult | undefined
}

export type OpenOracleView = 'browse' | 'create' | 'selected-report'

export type OpenOracleSectionProps = OpenOracleRouteContentProps & {
	activeView: OpenOracleView
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
	onTriggerZoltarFork?: (() => void) | undefined
	previewMarketDetails?: MarketDetails | undefined
	showHeader?: boolean
	showSecurityPoolAddressInput?: boolean
	triggerZoltarForkAvailability?: ActionAvailability | undefined
	triggerZoltarForkPending?: boolean | undefined
}

export type TradingRouteContentProps = {
	accountState: AccountState
	loadingTradingForkUniverse: boolean
	loadingTradingDetails: boolean
	onCreateCompleteSet: () => void
	onMigrateShares: () => void
	onRedeemCompleteSet: () => void
	onRedeemShares: () => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	selectedPool: ListedSecurityPool | undefined
	tradingActiveAction: TradingActionResult['action'] | undefined
	tradingDetails: TradingDetails | undefined
	tradingError: string | undefined
	tradingForkUniverse: ZoltarUniverseSummary | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
}

export type TradingSectionProps = TradingRouteContentProps & {
	embedInCard?: boolean
	poolState?: SecurityPoolStateModel | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

export type SettlementSelectedBid = {
	tick: bigint
	bidIndex: bigint
}

export type ForkAuctionRouteContentProps = {
	accountState: AccountState
	forkAuctionDetails: ForkAuctionDetails | undefined
	forkAuctionActiveAction: ForkAuctionActionResult['action'] | undefined
	forkAuctionError: string | undefined
	forkAuctionForm: ForkAuctionFormState
	forkAuctionResult: ForkAuctionActionResult | undefined
	loadingForkAuctionDetails: boolean
	onClaimAuctionProceeds: (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[]) => void
	onCreateChildUniverse: () => void
	onFinalizeTruthAuction: (securityPoolAddressOverride?: Address) => void
	onForkAuctionFormChange: (update: Partial<ForkAuctionFormState>) => void
	onForkUniverse: () => void
	onForkWithOwnEscalation: () => void
	onInitiateFork: () => void
	onLoadForkAuction: (securityPoolAddressOverride?: Address) => void
	onMigrateEscalationDeposits: (outcome: ReportingOutcomeKey, depositIndexes?: bigint[]) => void
	onMigrateUnresolvedEscalation: (selectedChildOutcome: ReportingOutcomeKey) => void
	onMigrateRepToZoltar: (outcomes?: ReportingOutcomeKey[]) => void
	onMigrateVault: () => void
	onRefundLosingBids: (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[]) => void
	onStartTruthAuction: (securityPoolAddressOverride?: Address) => void
	onSubmitBid: (securityPoolAddressOverride?: Address) => void
	onWithdrawForkedEscalation: (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) => void
}

export type ForkAuctionSectionProps = ForkAuctionRouteContentProps & {
	auctionDetailsOverride?: ForkAuctionDetails | undefined
	currentTimestamp?: bigint | undefined
	disabled?: boolean
	disabledMessage?: string | undefined
	embedInCard?: boolean
	forkMigrationReadClient?: Pick<ReadClient, 'readContract'> | ReadClient | undefined
	lifecycleStateOverride?: SecurityPoolLifecycleState | undefined
	loadingReportingDetails?: boolean
	onReportingFormChange?: ((update: Partial<ReportingFormState>) => void) | undefined
	previewPool?: ListedSecurityPool | undefined
	reportingDetails?: ReportingDetails | undefined
	reportingForm?: ReportingFormState | undefined
	securityPools?: ListedSecurityPool[] | undefined
	selectedPoolRefreshNonce?: number | undefined
	universeForkTime?: bigint | undefined
	currentStageView?: ForkAuctionStageView | undefined
	selectedStageView?: ForkWorkflowSelectionStage | undefined
	stageView?: ForkAuctionStageView | undefined
	onSelectedStageViewChange?: ((stage: ForkWorkflowSelectionStage) => void) | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
	truthAuctionReadClient?: Pick<ReadClient, 'readContract'> | ReadClient | undefined
}
