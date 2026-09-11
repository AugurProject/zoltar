import { contractSimulationReverted } from './discovery-client.ts'
import { escalationGameAbi } from '../contracts/abi.ts'
import { genesisUniswapSeederDeployment } from '../core/genesis-uniswap.ts'
import { canonicalUintString } from '../core/units.ts'
import { type EcosystemDeployments, type PoolSnapshot } from '../operations/types.ts'
import { type ChaosReadClient, drainConcurrent, sameAddress } from './discovery-client.ts'
import { type Address, zeroAddress } from '@zoltar/bot-shared/ethereum'

function fixedPointPower(value: bigint, exponent: bigint) {
	const precision = 10n ** 18n
	let result = exponent % 2n === 0n ? precision : value
	let base = value
	for (let remaining = exponent / 2n; remaining !== 0n; remaining /= 2n) {
		base = (base * base) / precision
		if (remaining % 2n !== 0n) result = (result * base) / precision
	}
	return result
}

export function projectSettlementCollateral(
	accounting: {
		settlementCollateralAttoEth: bigint
		feeEligibleCapacityOwnershipAttoRep: bigint
		feeIndexRemainder: bigint
		totalFeesOwedRemainder: bigint
		lastUpdatedFeeAccumulator: bigint
		currentRetentionRate: bigint
	},
	feeEndTimestamp: bigint | undefined,
	anchorTimestamp: bigint,
) {
	if (feeEndTimestamp === undefined) return 0n
	const clamped = anchorTimestamp < feeEndTimestamp ? anchorTimestamp : feeEndTimestamp
	if (accounting.lastUpdatedFeeAccumulator >= clamped || accounting.feeEligibleCapacityOwnershipAttoRep === 0n) return accounting.settlementCollateralAttoEth
	const timeDelta = clamped - accounting.lastUpdatedFeeAccumulator
	const resultingCollateral = (accounting.settlementCollateralAttoEth * fixedPointPower(accounting.currentRetentionRate, timeDelta)) / 10n ** 18n
	const scaledFeeDelta = (accounting.settlementCollateralAttoEth - resultingCollateral) * 10n ** 18n + accounting.feeIndexRemainder
	const feeIndexDelta = scaledFeeDelta / accounting.feeEligibleCapacityOwnershipAttoRep
	const feesOwedDelta = feeIndexDelta * accounting.feeEligibleCapacityOwnershipAttoRep + accounting.totalFeesOwedRemainder
	const creditedFees = feesOwedDelta / 10n ** 18n
	return creditedFees > accounting.settlementCollateralAttoEth ? 0n : accounting.settlementCollateralAttoEth - creditedFees
}

function resultingVaultBackingAfterDeposit(deposit: bigint, vaultBackingUnits: bigint, totalBackingUnits: bigint, poolRepBalance: bigint) {
	const addedBackingUnits = totalBackingUnits === 0n || poolRepBalance === 0n ? deposit * 10n ** 18n : (deposit * totalBackingUnits) / poolRepBalance
	const nextTotalBackingUnits = totalBackingUnits + addedBackingUnits
	if (nextTotalBackingUnits === 0n) return 0n
	return ((vaultBackingUnits + addedBackingUnits) * (poolRepBalance + deposit)) / nextTotalBackingUnits
}

export function minimumSafeVaultDeposit(minimumBacking: bigint, vaultBackingUnits: bigint, totalBackingUnits: bigint, poolRepBalance: bigint) {
	let lower = minimumBacking > 0n ? minimumBacking : 1n
	let upper = lower
	while (resultingVaultBackingAfterDeposit(upper, vaultBackingUnits, totalBackingUnits, poolRepBalance) < minimumBacking) {
		if (upper > ((1n << 256n) - 1n) / 2n) throw new Error('No representable REP deposit satisfies the vault minimum')
		upper *= 2n
	}
	while (lower < upper) {
		const middle = lower + (upper - lower) / 2n
		if (resultingVaultBackingAfterDeposit(middle, vaultBackingUnits, totalBackingUnits, poolRepBalance) >= minimumBacking) upper = middle
		else lower = middle + 1n
	}
	return lower
}

