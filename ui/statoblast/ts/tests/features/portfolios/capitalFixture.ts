import { getAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioAccountSnapshot } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
export const owner = getAddress('0x0000000000000000000000000000000000000011')
export const portfolio = getAddress('0x0000000000000000000000000000000000000022')
export const capital = getAddress('0x0000000000000000000000000000000000000033')
export const token = getAddress('0x0000000000000000000000000000000000000044')
export const index = getAddress('0x0000000000000000000000000000000000000055')
export const unit = 10n ** 18n
export function capitalSnapshot(overrides: Partial<PortfolioAccountSnapshot> = {}): PortfolioAccountSnapshot {
	return {
		chainId: 1,
		blockNumber: 10n,
		blockHash: zeroHash,
		timestamp: 1_000n,
		portfolio,
		owner,
		universeId: 0n,
		originUniverseId: 0n,
		capitalLedger: capital,
		commitmentIndex: index,
		repToken: token,
		acceptedPrice: 2n * unit,
		securityMultiplierBps: 10_500n,
		priceValidUntil: 2_000n,
		priceValid: true,
		demandAttoEth: 10n * unit,
		totalPledgedAttoRep: 100n * unit,
		totalCommitmentAttoEth: 20n * unit,
		healthyCommitmentAttoEth: 20n * unit,
		totalFreeAttoRep: 100n * unit,
		currentBatch: 1n,
		nextBatch: 2n,
		forkTime: 0n,
		frozen: false,
		importing: false,
		exported: false,
		ownerAccount: { freeAttoRep: 0n, feesAttoEth: unit, feesAttoRep: 2n * unit, executionReserveAttoEth: unit, targetHealthFactorBps: 12_000n, positionId: 1n },
		positions: [{ id: 1n, owner, batch: 0n, rep: 30n * unit, commitment: 10n * unit, maxHealthyPrice: (28n * unit) / 10n, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, executionReserveAttoEth: 10n ** 16n, liquidationStarted: 0n }],
		ownerPrincipalAttoRep: 30n * unit,
		ownerCommitmentAttoEth: 10n * unit,
		withdrawableAttoRep: 9n * unit,
		accruedFeesAttoEth: unit,
		accruedFeesAttoRep: 2n * unit,
		economics: { annualFeeBps: 1000n, purchaseFeeBps: 100n, minimumPurchaseFeeAttoEth: 10n ** 15n, minimumCommitmentAttoEth: unit, minimumExecutionReserveAttoEth: 10n ** 15n, minimumOutcomeRate: 10n ** 16n, rewardVestingSeconds: 86_400n },
		questionAdmissionPolicy: token,
		admission: { address: token, mode: 'open' },
		questions: [1n, 2n],
		questionCount: 2n,
		questionStart: 0n,
		walletAttoRep: 100n * unit,
		allowanceAttoRep: 0n,
		walletAttoEth: 100n * unit,
		forkController: index,
		...overrides,
	}
}
