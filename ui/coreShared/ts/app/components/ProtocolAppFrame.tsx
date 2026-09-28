import type { ComponentChildren } from 'preact'
import { useEffect } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ChainBlockNumberContext, ChainTimestampContext } from '../../wallet/chainTimestamp.js'
import { getLockedTransactionScopes, isTransactionPromptOpen, type TransactionTrayState } from '../../transactions/transactionTray.js'
import { getPendingTransactionActivityScopes } from '../../transactions/transactionActivity.js'
import { setTransactionActivityOwner, transactionActivity, useTransactionActivityReceiptWatcher } from '../../transactions/transactionActivityStore.js'
import { GlobalTransactionPresentationProvider } from '../../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '../../components/TransactionActionButton.js'
import { GlobalTransactionDialog } from './GlobalTransactionDialog.js'

export function ProtocolAppFrame({
	accountAddress,
	actionsLocked = false,
	activeUniverseId,
	children,
	currentBlockNumber,
	currentTimestamp,
	header,
	heading,
	notices,
	routeContentDisabled,
	transactionRouteKey,
	transactionState,
}: {
	/** The connected account whose recent transactions the activity list shows. */
	accountAddress: Address | undefined
	/** Locks every transaction action for a workflow the application tracks outside shared transaction status. */
	actionsLocked?: boolean
	activeUniverseId?: bigint
	children: ComponentChildren
	currentBlockNumber: bigint | undefined
	currentTimestamp: bigint | undefined
	header: ComponentChildren
	heading: ComponentChildren
	notices: ComponentChildren
	routeContentDisabled: boolean
	transactionRouteKey: string
	/** The shared transaction state; applications with their own transaction presentation omit it. */
	transactionState?: TransactionTrayState | undefined
}) {
	const activeTransaction = transactionState?.active
	// The owner also follows network changes, so re-check it after every render; an unchanged owner is a no-op.
	useEffect(() => setTransactionActivityOwner(accountAddress))
	useTransactionActivityReceiptWatcher()
	// Pending transactions lock only the objects they touch; an open review or wallet prompt locks every action.
	const lock = {
		lockedScopes: [...(transactionState === undefined ? [] : getLockedTransactionScopes(transactionState)), ...getPendingTransactionActivityScopes(transactionActivity.value.entries)],
		promptOpen: actionsLocked || (transactionState !== undefined && isTransactionPromptOpen(transactionState)),
	}
	return (
		<ChainBlockNumberContext.Provider value={currentBlockNumber}>
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<main>
					{heading}
					{notices}
					{header}
					<GlobalTransactionPresentationProvider transaction={activeTransaction}>
						<div id='app-content' tabIndex={-1}>
							<TransactionActionButtonLockProvider lock={lock}>
								<fieldset className='route-shell' disabled={routeContentDisabled}>
									{children}
								</fieldset>
							</TransactionActionButtonLockProvider>
						</div>
						{transactionState === undefined ? undefined : <GlobalTransactionDialog {...(activeUniverseId === undefined ? {} : { activeUniverseId })} routeKey={transactionRouteKey} transaction={activeTransaction} />}
					</GlobalTransactionPresentationProvider>
				</main>
			</ChainTimestampContext.Provider>
		</ChainBlockNumberContext.Provider>
	)
}
