import { maximumFeePerGas } from '@zoltar/bot-shared/execution/transaction-submission'
import type { CanonicalUintString } from '../core/units.ts'
import type { OracleRequestFundingSnapshot } from './types.ts'

const BPS_DENOMINATOR = 10_000n
const OPEN_INTEREST_DIVIDER = 100n
const OPEN_ORACLE_PERCENTAGE_PRECISION = 10_000_000n
const PRICE_PRECISION = 10n ** 18n
const UINT24_MAXIMUM = (1n << 24n) - 1n
const UINT32_MAXIMUM = (1n << 32n) - 1n
const UINT96_MAXIMUM = (1n << 96n) - 1n
const UINT128_MAXIMUM = (1n << 128n) - 1n
const UINT256_MAXIMUM = (1n << 256n) - 1n
const ORACLE_REQUEST_FUNDING_ERROR_CODE = 'oracle-request-funding'

function oracleRequestFundingError(message: string) {
	return Object.assign(new Error(message), { code: ORACLE_REQUEST_FUNDING_ERROR_CODE })
}

export function isOracleRequestFundingError(error: unknown) {
	return error instanceof Error && Reflect.get(error, 'code') === ORACLE_REQUEST_FUNDING_ERROR_CODE
}

type CoordinatorFundingValues = {
	escalationHaltMultiplierBps: bigint
	gasConsumedOpenOracleReportPrice: bigint
	gasUnitsForOneDispute: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
	reportDenominator: bigint
	reportNumeratorMultiplier: bigint
	settlementCallbackGasLimit: bigint
}

export interface OracleRequestFundingBoundParameters {
	anchorBaseFeePerGas: CanonicalUintString
	coordinator: OracleRequestFundingSnapshot
	proposedRepPerEthPrice: CanonicalUintString
	settlementCollateralAttoEth: CanonicalUintString
}

export interface OracleRequestFundingForMaximumBaseFeeParameters {
	coordinator: OracleRequestFundingSnapshot
	maximumBaseFeePerGas: CanonicalUintString
	proposedRepPerEthPrice: CanonicalUintString
	settlementCollateralAttoEth: CanonicalUintString
}

export interface OracleRequestFundingEnvelopeParameters {
	coordinator: OracleRequestFundingSnapshot
	maximumEthPrincipalAttoEth: CanonicalUintString
	maximumNativePrincipalAttoEth: CanonicalUintString
	maximumRepPrincipalAttoRep: CanonicalUintString
	maximumWethPrincipalAttoEth: CanonicalUintString
	proposedRepPerEthPrice: CanonicalUintString
	settlementCollateralCeilingAttoEth: CanonicalUintString
}

export interface OracleRequestFundingBounds {
	maximumBaseFeePerGas: CanonicalUintString
	maximumEscalationHaltAttoEth: CanonicalUintString
	maximumInitialAttoRep: CanonicalUintString
	maximumInitialAttoWeth: CanonicalUintString
	maximumRequestPriceCostAttoEth: CanonicalUintString
}

function uint256(value: CanonicalUintString, label: string) {
	if (!/^(0|[1-9][0-9]*)$/.test(value)) throw oracleRequestFundingError(`${label} must be a canonical unsigned integer`)
	const parsed = BigInt(value)
	if (parsed > UINT256_MAXIMUM) throw oracleRequestFundingError(`${label} exceeds uint256`)
	return parsed
}

function checkedAdd(left: bigint, right: bigint, label: string) {
	const result = left + right
	if (result > UINT256_MAXIMUM) throw oracleRequestFundingError(`${label} exceeds uint256`)
	return result
}

function checkedMultiply(left: bigint, right: bigint, label: string) {
	if (left !== 0n && right > UINT256_MAXIMUM / left) throw oracleRequestFundingError(`${label} exceeds uint256`)
	return left * right
}

function ceilDiv(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw oracleRequestFundingError('Oracle funding denominator must be positive')
	if (numerator === 0n) return 0n
	return (numerator - 1n) / denominator + 1n
}

