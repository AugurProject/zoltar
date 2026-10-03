import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { UniverseOutcomeNavigation } from '../../universes/components/UniverseOutcomeNavigation.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { useEffect, useRef } from 'preact/hooks'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { universeTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { UniverseBrowser } from '@zoltar/ui-core-shared/components/UniverseBrowser.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { ZoltarMigrationWorkflow } from '../../universes/components/ZoltarMigrationWorkflow.js'
import { getZoltarUniverseActions } from '../lib/zoltarViewModels.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

type UniverseRouteProps = { universe: ZoltarUniverseSummary }

/** The universe tree around the selected universe; Fork or Migrate appears only when that workflow applies. */
export function ZoltarUniversesRoute({ universe }: UniverseRouteProps) {
	const { activeUniverseId, onViewChange, operations } = useZoltarWorkspace()
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
			<>
				<button className='secondary' type='button' onClick={() => onViewChange('fork')}>
					{zoltarCopy.forkZoltar}
				</button>
				<button className='secondary' type='button' onClick={() => onViewChange('migrate')}>
					{zoltarCopy.previewMigration}
				</button>
			</>
		)
	}
	return (
		<>
			<RouteHeader description={zoltarCopy.universesDescription} title={zoltarCopy.universesTitle} />
			<UniverseBrowser
				actions={
					<>
						<UpdatedAgo {...operations.zoltarUniverseFreshness} />
						{actions}
					</>
				}
				activeUniverseId={activeUniverseId}
				includeRelatedUniverses={false}
				navigation={<UniverseOutcomeNavigation universe={universe} />}
				universe={universe}
			/>
		</>
	)
}

/** Mounts the existing fork workflow for an unforked universe. */
export function ZoltarForkRoute({ universe }: UniverseRouteProps) {
	const { accountState, environmentRefreshKey, operations, universeState } = useZoltarWorkspace()
	const forkQuestionId = operations.zoltarForkQuestionId.trim()
	const lookup = useRef(operations.loadZoltarQuestion)
	lookup.current = operations.loadZoltarQuestion
	useEffect(() => {
		if (normalizeQuestionId(forkQuestionId) === undefined) return
		const timeout = setTimeout(() => void lookup.current(forkQuestionId), 300)
		return () => clearTimeout(timeout)
	}, [forkQuestionId, environmentRefreshKey, universe.universeId])
	return (
		<>
			<RouteHeader description={zoltarCopy.forkRouteDescription} title={zoltarCopy.forkZoltar} />
			{/* A pending fork or migration locks only this universe's actions. */}
			<TransactionScopeProvider scope={universeTransactionScope(universe.universeId)}>
				<SectionBlock variant='plain'>
					<ForkZoltarSection
						accountAddress={accountState.address}
						hasLoadedZoltarForkAccess={operations.hasLoadedZoltarForkAccess}
						hasLoadedZoltarQuestions={operations.hasLoadedZoltarQuestions}
						isOnActiveAppChain={isActiveAppChain(accountState.chainId)}
						loadingZoltarForkAccess={operations.loadingZoltarForkAccess}
						loadingZoltarQuestion={operations.loadingZoltarQuestion}
						loadingZoltarQuestions={operations.loadingZoltarQuestions}
						onApproveZoltarForkRep={amount => void operations.approveZoltarForkRep(amount)}
						onForkZoltar={() => void operations.forkZoltar()}
						onRetryZoltarForkAccess={() => void operations.loadZoltarForkAccess()}
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
			</TransactionScopeProvider>
		</>
	)
}

/** Mounts the existing REP migration workflow for a forked universe. */
export function ZoltarMigrateRoute({ universe }: UniverseRouteProps) {
	const { accountState, operations, universeState } = useZoltarWorkspace()
	return (
		<>
			<RouteHeader description={zoltarCopy.migrateRouteDescription} title={zoltarCopy.migrateRep} />
			<ZoltarMigrationWorkflow universeBrowserHref={buildRouteHref(getCurrentRouteHash(), writeZoltarViewQueryParam(getRouteHashSearch(), 'universes'))} accountState={accountState} activeUniverseId={universe.universeId} operations={operations} universeState={universeState} />
		</>
	)
}
