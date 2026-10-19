import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

export const aggregatePortfolioAbi = portfolioArtifact.abi

export function useAggregatePortfolioFixture(economics: Partial<typeof portfolioEconomics> = {}) {
	const fixture = useSecurityPoolPortfolioFixture(economics)
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
	const claim = async (positionId = 1n, owner = fixture.owner().account.address, sender?: WriteClient) => {
		const claimant = sender ?? [fixture.owner(), fixture.other()].find(client => client.account.address.toLowerCase() === owner.toLowerCase())
		if (claimant === undefined || claimant.account.address.toLowerCase() !== owner.toLowerCase()) throw new Error('Only owner can claim allocation')
		const ledger = await claimant.readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		const count = await claimant.readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerIntervalCount', args: [owner] })
		for (let intervalId = 0n; intervalId < count; intervalId++) {
			const interval = await claimant.readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerInterval', args: [owner, intervalId] })
			if (interval.active && interval.startPosition <= positionId && (interval.open || interval.endPosition >= positionId)) return writeContractAndWait(claimant, () => claimant.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimPosition', args: [positionId, intervalId] }))
		}
		throw new Error('No allocation position')
	}

	return { fixture, deposit, quote, shares, assets, fees, rebalance, position, custody, positionCount, ownerPositionShares, reusable, mint, withdraw, claim }
}