/** Matches Solidity Math.mulDiv(..., Math.Rounding.Ceil) with a uint256 result. */
function mulDivCeil(left: bigint, right: bigint, denominator: bigint, label: string) {
	const result = ceilDiv(left * right, denominator)
	if (result > UINT256_MAXIMUM) throw oracleRequestFundingError(`${label} exceeds uint256`)
	return result
}

function coordinatorFundingValues(snapshot: OracleRequestFundingSnapshot): CoordinatorFundingValues {
	const gasConsumedOpenOracleReportPrice = uint256(snapshot.gasConsumedOpenOracleReportPrice, 'gasConsumedOpenOracleReportPrice')
	const settlementCallbackGasLimit = uint256(snapshot.settlementCallbackGasLimit, 'settlementCallbackGasLimit')
	const gasUnitsForOneDispute = uint256(snapshot.gasUnitsForOneDispute, 'gasUnitsForOneDispute')
	const initialReportPriorityFeeAttoEthPerGas = uint256(snapshot.initialReportPriorityFeeAttoEthPerGas, 'initialReportPriorityFeeAttoEthPerGas')
	const targetPriceErrorForDispute = uint256(snapshot.targetPriceErrorForDispute, 'targetPriceErrorForDispute')
	const openOracleSecurityMultiplierBps = uint256(snapshot.openOracleSecurityMultiplierBps, 'openOracleSecurityMultiplierBps')
	const protocolFee = uint256(snapshot.protocolFee, 'protocolFee')
	const feePercentage = uint256(snapshot.feePercentage, 'feePercentage')
	const escalationHaltMultiplierBps = uint256(snapshot.escalationHaltMultiplierBps, 'escalationHaltMultiplierBps')
	if (settlementCallbackGasLimit > UINT32_MAXIMUM) throw oracleRequestFundingError('settlementCallbackGasLimit exceeds uint32')
	if (protocolFee > UINT24_MAXIMUM) throw oracleRequestFundingError('protocolFee exceeds uint24')
	if (feePercentage > UINT24_MAXIMUM) throw oracleRequestFundingError('feePercentage exceeds uint24')
	if (gasUnitsForOneDispute === 0n) throw oracleRequestFundingError('gasUnitsForOneDispute must be positive')
	if (initialReportPriorityFeeAttoEthPerGas === 0n) throw oracleRequestFundingError('initialReportPriorityFeeAttoEthPerGas must be positive')
	if (targetPriceErrorForDispute > OPEN_ORACLE_PERCENTAGE_PRECISION) throw oracleRequestFundingError('targetPriceErrorForDispute exceeds OpenOracle precision')
	if (openOracleSecurityMultiplierBps < BPS_DENOMINATOR) throw oracleRequestFundingError('openOracleSecurityMultiplierBps must be at least 10000')
	if (escalationHaltMultiplierBps === 0n) throw oracleRequestFundingError('escalationHaltMultiplierBps must be positive')
	const fees = checkedAdd(protocolFee, feePercentage, 'oracle fees')
	if (fees >= targetPriceErrorForDispute) throw oracleRequestFundingError('Oracle fees must be below targetPriceErrorForDispute')
	const correctionProfitNumerator = targetPriceErrorForDispute - fees
	const reportNumeratorMultiplier = checkedMultiply(openOracleSecurityMultiplierBps, OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute, 'oracle report numerator multiplier')
	const reportDenominator = checkedMultiply(BPS_DENOMINATOR, correctionProfitNumerator, 'oracle report denominator')
	let maximumPriorityFeeReportAttoEth = (UINT128_MAXIMUM * BPS_DENOMINATOR) / escalationHaltMultiplierBps
	if (maximumPriorityFeeReportAttoEth > UINT128_MAXIMUM) maximumPriorityFeeReportAttoEth = UINT128_MAXIMUM
	maximumPriorityFeeReportAttoEth /= 2n
	const maximumPriorityDisputeGasCost = (maximumPriorityFeeReportAttoEth * reportDenominator) / reportNumeratorMultiplier
	const maximumInitialReportPriorityFeeAttoEthPerGas = maximumPriorityDisputeGasCost / gasUnitsForOneDispute
	if (initialReportPriorityFeeAttoEthPerGas > maximumInitialReportPriorityFeeAttoEthPerGas) {
		throw oracleRequestFundingError('initialReportPriorityFeeAttoEthPerGas exceeds OpenOracle limits')
	}
	return {
		escalationHaltMultiplierBps,
		gasConsumedOpenOracleReportPrice,
		gasUnitsForOneDispute,
		initialReportPriorityFeeAttoEthPerGas,
		reportDenominator,
		reportNumeratorMultiplier,
		settlementCallbackGasLimit,
	}
}

