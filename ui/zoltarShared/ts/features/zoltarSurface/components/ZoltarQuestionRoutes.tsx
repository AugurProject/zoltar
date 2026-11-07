import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import * as marketCopy from '../../../copy/market.js'
import { QuestionCreateSection } from '../../questions/components/QuestionCreateSection.js'
import { QuestionsView } from './QuestionsView.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'
import { getForkHandoff } from '../lib/zoltarViewModels.js'
import { useExistingQuestionCheck } from '../../questions/hooks/useExistingQuestionCheck.js'

/** Global question registry; choosing a question for a fork opens the Fork route with it selected. */
export function ZoltarQuestionsRoute() {
	const { currentTimestamp, environmentRefreshKey, onForkQuestionIdChange, onViewChange, operations, universeError, universeState } = useZoltarWorkspace()
	return (
		<QuestionsView
			currentTimestamp={currentTimestamp}
			forkHandoff={getForkHandoff({ universe: operations.zoltarUniverse, universeError, universeState })}
			zoltarQuestionsFreshness={operations.zoltarQuestionsFreshness}
			loadingZoltarQuestions={operations.loadingZoltarQuestions}
			onActiveViewChange={onViewChange}
			onLoadZoltarQuestionPage={operations.loadZoltarQuestionPage}
			onZoltarForkQuestionIdChange={onForkQuestionIdChange}
			requestContextKey={environmentRefreshKey}
			zoltarQuestionPage={operations.zoltarQuestionPage}
			zoltarQuestionsError={operations.zoltarQuestionsError}
		/>
	)
}

export function ZoltarCreateQuestionRoute() {
	const { accountState, environmentRefreshKey, onForkQuestionIdChange, onViewChange, operations, universeError, universeState } = useZoltarWorkspace()
	const forkHandoff = getForkHandoff({ universe: operations.zoltarUniverse, universeError, universeState })
	// The contract rejects a second question with the same ID, so the draft's ID is looked up before Create.
	const existingQuestionCheck = useExistingQuestionCheck({ enabled: operations.questionResult === undefined && !operations.questionCreating, environmentRefreshKey, form: operations.questionForm })
	return (
		<>
			<RouteHeader description={marketCopy.createQuestionDescription} title={commonCopy.createQuestion} />
			<QuestionCreateSection
				accountAddress={accountState.address}
				canUseForFork={forkHandoff.kind !== 'omitted'}
				existingQuestionCheck={existingQuestionCheck}
				forkUnavailableReason={forkHandoff.kind === 'offered' ? forkHandoff.universeReason : undefined}
				hasForked={forkHandoff.kind === 'forked'}
				isOnActiveAppChain={isActiveAppChain(accountState.chainId)}
				loadingZoltarQuestions={operations.loadingZoltarQuestions}
				questionCreating={operations.questionCreating}
				questionError={operations.questionError}
				questionForm={operations.questionForm}
				questionResult={operations.questionResult}
				onCreateQuestion={() => void operations.createQuestion()}
				onOpenForkTab={() => onViewChange('fork')}
				onQuestionFormChange={update => operations.setQuestionForm(current => ({ ...current, ...update }))}
				onResetQuestion={operations.resetQuestion}
				onUseQuestionForFork={onForkQuestionIdChange}
				zoltarQuestions={operations.zoltarQuestions}
			/>
		</>
	)
}
