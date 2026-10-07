import { expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import { selectedCandidate } from '../../src/core/candidate-selection.ts'
import { evaluateCandidate, PRICE_PRECISION, type LiquidationCandidate, type PoolRiskContext, type VaultPosition } from '../../src/core/strategy.ts'
import { assertStaleLiquidationExposureBound } from '../../src/execution/execution-safety.ts'
import type { PoolObservation } from '../../src/state/operator-state.ts'

const address = (index: number) => getAddress(`0x${index.toString(16).padStart(40, '0')}`)
const settings = parseSettings(example)
const risk: PoolRiskContext = {
	address: address(16),
	denominator: 1_000n * PRICE_PRECISION * PRICE_PRECISION,
	feeEligibleUnderwritingLimitAttoEth: 1_000n * PRICE_PRECISION,
	manager: address(32),
	minimumSecurityBondDebtAttoEth: PRICE_PRECISION,
	minimumVaultRepDepositAttoRep: 10n * PRICE_PRECISION,
	minLiquidationPriceDistanceBps: 0n,
	multiplierBps: 20_000n,
	price: 10n * PRICE_PRECISION,
	settlementCollateralAttoEth: 100n * PRICE_PRECISION,
	totalAttoRep: 1_000n * PRICE_PRECISION,
	totalUnderwritingLimitAttoEth: 1_000n * PRICE_PRECISION,
}

function vault(index: number, rep: bigint, debt: bigint): VaultPosition {
	return { address: address(index), backingUnits: rep * PRICE_PRECISION, badDebtAttoEth: 0n, underwritingLimitAttoEth: debt, claimableFeesAttoEth: 0n, disputeStakedAttoRep: 0n, openInterestAttoEth: debt, vaultAttoRepBacking: rep }
}

const caller = vault(48, 0n, 0n)

function observation(isPriceValid: boolean, candidates: LiquidationCandidate[]): PoolObservation {
	return {
		knownVaultCount: BigInt(candidates.length),
		address: risk.address,
		approvedUniverse: true,
		botVault: caller,
		candidates,
		settlementCollateralAttoEth: risk.settlementCollateralAttoEth,
		currentRetentionRate: PRICE_PRECISION,
		forkActivationTime: 0n,
		forkOutcomeIndex: undefined,
		initialReportPriorityFeeAttoEthPerGas: 0n,
		isPriceValid,
		lastPrice: risk.price,
		lastSettlementTimestamp: 0n,
		manager: risk.manager,
		minLiquidationPriceDistanceBps: 0n,
		minimumSecurityBondDebtAttoEth: risk.minimumSecurityBondDebtAttoEth,
		minimumToken1ReportAttoEth: 0n,
		minimumVaultRepDepositAttoRep: risk.minimumVaultRepDepositAttoRep,
		multiplierBps: risk.multiplierBps,
		parent: address(0),
		parentUniverseId: undefined,
		pendingReportId: 0n,
		pendingReportSponsor: address(0),
		questionId: 1n,
		repToken: address(96),
		requestPriceCostAttoEth: 0n,
		selected: true,
		securityPoolForker: address(112),
		stagedOperations: [],
		systemState: 0n,
		totalUnderwritingLimitAttoEth: risk.totalUnderwritingLimitAttoEth,
		totalAttoRep: risk.totalAttoRep,
		universeId: 0n,
		vaults: candidates.map(candidate => candidate.target),
	}
}

function candidates() {
	const full = evaluateCandidate(risk, vault(64, 300n * PRICE_PRECISION, 25n * PRICE_PRECISION), caller, settings.strategy)
	const partial = evaluateCandidate(risk, vault(80, 1_000n * PRICE_PRECISION, 75n * PRICE_PRECISION), caller, settings.strategy)
	if (full === undefined || partial === undefined) throw new Error('Expected both fixture vaults to be liquidation candidates')
	return { full, partial }
}

test('skips stale full closes and selects the next executable liquidation', () => {
	const { full, partial } = candidates()
	const pool = observation(false, [full, partial])
	const selected = selectedCandidate([pool], settings, () => true)
	expect(selected?.candidate).toBe(partial)
	if (selected === undefined) throw new Error('Expected the partial liquidation to be selected')
	expect(() => assertStaleLiquidationExposureBound(selected.candidate)).not.toThrow()
})

test('returns no candidate when only an unsafe stale full close is available', () => {
	const { full } = candidates()
	expect(selectedCandidate([observation(false, [full])], settings, () => true)).toBeUndefined()
})

test('keeps full closes eligible with a current price and honors pool eligibility', () => {
	const { full, partial } = candidates()
	const pool = observation(true, [full, partial])
	expect(selectedCandidate([pool], settings, () => true)?.candidate).toBe(full)
	expect(selectedCandidate([pool], settings, () => false)).toBeUndefined()
})
