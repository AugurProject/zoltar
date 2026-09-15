import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { SecurityVaultSectionProps } from '../../types.js'

type QueuedVaultOperationStatus = 'executed' | 'failed' | 'expired' | 'superseded' | 'manual-queued' | 'missing' | 'queued' | 'refreshing' | undefined
type QueuedVaultOperationView = {
	isConfirmedActive: boolean
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}

function getQueuedVaultOperation({ oracleManagerDetails, selectedVaultOwner, securityVaultResult }: { oracleManagerDetails: SecurityVaultSectionProps['oracleManagerDetails']; selectedVaultOwner: string; securityVaultResult: SecurityVaultSectionProps['securityVaultResult'] }) {
	let operation: 'withdrawRep' | 'adjustVaultBackingFactor' | undefined
	if (securityVaultResult?.action === 'queueWithdrawRep') operation = 'withdrawRep'
	if (securityVaultResult?.action === 'adjustVaultBackingFactor') operation = 'adjustVaultBackingFactor'
	if (operation === undefined) return undefined
	const queued = securityVaultResult?.queuedOperation
	const candidates = [...(oracleManagerDetails?.stagedOperations ?? []), ...(oracleManagerDetails?.pendingOperation === undefined ? [] : [oracleManagerDetails.pendingOperation])]
	const active = candidates.find(candidate => sameAddress(candidate.targetVault, selectedVaultOwner) && candidate.operation === operation && (queued === undefined || candidate.operationId === queued.operationId))
	if (active !== undefined) return { isConfirmedActive: true, amount: operation === 'withdrawRep' ? active.amount : undefined, isPendingSlot: oracleManagerDetails?.pendingSettlementOperationIds.includes(active.operationId) ?? false, operationId: active.operationId } satisfies QueuedVaultOperationView
	const status = securityVaultResult?.queuedOperationState?.status
	if (queued?.operation === operation) return { isConfirmedActive: false, amount: undefined, isPendingSlot: status === 'queued' || (status !== 'manual-queued' && queued.isPendingSlot), operationId: queued.operationId } satisfies QueuedVaultOperationView
	return undefined
}

function getQueuedVaultOperationStatus({
	currentPoolOracleManagerDetails,
	loadingSecurityVault,
	queuedVaultOperation,
	securityVaultResult,
}: {
	currentPoolOracleManagerDetails: SecurityVaultSectionProps['oracleManagerDetails']
	loadingSecurityVault: boolean
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	securityVaultResult: SecurityVaultSectionProps['securityVaultResult']
}) {
	if (securityVaultResult?.action !== 'queueWithdrawRep' && securityVaultResult?.action !== 'adjustVaultBackingFactor') return undefined
	if (securityVaultResult.queuedOperationState !== undefined) return securityVaultResult.queuedOperationState.status
	if (securityVaultResult.stagedExecution !== undefined) return securityVaultResult.stagedExecution.success ? 'executed' : 'failed'
	if (queuedVaultOperation !== undefined && (queuedVaultOperation.isConfirmedActive || currentPoolOracleManagerDetails === undefined)) return queuedVaultOperation.isPendingSlot ? 'queued' : 'manual-queued'
	if (loadingSecurityVault || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return 'missing'
}

function VaultQueuedOperationStatusCard({
	amountLabel,
	amountSuffix,
	executedTitle,
	failedTitle,
	missingTitle,
	missingDescription,
	queuedTitle,
	queuedVaultOperation,
	manualQueuedDescription,
	refreshingTitle,
	refreshingDescription,
	status,
	successDescription,
	errorMessage,
	onViewStagedOperations,
}: {
	amountLabel: string
	amountSuffix: string
	errorMessage: string | undefined
	executedTitle: string
	failedTitle: string
	missingDescription: string
	missingTitle: string
	onViewStagedOperations: (() => void) | undefined
	queuedTitle: string
	queuedVaultOperation: ReturnType<typeof getQueuedVaultOperation>
	manualQueuedDescription: string
	refreshingDescription: string
	refreshingTitle: string
	status: QueuedVaultOperationStatus
	successDescription: string
}) {
	if (status === undefined) return undefined
	const operationIdentifier =
		queuedVaultOperation === undefined ? undefined : (
			<MetricGrid>
				<MetricField label={commonCopy.stagedOperation}>{`#${queuedVaultOperation.operationId.toString()}`}</MetricField>
			</MetricGrid>
		)
	if (status === 'queued' || status === 'manual-queued')
		return (
			<WarningSurface as='section' surface='flat' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{queuedTitle}</h4>
					</div>
				</div>
				<MetricGrid>
					<MetricField label={commonCopy.stagedOperation}>{queuedVaultOperation === undefined ? securityPoolCopy.refreshing : `#${queuedVaultOperation.operationId.toString()}`}</MetricField>
					{queuedVaultOperation?.amount === undefined ? null : (
						<MetricField label={amountLabel}>
							<CurrencyValue precision='exact' value={queuedVaultOperation.amount} suffix={amountSuffix} />
						</MetricField>
					)}
				</MetricGrid>
				<p className='detail'>{status === 'manual-queued' ? manualQueuedDescription : securityPoolCopy.queuedVaultAutomaticExecution}</p>
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							{commonCopy.viewInStagedOperations}
						</button>
					</div>
				)}
			</WarningSurface>
		)
	if (status === 'failed' || status === 'expired' || status === 'superseded') {
		const titles = { failed: failedTitle, expired: securityPoolCopy.queuedVaultOperationExpired, superseded: securityPoolCopy.queuedVaultOperationSuperseded }
		const details = { failed: errorMessage ?? securityPoolCopy.actionRejectedDetail, expired: securityPoolCopy.queuedVaultOperationExpiredDetail, superseded: securityPoolCopy.queuedVaultOperationSupersededDetail }
		return (
			<section className='entity-card compact flat'>
				<div className='entity-card-header'>
					<div>
						<h4>{titles[status]}</h4>
					</div>
					{status === 'failed' ? <Badge tone='blocked'>{commonCopy.failed}</Badge> : undefined}
				</div>
				{operationIdentifier}
				<p className='detail'>{details[status]}</p>
				{status === 'superseded' ? undefined : <p className='detail'>{commonCopy.stagedOperationRetryDetail}</p>}
			</section>
		)
	}
	if (status === 'executed')
		return (
			<section className='entity-card compact flat'>
				<div className='entity-card-header'>
					<div>
						<h4>{executedTitle}</h4>
					</div>
					<Badge tone='ok'>{commonCopy.executed}</Badge>
				</div>
				{operationIdentifier}
				<p className='detail'>{successDescription}</p>
			</section>
		)
	const submittedOperationDetails =
		queuedVaultOperation === undefined ? undefined : (
			<>
				{operationIdentifier}
				<p className='detail'>{queuedVaultOperation.isPendingSlot ? securityPoolCopy.queuedVaultOperationAutomaticRefreshDetail : securityPoolCopy.queuedVaultOperationManualRefreshDetail}</p>
				{onViewStagedOperations === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onViewStagedOperations}>
							{commonCopy.viewInStagedOperations}
						</button>
					</div>
				)}
			</>
		)
	if (status === 'missing')
		return (
			<WarningSurface as='section' surface='flat' variant='compact'>
				<div className='entity-card-header'>
					<div>
						<h4>{missingTitle}</h4>
					</div>
				</div>
				<p className='detail'>{missingDescription}</p>
				{submittedOperationDetails}
			</WarningSurface>
		)
	return (
		<section className='entity-card compact flat'>
			<div className='entity-card-header'>
				<div>
					<h4>{refreshingTitle}</h4>
				</div>
				<Badge tone='muted'>{commonCopy.refreshingWithoutEllipsis}</Badge>
			</div>
			<p className='detail'>{refreshingDescription}</p>
			{submittedOperationDetails}
		</section>
	)
}

