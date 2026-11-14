import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, parseAbi, keccak256, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
	test_statoblast_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as receiverArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { loadOpenOracleEventState, openOracleSettle, wrapWeth } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_openOracle_OpenOracle_OpenOracle as oracleArtifact } from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const batchAbi = parseAbi(['function requestPortfolioPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])

describe('Statoblast: gas-bounded sponsor operation batches', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const prepare = async (targets = 1) => {
		await fixture.prepare(400n * unit, 100n * unit)
		if (targets === 2) {
			const other = createWriteClient(fixture.base.mockWindow, TEST_ADDRESSES[2])
			const rep = await fixture.owner().readContract({ ...capital(), functionName: 'repToken' })
			await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: tokenArtifact.abi, address: rep, functionName: 'transfer', args: [other.account.address, 400n * unit] }))
			await fixture.deposit(400n * unit, other)
			await fixture.authorize(100n * unit, other)
		}
		await fixture.mint(BigInt(targets) * 100n * unit)
		if (targets === 2) await fixture.refreshPrice(fixture.base.questionId, 4n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		const sponsor = fixture.other()
		await fixture.deposit(3000n * unit, sponsor)
		const address = await sponsor.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)
		return { sponsor, feed }
	}
	const withdraw = (amount: bigint, recipient: `0x${string}`) => ({ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [amount, recipient] }) })

	const run = async (context: Awaited<ReturnType<typeof prepare>>, operations: { gasLimit: bigint; data: `0x${string}` }[], price = unit, submit?: (data: Hex, value: bigint) => Promise<Hash>, beforeSettlement?: () => Promise<void>) => {
		const { sponsor, feed } = context
		const gasLimit = operations.reduce((sum, operation) => sum + operation.gasLimit + 100_000n, 0n)
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		const timestamp = (await sponsor.getBlock()).timestamp
		const args = [price, 10n * unit, bounty, { gasLimit, minimumPrice: price, maximumPrice: price, deadline: timestamp + 1000n, operations }] as const
		if (submit === undefined) await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestPortfolioPriceWithOperations', args, value: bounty }))
		else await submit(encodeFunctionData({ abi: batchAbi, functionName: 'requestPortfolioPriceWithOperations', args }), bounty)
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await beforeSettlement?.()
		await fixture.base.mockWindow.advanceTime(481n)
		const hash = await openOracleSettle(fixture.owner(), report)
		const receipt = await sponsor.waitForTransactionReceipt({ hash })
		const topic = keccak256('ReportOperationAttempted(uint256,address,uint256,bool)')
		const attempts = receipt.logs
			.filter(log => log.address.toLowerCase() === feed.address.toLowerCase() && log.topics[0] === topic)
			.map(log => {
				const event = decodeEventLog({ abi: feedArtifact.abi, topics: log.topics, data: log.data })
				if (event.eventName !== 'ReportOperationAttempted') throw new Error('Unexpected operation event')
				return event.args
			})
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		return attempts
	}

	test('ordered sponsor withdrawals survive a failed operation and run when someone else settles', async () => {
		const { sponsor, feed } = await prepare()
		const operations = [withdraw(unit, sponsor.account.address), withdraw(10_000n * unit, sponsor.account.address), withdraw(2n * unit, sponsor.account.address)]
		const bounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		const timestamp = (await sponsor.getBlock()).timestamp
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestPortfolioPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 1_800_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations }], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(fixture.owner(), report)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe(2997n * unit)
	})
	test('two funded takeovers execute in order for the sponsor, never the competing settler', async () => {
		const context = await prepare(2)
		const third = createWriteClient(fixture.base.mockWindow, TEST_ADDRESSES[2])
		const targets = await Promise.all([fixture.owner(), third].map(client => client.readContract({ ...capital(), functionName: 'ownerAccount', args: [client.account.address] })))
		const operations = targets.map((account, index) => ({
			gasLimit: 3_000_000n,
			data: encodeFunctionData({
				abi: capitalArtifact.abi,
				functionName: 'takeOverWithBounds',
				args: [account.positionId, 100n * unit, 1n, index === 0 ? 3000n * unit : 0n, { maximumOwnerPrincipal: 5000n * unit, maximumOwnerCommitment: 200n * unit, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: 0n, expectedSourceBatch: 0n }],
			}),
		}))
		expect((await run(context, operations, 4n * unit)).map(event => event.success)).toEqual([true, true])
		expect((await context.sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [context.sponsor.account.address] }))[1]).toBe(200n * unit)
	})

	test('deposits, health targets, commitment changes, withdrawals and earnings share sponsor authorization', async () => {
		const context = await prepare()
		const operations = [
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'depositFor', args: [context.sponsor.account.address, 5n * unit] }),
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [15_000n] }),
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setCommitment', args: [100n * unit] }),
			withdraw(2n * unit, context.sponsor.account.address).data,
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings' }),
		].map(data => ({ gasLimit: 1_000_000n, data }))
		expect((await run(context, operations)).map(event => event.success)).toEqual([true, true, true, true, true])
		expect((await context.sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [context.sponsor.account.address] })).slice(0, 2)).toEqual([3003n * unit, 100n * unit])
	})

	test('an exhausted operation and a privileged selector cannot block a later owner withdrawal', async () => {
		const context = await prepare()
		const operations = [{ ...withdraw(unit, context.sponsor.account.address), gasLimit: 10_000n }, { gasLimit: 300_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setDemand', args: [0n] }) }, withdraw(unit, context.sponsor.account.address)]
		expect((await run(context, operations)).map(event => event.success)).toEqual([false, false, true])
		expect((await context.sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [context.sponsor.account.address] })).freeAttoRep).toBe(2999n * unit)
	})

	test('operation count has no fixed cap: thirty-two calls fit their declared gas budget', async () => {
		const context = await prepare()
		const operations = Array.from({ length: 32 }, () => ({ gasLimit: 200_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings' }) }))
		const attempts = await run(context, operations)
		expect(attempts).toHaveLength(32)
		expect(attempts.every(event => event.success)).toBe(true)
		expect(attempts.map(event => event.operationIndex)).toEqual(Array.from({ length: 32 }, (_, index) => BigInt(index)))
	})

	test.each(['withdraw', 'price'] as const)('collateral earnings do not invoke a native %s reentry hook and later operations still execute', async mode => {
		await fixture.prepare(400n * unit, 100n * unit)
		const owner = fixture.owner()
		const receiver = await deployContract(owner, encodeDeployData({ abi: receiverArtifact.abi, bytecode: `0x${receiverArtifact.evm.bytecode.object}` }))
		const execute = (target: `0x${string}`, data: Hex, value = 0n) => writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'execute', args: [target, data], value }))
		const rep = await owner.readContract({ ...capital(), functionName: 'repToken' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: rep, functionName: 'transfer', args: [receiver, 3020n * unit] }))
		await execute(rep, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [fixture.capitalLedger, 3000n * unit] }))
		await execute(fixture.capitalLedger, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'depositFor', args: [receiver, 3000n * unit] }))
		await execute(fixture.capitalLedger, encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setCommitment', args: [100n * unit] }))
		await fixture.base.mockWindow.advanceTime(86_401n)
		await fixture.refreshPrice()
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.advanceTime(86_401n)
		await fixture.refreshPrice()
		const account = await owner.readContract({ ...capital(), functionName: 'ownerAccount', args: [receiver] })
		const index = await owner.readContract({ ...capital(), functionName: 'commitmentIndex' })
		const position = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [account.positionId] })
		expect(account.feesAttoEth + position.ethFees).toBeGreaterThan(0n)
		await fixture.base.mockWindow.advanceTime(1300n)
		const feed = { abi: feedArtifact.abi, address: await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] }) }
		const weth = await owner.readContract({ ...feed, functionName: 'weth' })
		await wrapWeth(owner, 10n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: weth, functionName: 'transfer', args: [receiver, 10n * unit] }))
		for (const token of [weth, rep]) await execute(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [feed.address, 20n * unit] }))
		let nestedReport: bigint | undefined
		const beforeSettlement = async () => {
			if (mode === 'withdraw') return
			for (const token of [weth, rep]) await approveToken(owner, token, feed.address)
			const bounty = await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
			await writeContractAndWait(owner, () => owner.writeContract({ ...feed, functionName: 'requestPortfolioPrice', args: [2n * unit, 10n * unit, bounty], value: bounty }))
			nestedReport = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
			const state = (await loadOpenOracleEventState(owner, nestedReport)).latest
			const data = encodeFunctionData({ abi: oracleArtifact.abi, functionName: 'settle', args: [nestedReport, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper)] })
			await writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'setReceiveReentry', args: [getInfraContractAddresses().openOracle, data] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'setReceiveReentry', args: [fixture.capitalLedger, withdraw(unit, receiver).data] }))
		const operations = [
			{ gasLimit: 5_000_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings' }) },
			{ ...withdraw(unit, receiver), gasLimit: 2_000_000n },
		]
		expect((await run({ sponsor: owner, feed }, operations, unit, (data, value) => execute(feed.address, data, value), beforeSettlement)).map(event => event.success)).toEqual([true, true])
		if (nestedReport !== undefined) {
			expect(await owner.readContract({ ...feed, functionName: 'lastPrice' })).toBe(unit)
			expect(await owner.readContract({ ...feed, functionName: 'reportOutcome', args: [nestedReport] })).toBe(0n)
			const id = nestedReport
			await expect(owner.writeContract({ ...feed, functionName: 'recoverReport', args: [id] })).rejects.toThrow('Report not settled')
		}
		expect(await owner.readContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'reenterOnReceive' })).toBe(true)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: weth, functionName: 'balanceOf', args: [receiver] })).toBeGreaterThan(0n)
		expect((await owner.readContract({ ...capital(), functionName: 'ownerCollateral', args: [receiver] }))[0]).toBe(2999n * unit)
	})
})