function minimumToken1ReportForGasPrice(gasPriceAttoEthPerGas: bigint, funding: CoordinatorFundingValues) {
	if (gasPriceAttoEthPerGas === 0n) return 0n
	const disputeGasCost = checkedMultiply(gasPriceAttoEthPerGas, funding.gasUnitsForOneDispute, 'oracle dispute gas cost')
	return mulDivCeil(disputeGasCost, funding.reportNumeratorMultiplier, funding.reportDenominator, 'minimum oracle report')
}

function minimumToken1ReportAttoEth(baseFeePerGas: bigint, settlementCollateralAttoEth: bigint, funding: CoordinatorFundingValues) {
	const priorityReport = minimumToken1ReportForGasPrice(funding.initialReportPriorityFeeAttoEthPerGas, funding)
	const baseFeeReport = minimumToken1ReportForGasPrice(baseFeePerGas, funding)
	const openInterestReport = ceilDiv(settlementCollateralAttoEth, OPEN_INTEREST_DIVIDER)
	const minimum = checkedAdd(priorityReport, baseFeeReport > openInterestReport ? baseFeeReport : openInterestReport, 'minimum oracle report')
	return minimum > 0n ? minimum : 1n
}

function requestPriceCostAttoEth(baseFeePerGas: bigint, funding: CoordinatorFundingValues) {
	const callbackAndReportGas = checkedAdd(funding.settlementCallbackGasLimit, funding.gasConsumedOpenOracleReportPrice, 'oracle request gas units')
	const fourBaseFees = checkedMultiply(baseFeePerGas, 4n, 'oracle request base-fee bounty')
	return checkedAdd(checkedMultiply(fourBaseFees, callbackAndReportGas, 'oracle request bounty'), 101n, 'oracle request bounty')
}

function fundingBoundsForMaximumBaseFee(parameters: { funding: CoordinatorFundingValues; maximumBaseFeePerGas: bigint; proposedRepPerEthPrice: bigint; settlementCollateralAttoEth: bigint }): OracleRequestFundingBounds {
	const maximumInitialAttoWeth = minimumToken1ReportAttoEth(parameters.maximumBaseFeePerGas, parameters.settlementCollateralAttoEth, parameters.funding)
	if (maximumInitialAttoWeth > UINT128_MAXIMUM) throw oracleRequestFundingError('WETH report exceeds uint128')
	const maximumInitialAttoRep = mulDivCeil(maximumInitialAttoWeth, parameters.proposedRepPerEthPrice, PRICE_PRECISION, 'REP report')
	if (maximumInitialAttoRep > UINT128_MAXIMUM) throw oracleRequestFundingError('REP report exceeds uint128')
	const percentageEscalationHalt = (maximumInitialAttoWeth * parameters.funding.escalationHaltMultiplierBps) / BPS_DENOMINATOR
	if (percentageEscalationHalt > UINT256_MAXIMUM) throw oracleRequestFundingError('Oracle escalation halt exceeds uint256')
	const openInterestEscalationHalt = ceilDiv(parameters.settlementCollateralAttoEth, OPEN_INTEREST_DIVIDER)
	const maximumEscalationHalt = percentageEscalationHalt > openInterestEscalationHalt ? percentageEscalationHalt : openInterestEscalationHalt
	if (maximumEscalationHalt > UINT128_MAXIMUM) throw oracleRequestFundingError('Oracle escalation halt exceeds uint128')
	const maximumRequestPriceCost = requestPriceCostAttoEth(parameters.maximumBaseFeePerGas, parameters.funding)
	if (maximumRequestPriceCost > UINT96_MAXIMUM) throw oracleRequestFundingError('Oracle settler reward exceeds uint96')
	return {
		maximumBaseFeePerGas: parameters.maximumBaseFeePerGas.toString(),
		maximumEscalationHaltAttoEth: maximumEscalationHalt.toString(),
		maximumInitialAttoRep: maximumInitialAttoRep.toString(),
		maximumInitialAttoWeth: maximumInitialAttoWeth.toString(),
		maximumRequestPriceCostAttoEth: maximumRequestPriceCost.toString(),
	}
}

