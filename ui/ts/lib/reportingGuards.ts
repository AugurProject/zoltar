import type { Address } from 'viem'

type ReportingStatus = 'missing' | 'not-started' | 'active'

export function getReportingReportGuardMessage({
	accountAddress,
	isMainnet,
	lockedReason,
	reportAmount,
	reportingStatus,
	selectedAmount,
}: {
	accountAddress: Address | undefined
	isMainnet: boolean
	lockedReason: string | undefined
	reportAmount: string
	reportingStatus: ReportingStatus
	selectedAmount: bigint | undefined
}) {
	if (lockedReason !== undefined) return lockedReason
	if (accountAddress === undefined) return 'Connect a wallet before reporting on a market.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before reporting on a market.'
	if (reportingStatus === 'missing') return 'Load reporting details before reporting on an outcome.'
	if (reportAmount.trim() === '') return 'Enter a report amount greater than zero.'
	if (selectedAmount === undefined || selectedAmount <= 0n) return 'Enter a valid report amount greater than zero.'
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, hasUserDepositsOnSelectedSide, isMainnet, lockedReason, reportingStatus }: { accountAddress: Address | undefined; hasUserDepositsOnSelectedSide: boolean; isMainnet: boolean; lockedReason: string | undefined; reportingStatus: ReportingStatus }) {
	if (lockedReason !== undefined) return lockedReason
	if (accountAddress === undefined) return 'Connect a wallet before withdrawing escalation deposits.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before withdrawing escalation deposits.'
	if (reportingStatus === 'missing') return 'Load reporting details before withdrawing escalation deposits.'
	if (reportingStatus === 'not-started') return 'Escalation game has not started yet.'
	if (!hasUserDepositsOnSelectedSide) return 'No deposits are available to withdraw on the selected side.'
	return undefined
}
