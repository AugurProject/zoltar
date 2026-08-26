import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import type { Address } from '@zoltar/shared/ethereum'
import { ChildUniverseDeploymentSection } from '../../universes/components/ChildUniverseDeploymentSection.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../../universes/lib/universe.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { MarketRouteContentProps } from '../../types.js'

type ZoltarUniverseOverviewProps = {
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary
}

function ZoltarUniverseOverview({ accountAddress, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse }: ZoltarUniverseOverviewProps) {
	const hasForked = zoltarUniverse.hasForked === true
	const currentUniverseName = formatUniverseCollectionLabel([zoltarUniverse.universeId])

	return (
		<>
			<DataGrid className='market-overview-grid'>
				<MetricField label={commonCopy.universe}>{currentUniverseName}</MetricField>
				<MetricField label={commonCopy.status}>{hasForked ? commonCopy.forked : marketCopy.unforked}</MetricField>
			</DataGrid>
			<ChildUniverseDeploymentSection accountAddress={accountAddress} childUniverses={zoltarUniverse.childUniverses} hasForked={hasForked} isOnActiveAppChain={isOnActiveAppChain} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} pendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex} />
		</>
	)
}

export function ZoltarSection({
	accountState,
	activeView,
	loadingZoltarForkAccess,
	loadingZoltarQuestion,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
	hasLoadedZoltarQuestions,
	onApproveZoltarForkRep,
	onCreateChildUniverseForOutcomeIndex,
	onForkZoltar,
	onLoadZoltarQuestion,
	onMigrateInternalRep,
	onPrepareRepForMigration,
	onZoltarForkQuestionIdChange,
	onZoltarMigrationFormChange,
	zoltarChildUniversePendingOutcomeIndex,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalanceAttoRep,
	zoltarMigrationActiveAction,
	zoltarMigrationChildRepBalancesAttoRep,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalanceAttoRep,
	zoltarQuestionLookupError,
	zoltarQuestionLookupId,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
}: MarketRouteContentProps) {
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	if (zoltarUniverseState === 'missing') {
		const presentation = getUniversePresentation(zoltarUniverseState)
		return presentation === undefined ? undefined : <StateHint presentation={presentation} />
	}
	if (zoltarUniverse === undefined) {
		return <StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />
	}

	if (activeView === 'fork') {
		return (
			<>
				<RouteHeader title={zoltarCopy.forkZoltar} />
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
			</>
		)
	}

	if (activeView === 'migrate') {
		return (
			<>
				<RouteHeader title={zoltarCopy.migrateRep} />
				<ZoltarMigrationSection
					accountAddress={accountState.address}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingZoltarForkAccess={loadingZoltarForkAccess}
					loadingZoltarUniverse={loadingZoltarUniverse}
					onApproveZoltarForkRep={amount => onApproveZoltarForkRep(amount)}
					onMigrateInternalRep={onMigrateInternalRep}
					onPrepareRepForMigration={onPrepareRepForMigration}
					onZoltarMigrationFormChange={onZoltarMigrationFormChange}
					zoltarForkActiveAction={zoltarForkActiveAction}
					zoltarForkApproval={zoltarForkApproval}
					zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
					zoltarMigrationActiveAction={zoltarMigrationActiveAction}
					zoltarMigrationChildRepBalancesAttoRep={zoltarMigrationChildRepBalancesAttoRep}
					zoltarMigrationError={zoltarMigrationError}
					zoltarMigrationForm={zoltarMigrationForm}
					zoltarMigrationPending={zoltarMigrationPending}
					zoltarMigrationPreparedRepBalanceAttoRep={zoltarMigrationPreparedRepBalanceAttoRep}
					zoltarUniverse={zoltarUniverse}
					zoltarUniverseState={zoltarUniverseState}
				/>
			</>
		)
	}

	return <ZoltarUniverseOverview accountAddress={accountState.address} isOnActiveAppChain={isOnActiveAppChain} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} zoltarChildUniversePendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex} zoltarUniverse={zoltarUniverse} />
}