export function VaultQueuedOperationStatusCards({
	results,
	operation,
	oracleManagerDetails,
	selectedVaultOwner,
	loadingSecurityVault,
	onViewStagedOperations,
}: {
	results: readonly NonNullable<SecurityVaultSectionProps['securityVaultResult']>[]
	operation: 'withdrawRep' | 'adjustVaultBackingFactor'
	oracleManagerDetails: SecurityVaultSectionProps['oracleManagerDetails']
	selectedVaultOwner: string
	loadingSecurityVault: boolean
	onViewStagedOperations: (() => void) | undefined
}) {
	const action = operation === 'withdrawRep' ? 'queueWithdrawRep' : 'adjustVaultBackingFactor'
	const copy =
		operation === 'withdrawRep'
			? {
					amountLabel: securityPoolCopy.repWithdrawal,
					amountSuffix: commonCopy.rep,
					errorMessage: securityPoolCopy.immediateWithdrawalRejectedDetail,
					executedTitle: securityPoolCopy.repWithdrawalExecuted,
					failedTitle: securityPoolCopy.repWithdrawalFailed,
					missingTitle: securityPoolCopy.repWithdrawalSubmitted,
					queuedTitle: securityPoolCopy.repWithdrawalQueued,
					refreshingDescription: securityPoolCopy.refreshingWithdrawalStatusDetail,
					refreshingTitle: securityPoolCopy.refreshingWithdrawalState,
					successDescription: securityPoolCopy.immediateWithdrawalSuccessDetail,
				}
			: {
					amountLabel: securityPoolCopy.vaultBackingFactor,
					amountSuffix: '',
					errorMessage: undefined,
					executedTitle: securityPoolCopy.backingRatioChangeExecuted,
					failedTitle: securityPoolCopy.backingRatioChangeFailed,
					missingTitle: securityPoolCopy.backingRatioChangeSubmitted,
					queuedTitle: securityPoolCopy.backingRatioChangeQueued,
					refreshingDescription: securityPoolCopy.refreshingBackingRatioStatusDetail,
					refreshingTitle: securityPoolCopy.refreshingBackingRatioStatus,
					successDescription: securityPoolCopy.backingRatioChangeSuccessDetail,
				}
	return (
		<>
			{results
				.filter(result => result.action === action)
				.map(result => {
					const queuedVaultOperation = getQueuedVaultOperation({ oracleManagerDetails, selectedVaultOwner, securityVaultResult: result })
					const status = getQueuedVaultOperationStatus({ currentPoolOracleManagerDetails: oracleManagerDetails, loadingSecurityVault, queuedVaultOperation, securityVaultResult: result })
					return (
						<VaultQueuedOperationStatusCard
							key={result.queuedOperation?.operationId.toString() ?? result.hash}
							{...copy}
							errorMessage={result.stagedExecution?.errorMessage ?? copy.errorMessage}
							manualQueuedDescription={commonCopy.manualQueuedOperationDetail}
							missingDescription={commonCopy.transactionStateUnavailableDetail}
							onViewStagedOperations={onViewStagedOperations}
							queuedVaultOperation={queuedVaultOperation}
							status={status}
						/>
					)
				})}
		</>
	)
}
