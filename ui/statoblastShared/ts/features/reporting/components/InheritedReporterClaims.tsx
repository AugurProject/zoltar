import * as copy from '../../../copy/reporting.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { buildForkCarriedEscalationProofs, withdrawForkedEscalationDeposits } from '../../../protocol/reportingCarryState.js'
import { loadReportingDetails } from '../../../protocol/reporting.js'
import type { AuthenticatedForkClaim, ReportingDetails } from '../../../types/contracts.js'
import type { AccountState, WriteOperationsParameters } from '../../../types/app.js'

type Props = {
	parameters: WriteOperationsParameters
	accountState: AccountState
	details: ReportingDetails | undefined
	onRefresh: () => Promise<unknown>
}

/** Inherited reporter claims are question claims, independent of underwriting ownership. */
export function InheritedReporterClaims({ parameters, accountState, details, onRefresh }: Props) {
	const error = useSignal<string | undefined>(undefined)
	const pending = useSignal<string | undefined>(undefined)
	const selection = `${details?.securityPoolAddress ?? ''}:${accountState.address ?? ''}:${accountState.chainId ?? ''}`
	const current = useRef(selection)
	current.current = selection
	useEffect(
		() => () => {
			current.current = ''
		},
		[],
	)
	const active = details?.status === 'active' ? details : undefined
	const claims = active?.sides.flatMap(side => side.importedUserDeposits.map(deposit => ({ side, deposit }))) ?? []
	if (claims.length === 0) return undefined
	const walletReason = getWalletActiveAppChainGuardState({ accountAddress: accountState.address, isOnActiveAppChain: isActiveAppChain(accountState.chainId) })?.reason
	const run = async (identity: AuthenticatedForkClaim) => {
		if (pending.value !== undefined || active === undefined) return
		const pool = active.securityPoolAddress
		const key = `${identity.outcome}:${identity.parentDepositIndex}`
		pending.value = key
		error.value = undefined
		const assertSelection = () => {
			if (current.current !== selection) throw new Error('Question or wallet changed. Reopen the claim and retry.')
		}
		try {
			await runWriteAction(
				buildWriteActionConfig({ ...parameters, onTransactionCanceled: parameters.onTransactionCanceled, onTransactionFailed: parameters.onTransactionFailed, onTransactionPrepared: parameters.onTransactionPrepared }, error, commonCopy.formatConnectWalletBefore('recovering reporter REP'), {
					action: 'settleForkedEscalation',
					source: copy.recoverySource,
					submittedTitle: copy.settleInheritedClaim,
					universeId: active.universeId,
				}),
				async (account, context) => {
					assertSelection()
					const read = createConnectedReadClient()
					const latest = await loadReportingDetails(read, pool, account)
					context.assertActive()
					assertSelection()
					const deposit = latest.status === 'active' ? latest.sides.find(side => side.key === identity.outcome)?.importedUserDeposits.find(candidate => candidate.parentDepositIndex === identity.parentDepositIndex) : undefined
					if (deposit?.claimIdentity === undefined || deposit.claimIdentity.snapshotRoot !== identity.snapshotRoot || deposit.depositor.toLowerCase() !== account.toLowerCase()) throw new Error('Inherited claim changed. Refresh and retry.')
					if (latest.settlementState !== 'resolved' || latest.questionOutcome !== identity.outcome) throw new Error('The winning claim must be finalized before settlement.')
					const client = createWalletWriteClient(account, { reviewSignal: context.reviewSignal, onTransactionPrepared: parameters.onTransactionPrepared, onTransactionSubmitted: parameters.onTransactionSubmitted })
					const proofs = await buildForkCarriedEscalationProofs(read, pool, identity.outcome, [identity.parentDepositIndex])
					context.assertActive()
					assertSelection()
					return await withdrawForkedEscalationDeposits(client, pool, identity.outcome, proofs)
				},
				'Unable to recover the inherited reporter claim.',
				async result => {
					parameters.onTransactionPresented({ hash: result.hash, title: copy.claimSettled, tone: 'success', showStatusDialog: false, universeId: active.universeId })
					if (current.current === selection) await onRefresh()
				},
			)
		} finally {
			pending.value = undefined
		}
	}
	return (
		<SectionBlock title={copy.inheritedClaims} description={copy.inheritedClaimsDescription}>
			<ErrorNotice message={error.value} />
			{claims.map(({ side, deposit }) => {
				const identity = deposit.claimIdentity
				const baseReason = walletReason ?? (pending.value === undefined ? undefined : copy.claimPending) ?? (identity === undefined ? copy.claimAuthenticationRequired : undefined)
				let settlementReason: string | undefined
				if (active?.settlementState !== 'resolved') settlementReason = copy.claimResolutionRequired
				else if (active.questionOutcome !== side.key) settlementReason = copy.claimWinningOutcomeRequired
				const settleReason = baseReason ?? settlementReason
				return (
					<div key={`${side.key}:${deposit.parentDepositIndex}`} className='workflow-subsection'>
						<p>
							{copy.inheritedClaimIdentity(side.label, deposit.parentDepositIndex.toString())} <CurrencyValue value={getImportedEscalationDepositClaimAmount(active, side.key, deposit)} suffix={copy.repUnit} />
						</p>
						<div className='actions'>
							<TransactionActionButton
								idleLabel={copy.settleClaim}
								pendingLabel={copy.settlingClaim}
								pending={pending.value === `${side.key}:${deposit.parentDepositIndex}`}
								availability={{ disabled: settleReason !== undefined, reason: settleReason }}
								onClick={() => {
									if (identity !== undefined) void run(identity)
								}}
							/>
						</div>
					</div>
				)
			})}
		</SectionBlock>
	)
}
