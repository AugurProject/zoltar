import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolCapitalLedgerAbi as capitalAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { expect } from 'bun:test'
import { type useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioCollateralRepairAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioCollateralRepairAuctionFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioSettings } from './portfolio-observation.ts'

type RepairAuction = Awaited<ReturnType<typeof preparePortfolioCollateralRepairAuction>>
type KeeperOperator = ReturnType<typeof repairAuctionKeeper>

/** A keeper signer, its reader and wallet over the auction's mock chain, and settings that select the auction's child-universe portfolio. */
export function repairAuctionKeeper(fixture: ReturnType<typeof useSecurityPoolPortfolioFixture>, context: RepairAuction) {
	const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
	const reader = createPublicClient({ chain: mainnet, transport: custom(context.mock) })
	const wallet = createWalletClient({ account, chain: mainnet, transport: custom(context.mock) })
	const settings = portfolioSettings()
	const scope = { address: fixture.portfolio, universeId: context.child, nextPositionId: 1n, sweepEnd: 0n }
	settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
	settings.deployment.zoltar = getZoltarAddress()
	settings.deployment.multicall3 = getInfraContractAddresses().multicall3
	settings.selectedPortfolios = [scope]
	settings.approvedUniverses = [context.child]
	return { account, reader, scope, settings, wallet }
}

/** Retires the owner's capital down to claim demand, funds the keeper with REP, and returns the distressed second-bid winner the keeper can acquire. */
export async function distressedSecondWinner(context: RepairAuction, keeperOperator: KeeperOperator, secondBidId: bigint) {
	const { account, reader, scope, settings } = keeperOperator
	// Retire chosen capital down to claim demand so cure cannot change K.
	await context.report(unit)
	await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'setCommitment', args: [5n * unit] }))
	await context.report(4n * unit)
	const distressed = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
	const initialWinner = distressed.positions.find(position => position.auctionTarget?.bidId === secondBidId)
	if (initialWinner === undefined) throw new Error('Second auction target disappeared')
	expect(initialWinner.liquidationStarted).toBeGreaterThan(0n)
	// Receiver-funded repair does not wait for a principal award.
	await context.mock.impersonateAccount(account.address)
	const keeper = createWriteClient(context.mock, BigInt(account.address))
	await writeContractAndWait(keeper, () => keeper.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'setHealthTarget', args: [15_000n] }))
	await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 40n * unit] }))
	settings.strategy.maximumGasCostAttoEth = unit / 50n
	const next = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
	const winner = next.positions.find(position => position.auctionTarget?.bidId === secondBidId)
	if (winner === undefined) throw new Error('Second auction target disappeared')
	expect(next.snapshot.totalCommitmentAttoEth).toBeGreaterThanOrEqual(next.snapshot.demandAttoEth)
	expect(next.snapshot.totalCommitmentAttoEth - next.snapshot.demandAttoEth).toBeLessThan(unit)
	expect(next.snapshot.priceValid).toBe(true)
	expect(next.snapshot.timestamp).toBeLessThan(next.snapshot.priceValidUntil)
	expect(winner.liquidationStarted).toBe(initialWinner.liquidationStarted)
	return { keeper, next, winner }
}

/** Reads current equal-lot terms instead of assuming the historical one-ETH lot. */
export async function repairAuctionTerms(context: RepairAuction) {
	const abi = parseAbi(['function lotAttoEth() view returns (uint256)', 'function targetLots() view returns (uint256)', 'function repGrid() view returns (uint256)', 'function minimumCollateralAttoRepPerLot() view returns (uint256)'])
	const [collateralPerLot, lotCount, grid, minimumRepPerLot] = await Promise.all([
		context.owner.readContract({ address: context.auction, abi, functionName: 'lotAttoEth' }),
		context.owner.readContract({ address: context.auction, abi, functionName: 'targetLots' }),
		context.owner.readContract({ address: context.auction, abi, functionName: 'repGrid' }),
		context.owner.readContract({ address: context.auction, abi, functionName: 'minimumCollateralAttoRepPerLot' }),
	])
	if (typeof collateralPerLot !== 'bigint' || typeof lotCount !== 'bigint' || typeof grid !== 'bigint' || typeof minimumRepPerLot !== 'bigint' || grid === 0n) throw new Error('Auction lot terms are invalid')
	const repPerLot = (((collateralPerLot * 35n) / 10n + grid - 1n) / grid) * grid
	expect(lotCount).toBeGreaterThan(1n)
	expect(repPerLot).toBeGreaterThanOrEqual((minimumRepPerLot * 12n) / 10n)
	return { collateralPerLot, lotCount, repPerLot, minimumRepPerLot, grid }
}

/** Keeps fee-bearing demand divisible without relying on the old one-ETH lots. */
export async function prepareKeeperCollateralRepairAuction(fixture: ReturnType<typeof useSecurityPoolPortfolioFixture>) {
	// An exact fee denominator makes the integer-per-second holding fee
	// divisible by eight at any whole basis-point rate, preserving that divisor at a fork.
	const quantum = 365n * DAY * 10_000n * 8n
	return await preparePortfolioCollateralRepairAuction({
		...fixture,
		mint: async (amount = 10n * unit, question, options) => {
			const principal = amount - (amount % quantum)
			expect(principal).toBeGreaterThan(0n)
			return await fixture.mint(principal, question, options)
		},
	})
}
