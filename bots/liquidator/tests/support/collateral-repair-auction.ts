import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolCapitalLedgerAbi as capitalAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { expect } from 'bun:test'
import { type useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import type { preparePortfolioCollateralRepairAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioCollateralRepairAuctionFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
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
	await context.report(2n * unit)
	const distressed = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
	const initialWinner = distressed.positions.find(position => position.auctionTarget?.bidId === secondBidId)
	if (initialWinner === undefined) throw new Error('Second auction target disappeared')
	expect(initialWinner.liquidationStarted).toBeGreaterThan(0n)
	// Mature the award while continuously renewing the adverse quote. A stale
	// gap followed by a fresh report correctly restarts the liquidation clock.
	for (let renewal = 0; renewal < 8; renewal++) await context.report(2n * unit)
	await context.mock.impersonateAccount(account.address)
	const keeper = createWriteClient(context.mock, BigInt(account.address))
	await writeContractAndWait(keeper, () => keeper.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'setHealthTarget', args: [15_000n] }))
	await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 20n * unit] }))
	settings.strategy.maximumGasCostAttoEth = unit / 50n
	const next = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
	const winner = next.positions.find(position => position.auctionTarget?.bidId === secondBidId)
	if (winner === undefined) throw new Error('Second auction target disappeared')
	expect(next.snapshot.totalCommitmentAttoEth).toBe(next.snapshot.demandAttoEth)
	expect(next.snapshot.priceValid).toBe(true)
	expect(next.snapshot.timestamp).toBeLessThan(next.snapshot.priceValidUntil)
	expect(winner.liquidationStarted).toBe(initialWinner.liquidationStarted)
	expect(next.snapshot.timestamp - winner.liquidationStarted).toBeGreaterThanOrEqual(3600n)
	return { keeper, next, winner }
}
