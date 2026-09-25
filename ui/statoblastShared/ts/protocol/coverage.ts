import { formatUnits, type Address } from '@zoltar/core-shared/evm/ethereum'
import { allocateCoverage, coverageObligation, maximumCoveredObligation, type CoverageOfferPosition } from '@zoltar/statoblast-shared/statoblast/coverage'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'

import * as copy from '../copy/securityPool.js'

const abi = statoblast_SecurityPool_SecurityPool.abi

async function loadCoverageState(client: Pick<ReadClient, 'readContract'>, pool: Address) {
	const [collateral, units, multiplier, manager, count] = await Promise.all([
		client.readContract({ abi, address: pool, functionName: 'settlementCollateralAttoEth' }),
		client.readContract({ abi, address: pool, functionName: 'totalObligationUnits' }),
		client.readContract({ abi, address: pool, functionName: 'statoblastSecurityMultiplierBps' }),
		client.readContract({ abi, address: pool, functionName: 'priceOracleManagerAndOperatorQueuer' }),
		client.readContract({ abi, address: pool, functionName: 'getVaultCount' }),
	])
	const price = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: manager, functionName: 'lastPrice' })
	const offers: CoverageOfferPosition[] = []
	for (let start = 0n; start < count; start += 64n) {
		const vaults = await client.readContract({ abi, address: pool, functionName: 'getVaults', args: [start, 64n] })
		const page = await Promise.all(
			vaults.map(async vault => {
				const [offer, obligationUnits, state] = await Promise.all([
					client.readContract({ abi, address: pool, functionName: 'coverageOffers', args: [vault] }),
					client.readContract({ abi, address: pool, functionName: 'getVaultObligationUnits', args: [vault] }),
					client.readContract({ abi, address: pool, functionName: 'securityVaults', args: [vault] }),
				])
				const poolHeldAttoRep = await client.readContract({ abi, address: pool, functionName: 'backingUnitsToAttoRep', args: [state[0]] })
				return { vault, enabled: offer[0], maximumObligationAttoEth: offer[1], minimumHealthFactorBps: offer[2], obligationUnits, poolHeldAttoRep, disputeStakeAttoRep: 0n }
			}),
		)
		offers.push(...page)
	}
	return { offers, collateral, units, price, multiplier }
}

export async function loadCoverageAllocations(client: Pick<ReadClient, 'readContract'>, pool: Address, amount: bigint) {
	const { offers, collateral, units, price, multiplier } = await loadCoverageState(client, pool)
	return allocateCoverage(offers, collateral, units, amount, price, multiplier)
}

/** Conservative quote for at most 64 willing vaults; execution revalidates the exact allocation. */
export async function loadAvailableCoverage(client: Pick<ReadClient, 'readContract'>, pool: Address) {
	const { offers, collateral, units, price, multiplier } = await loadCoverageState(client, pool)
	return offers
		.map(offer => {
			const maximum = maximumCoveredObligation(offer, price, multiplier)
			const current = coverageObligation(collateral, offer.obligationUnits, units)
			return maximum > current ? maximum - current : 0n
		})
		.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
		.slice(0, 64)
		.reduce((total, amount) => total + amount, 0n)
}

export async function setCoverageOffer(client: WriteClient, pool: Address, enabled: boolean, maximumObligationAttoEth: bigint, minimumHealthFactorBps: bigint) {
	return await writeContractAndWait(client, () => ({
		abi,
		address: pool,
		functionName: 'setCoverageOffer',
		args: [enabled, maximumObligationAttoEth, minimumHealthFactorBps],
		reviewTitle: enabled ? copy.saveCoverageOffer : copy.disableCoverageOffer,
		reviewDescription: enabled ? copy.coverageOfferReview(formatUnits(maximumObligationAttoEth, 18), formatUnits(minimumHealthFactorBps, 4)) : copy.disableCoverageOfferReview,
	}))
}
