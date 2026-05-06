import { ErrorNotice } from './ErrorNotice.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import type { TransactionState } from '../lib/transactionState.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

type AppStatusNoticesProps = {
	bootstrapLabel: string | undefined
	bootstrapProgress: number | undefined
	errorMessage: string | undefined
	hasInjectedWallet: boolean
	isBootstrappingSimulation: boolean
	simulationBootstrapError: string | undefined
	showAugurPlaceHolderDeploymentWarning: boolean
	showZoltarUniverseForkedWarning: boolean
	transactionState: TransactionState
	walletPresentation: UserMessagePresentation | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function AppStatusNotices({ bootstrapLabel, bootstrapProgress, errorMessage, hasInjectedWallet, isBootstrappingSimulation, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, transactionState, walletPresentation, zoltarUniverse }: AppStatusNoticesProps) {
	return (
		<div className='page-notices'>
			{isBootstrappingSimulation ? (
				<div className='notice warning notice-progress'>
					<p>
						<span className='spinner' aria-hidden='true' />
						{bootstrapLabel ?? 'Preparing simulation scenario in the background.'}
					</p>
					<div className='notice-progress-track' aria-hidden='true'>
						<div className='notice-progress-fill' style={{ width: `${Math.round((bootstrapProgress ?? 0.08) * 100)}%` }} />
					</div>
					<p className='detail'>Route-specific data will appear as soon as bootstrap completes.</p>
				</div>
			) : undefined}
			{simulationBootstrapError === undefined ? undefined : <div className='notice error'>{simulationBootstrapError}</div>}
			{showZoltarUniverseForkedWarning && zoltarUniverse !== undefined ? (
				<div className='notice error'>
					{formatUniverseLabel(zoltarUniverse.universeId)} has forked on <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</div>
			) : undefined}
			{showAugurPlaceHolderDeploymentWarning ? <div className='notice error'>Finish setup in Deploy before using the app.</div> : undefined}
			{walletPresentation === undefined || hasInjectedWallet ? undefined : <p className='notice warning'>{walletPresentation.detail}</p>}
			<ErrorNotice message={errorMessage} />
			{transactionState.transactionInFlightCount > 0 ? (
				<p className='notice success'>
					<span className='spinner' aria-hidden='true' />
					{transactionState.transactionSubmitted ? <>Transaction submitted, waiting for confirmation. {transactionState.lastTransactionHash === undefined ? <span>Pending wallet signature</span> : <TransactionHashLink hash={transactionState.lastTransactionHash} />}</> : 'Awaiting wallet confirmation.'}
				</p>
			) : transactionState.lastTransactionHash === undefined ? undefined : (
				<p className='notice success'>
					Last transaction: <TransactionHashLink hash={transactionState.lastTransactionHash} />
				</p>
			)}
		</div>
	)
}