export function anchoredMinimumToken1ReportAttoEth(parameters: { baseFeePerGas: CanonicalUintString; coordinator: OracleRequestFundingSnapshot; settlementCollateralAttoEth: CanonicalUintString }): CanonicalUintString {
	const funding = coordinatorFundingValues(parameters.coordinator)
	return minimumToken1ReportAttoEth(uint256(parameters.baseFeePerGas, 'baseFeePerGas'), uint256(parameters.settlementCollateralAttoEth, 'settlementCollateralAttoEth'), funding).toString()
}

export function anchoredRequestPriceCostAttoEth(parameters: { baseFeePerGas: CanonicalUintString; coordinator: OracleRequestFundingSnapshot }): CanonicalUintString {
	const funding = coordinatorFundingValues(parameters.coordinator)
	return requestPriceCostAttoEth(uint256(parameters.baseFeePerGas, 'baseFeePerGas'), funding).toString()
}

export function assertAnchoredOracleRequestFunding(parameters: { baseFeePerGas: CanonicalUintString; coordinator: OracleRequestFundingSnapshot; minimumToken1ReportAttoEth: CanonicalUintString; requestPriceCostAttoEth: CanonicalUintString; settlementCollateralAttoEth: CanonicalUintString; subject?: string }) {
	const subject = parameters.subject ?? 'Coordinator'
	const locallyDerivedMinimumReport = anchoredMinimumToken1ReportAttoEth(parameters)
	if (locallyDerivedMinimumReport !== parameters.minimumToken1ReportAttoEth) {
		throw oracleRequestFundingError(`${subject} minimum oracle report does not match its anchored funding inputs`)
	}
	const locallyDerivedRequestCost = anchoredRequestPriceCostAttoEth(parameters)
	if (locallyDerivedRequestCost !== parameters.requestPriceCostAttoEth) {
		throw oracleRequestFundingError(`${subject} request-price cost does not match its anchored funding inputs`)
	}
}

export function oracleRequestFundingBounds(parameters: OracleRequestFundingBoundParameters): OracleRequestFundingBounds {
	const anchorBaseFeePerGas = uint256(parameters.anchorBaseFeePerGas, 'anchorBaseFeePerGas')
	return oracleRequestFundingForMaximumBaseFee({
		coordinator: parameters.coordinator,
		maximumBaseFeePerGas: maximumFeePerGas(anchorBaseFeePerGas).toString(),
		proposedRepPerEthPrice: parameters.proposedRepPerEthPrice,
		settlementCollateralAttoEth: parameters.settlementCollateralAttoEth,
	})
}

