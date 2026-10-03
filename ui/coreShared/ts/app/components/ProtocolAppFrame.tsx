import { createUniverseIdentity } from '../../lib/universeIdentity.js'
import { UniverseIdentity } from '../../components/UniverseIdentity.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useMemo } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ChainBlockNumberContext, ChainTimestampContext } from '../../wallet/chainTimestamp.js'
import { getLockedTransactionScopes, isTransactionPromptOpen, type TransactionTrayState } from '../../transactions/transactionTray.js'
import { getPendingTransactionActivityScopes } from '../../transactions/transactionActivity.js'
import { setTransactionActivityOwner, transactionActivity, useTransactionActivityReceiptWatcher } from '../../transactions/transactionActivityStore.js'
import { GlobalTransactionPresentationProvider } from '../../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '../../components/TransactionActionButton.js'
import { GlobalTransactionDialog } from './GlobalTransactionDialog.js'
import { WalletActionsProvider, type WalletActions } from '../../components/WalletActionFix.js'

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
	walletActions,
}: {
	/** The connected account whose recent transactions the activity list shows. */
	accountAddress: Address | undefined
	/** Locks every transaction action for a workflow the application tracks outside shared transaction status. */
	actionsLocked?: boolean
	activeUniverseId?: bigint | undefined
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
	/** The header's wallet controls; blocked actions reuse them to offer connect and switch fixes in place. */
	walletActions?: WalletActions | undefined
}) {
	const identity = useMemo(() => (activeUniverseId === undefined ? undefined : createUniverseIdentity(activeUniverseId)), [activeUniverseId])
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
				<main data-universe-id={activeUniverseId?.toString()} style={{ '--universe-band-light': identity?.bandImage.light, '--universe-band-dark': identity?.bandImage.dark }}>
					{activeUniverseId === undefined ? undefined : <UniverseIdentity universeId={activeUniverseId} variant='backdrop' />}
					{heading}
					{notices}
					{header}
					<WalletActionsProvider walletActions={walletActions}>
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
					</WalletActionsProvider>
				</main>
			</ChainTimestampContext.Provider>
		</ChainBlockNumberContext.Provider>
	)
}
