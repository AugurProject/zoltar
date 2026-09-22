import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { AccountState, ZoltarMigrationFormState } from '../types/app.js'
import type { DeploymentStatus, DeploymentStepId, MarketDetails, MarketDetailsPage, MarketCreationResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/transactions/tokenApproval.js'

export type * from '@zoltar/ui-core-shared/types/components.js'

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

export type ZoltarView = 'create' | 'questions' | 'universes'

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
	onRetryMigrationBalances: () => void
	onMigrateInternalRep: (preparationAttoRep: bigint) => void
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
	zoltarMigrationChildSplitAmountsAttoRep: Record<string, bigint | undefined>
	zoltarMigrationChildRepBalancesAttoRep: Record<string, bigint | undefined>
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined
	zoltarQuestions: MarketDetails[]
	zoltarQuestionsError: string | undefined
	zoltarMigrationActiveAction: 'split' | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	onZoltarForkQuestionIdChange: (questionId: string) => void
}
