import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

export const aggregatePortfolioAbi = portfolioArtifact.abi

export function useAggregatePortfolioFixture() {
	const fixture = useSecurityPoolPortfolioFixture()
	const deposit = async (amount = 5_000n * unit, owner = fixture.owner(), minimumShares = 1n) => {
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.portfolio)
		return await writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'deposit', args: [amount, minimumShares] }))
	}
	const quote = (amount = 100n * unit, questionId = fixture.base.questionId) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'quoteMint', args: [questionId, amount] })
	const shares = (owner: Address = fixture.owner().account.address) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'balanceOf', args: [owner] })
	const assets = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'totalAssets' })
	const fees = (owner: Address = fixture.owner().account.address) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimableFees', args: [owner] })
	const rebalance = (positionId = 1n) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'rebalancePosition', args: [positionId] }))
	const position = (positionId = 1n) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'positions', args: [positionId] })
	const custody = async (positionId = 1n) => (await position(positionId))[3]
	const positionCount = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'positionCount' })
	const ownerPositionShares = (positionId = 1n, owner = fixture.owner().account.address) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'getOwnerPositionShares', args: [positionId, owner] })
	const reusable = (positionId = 1n) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'isReusablePosition', args: [positionId] })
	const mint = (amount = 100n * unit, questionId = fixture.base.questionId, budget = 10n * unit, minimumShares = 0n, recipient = fixture.other().account.address) =>
		writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [questionId, recipient, minimumShares, amount], value: amount + budget }))
	const withdraw = (amount: bigint, owner = fixture.owner(), minimumIdleAttoRep = 0n) => writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'withdraw', args: [amount, minimumIdleAttoRep] }))
	const claim = (positionId = 1n, owner = fixture.owner().account.address, sender = fixture.owner()) => writeContractAndWait(sender, () => sender.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimPosition', args: [positionId, owner] }))
	return { fixture, deposit, quote, shares, assets, fees, rebalance, position, custody, positionCount, ownerPositionShares, reusable, mint, withdraw, claim }
}
