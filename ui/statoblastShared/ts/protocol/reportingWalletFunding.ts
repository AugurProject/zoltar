import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { ReportingActionResult, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_SecurityPool_SecurityPool, statoblast_EscalationGame_EscalationGame } from '../contractArtifact.js'
import { getReportingOutcomeValue } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import { getEscalationSideLabel } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { loadReportingDetails } from './reporting.js'
import { getReportingWalletFundingQuote } from '../lib/reportingFunding.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'

export async function reportOutcomeWithWalletViaVault(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, reportAmount: bigint, expectedDepositAmount: bigint, onVaultFunded: () => void) {
	const details = await loadReportingDetails(client, securityPoolAddress, client.account.address)
	if (details.status !== 'active' || !details.forkContinuation || details.systemState !== 'operational') throw new Error('Reporting changed. Refresh the pool before continuing.')
	const [actualReportAmount] = await client.readContract({ address: details.escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'previewDepositOnOutcome', args: [getReportingOutcomeValue(outcome), reportAmount] })
	if (actualReportAmount === undefined || actualReportAmount <= 0n) throw new Error('This report is no longer available. Refresh the pool before continuing.')
	const fundingQuote = getReportingWalletFundingQuote(details, actualReportAmount)
	const depositAmount = fundingQuote?.depositAmount
	if (fundingQuote === undefined || depositAmount === undefined || depositAmount !== expectedDepositAmount) throw new Error('The required vault deposit changed. Review the amount again.')
	if ((details.viewerWalletRepBalanceAttoRep ?? 0n) < depositAmount || (details.viewerWalletRepAllowanceAttoRep ?? 0n) < depositAmount) throw new Error('Check your wallet REP balance and approval before reporting.')
	const target = await client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'statoblastSecurityMultiplierBps', args: [] })
	const deposit = {
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'depositRepToVault',
		args: [depositAmount, target],
		reviewTitle: `Deposit ${formatCurrencyBalanceWithUnit(depositAmount, commonCopy.rep)} into this pool`,
		reviewDescription: `Paid from your wallet. Next, ${formatCurrencyBalanceWithUnit(actualReportAmount, commonCopy.rep)} from this vault funds your report. Your vault will hold ${formatCurrencyBalanceWithUnit(fundingQuote.remainingVaultRepAttoRep, commonCopy.rep)} after reporting. Depositing REP does not change your standing ETH commitment.`,
	} as const
	const report = {
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		args: [getReportingOutcomeValue(outcome), reportAmount],
		reviewTitle: transactionCopy.reportingAction(getEscalationSideLabel(outcome), formatCurrencyBalance(actualReportAmount)),
		reviewAmount: formatCurrencyBalanceWithUnit(actualReportAmount, commonCopy.rep),
	} as const
	client.onTransactionPlan?.([
		{ ...deposit, contractAddress: securityPoolAddress },
		{ ...report, contractAddress: securityPoolAddress },
	])
	await writeContractAndWait(client, () => deposit)
	onVaultFunded()
	try {
		const latest = await loadReportingDetails(client, securityPoolAddress, client.account.address)
		if (latest.status !== 'active' || !latest.forkContinuation || latest.systemState !== 'operational') throw new Error('The pool state changed.')
		const [acceptedAmount] = await client.readContract({ address: latest.escalationGameAddress, abi: statoblast_EscalationGame_EscalationGame.abi, functionName: 'previewDepositOnOutcome', args: [getReportingOutcomeValue(outcome), reportAmount] })
		if (acceptedAmount !== actualReportAmount) throw new Error('The report amount changed.')
		const hash = await writeContractAndWait(client, () => report)
		return { action: 'reportOutcome', hash, outcome, securityPoolAddress, universeId: details.universeId } satisfies ReportingActionResult
	} catch (error) {
		// Keep partial completion visible even when the remaining review was canceled.
		throw new Error(`Your REP was deposited into your vault, but the report did not complete. Use Pool vault REP to retry without another wallet deposit. ${getErrorMessage(error, 'Review the report before retrying.')}`)
	}
}
