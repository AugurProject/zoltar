import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, maxUint256, parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioServices_SecurityPoolPortfolioServices as servicesArtifact,
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryArtifact,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { deployChild, forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { openOracleSettle, openOracleSettleWithGasPrice } from '../../testSupport/simulator/utils/contracts/statoblast'
import { portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('ERC20 portfolio collateral', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test.each(['callback', 'recovery'] as const)('#1502 blocked sponsor refunds cannot roll back %s acceptance', async mode => {
		const owner = fixture.owner()
		const other = fixture.other()
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: applyLibraries(tokenArtifact.evm.bytecode.object), args: [18] }))
		const portfolio = await fixture.deployPortfolio(undefined, portfolioEconomics, { collateralToken: token })
		await fixture.register(fixture.base.questionId, portfolio)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [owner.account.address, 1_000_000n * unit] }))
		const address = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		await approveToken(owner, token, address)
		await approveToken(owner, rep, address)
		const batchAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])
		const bounty = 3n * (await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await owner.getBlock()).timestamp
		const minimum = await owner.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		await writeContractAndWait(owner, () =>
			owner.writeContract({
				abi: batchAbi,
				address,
				functionName: 'requestPortfolioPriceWithOperations',
				args: [unit, minimum + 100n * unit, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 2_000n, operations: [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [15_000n] }) }] }],
				value: bounty,
			}),
		)
		const report = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
		const [escrow, , , ceiling] = await owner.readContract({ ...feed, functionName: 'reportCandidates', args: [report] })
		const escrowAbi = parseAbi(['function withdrawTokenFunding(address token,address recipient)'])
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setBlocked', args: [owner.account.address, true] }))
		await fixture.base.mockWindow.advanceTime(481n)
		if (mode === 'recovery') await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${(ceiling + 1n).toString(16)}`] })
		await openOracleSettleWithGasPrice(other, report, mode === 'recovery' ? ceiling + 1n : ceiling)
		if (mode === 'recovery') {
			expect(await owner.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(0n)
			await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })
			await writeContractAndWait(other, () => other.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gasPrice: ceiling }))
		}
		expect(await owner.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect(await owner.readContract({ ...feed, functionName: 'lastPrice' })).toBe(unit)
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })
		expect((await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [owner.account.address] })).targetHealthFactorBps).toBe(15_000n)
		const withdraw = (sender: typeof owner, asset: typeof token, recipient: typeof token) => writeContractAndWait(sender, () => sender.writeContract({ abi: escrowAbi, address: escrow, functionName: 'withdrawTokenFunding', args: [asset, recipient] }))
		await expect(withdraw(other, token, other.account.address)).rejects.toThrow('Invalid funding withdrawal')
		await expect(withdraw(owner, token, zeroAddress)).rejects.toThrow()
		await expect(withdraw(owner, token, escrow)).rejects.toThrow('Invalid funding withdrawal')
		await expect(withdraw(owner, portfolio, other.account.address)).rejects.toThrow('Invalid funding withdrawal')
		await expect(withdraw(owner, token, owner.account.address)).rejects.toThrow()
		const balance = (asset: typeof token, holder: typeof token) => owner.readContract({ abi: tokenArtifact.abi, address: asset, functionName: 'balanceOf', args: [holder] })
		const repBefore = await balance(rep, owner.account.address)
		await withdraw(other, rep, owner.account.address)
		expect(await balance(rep, owner.account.address)).toBeGreaterThan(repBefore)
		const before = await balance(token, other.account.address)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [escrow, 7n] }))
		await withdraw(owner, token, other.account.address)
		expect(await balance(token, other.account.address)).toBe(before + minimum + 100n * unit + 7n)
		await withdraw(owner, token, other.account.address)
		expect(await balance(token, other.account.address)).toBe(before + minimum + 100n * unit + 7n)
	})

	test('rejects canonical REP collateral before deploying an unusable portfolio', async () => {
		await expect(fixture.deployPortfolio(undefined, undefined, { collateralToken: getRepTokenAddress(fixture.base.genesisUniverse) })).rejects.toThrow('REP cannot be portfolio collateral')
	})
	test('rejects a different existing child REP token as collateral', async () => {
		const owner = fixture.owner()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.base.questionId)
		await deployChild(owner, fixture.base.genesisUniverse, 1n)
		await deployChild(owner, fixture.base.genesisUniverse, 2n)
		const origin = getChildUniverseId(fixture.base.genesisUniverse, 1)
		const collateralUniverse = getChildUniverseId(fixture.base.genesisUniverse, 2)
		await expect(fixture.deployPortfolio(undefined, undefined, { universeId: origin, collateralToken: getRepTokenAddress(collateralUniverse) })).rejects.toThrow('REP cannot be portfolio collateral')
	})

	test.each(['paused', 'burn-blocked'] as const)('#1336/#1337 REP disputes and fee accounting survive %s collateral', async mode => {
		const owner = fixture.owner()
		const other = fixture.other()
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: applyLibraries(tokenArtifact.evm.bytecode.object), args: [18] }))
		const portfolio = await fixture.deployPortfolio(undefined, portfolioEconomics, { collateralToken: token })
		await fixture.register(fixture.base.questionId, portfolio)
		for (const recipient of [owner.account.address, other.account.address]) await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [recipient, 1_000_000n * unit] }))
		await fixture.deposit(1_000n * unit, owner, portfolio)
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		await approveToken(owner, token, feed)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		const minimum = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [unit, minimum + 100n * unit, bounty], value: bounty }))
		const report = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		await fixture.authorize(200n * unit, owner, portfolio)
		await fixture.mint(100n * unit, fixture.base.questionId, { namespace: portfolio })
		if (mode === 'burn-blocked') {
			// Distressed backing leaves subsequent prepaid income unassigned, exercising
			// the capital burn queue as well as the unused-premium service burn queue.
			await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [4n * unit, 100n * unit, bounty], value: bounty }))
			const adverseReport = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
			await fixture.base.mockWindow.advanceTime(481n)
			await openOracleSettle(owner, adverseReport)
		}
		const pool = fixture.poolFor(fixture.base.questionId, undefined, undefined, portfolio).securityPool
		for (const sender of [owner, other]) await approveToken(sender, getRepTokenAddress(fixture.base.genesisUniverse), pool)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		if (mode === 'paused') await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setPaused', args: [true] }))
		else await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setBlocked', args: ['0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', true] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 2n * unit] }))
		await fixture.base.mockWindow.advanceTime(86_400n)
		await writeContractAndWait(other, () => other.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'depositWalletRepToEscalationGame', args: [2, 10n * unit] }))
		expect(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'escalationGame' })).not.toBe('0x0000000000000000000000000000000000000000')
		if (mode === 'burn-blocked') await expect(fixture.deposit(unit, owner, portfolio)).rejects.toThrow('Position is liquidating')
		await fixture.deposit(unit, mode === 'burn-blocked' ? other : owner, portfolio)
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })
		await fixture.base.mockWindow.advanceTime(5n * 86_400n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'checkpoint' }))
		const services = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'services' })
		expect(await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingBurnCash', args: [fixture.base.genesisUniverse] })).toBeGreaterThan(0n)
		if (mode === 'burn-blocked') expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'pendingBurnCash' })).toBeGreaterThan(0n)
		const claim = () => writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'claimEarnings', args: [owner.account.address] }))
		if (mode === 'paused') await expect(claim()).rejects.toThrow('SafeERC20Ops token call reverted')
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setPaused', args: [false] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setBlocked', args: ['0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', false] }))
		const before = await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner.account.address] })
		await claim()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'flushBurn' }))
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'pendingBurnCash' })).toBe(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: servicesArtifact.abi, address: services, functionName: 'flushBurn', args: [fixture.base.genesisUniverse] }))
		expect(await owner.readContract({ abi: servicesArtifact.abi, address: services, functionName: 'pendingBurnCash', args: [fixture.base.genesisUniverse] })).toBe(0n)
		const after = await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner.account.address] })
		expect(after).toBeGreaterThan(before)
		await claim()
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [owner.account.address] })).toBe(after)
	})
	test('#1567 a provider the collateral token blocks still claims REP and collateral earnings to another recipient', async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: applyLibraries(tokenArtifact.evm.bytecode.object), args: [18] }))
		const portfolio = await fixture.deployPortfolio(undefined, portfolioEconomics, { collateralToken: token })
		await fixture.register(fixture.base.questionId, portfolio)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [owner.account.address, 1_000_000n * unit] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [other.account.address, 1_000_000n * unit] }))
		await fixture.deposit(1_000n * unit, owner, portfolio)
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		await approveToken(owner, token, feed)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		const minimum = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [unit] })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [unit, minimum + 100n * unit, bounty], value: bounty }))
		const report = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		await fixture.authorize(200n * unit, owner, portfolio)
		await fixture.mint(100n * unit, fixture.base.questionId, { namespace: portfolio })
		await fixture.base.mockWindow.advanceTime(600n)
		const capital = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'checkpoint' }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setBlocked', args: [owner.account.address, true] }))
		const claimTo = (recipient: `0x${string}`) => writeContractAndWait(owner, () => owner.writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'claimEarnings', args: [recipient] }))
		await expect(claimTo(owner.account.address)).rejects.toThrow('SafeERC20Ops token call reverted')
		await expect(claimTo(zeroAddress)).rejects.toThrow('Invalid earnings recipient')
		const before = await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [other.account.address] })
		await claimTo(other.account.address)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [other.account.address] })).toBeGreaterThan(before)
	})

	test('six-decimal collateral funds direct reports and round trips', async () => {
		const owner = fixture.owner()
		const buyer = fixture.other()
		const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: applyLibraries(tokenArtifact.evm.bytecode.object), args: [6] }))
		const floor = 10_000n
		const portfolio = await fixture.deployPortfolio(undefined, { ...portfolioEconomics, minimumCommitmentAttoEth: 1_000_000n, minimumPurchaseFeeAttoEth: 100n }, { collateralToken: token, minimumReportCollateral: floor })
		await fixture.register(fixture.base.questionId, portfolio)
		for (const recipient of [owner.account.address, buyer.account.address]) await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [recipient, 1_000_000_000n] }))
		await fixture.deposit(1_000n * unit, owner, portfolio)
		const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'collateralToken' })).toBe(token)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })).toBe(floor)
		await approveToken(owner, token, feed)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
		const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
		const price = 10n ** 30n // 1 REP per whole six-decimal token, scaled raw-unit ratio.
		await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [price, 2_000_000n + floor, bounty], value: bounty }))
		const report = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'lastPrice' })).toBe(price)
		await fixture.authorize(100_000_000n, owner, portfolio)
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'aggregateExposureAttoEth' })).toBe(100_000_000n)
		// Unused accepted capacity does not raise renewal funding in this collateral.
		expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })).toBe(floor + 1_000_000n)
		const cash = 10_000_000n
		const quote = await buyer.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
		const balance = () => buyer.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [buyer.account.address] })
		const before = await balance()
		const mintHash = await fixture.mint(cash, fixture.base.questionId, { namespace: portfolio, budget: quote[0] })
		const settlement = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'settlement' })
		const mintReceipt = await buyer.getTransactionReceipt({ hash: mintHash })
		const transfers = mintReceipt.logs
			.filter(log => log.address.toLowerCase() === token.toLowerCase())
			.flatMap(log => {
				const event = decodeEventLog({ abi: tokenArtifact.abi, data: log.data, topics: log.topics })
				return event.eventName === 'Transfer' ? [event.args] : []
			})
		expect(transfers.some(transfer => transfer.from === buyer.account.address && transfer.to === settlement && transfer.amount === cash)).toBe(true)
		expect(before - (await balance())).toBe(cash + quote[0])
		const pool = fixture.poolFor(fixture.base.questionId, undefined, undefined, portfolio).securityPool
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [100n] }))
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [cash] }))).rejects.toThrow('Collateral transfer amount mismatch')
		expect(await balance()).toBe(before - cash - quote[0])
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [0n] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [cash] }))
		expect(await balance()).toBe(before - quote[0])
		const factory = await deployContract(owner, encodeDeployData({ abi: factoryArtifact.abi, bytecode: applyLibraries(factoryArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
		const router = await deployContract(owner, encodeDeployData({ abi: routerArtifact.abi, bytecode: applyLibraries(routerArtifact.evm.bytecode.object), args: [factory] }))
		await approveToken(buyer, token, router)
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithCollateral', args: [pool, cash, 5_000n, maxUint256, maxUint256, 0n, 0n, 1n, buyer.account.address, fixture.base.questionData.endTime - 1n, 2n * cash] }))
		expect(await buyer.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [router] })).toBe(0n)
		expect(await buyer.getBalance({ address: router })).toBe(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [100n] }))
		const taxedBalance = await balance()
		await expect(fixture.mint(cash, fixture.base.questionId, { namespace: portfolio })).rejects.toThrow('Collateral transfer amount mismatch')
		expect(await balance()).toBe(taxedBalance)
	})
})
