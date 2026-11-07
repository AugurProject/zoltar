import { describe, expect, test } from 'bun:test'
import { createPublicClient, createWalletClient, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolCapitalLedgerAbi as capitalAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress, getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { DAY } from '../../../../solidity/ts/testSupport/simulator/utils/constants'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { executePortfolioEarnings } from '../../src/execution/portfolio-earnings.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'
import { serveMockChainRpc } from '../support/mock-chain-rpc.ts'

describe('portfolio operator earnings integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('the keeper collects its own vested purchase fees through the live capital ledger', async () => {
		const { base } = fixture
		const mock = base.mockWindow
		const account = privateKeyToAccount(`0x${'02'.repeat(32)}`)
		await mock.setBalance(account.address, 100n * unit)
		await mock.impersonateAccount(account.address)
		const keeper = createWriteClient(mock, BigInt(account.address))
		// The keeper is the only underwriter, so every vested purchase fee is its own.
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ address: getRepTokenAddress(base.genesisUniverse), abi: erc20Abi, functionName: 'transfer', args: [account.address, 1_000n * unit] }))
		await fixture.deposit(1_000n * unit, keeper)
		await fixture.refreshPrice()
		await fixture.authorize(100n * unit, keeper)
		await fixture.mint(100n * unit)
		await mock.advanceTime(DAY + 1n)
		await fixture.refreshPrice()
		const capital = await fixture.capitalFor()
		// Owner-scoped mutations settle the position's vested fees into the owner's claimable account, which the keeper reads.
		await writeContractAndWait(keeper, () => keeper.writeContract({ address: capital, abi: capitalAbi, functionName: 'setHealthTarget', args: [15_000n] }))
		const reader = createPublicClient({ chain: mainnet, transport: custom(mock) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(mock) })
		const settings = portfolioSettings()
		const scope = { address: fixture.portfolio, universeId: base.genesisUniverse, nextPositionId: 1n, sweepEnd: 0n }
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		settings.deployment.multicall3 = getInfraContractAddresses().multicall3
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [base.genesisUniverse]
		settings.strategy.maximumGasCostAttoEth = unit / 100n
		settings.portfolioPolicy.minimumNetRewardAttoEth = 0n
		const { pool, state, stop } = await serveMockChainRpc(mock, settings, account.address, scope)
		try {
			const observation = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
			expect(observation.snapshot.ownerAccount.feesAttoEth).toBeGreaterThan(settings.strategy.maximumGasCostAttoEth)
			const ethBefore = await reader.getBalance({ address: account.address })
			await executePortfolioEarnings(wallet, settings, state, pool, observation, async () => true)
			const claim = state.activities.find(activity => activity.status === 'confirmed')
			if (claim?.hash === undefined) throw new Error('Earnings claim was not confirmed')
			const receipt = await reader.waitForTransactionReceipt({ hash: claim.hash })
			expect(receipt.status).toBe('success')
			const stored = await reader.readContract({ address: capital, abi: capitalAbi, functionName: 'storedOwnerAccount', args: [account.address] })
			expect(stored.feesAttoEth).toBe(0n)
			expect(stored.feesAttoRep).toBe(0n)
			if (receipt.effectiveGasPrice === undefined) throw new Error('Earnings claim receipt has no effective gas price')
			const paid = (await reader.getBalance({ address: account.address })) - ethBefore + receipt.gasUsed * receipt.effectiveGasPrice
			expect(paid).toBeGreaterThanOrEqual(observation.snapshot.ownerAccount.feesAttoEth)
		} finally {
			await stop()
		}
	})
})
