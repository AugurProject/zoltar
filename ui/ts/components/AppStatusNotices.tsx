import { NoticeStack } from './NoticeStack.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import type { TransactionState } from '../lib/transactionState.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import type { NoticeItem } from '../types/components.js'

type AppStatusNoticesProps = {
	errorMessage: string | undefined
	hasInjectedWallet: boolean
	simulationBootstrapError: string | undefined
	showAugurPlaceHolderDeploymentWarning: boolean
	showTransactionSuccessNotice: boolean
	showZoltarUniverseForkedWarning: boolean
	transactionState: TransactionState
	walletPresentation: UserMessagePresentation | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function AppStatusNotices({ errorMessage, hasInjectedWallet, showTransactionSuccessNotice, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, transactionState, walletPresentation, zoltarUniverse }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	if (simulationBootstrapError !== undefined) {
		items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: 'Simulation bootstrap failed' })
	}
	if (showZoltarUniverseForkedWarning && zoltarUniverse !== undefined) {
		items.push({
			detail: (
				<>
					{formatUniverseLabel(zoltarUniverse.universeId)} has forked on <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</>
			),
			id: 'zoltar-forked',
			tone: 'blocking',
			title: 'Universe forked',
		})
	}
	if (showAugurPlaceHolderDeploymentWarning) {
		items.push({ detail: 'Finish setup in Deploy before using the app.', id: 'setup-incomplete', tone: 'blocking', title: 'Setup incomplete' })
	}
	if (walletPresentation !== undefined && !hasInjectedWallet) {
		items.push({ detail: walletPresentation.detail, id: 'wallet-guidance', tone: 'warning', title: 'Wallet guidance' })
	}
	if (errorMessage !== undefined) {
		items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: 'Error' })
	}
	if (transactionState.transactionInFlightCount > 0) {
		items.push({
			detail: transactionState.transactionSubmitted ? <>Transaction submitted, waiting for confirmation. {transactionState.lastTransactionHash === undefined ? <span>Pending wallet signature</span> : <TransactionHashLink hash={transactionState.lastTransactionHash} />}</> : 'Awaiting wallet confirmation.',
			id: 'transaction-pending',
			tone: 'pending',
			title: 'Transaction pending',
		})
	} else if (showTransactionSuccessNotice && transactionState.lastTransactionHash !== undefined) {
		items.push({
			detail: (
				<>
					Last transaction: <TransactionHashLink hash={transactionState.lastTransactionHash} />
				</>
			),
			id: 'transaction-success',
			tone: 'success',
			title: 'Transaction complete',
		})
	}

	return <NoticeStack items={items} />
}
