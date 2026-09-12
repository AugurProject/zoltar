import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js'
import { UniverseDirectorySection } from '../../universes/components/UniverseDirectorySection.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { QuestionCreateSection } from '../../questions/components/QuestionCreateSection.js'
import { QuestionsView } from './QuestionsView.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import type { MarketRouteContentProps } from '../../types.js'

export function ZoltarSection({
	accountState,
	activeView,
	environmentRefreshKey,
	loadingZoltarForkAccess,
	loadingZoltarQuestion,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
	hasLoadedZoltarQuestions,
	onActiveViewChange,
	onApproveZoltarForkRep,
	onCreateChildUniverseForOutcomeIndex,
	onCreateQuestion,
	onForkZoltar,
	onLoadZoltarQuestion,
	onLoadZoltarQuestionPage,
	onRetryMigrationBalances,
	onMigrateInternalRep,
	onQuestionFormChange,
	onResetQuestion,
	onZoltarForkQuestionIdChange,
	onZoltarMigrationFormChange,
	zoltarChildUniverseError,
	zoltarChildUniversePendingOutcomeIndex,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalanceAttoRep,
	zoltarMigrationActiveAction,
	zoltarMigrationChildSplitAmountsAttoRep,
	zoltarMigrationChildRepBalancesAttoRep,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalanceAttoRep,
	zoltarQuestionLookupError,
	zoltarQuestionLookupId,
	zoltarQuestionPage,
	zoltarQuestionsError,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
	questionCreating,
	questionError,
	questionForm,
	questionResult,
}: MarketRouteContentProps) {
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	if (activeView === 'create') {
		return (
			<>
				<RouteHeader description={marketCopy.createQuestionDescription} title={commonCopy.createQuestion} />
				<QuestionCreateSection
					accountAddress={accountState.address}
					canUseForFork={zoltarUniverse !== undefined}
					hasForked={zoltarUniverse?.hasForked === true}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingZoltarQuestions={loadingZoltarQuestions}
					questionCreating={questionCreating}
					questionError={questionError}
					questionForm={questionForm}
					questionResult={questionResult}
					onCreateQuestion={onCreateQuestion}
					onOpenForkTab={() => onActiveViewChange('universes')}
					onQuestionFormChange={onQuestionFormChange}
					onResetQuestion={onResetQuestion}
					onUseQuestionForFork={onZoltarForkQuestionIdChange}
					zoltarQuestions={zoltarQuestions}
				/>
			</>
		)
	}

	const questionsView = (
		<QuestionsView
			canFork={zoltarUniverse !== undefined}
			hasForked={zoltarUniverse?.hasForked === true}
			loadingZoltarQuestions={loadingZoltarQuestions}
			onActiveViewChange={onActiveViewChange}
			onLoadZoltarQuestionPage={onLoadZoltarQuestionPage}
			onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
			requestContextKey={environmentRefreshKey}
			zoltarQuestionPage={zoltarQuestionPage}
			zoltarQuestionsError={zoltarQuestionsError}
		/>
	)
	if (activeView === 'questions' || zoltarUniverseState === 'missing') return questionsView

	if (activeView === 'universes') {
		let universeActionContent
		if (zoltarUniverse?.hasForked === true) {
			universeActionContent = (
				<SectionBlock title={zoltarCopy.migrateRep} variant='plain'>
					<ZoltarMigrationSection
						onDeployChildUniverse={onCreateChildUniverseForOutcomeIndex}
						pendingChildUniverseOutcomeIndex={zoltarChildUniversePendingOutcomeIndex}
						accountAddress={accountState.address}
						isOnActiveAppChain={isOnActiveAppChain}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onApproveZoltarForkRep={amount => onApproveZoltarForkRep(amount)}
						onMigrateInternalRep={onMigrateInternalRep}
						onRetryMigrationBalances={onRetryMigrationBalances}
						onZoltarMigrationFormChange={onZoltarMigrationFormChange}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
						zoltarMigrationActiveAction={zoltarMigrationActiveAction}
						zoltarMigrationChildRepBalancesAttoRep={zoltarMigrationChildRepBalancesAttoRep}
						zoltarMigrationChildSplitAmountsAttoRep={zoltarMigrationChildSplitAmountsAttoRep}
						zoltarMigrationError={zoltarMigrationError}
						zoltarMigrationForm={zoltarMigrationForm}
						zoltarMigrationPending={zoltarMigrationPending}
						zoltarMigrationPreparedRepBalanceAttoRep={zoltarMigrationPreparedRepBalanceAttoRep}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
					/>
				</SectionBlock>
			)
		} else if (zoltarUniverse !== undefined) {
			universeActionContent = (
				<SectionBlock title={zoltarCopy.forkZoltar} variant='plain'>
					<ForkZoltarSection
						accountAddress={accountState.address}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
						isOnActiveAppChain={isOnActiveAppChain}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarQuestion={loadingZoltarQuestion}
						loadingZoltarQuestions={loadingZoltarQuestions}
						onApproveZoltarForkRep={amount => onApproveZoltarForkRep(amount)}
						onForkZoltar={onForkZoltar}
						onRetryZoltarQuestion={zoltarForkQuestionId.trim() === '' ? undefined : () => void onLoadZoltarQuestion(zoltarForkQuestionId.trim())}
						onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkError={zoltarForkError}
						zoltarForkPending={zoltarForkPending}
						zoltarForkQuestionId={zoltarForkQuestionId}
						zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
						zoltarQuestionLookupError={zoltarQuestionLookupError}
						zoltarQuestionLookupId={zoltarQuestionLookupId}
						zoltarQuestions={zoltarQuestions}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
					/>
				</SectionBlock>
			)
		}
		return (
			<>
				<UniverseDirectorySection zoltarUniverse={zoltarUniverse}>{universeActionContent}</UniverseDirectorySection>
				<ErrorNotice message={zoltarChildUniverseError} />
			</>
		)
	}

	return questionsView
}
