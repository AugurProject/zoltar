import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { amount, mixSeed, ONE_TOKEN, optionAmount, tokenInventory } from '../planning.ts'
import type { EcosystemSnapshot, OracleGameSnapshot, PlanningOptions } from '../types.ts'
import { approveToken } from './approvals.ts'
import { MAX_UINT128, reportWindow } from './planning.ts'

// The escalated amounts, internal-credit funding split, and timing window of a permissionless OpenOracle dispute.

function contributionFunding(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, required: bigint, options: PlanningOptions) {
	const inventory = tokenInventory(snapshot, tokenAddress)
	const internalCredit = tokenAddress === zeroAddress ? amount(snapshot.wallet.openOracleEthCredit) : amount(inventory?.openOracleCredit ?? '0')
	const internalAvailable = internalCredit <= 1n ? 0n : internalCredit - 1n
	const internalRequired = required < internalAvailable ? required : internalAvailable
	const externalRequired = required > internalAvailable ? required - internalAvailable : 0n
	const isNative = tokenAddress === zeroAddress
	const isRep = snapshot.universes.some(universe => universe.repToken.toLowerCase() === tokenAddress.toLowerCase())
	let reserve = 1n
	if (isNative) reserve = optionAmount(options, 'minimumEthReserveAttoEth', 10n ** 16n)
	else if (isRep) reserve = optionAmount(options, 'minimumRepReserveAttoRep', ONE_TOKEN)
	const maximum = isRep ? optionAmount(options, 'maxRepSpendAttoRep', ONE_TOKEN) : optionAmount(options, 'maxEthSpendAttoEth', 10n ** 16n)
	const externalBalance = isNative ? amount(snapshot.wallet.ethBalanceAttoEth) : amount(inventory?.balance ?? '0')
	const combinedBalance = externalBalance + internalAvailable
	const fundingAffordable = isRep ? externalBalance >= externalRequired && (required === 0n || combinedBalance >= reserve + required) : externalRequired === 0n || externalBalance >= reserve + externalRequired
	return {
		affordable: required <= maximum && fundingAffordable,
		externalRequired,
		internalRequired,
		maximumWalletDebit: externalRequired,
	}
}

export function disputeQuote(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions) {
	const old1 = amount(report.currentAmount1)
	const old2 = amount(report.currentAmount2)
	if (old1 === 0n || old2 === 0n) return undefined
	const halt = amount(report.escalationHalt)
	const multiplied = (old1 * BigInt(report.multiplier)) / 100n
	let new1 = old1 + 1n
	if (halt > old1) new1 = multiplied > halt ? halt : multiplied
	const reportSeed = Number(BigInt(report.reportId) & 0xffff_ffffn)
	const direction = mixSeed(reportSeed, `${report.reportId}:price`) % 2 === 0 ? 99n : 101n
	const quotedAmount2 = (old2 * new1 * direction) / (old1 * 100n)
	const new2 = quotedAmount2 === 0n ? 1n : quotedAmount2
	if (new1 === 0n || new1 > MAX_UINT128 || new2 > MAX_UINT128) return undefined
	const swapToken2 = new2 * old1 > old2 * new1
	const selfDispute = report.currentReporter.toLowerCase() === snapshot.wallet.address.toLowerCase()
	const protocolFeeBase = swapToken2 ? old2 : old1
	const fee = (protocolFeeBase * BigInt(report.game.feePercentage)) / 10_000_000n
	const protocolFee = (protocolFeeBase * BigInt(report.game.protocolFee)) / 10_000_000n
	let required1: bigint
	if (swapToken2) required1 = new1 - old1
	else if (selfDispute) required1 = new1 - old1 + protocolFee
	else required1 = new1 + old1 + fee + protocolFee
	let required2 = 0n
	if (swapToken2 && selfDispute) required2 = new2 + protocolFee > old2 ? new2 + protocolFee - old2 : 0n
	else if (swapToken2) required2 = new2 + old2 + fee + protocolFee
	else if (new2 > old2) required2 = new2 - old2
	const token1 = contributionFunding(snapshot, report.token1, required1, options)
	const token2 = contributionFunding(snapshot, report.token2, required2, options)
	return {
		affordable: token1.affordable && token2.affordable,
		external1: token1.externalRequired,
		external2: token2.externalRequired,
		internal1: token1.internalRequired,
		internal2: token2.internalRequired,
		maximumWalletDebit1: token1.maximumWalletDebit,
		maximumWalletDebit2: token2.maximumWalletDebit,
		new1,
		new2,
		selfDispute,
	}
}

export function disputeWindow(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, quote: NonNullable<ReturnType<typeof disputeQuote>>, options: PlanningOptions) {
	const prerequisites = approveToken(snapshot, report.token1, quote.external1).length + approveToken(snapshot, report.token2, quote.external2).length
	return reportWindow(snapshot, report, options, prerequisites)
}

export function disputableReport(snapshot: EcosystemSnapshot, report: OracleGameSnapshot, options: PlanningOptions) {
	if (report.settlementTimestamp !== '0') return false
	const quote = disputeQuote(snapshot, report, options)
	if (quote === undefined || !quote.affordable) return false
	const window = disputeWindow(snapshot, report, quote, options)
	return window.current >= window.opened && window.current + window.safetyMargin < window.closes
}
