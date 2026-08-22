import type { ComponentChildren } from 'preact'
import { ChainBlockNumberContext, ChainTimestampContext } from '../../lib/chainTimestamp.js'
import { getTransactionActionLockReason, type TransactionTrayState } from '../../lib/transactionTray.js'
import { GlobalTransactionPresentationProvider } from '../../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '../../components/TransactionActionButton.js'
import { GlobalTransactionTray } from './GlobalTransactionTray.js'

export function ProtocolAppFrame({
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
	activeUniverseId?: bigint
	children: ComponentChildren
	currentBlockNumber: bigint | undefined
	currentTimestamp: bigint | undefined
	header: ComponentChildren
	heading: ComponentChildren
	notices: ComponentChildren
	routeContentDisabled: boolean
	transactionRouteKey: string
	transactionState: TransactionTrayState
}) {
	return (
		<ChainBlockNumberContext.Provider value={currentBlockNumber}>
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<main>
					{heading}
					{notices}
					{header}
					<GlobalTransactionPresentationProvider transaction={transactionState.active}>
						<GlobalTransactionTray {...(activeUniverseId === undefined ? {} : { activeUniverseId })} routeKey={transactionRouteKey} transaction={transactionState.active} />
						<div id='app-content' tabIndex={-1}>
							<TransactionActionButtonLockProvider disabledReason={getTransactionActionLockReason(transactionState)}>
								<fieldset className='route-shell' disabled={routeContentDisabled}>
									{children}
								</fieldset>
							</TransactionActionButtonLockProvider>
						</div>
					</GlobalTransactionPresentationProvider>
				</main>
			</ChainTimestampContext.Provider>
		</ChainBlockNumberContext.Provider>
	)
}
