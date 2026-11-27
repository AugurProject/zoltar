import { join } from 'node:path'
import { toHex } from '@zoltar/core-shared/evm/ethereum'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from '../contractArtifactHelpers'
import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPoolUniformPriceRepairAuction_SecurityPoolUniformPriceRepairAuction as engineArtifact,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuction as auctionArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { prepareSecurityPoolCollateralRepairAuction } from './securityPoolCollateralRepairAuctionFixture'
import { useSecurityPoolFixture } from './securityPoolFixture'

describe('collateral repair auction safety bounds', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	test('#1363 an opening-week quote cannot authorize closing', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		await context.open()
		await context.bid(context.owner, 1n)
		await context.finalize()
		const clearing = await context.owner.readContract({ abi: engineArtifact.abi, address: context.engine, functionName: 'clearing' })
		expect(clearing.filledLots).toBe(0n)
		expect(clearing.soldAttoRep).toBe(0n)
	})

	test('#1331 opening cannot compress a week of bidding into its last seconds', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.mock.setTime(context.deadline - DAY + 1n)
		await context.report()
		await expect(context.open()).rejects.toThrow('Collateral repair auction requires one day of bidding')
	})
})

describe('collateral repair auction REP precision', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n, minimumCommitmentAttoEth: 1n }, 10_500n)
	test('#1634 opening rechecks the observation against final rounded exposure', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture, 10n * 10n ** 18n + 1n)
		await context.report()
		const exposure = await context.owner.readContract({ abi: poolArtifact.abi, address: fixture.securityPool, functionName: 'oracleExposure', args: [context.child] })
		const layout = normalizeStorageLayout(getContractOutput(loadContractsJson(join(import.meta.dir, '..')), 'contracts/statoblast/SharedPoolPriceFeed.sol', 'SharedPoolPriceFeed'))
		const field = layout.find(entry => entry.label === 'acceptedExposureLimitAttoEth')
		if (field === undefined || field.offset !== 0) throw new Error('Missing whole-word observation coverage slot')
		// Isolate the boundary after a normally accepted observation: cover the
		// original terms exactly, while retaining its real REP budget and clocks.
		await context.mock.request({ method: 'anvil_setStorageAt', params: [context.feed, toHex(BigInt(field.slot), { size: 32 }), toHex(exposure, { size: 32 })] })
		await expect(context.open()).rejects.toThrow('Collateral repair auction quote does not cover final lots')
	})

	test('#1339 permits precise small lots while bounding rounding and covering the deficit', async () => {
		const context = await prepareSecurityPoolCollateralRepairAuction(fixture)
		await context.report()
		const auction = { abi: auctionArtifact.abi, address: context.auction }
		await context.open()
		const lot = await context.owner.readContract({ ...auction, functionName: 'lotAttoEth' })
		const lots = await context.owner.readContract({ ...auction, functionName: 'targetLots' })
		const shortfall = await context.owner.readContract({ ...auction, functionName: 'shortfallAttoEth' })
		const rounded = await context.owner.readContract({ ...auction, functionName: 'minimumCollateralAttoRepPerLot' })
		const price = await context.owner.readContract({ ...auction, functionName: 'openingConservativePrice' })
		const multiplier = await context.owner.readContract({ abi: capitalArtifact.abi, address: context.capital, functionName: 'securityMultiplierBps' })
		const required = await context.owner.readContract({ abi: indexArtifact.abi, address: context.index, functionName: 'requiredRep', args: [lot, price, multiplier, 10_000n] })
		expect(lots * lot).toBe(shortfall)
		expect(lots === 1n || (rounded - required) * 100n < required).toBe(true)
	})
})
