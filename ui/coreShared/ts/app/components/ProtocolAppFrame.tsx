import type { ComponentChildren } from 'preact'
import { ChainBlockNumberContext, ChainTimestampContext } from '../../wallet/chainTimestamp.js'
import { isTransactionActionLocked, type TransactionTrayState } from '../../transactions/transactionTray.js'
import { GlobalTransactionPresentationProvider } from '../../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '../../components/TransactionActionButton.js'
import { GlobalTransactionDialog } from './GlobalTransactionDialog.js'

export function ProtocolAppFrame({
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
	/** Locks transaction actions for a workflow the application tracks outside shared transaction status. */
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
	const locked = actionsLocked || (transactionState !== undefined && isTransactionActionLocked(transactionState))
	return (
		<ChainBlockNumberContext.Provider value={currentBlockNumber}>
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<main>
					{heading}
					{notices}
					{header}
					<GlobalTransactionPresentationProvider transaction={activeTransaction}>
						<div id='app-content' tabIndex={-1}>
							<TransactionActionButtonLockProvider locked={locked}>
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
