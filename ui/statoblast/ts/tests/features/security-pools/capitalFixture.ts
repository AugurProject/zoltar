import { getAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolAccountSnapshot } from '@zoltar/ui-statoblast-shared/protocol/securityPool.js'
export const owner = getAddress('0x0000000000000000000000000000000000000011')
export const securityPool = getAddress('0x0000000000000000000000000000000000000022')
export const capital = getAddress('0x0000000000000000000000000000000000000033')
export const token = getAddress('0x0000000000000000000000000000000000000044')
export const collateralToken = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
export const index = getAddress('0x0000000000000000000000000000000000000055')
export const auctionAddress = getAddress('0x0000000000000000000000000000000000000091')
export const auctionEngine = getAddress('0x0000000000000000000000000000000000000092')
export const unit = 10n ** 18n
export function capitalSnapshot(overrides: Partial<SecurityPoolAccountSnapshot> = {}): SecurityPoolAccountSnapshot {
	return {
		collateralToken,
		collateral: { address: collateralToken, symbol: 'WETH', decimals: 18 },
		walletCollateral: 100n * unit,
		collateralAllowance: 100n * unit,
		services: getAddress('0x0000000000000000000000000000000000000068'),
		chainId: 1,
		blockNumber: 10n,
		blockHash: zeroHash,
		timestamp: 1_000n,
		securityPool,
		owner,
		universeId: 0n,
		originUniverseId: 0n,
		capitalLedger: capital,
		priceFeed: securityPool,
		commitmentIndex: index,
		repToken: token,
		acceptedPrice: 2n * unit,
		conservativePrice: 2n * unit,
		liquidationPrice: 2n * unit,
		ownerConservativePrice: 2n * unit,
		oracleExposureLimitAttoEth: 100n * unit,
		securityMultiplierBps: 10_500n,
		priceValidUntil: 2_000n,
		priceValid: true,
		demandAttoEth: 10n * unit,
		totalPledgedAttoRep: 100n * unit,
		totalCommitmentAttoEth: 20n * unit,
		healthyCommitmentAttoEth: 20n * unit,
		availableMintCapacityAttoEth: 10n * unit,
		totalFreeAttoRep: 100n * unit,
		currentBatch: 1n,
		nextBatch: 2n,
		forkTime: 0n,
		forkChoiceDeadline: 0n,
		frozen: false,
		importing: false,
		exported: false,
		unclaimedRepairAuctionBids: 0n,
		ownerAccount: { freeAttoRep: 0n, feesAttoEth: unit, feesAttoRep: 2n * unit, targetHealthFactorBps: 12_000n, positionId: 1n },
		positions: [{ id: 1n, owner, batch: 0n, rep: 30n * unit, commitment: 10n * unit, maxHealthyPrice: (28n * unit) / 10n, releasedRep: 0n, feesAttoEth: 0n, feesAttoRep: 0n, liquidationStarted: 0n, remainingCommitment: 0n, retirementPreview: undefined }],
		ownerPrincipalAttoRep: 30n * unit,
		ownerCommitmentAttoEth: 10n * unit,
		withdrawableAttoRep: (48n * unit) / 10n,
		accruedFeesAttoEth: unit,
		accruedFeesAttoRep: 2n * unit,
		economics: {
			annualFeeBps: 1000n,
			purchaseFeeBps: 100n,
			minimumPurchaseFeeAttoEth: 10n ** 15n,
			minimumCommitmentAttoEth: unit,
			minimumOutcomeRate: 10n ** 16n,
			rewardVestingSeconds: 86_400n,
		},
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
export type CentralSecurityPoolMode = 'active' | 'stale' | 'runoff' | 'sealed' | 'disabled' | 'frozen' | 'basket'
// Central security pool, question and book reads for a capital ledger bound to `securityPool` at universe 42, question 7.
export function centralSecurityPoolRead(name: string, mode: CentralSecurityPoolMode) {
	switch (name) {
		case 'refreshSecurityPoolFees':
			return undefined
		case 'priceValidUntil':
			return 6000n
		case 'getCurrentBlockTimestamp':
			return 5_000n
		case 'securityPool':
			return securityPool
		case 'universeId':
			return 42n
		case 'totals':
			return [300n, 200n, 120n]
		case 'questionId':
			return 7n
		case 'isPriceValid':
			return mode !== 'stale'
		case 'ledger':
			return token
		case 'bookIds':
			return 1n
		case 'feeTimestamp':
			return 1000n
		case 'question':
			return [{ units: 60n, outcomeSupplyAttoShares: 100n, finalAfter: 0n, feeRateAttoEthPerSecond: 2_000_000_000n, feeStart: 1000n, feeEnd: 2000n, feePrincipalAttoEth: 100n }, mode === 'frozen' ? 1n : 0n]
		case 'isCashFunded':
			return mode !== 'runoff'
		case 'books':
			return [mode === 'runoff' ? 50n : 100n, 100_000_000_000n, 0n, 1n, 0n, 0n, 123n, mode === 'sealed', 1n, 1n, 1n, mode !== 'disabled', 0n, 877n, 40n, mode === 'basket' ? 150n : 0n]
		case 'settlement':
			return token
		case 'additionalMintCapacityAttoEth':
		case 'availableMintCapacity':
			return 20n
		case 'snapshotQuestion':
			return { outcomeSupplyAttoShares: 100n, questionCashAttoEth: 60n, questionRecoveryAttoRep: mode === 'basket' ? 90n : 0n, demandAttoEth: 100n, earnedFeesAttoEth: 0n, timestamp: 123n }
		default:
			throw new Error(`Unexpected ${name}`)
	}
}
