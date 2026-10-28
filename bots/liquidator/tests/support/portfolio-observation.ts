import type { PortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { parseSettings } from '../../src/config/settings.ts'
import example from '../../config/operator.example.json'
import { getAddress } from '@zoltar/bot-shared/ethereum'

export const unit = 10n ** 18n
export const portfolioAddress = getAddress('0x0000000000000000000000000000000000000011')
export const ownerAddress = getAddress('0x0000000000000000000000000000000000000012')
export const targetAddress = getAddress('0x0000000000000000000000000000000000000013')
export function portfolioSettings() {
	return parseSettings({
		...example,
		selectedPortfolios: [{ address: portfolioAddress, universeId: '0' }],
		approvedUniverses: ['0'],
		portfolioPolicy: { allowFundedTakeovers: true, maximumPrincipalRep: '1000', maximumTotalPrincipalRep: '2000', maximumCommitmentEth: '1000', maximumOwnFundingRep: '1000', maximumReserveFundingEth: '1', minimumNetRewardEth: '0.001', walletReserveEth: '0.01', targetHealthFactorBps: 15000 },
		strategy: { ...example.strategy, maximumGasCostEth: '0.001', walletReserveRep: '1' },
	})
}
export function portfolioObservation(): PortfolioObservation {
	const position = { id: 1n, owner: targetAddress, batch: 0n, rep: 99n * unit, commitment: 100n * unit, maxHealthyPrice: unit - 1n, remainingCommitment: 0n, executionReserveAttoEth: unit, requiredExecutionReserveAttoEth: unit / 10n, liquidationStarted: 100n, retirementStatus: 'Not retiring', stalledRetirement: false }
	return {
		selection: { address: portfolioAddress, universeId: 0n },
		selected: true,
		approvedUniverse: true,
		acceptedPriceEpoch: 3n,
		knownPositionCount: 1n,
		positions: [position],
		nextScope: { address: portfolioAddress, universeId: 0n, nextPositionId: 1n, sweepEnd: 0n },
		walletRep: 10_000n * unit,
		walletAttoEth: 10n * unit,
		snapshot: {
			chainId: 1,
			blockNumber: 123n,
			blockHash: `0x${'a'.repeat(64)}`,
			timestamp: 3700n,
			portfolio: portfolioAddress,
			owner: ownerAddress,
			universeId: 0n,
			capitalLedger: portfolioAddress,
			priceFeed: portfolioAddress,
			commitmentIndex: portfolioAddress,
			repToken: portfolioAddress,
			acceptedPrice: unit,
			conservativePrice: unit,
			liquidationPrice: unit,
			ownerConservativePrice: unit,
			oracleExposureLimitAttoEth: 100n * unit,
			securityMultiplierBps: 10_500n,
			priceValidUntil: 5000n,
			priceValid: true,
			demandAttoEth: 100n * unit,
			totalPledgedAttoRep: 99n * unit,
			totalCommitmentAttoEth: 100n * unit,
			healthyCommitmentAttoEth: 0n,
			totalFreeAttoRep: 0n,
			currentBatch: 0n,
			nextBatch: 1n,
			forkTime: 0n,
			forkChoiceDeadline: 0n,
			frozen: false,
			importing: false,
			exported: false,
			ownerAccount: { freeAttoRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, executionReserveAttoEth: 0n, targetHealthFactorBps: 15_000n, positionId: 0n },
			positions: [],
			ownerPrincipalAttoRep: 0n,
			ownerCommitmentAttoEth: 0n,
			withdrawableAttoRep: 0n,
			withdrawableExecutionReserveAttoEth: 0n,
			accruedFeesAttoEth: 0n,
			accruedFeesAttoRep: 0n,
			economics: { purchaseFeeBps: 100n, annualFeeBps: 100n, minimumPurchaseFeeAttoEth: 1n, minimumCommitmentAttoEth: unit, minimumExecutionReserveAttoEth: unit / 1000n, minimumOutcomeRate: 1n, rewardVestingSeconds: 3600n, reportingFeeAttoEth: 1n, serviceFeeBps: 1n, maximumOracleRewardAttoEth: 1n },
		},
	}
}