export function relevantTokenSpenders(deployments: EcosystemDeployments, pools: readonly PoolSnapshot[], token: Address): Address[] {
	const spenders = new Map<string, Address>()
	if (deployments.uniswapV3Factory !== undefined) {
		const genesisSeeder = genesisUniswapSeederDeployment().address
		spenders.set(genesisSeeder.toLowerCase(), genesisSeeder)
	}
	spenders.set(deployments.zoltar.toLowerCase(), deployments.zoltar)
	spenders.set(deployments.openOracle.toLowerCase(), deployments.openOracle)
	for (const pool of pools) {
		if (!sameAddress(token, deployments.weth) && !sameAddress(token, pool.repToken)) continue
		spenders.set(pool.coordinator.toLowerCase(), pool.coordinator)
		if (sameAddress(token, pool.repToken)) {
			spenders.set(pool.address.toLowerCase(), pool.address)
			if (pool.escalationGame !== zeroAddress) spenders.set(pool.escalationGame.toLowerCase(), pool.escalationGame)
		}
	}
	return [...spenders.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
}

export function emptyDirectEscalationDepositQuote(): PoolSnapshot['directEscalationDepositQuotes'][number] {
	return {
		acceptedAmountAttoRep: canonicalUintString(0n),
		maximumDepositAttoRep: canonicalUintString(0n),
		mutationExpectedSuccess: false,
		resultingCumulativeAmountAttoRep: canonicalUintString(0n),
	}
}

export async function discoverDirectEscalationDepositQuotes(
	client: ChaosReadClient,
	wallet: Address,
	escalationGame: Address,
	requestedAmountAttoRep: bigint,
	outcomeBalancesAttoRep: readonly [bigint, bigint, bigint],
	nonDecisionThresholdAttoRep: bigint,
	blockNumber: bigint,
): Promise<PoolSnapshot['directEscalationDepositQuotes']> {
	const quotes: PoolSnapshot['directEscalationDepositQuotes'] = [emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote()]
	if (requestedAmountAttoRep === 0n) return quotes
	await drainConcurrent(
		[0, 1, 2].map(async outcome => {
			let preview: readonly [bigint, bigint]
			try {
				preview = await client.readContract({ abi: escalationGameAbi, address: escalationGame, args: [outcome, requestedAmountAttoRep], blockNumber, functionName: 'previewDepositOnOutcome' })
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				return
			}
			const [acceptedAmountAttoRep, resultingCumulativeAmountAttoRep] = preview
			const currentBalanceAttoRep = outcomeBalancesAttoRep[outcome]
			if (currentBalanceAttoRep === undefined) throw new Error(`Escalation outcome ${outcome.toString()} is missing its anchored balance`)
			if (acceptedAmountAttoRep === 0n || acceptedAmountAttoRep > requestedAmountAttoRep || resultingCumulativeAmountAttoRep !== currentBalanceAttoRep + acceptedAmountAttoRep) {
				throw new Error(`Escalation game ${escalationGame} returned an invalid direct-deposit preview for outcome ${outcome.toString()}`)
			}
			// Only a full start-bond deposit that exactly reaches the threshold is safe to
			// authorize. Any intervening deposit on this outcome necessarily fills the
			// remaining start-bond room, so this call reverts instead of allowing a smaller
			// threshold-fill transfer and leaving residual allowance.
			if (acceptedAmountAttoRep !== requestedAmountAttoRep || resultingCumulativeAmountAttoRep !== nonDecisionThresholdAttoRep) return
			let mutationExpectedSuccess = false
			try {
				await client.simulateContract({ abi: escalationGameAbi, account: wallet, address: escalationGame, args: [outcome, acceptedAmountAttoRep], blockNumber, functionName: 'depositRepOnOutcome' })
				mutationExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				// A missing allowance is expected before the workflow's approval step.
			}
			quotes[outcome] = {
				acceptedAmountAttoRep: acceptedAmountAttoRep.toString(),
				maximumDepositAttoRep: requestedAmountAttoRep.toString(),
				mutationExpectedSuccess,
				resultingCumulativeAmountAttoRep: resultingCumulativeAmountAttoRep.toString(),
			}
		}),
	)
	return quotes
}
