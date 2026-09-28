import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import * as marketCopy from '../../../copy/market.js'
import { QuestionCreateSection } from '../../questions/components/QuestionCreateSection.js'
import { QuestionsView } from './QuestionsView.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

/** Global question registry; choosing a question for a fork opens the Fork route with it selected. */
export function ZoltarQuestionsRoute() {
	const { environmentRefreshKey, onViewChange, operations } = useZoltarWorkspace()
	return (
		<QuestionsView
			canFork={operations.zoltarUniverse !== undefined}
			hasForked={operations.zoltarUniverse?.hasForked === true}
			loadingZoltarQuestions={operations.loadingZoltarQuestions}
			onActiveViewChange={onViewChange}
			onLoadZoltarQuestionPage={operations.loadZoltarQuestionPage}
			onZoltarForkQuestionIdChange={operations.setZoltarForkQuestionId}
			requestContextKey={environmentRefreshKey}
			zoltarQuestionPage={operations.zoltarQuestionPage}
			zoltarQuestionsError={operations.zoltarQuestionsError}
		/>
	)
}

export function ZoltarCreateQuestionRoute() {
	const { accountState, onViewChange, operations } = useZoltarWorkspace()
	return (
		<>
			<RouteHeader description={marketCopy.createQuestionDescription} title={commonCopy.createQuestion} />
			<QuestionCreateSection
				accountAddress={accountState.address}
				canUseForFork={operations.zoltarUniverse !== undefined}
				hasForked={operations.zoltarUniverse?.hasForked === true}
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
				onUseQuestionForFork={operations.setZoltarForkQuestionId}
				zoltarQuestions={operations.zoltarQuestions}
			/>
		</>
	)
}