export function oracleRequestFundingForMaximumBaseFee(parameters: OracleRequestFundingForMaximumBaseFeeParameters): OracleRequestFundingBounds {
	const funding = coordinatorFundingValues(parameters.coordinator)
	const maximumBaseFeePerGas = uint256(parameters.maximumBaseFeePerGas, 'maximumBaseFeePerGas')
	const proposedRepPerEthPrice = uint256(parameters.proposedRepPerEthPrice, 'proposedRepPerEthPrice')
	if (proposedRepPerEthPrice === 0n) throw oracleRequestFundingError('proposedRepPerEthPrice must be positive')
	return fundingBoundsForMaximumBaseFee({
		funding,
		maximumBaseFeePerGas,
		proposedRepPerEthPrice,
		settlementCollateralAttoEth: uint256(parameters.settlementCollateralAttoEth, 'settlementCollateralAttoEth'),
	})
}

/**
 * Computes a stable request envelope whose WETH, REP, and native bounty all fit
 * both the configured cumulative principal caps and the asset-specific inventory
 * available to this workflow at any inclusion base fee up to G.
 */
export function oracleRequestFundingEnvelope(parameters: OracleRequestFundingEnvelopeParameters): OracleRequestFundingBounds {
	const funding = coordinatorFundingValues(parameters.coordinator)
	const maximumEthPrincipalAttoEth = uint256(parameters.maximumEthPrincipalAttoEth, 'maximumEthPrincipalAttoEth')
	const maximumNativePrincipalAttoEth = uint256(parameters.maximumNativePrincipalAttoEth, 'maximumNativePrincipalAttoEth')
	const maximumRepPrincipalAttoRep = uint256(parameters.maximumRepPrincipalAttoRep, 'maximumRepPrincipalAttoRep')
	const maximumWethPrincipalAttoEth = uint256(parameters.maximumWethPrincipalAttoEth, 'maximumWethPrincipalAttoEth')
	const proposedRepPerEthPrice = uint256(parameters.proposedRepPerEthPrice, 'proposedRepPerEthPrice')
	if (proposedRepPerEthPrice === 0n) throw oracleRequestFundingError('proposedRepPerEthPrice must be positive')
	const settlementCollateralAttoEth = uint256(parameters.settlementCollateralCeilingAttoEth, 'settlementCollateralCeilingAttoEth')

	const feasibleFunding = (maximumBaseFeePerGas: bigint) => {
		try {
			const bounds = fundingBoundsForMaximumBaseFee({ funding, maximumBaseFeePerGas, proposedRepPerEthPrice, settlementCollateralAttoEth })
			const wethPrincipal = BigInt(bounds.maximumInitialAttoWeth)
			const nativePrincipal = BigInt(bounds.maximumRequestPriceCostAttoEth)
			const cumulativeEthPrincipal = checkedAdd(wethPrincipal, nativePrincipal, 'oracle request ETH principal')
			if (cumulativeEthPrincipal > maximumEthPrincipalAttoEth || nativePrincipal > maximumNativePrincipalAttoEth || wethPrincipal > maximumWethPrincipalAttoEth || BigInt(bounds.maximumInitialAttoRep) > maximumRepPrincipalAttoRep) {
				return undefined
			}
			return bounds
		} catch (error) {
			if (!isOracleRequestFundingError(error)) throw error
			return undefined
		}
	}

	if (feasibleFunding(1n) === undefined) {
		throw oracleRequestFundingError('Oracle request funding caps cannot support a positive maximum base fee')
	}
	let lower = 1n
	let upper = UINT256_MAXIMUM
	while (lower < upper) {
		const middle = lower + (upper - lower + 1n) / 2n
		if (feasibleFunding(middle) === undefined) upper = middle - 1n
		else lower = middle
	}
	const envelope = feasibleFunding(lower)
	if (envelope === undefined) throw oracleRequestFundingError('Oracle request funding envelope search failed')
	return envelope
}

