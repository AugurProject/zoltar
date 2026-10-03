import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionScopeProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { universeTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { ZoltarMigrationSection } from './ZoltarMigrationSection.js'
import type { useZoltarOperations } from '../hooks/useZoltarOperations.js'

type Props = { universeBrowserHref: string; accountState: { address: Address | undefined; chainId: string | undefined }; activeUniverseId: bigint; operations: ReturnType<typeof useZoltarOperations>; universeState: LoadableValueState }

/** The same wallet REP migration workflow in Zoltar and Statoblast. */
export function ZoltarMigrationWorkflow({ universeBrowserHref, accountState, activeUniverseId, operations, universeState }: Props) {
	return (
		<>
			{/* A pending fork or migration locks only this universe's actions. */}
			<TransactionScopeProvider scope={universeTransactionScope(activeUniverseId)}>
				<SectionBlock variant='plain'>
					<ZoltarMigrationSection
						universeBrowserHref={universeBrowserHref}
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
						zoltarUniverse={operations.zoltarUniverse}
						zoltarUniverseState={universeState}
					/>
				</SectionBlock>
			</TransactionScopeProvider>
			<ErrorNotice message={operations.zoltarChildUniverseError} />
		</>
	)
}
