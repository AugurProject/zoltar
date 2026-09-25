import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { Question } from '@zoltar/ui-core-shared/components/Question.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { UniverseBrowser } from '@zoltar/ui-core-shared/components/UniverseBrowser.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js'
import { getZoltarUniverseActions } from '../lib/zoltarViewModels.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

type UniverseRouteProps = { universe: ZoltarUniverseSummary }

/** The universe tree around the selected universe; Fork or Migrate appears only when that workflow applies. */
export function ZoltarUniversesRoute({ universe }: UniverseRouteProps) {
	const { activeUniverseId, onViewChange } = useZoltarWorkspace()
	const { canFork, canMigrate } = getZoltarUniverseActions(universe)
	let actions
	if (canMigrate) {
		actions = (
			<button className='primary' type='button' onClick={() => onViewChange('migrate')}>
				{zoltarCopy.migrateRep}
			</button>
		)
	} else if (canFork) {
		actions = (
			<button className='secondary' type='button' onClick={() => onViewChange('fork')}>
				{zoltarCopy.forkZoltar}
			</button>
		)
	}
	return (
		<>
			<RouteHeader description={zoltarCopy.universesDescription} title={zoltarCopy.universesTitle} />
			<UniverseBrowser actions={actions} activeUniverseId={activeUniverseId} universe={universe}>
				{universe.forkQuestionDetails === undefined ? undefined : (
					<div className='loaded-question-preview'>
						<Question question={universe.forkQuestionDetails} variant='preview' />
					</div>
				)}
			</UniverseBrowser>
		</>
	)
}

/** Mounts the existing fork workflow for an unforked universe. */
export function ZoltarForkRoute({ universe }: UniverseRouteProps) {
	const { accountState, operations, universeState } = useZoltarWorkspace()
	const forkQuestionId = operations.zoltarForkQuestionId.trim()
	return (
		<>
			<RouteHeader description={zoltarCopy.forkRouteDescription} title={zoltarCopy.forkZoltar} />
			<SectionBlock variant='plain'>
				<ForkZoltarSection
					accountAddress={accountState.address}
					hasLoadedZoltarQuestions={operations.hasLoadedZoltarQuestions}
					isOnActiveAppChain={isActiveAppChain(accountState.chainId)}
					loadingZoltarForkAccess={operations.loadingZoltarForkAccess}
					loadingZoltarQuestion={operations.loadingZoltarQuestion}
					loadingZoltarQuestions={operations.loadingZoltarQuestions}
					onApproveZoltarForkRep={amount => void operations.approveZoltarForkRep(amount)}
					onForkZoltar={() => void operations.forkZoltar()}
					onRetryZoltarQuestion={forkQuestionId === '' ? undefined : () => void operations.loadZoltarQuestion(forkQuestionId)}
					onZoltarForkQuestionIdChange={operations.setZoltarForkQuestionId}
					zoltarForkActiveAction={operations.zoltarForkActiveAction}
					zoltarForkApproval={operations.zoltarForkApproval}
					zoltarForkError={operations.zoltarForkError}
					zoltarForkPending={operations.zoltarForkPending}
					zoltarForkQuestionId={operations.zoltarForkQuestionId}
					zoltarForkRepBalanceAttoRep={operations.zoltarForkRepBalanceAttoRep}
					zoltarQuestionLookupError={operations.zoltarQuestionLookupError}
					zoltarQuestionLookupId={operations.zoltarQuestionLookupId}
					zoltarQuestions={operations.zoltarQuestions}
					zoltarUniverse={universe}
					zoltarUniverseState={universeState}
				/>
			</SectionBlock>
		</>
	)
}

/** Mounts the existing REP migration workflow for a forked universe. */
export function ZoltarMigrateRoute({ universe }: UniverseRouteProps) {
	const { accountState, operations, universeState } = useZoltarWorkspace()
	return (
		<>
			<RouteHeader description={zoltarCopy.migrateRouteDescription} title={zoltarCopy.migrateRep} />
			<SectionBlock variant='plain'>
				<ZoltarMigrationSection
					accountAddress={accountState.address}
					isOnActiveAppChain={isActiveAppChain(accountState.chainId)}
					loadingZoltarForkAccess={operations.loadingZoltarForkAccess}
					loadingZoltarUniverse={operations.loadingZoltarUniverse}
					onApproveZoltarForkRep={amount => void operations.approveZoltarForkRep(amount)}
					onDeployChildUniverse={outcomeIndex => void operations.createChildUniverse(outcomeIndex)}
					onMigrateInternalRep={maxPreparationAttoRep => void operations.migrateInternalRep(maxPreparationAttoRep)}
					onRetryMigrationBalances={() => void operations.loadZoltarForkAccess()}
					onZoltarMigrationFormChange={update => operations.setZoltarMigrationForm(current => ({ ...current, ...update }))}
					pendingChildUniverseOutcomeIndex={operations.zoltarChildUniversePendingOutcomeIndex}
					zoltarForkActiveAction={operations.zoltarForkActiveAction}
					zoltarForkApproval={operations.zoltarForkApproval}
					zoltarForkRepBalanceAttoRep={operations.zoltarForkRepBalanceAttoRep}
					zoltarMigrationActiveAction={operations.zoltarMigrationActiveAction}
					zoltarMigrationChildRepBalancesAttoRep={operations.zoltarMigrationChildRepBalancesAttoRep}
					zoltarMigrationChildSplitAmountsAttoRep={operations.zoltarMigrationChildSplitAmountsAttoRep}
					zoltarMigrationError={operations.zoltarMigrationError}
					zoltarMigrationForm={operations.zoltarMigrationForm}
					zoltarMigrationPending={operations.zoltarMigrationPending}
					zoltarMigrationPreparedRepBalanceAttoRep={operations.zoltarMigrationPreparedRepBalanceAttoRep}
					zoltarUniverse={universe}
					zoltarUniverseState={universeState}
				/>
			</SectionBlock>
			<ErrorNotice message={operations.zoltarChildUniverseError} />
		</>
	)
}