/** Largest collateral whose one-percent open-interest floor fits this exact WETH report. */
export function oracleRequestSettlementCollateralCeiling(parameters: { coordinator: OracleRequestFundingSnapshot; envelope: OracleRequestFundingBounds }): CanonicalUintString {
	const funding = coordinatorFundingValues(parameters.coordinator)
	const initialWethAttoEth = uint256(parameters.envelope.maximumInitialAttoWeth, 'maximumInitialAttoWeth')
	const priorityReportAttoEth = minimumToken1ReportForGasPrice(funding.initialReportPriorityFeeAttoEthPerGas, funding)
	if (initialWethAttoEth < priorityReportAttoEth) throw oracleRequestFundingError('Oracle request WETH report is below its priority-fee floor')
	return checkedMultiply(initialWethAttoEth - priorityReportAttoEth, OPEN_INTEREST_DIVIDER, 'oracle settlement collateral ceiling').toString()
}

/** Fails closed when a persisted envelope no longer covers current pool state. */
export function assertOracleRequestFundingEnvelope(parameters: { coordinator: OracleRequestFundingSnapshot; envelope: OracleRequestFundingBounds; proposedRepPerEthPrice: CanonicalUintString; settlementCollateralAttoEth: CanonicalUintString; subject?: string }) {
	const subject = parameters.subject ?? 'Oracle request'
	const funding = coordinatorFundingValues(parameters.coordinator)
	const maximumBaseFeePerGas = uint256(parameters.envelope.maximumBaseFeePerGas, 'maximumBaseFeePerGas')
	const proposedRepPerEthPrice = uint256(parameters.proposedRepPerEthPrice, 'proposedRepPerEthPrice')
	if (proposedRepPerEthPrice === 0n) throw oracleRequestFundingError('proposedRepPerEthPrice must be positive')
	const settlementCollateralAttoEth = uint256(parameters.settlementCollateralAttoEth, 'settlementCollateralAttoEth')
	const persistedInitialAttoWeth = uint256(parameters.envelope.maximumInitialAttoWeth, 'maximumInitialAttoWeth')
	if (persistedInitialAttoWeth > UINT128_MAXIMUM) throw oracleRequestFundingError(`${subject} WETH report exceeds uint128`)
	const currentMinimumAttoWeth = minimumToken1ReportAttoEth(maximumBaseFeePerGas, settlementCollateralAttoEth, funding)
	if (currentMinimumAttoWeth > persistedInitialAttoWeth) throw oracleRequestFundingError(`${subject} no longer covers the current WETH report`)
	const expectedInitialAttoRep = mulDivCeil(persistedInitialAttoWeth, proposedRepPerEthPrice, PRICE_PRECISION, 'REP report')
	if (expectedInitialAttoRep > UINT128_MAXIMUM || expectedInitialAttoRep !== uint256(parameters.envelope.maximumInitialAttoRep, 'maximumInitialAttoRep')) {
		throw oracleRequestFundingError(`${subject} REP report does not match its persisted funding inputs`)
	}
	const expectedRequestCost = requestPriceCostAttoEth(maximumBaseFeePerGas, funding)
	if (expectedRequestCost > UINT96_MAXIMUM || expectedRequestCost !== uint256(parameters.envelope.maximumRequestPriceCostAttoEth, 'maximumRequestPriceCostAttoEth')) {
		throw oracleRequestFundingError(`${subject} bounty does not match its persisted funding inputs`)
	}
	const percentageEscalationHalt = (persistedInitialAttoWeth * funding.escalationHaltMultiplierBps) / BPS_DENOMINATOR
	const openInterestEscalationHalt = ceilDiv(settlementCollateralAttoEth, OPEN_INTEREST_DIVIDER)
	const currentEscalationHalt = percentageEscalationHalt > openInterestEscalationHalt ? percentageEscalationHalt : openInterestEscalationHalt
	const persistedEscalationHalt = uint256(parameters.envelope.maximumEscalationHaltAttoEth, 'maximumEscalationHaltAttoEth')
	if (persistedEscalationHalt > UINT128_MAXIMUM) throw oracleRequestFundingError(`${subject} escalation halt exceeds uint128`)
	if (currentEscalationHalt > persistedEscalationHalt) {
		throw oracleRequestFundingError(`${subject} no longer covers the current escalation halt`)
	}
}
