import { useState } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getWalletActiveAppChainGuardState, withWalletGuardFirst } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { createTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import * as copy from '../../../copy/openOracle.js'
import type { OpenOracleSectionProps } from '../../oracleTypes.js'
import { useOpenOracleSettlementTime } from '../hooks/useOpenOracleSettlementTime.js'
import { formatOpenOracleReportPriceUnit, getEffectiveOpenOracleReportDetails, getOpenOracleReportProgress, getOpenOracleReportProgressLabel, getOpenOracleReportProgressTone, getOpenOracleSettleAvailability, getOpenOracleSettleRemaining, OPEN_ORACLE_PRICE_UNITS } from '../lib/openOracle.js'

export type PriceRequestStatusProps = Pick<OpenOracleSectionProps, 'accountState' | 'onLoadOracleReport' | 'onOpenOracleFormChange' | 'onSettleReport' | 'openOracleForm' | 'openOracleReportDetails' | 'openOracleReportLookupState' | 'openOracleActiveAction' | 'openOracleError'>

export function PriceRequestStatusSection({ accountState, onLoadOracleReport, onOpenOracleFormChange, onSettleReport, openOracleForm, openOracleReportDetails, openOracleReportLookupState, openOracleActiveAction, openOracleError }: PriceRequestStatusProps) {
	const [draft, setDraft] = useState<{ selected: string; text: string }>({ selected: openOracleForm.reportId, text: openOracleForm.reportId })
	const text = draft.selected === openOracleForm.reportId ? draft.text : openOracleForm.reportId
	const loading = openOracleReportLookupState === 'loading'
	const chainTime = useChainTimestamp()
	const chainBlock = useChainBlockNumber()
	const effectiveReport = openOracleReportDetails === undefined ? undefined : getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainTime, chainBlock)
	const currentTime = useOpenOracleSettlementTime(effectiveReport, loading, onLoadOracleReport)
	const report = effectiveReport === undefined ? undefined : getEffectiveOpenOracleReportDetails(effectiveReport, currentTime, undefined)
	const progress = report === undefined ? undefined : getOpenOracleReportProgress(report, report)
	const availability = report === undefined ? undefined : getOpenOracleSettleAvailability(report)
	const walletGuard = getWalletActiveAppChainGuardState({ accountAddress: accountState.address, isOnActiveAppChain: isActiveAppChain(accountState.chainId) })
	const remaining = report === undefined ? 0n : getOpenOracleSettleRemaining(report)
	const emptyLabel = openOracleReportLookupState === 'missing' ? copy.priceReportNotFound : copy.selectPriceReport
	return (
		<div className='route-view-flow price-request-status-stack'>
			<RouteHeader title={copy.priceReports} />
			<SectionBlock title={copy.reportStatus} variant='plain'>
				<form
					onSubmit={event => {
						event.preventDefault()
						onOpenOracleFormChange({ reportId: text.trim() })
						onLoadOracleReport(text.trim())
					}}
				>
					<LookupFieldRow
						label={copy.reportId}
						value={text}
						onInput={value => setDraft({ selected: openOracleForm.reportId, text: value })}
						action={
							<button type='submit' className='secondary' disabled={loading || !/^\d+$/.test(text.trim())}>
								{loading ? commonCopy.loadingWithEllipsis : copy.openReport}
							</button>
						}
					/>
				</form>
				{report === undefined ? (
					<StateHint presentation={{ key: loading ? 'loading' : 'empty', badgeLabel: loading ? commonCopy.loadingWithEllipsis : emptyLabel, badgeTone: 'muted' }} />
				) : (
					<>
						<h3>{copy.formatReportNumberTitle(report.reportId.toString())}</h3>
						<MetricGrid>
							<MetricField label={commonCopy.status}>{progress === undefined ? undefined : <Badge tone={getOpenOracleReportProgressTone(progress)}>{getOpenOracleReportProgressLabel(progress)}</Badge>}</MetricField>
							<MetricField label={copy.price}>
								<CurrencyValue value={report.price} units={OPEN_ORACLE_PRICE_UNITS} suffix={formatOpenOracleReportPriceUnit(report)} />
							</MetricField>
						</MetricGrid>
						{!report.isDistributed && remaining > 0n ? <p className='detail'>{copy.formatSettleCountdown(remaining, report.timeType)}</p> : undefined}
						<div className='actions'>
							<TransactionActionButton
								scope={createTransactionScope('open-oracle-report', report.reportId.toString())}
								idleLabel={copy.settleReport}
								pendingLabel={copy.settlingReport}
								pending={openOracleActiveAction === 'settle'}
								onClick={onSettleReport}
								availability={withWalletGuardFirst({ disabled: loading || openOracleReportLookupState !== 'ready' || tryParseBigIntInput(openOracleForm.reportId) !== report.reportId || availability?.canAct !== true, reason: loading ? commonCopy.loadingWithEllipsis : availability?.message }, walletGuard)}
							/>
						</div>
					</>
				)}
				<ErrorNotice message={openOracleError} />
			</SectionBlock>
		</div>
	)
}
