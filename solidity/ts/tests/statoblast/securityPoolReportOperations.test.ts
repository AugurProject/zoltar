import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, encodeFunctionData, parseAbi, keccak256, hexToBytes, toHex, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
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
import { unit, useSecurityPoolFixture } from './securityPoolFixture'
import { buildSecurityPoolPriceOperationsRequest, loadSecurityPoolPriceSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'

const batchAbi = parseAbi(['function requestSecurityPoolPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])

describe('Statoblast: gas-bounded sponsor operation batches', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
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
		const address = await sponsor.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
		const feed = { abi: feedArtifact.abi, address }
		await wrapWeth(sponsor, 10n * unit)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), address)
		return { sponsor, feed }
	}
	const withdraw = (amount: bigint, recipient: `0x${string}`) => ({ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [amount, recipient] }) })
	test('#1682 refuses operations expiring before first settlement without taking funding', async () => {
		const { sponsor, feed } = await prepare()
		const snapshot = await loadSecurityPoolPriceSnapshot({ client: sponsor, securityPool: fixture.securityPool, owner: sponsor.account.address, universeId: fixture.base.genesisUniverse })
		const batch = { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: snapshot.timestamp + 60n, operations: [withdraw(1n, sponsor.account.address)] }
		const bounty = 3n * (snapshot.observation?.bounty ?? 0n)
		await expect(sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, batch], value: bounty })).rejects.toThrow('Report operations expire before settlement')
		expect(() => buildSecurityPoolPriceOperationsRequest(snapshot, unit, 10n * unit, batch)).toThrow('before settlement')
		const now = (await sponsor.getBlock()).timestamp
		const challenge = await sponsor.readContract({ ...feed, functionName: 'settlementTime' })
		await expect(sponsor.simulateContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { ...batch, deadline: now + challenge }], value: bounty })).resolves.toBeDefined()
	})

	test('#1252 the SDK preserves the mined base fee when quoting a settlement bounty', async () => {
		const { sponsor, feed } = await prepare()
		const baseFee = 1_000_000_000n
		await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [toHex(baseFee)] })
		await fixture.base.mockWindow.request({ method: 'evm_mine', params: [] })
		const snapshot = await loadSecurityPoolPriceSnapshot({ client: sponsor, securityPool: fixture.securityPool, owner: sponsor.account.address, universeId: fixture.base.genesisUniverse })
		const quoted = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth', blockNumber: snapshot.blockNumber, gasPrice: 2n * baseFee })
		expect(snapshot.observation?.bounty).toBe(quoted)
		const batch = { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: snapshot.timestamp + 1_000n, operations: [withdraw(1n, sponsor.account.address)] }
		const request = buildSecurityPoolPriceOperationsRequest(snapshot, unit, 10n * unit, batch)
		await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [toHex(baseFee)] })
		await writeContractAndWait(sponsor, () => sponsor.sendTransaction({ ...request, gasPrice: 2n * baseFee }))
		expect(await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })).toBeGreaterThan(0n)
	})

	test('#1252 the SDK funds attached work and the feed rejects an ordinary-only settlement bounty', async () => {
		const { sponsor, feed } = await prepare()
		const snapshot = await loadSecurityPoolPriceSnapshot({ client: sponsor, securityPool: fixture.securityPool, owner: sponsor.account.address, universeId: fixture.base.genesisUniverse })
		const ordinaryBounty = await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		const batch = { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: snapshot.timestamp + 1_000n, operations: [withdraw(1n, sponsor.account.address)] }
		await expect(sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, ordinaryBounty, batch], value: ordinaryBounty })).rejects.toThrow('Oracle bounty too small')
		const request = buildSecurityPoolPriceOperationsRequest(snapshot, unit, 10n * unit, batch)
		expect(request.value).toBeGreaterThan(ordinaryBounty)
		await writeContractAndWait(sponsor, () => sponsor.sendTransaction(request))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(sponsor, report)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
	})

	const run = async (context: Awaited<ReturnType<typeof prepare>>, operations: { gasLimit: bigint; data: `0x${string}` }[], price = unit, submit?: (data: Hex, value: bigint) => Promise<Hash>, beforeSettlement?: () => Promise<void>) => {
		const { sponsor, feed } = context
		const gasLimit = operations.reduce((sum, operation) => sum + operation.gasLimit + 100_000n, 0n)
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		const minimum = await sponsor.readContract({ ...feed, functionName: 'minimumToken1ReportAttoEthForPrice', args: [price] })
		const funding = minimum > 10n * unit ? minimum : 10n * unit
		if (submit === undefined) await wrapWeth(sponsor, funding)
		const args = [price, funding, bounty, { gasLimit, minimumPrice: price, maximumPrice: price, deadline: timestamp + 1000n, operations }] as const
		if (submit === undefined) await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args, value: bounty }))
		else await submit(encodeFunctionData({ abi: batchAbi, functionName: 'requestSecurityPoolPriceWithOperations', args }), bounty)
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

	test('#1466 retirements queued while the price is stale do not starve a sponsor operation funded at 1.25x its estimate', async () => {
		// A bystander, the sponsor's 100 ETH position on 400 REP, and two 3 ETH positions that queue retirements.
		await fixture.prepare(20_000n * unit, 200n * unit)
		const owner = fixture.owner()
		const sponsor = fixture.other()
		const attackers = [TEST_ADDRESSES[2], TEST_ADDRESSES[3]].map(address => createWriteClient(fixture.base.mockWindow, address))
		const rep = await owner.readContract({ ...capital(), functionName: 'repToken' })
		for (const [client, amount] of [[sponsor, 3400n * unit], ...attackers.map(attacker => [attacker, 100n * unit] as const)] as const) {
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: rep, functionName: 'transfer', args: [client.account.address, amount] }))
		}
		await fixture.deposit(400n * unit, sponsor)
		await fixture.authorize(100n * unit, sponsor)
		for (const attacker of attackers) {
			await fixture.deposit(100n * unit, attacker)
			await fixture.authorize(3n * unit, attacker)
		}
		await fixture.mint(100n * unit)
		await fixture.base.mockWindow.advanceTime(3601n)
		const feed = { abi: feedArtifact.abi, address: await sponsor.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] }) }
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'weth' }), feed.address)
		await approveToken(sponsor, await sponsor.readContract({ ...feed, functionName: 'reputationToken' }), feed.address)
		const deposit = { ...capital(), functionName: 'depositFor', args: [sponsor.account.address, 3000n * unit] } as const
		const benign = await sponsor.estimateContractGas({ ...deposit, account: sponsor.account })
		const index = { abi: indexArtifact.abi, address: await owner.readContract({ ...capital(), functionName: 'commitmentIndex' }) }
		const positionOf = async (client: typeof owner) => (await owner.readContract({ ...capital(), functionName: 'ownerAccount', args: [client.account.address] })).positionId
		const expectQueued = async () => {
			for (const attacker of attackers) expect((await owner.readContract({ ...index, functionName: 'accountOf', args: [await positionOf(attacker)] })).batch).not.toBe(0n)
		}
		const queueRetirements = async () => {
			await fixture.authorize(0n, attackers[0])
			await fixture.authorize(unit, attackers[1])
			await expectQueued()
		}
		const operations = [{ gasLimit: (benign * 125n) / 100n, data: encodeFunctionData(deposit) }]
		// The report moves the price to 1.5, which the sponsor's position still backs. At the issue's price of 4 the
		// position is liquidating, and a deposit is refused whatever its gas, so it cannot undo the adverse condition.
		expect((await run({ sponsor, feed }, operations, (3n * unit) / 2n, undefined, queueRetirements)).map(event => event.success)).toEqual([true])
		// Each owner's retirement is served only by that owner's own operations, so none of it ran in the sponsor's call.
		await expectQueued()
		expect((await owner.readContract({ ...capital(), functionName: 'ownerCollateral', args: [sponsor.account.address] }))[0]).toBe(3400n * unit)
		expect(await owner.readContract({ ...index, functionName: 'liquidationStarted', args: [await positionOf(sponsor)] })).toBe(0n)
	})

	test('#1340 equal-time rival settlements cannot suppress a funded sponsor operation', async () => {
		const { sponsor, feed } = await prepare()
		const mock = fixture.base.mockWindow
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const nonce = await sponsor.getTransactionCount({ address: sponsor.account.address })
		const timestamp = (await sponsor.getBlock()).timestamp
		let first: Hash | undefined
		let second: Hash | undefined
		const send = async (data: Hex, nonce: bigint): Promise<Hash> => {
			const hash = await mock.requestRaw({ method: 'eth_sendTransaction', params: [{ from: sponsor.account.address, to: feed.address, data, value: toHex(bounty), gas: '0x7a1200', nonce: toHex(nonce) }] })
			if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid report transaction hash')
			return `0x${hash.slice(2)}`
		}
		await mock.requestRaw({ method: 'evm_setAutomine', params: [false] })
		try {
			first = await send(encodeFunctionData({ ...feed, functionName: 'requestSecurityPoolPrice', args: [unit, 10n * unit, bounty] }), nonce)
			second = await send(encodeFunctionData({ abi: batchAbi, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1_000n, operations: [withdraw(unit, sponsor.account.address)] }] }), nonce + 1n)
			await mock.requestRaw({ method: 'evm_mine', params: [] })
		} finally {
			await mock.requestRaw({ method: 'evm_setAutomine', params: [true] })
		}
		if (first === undefined || second === undefined) throw new Error('Report request missing')
		const ids: bigint[] = []
		let requestBlock: bigint | undefined
		for (const hash of [first, second]) {
			const receipt = await sponsor.waitForTransactionReceipt({ hash })
			expect(receipt.status).toBe('success')
			if (requestBlock === undefined) requestBlock = receipt.blockNumber
			else expect(receipt.blockNumber).toBe(requestBlock)
			for (const log of receipt.logs.filter(log => log.address.toLowerCase() === feed.address.toLowerCase())) {
				const event = decodeEventLog({ abi: feedArtifact.abi, data: log.data, topics: log.topics })
				if (event.eventName === 'PriceRequested') ids.push(event.args.reportId)
			}
		}
		const [rival, candidate] = ids
		if (rival === undefined || candidate === undefined) throw new Error('Requested report ids missing')
		await mock.advanceTime(481n)
		await openOracleSettle(sponsor, rival)
		const before = await sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [sponsor.account.address] })
		await openOracleSettle(sponsor, candidate)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [candidate] })).toBe(1n)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [sponsor.account.address] }))[0]).toBe(before[0] - unit)
	})

	test.each([false, true])('#1248 recovery retries fresh callbacks and retires stale ones (stale: %s)', async stale => {
		const { sponsor, feed } = await prepare()
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		await writeContractAndWait(sponsor, () =>
			sponsor.writeContract({
				abi: batchAbi,
				address: feed.address,
				functionName: 'requestSecurityPoolPriceWithOperations',
				args: [unit, 10n * unit, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations: [withdraw(unit, sponsor.account.address)] }],
				value: bounty,
			}),
		)
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		const state = (await loadOpenOracleEventState(sponsor, report)).latest
		// Under-gassed settlements now revert atomically. Inject a temporary receiver failure instead,
		// leaving the real escrow, oracle settlement and report storage in place for recovery.
		const code = await sponsor.getCode({ address: feed.address })
		if (code === undefined || code === '0x') throw new Error('Shared feed runtime code missing')
		await fixture.base.mockWindow.addStateOverrides({ [feed.address]: { code: hexToBytes('0x5f5ffd') } })
		try {
			await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: oracleArtifact.abi, address: getInfraContractAddresses().openOracle, functionName: 'settle', args: [report, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper)], gas: 8_000_000n }))
		} finally {
			await fixture.base.mockWindow.addStateOverrides({ [feed.address]: { code: hexToBytes(code) } })
		}
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(0n)
		if (stale) await fixture.base.mockWindow.advanceTime(1300n)
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report], gas: 8_000_000n }))
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(stale ? 2n : 1n)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe((stale ? 3000n : 2999n) * unit)
		await expect(sponsor.writeContract({ ...feed, functionName: 'recoverReport', args: [report] })).rejects.toThrow('No report to recover')
	})

	test('ordered sponsor withdrawals survive a failed operation and run when someone else settles', async () => {
		const { sponsor, feed } = await prepare()
		const operations = [withdraw(unit, sponsor.account.address), withdraw(10_000n * unit, sponsor.account.address), withdraw(2n * unit, sponsor.account.address)]
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		await writeContractAndWait(sponsor, () =>
			sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 1_800_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations }], value: bounty }),
		)
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
		// Two calls with their per-call overhead fill the feed's operation allowance exactly: 2 x (2,900,000 + 100,000) = 6,000,000.
		const operations = targets.map((account, index) => ({
			gasLimit: 2_900_000n,
			data: encodeFunctionData({
				abi: capitalArtifact.abi,
				functionName: 'takeOverWithBounds',
				args: [account.positionId, 100n * unit, 0n, index === 0 ? 3000n * unit : 0n, { maximumOwnerPrincipal: 5000n * unit, maximumOwnerCommitment: 200n * unit, expectedTargetHealthFactorBps: 10_000n, expectedAcceptedPriceEpoch: 0n, expectedSourceBatch: 0n }],
			}),
		}))
		expect((await run(context, operations, 4n * unit)).map(event => event.success)).toEqual([true, true])
		const receiver = await context.sponsor.readContract({ ...capital(), functionName: 'ownerCollateral', args: [context.sponsor.account.address] })
		expect(receiver[0]).toBe(3800n * unit)
		expect(receiver[1]).toBeGreaterThan(100n * unit)
		expect(receiver[1]).toBe(200n * unit)
		let remaining = 0n
		for (const provider of [fixture.owner(), third]) remaining += (await provider.readContract({ ...capital(), functionName: 'ownerCollateral', args: [provider.account.address] }))[0]
		expect(remaining + receiver[0]).toBe(3800n * unit)
	})

	test('deposits, health targets, commitment changes, withdrawals and earnings share sponsor authorization', async () => {
		const context = await prepare()
		const operations = [
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'depositFor', args: [context.sponsor.account.address, 5n * unit] }),
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setHealthTarget', args: [15_000n] }),
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'setCommitment', args: [100n * unit] }),
			withdraw(2n * unit, context.sponsor.account.address).data,
			encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [context.sponsor.account.address] }),
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

	test('operation count has no fixed cap: twenty calls fill the feed operation gas allowance', async () => {
		const context = await prepare()
		// Only gas bounds the count: 20 x (200,000 + 100,000) is the whole 6,000,000 the feed allows a batch.
		const operations = Array.from({ length: 20 }, () => ({ gasLimit: 200_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [context.sponsor.account.address] }) }))
		const attempts = await run(context, operations)
		expect(attempts).toHaveLength(20)
		expect(attempts.every(event => event.success)).toBe(true)
		expect(attempts.map(event => event.operationIndex)).toEqual(Array.from({ length: 20 }, (_, index) => BigInt(index)))
		// One more call does not fit, whatever its own limit.
		const bounty = 3n * (await context.sponsor.readContract({ ...context.feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await context.sponsor.getBlock()).timestamp
		const oversized = { gasLimit: 6_100_001n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations: [...operations, { gasLimit: 1n, data: operations[0]?.data ?? '0x' }] }
		await expect(context.sponsor.writeContract({ abi: batchAbi, address: context.feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, oversized], value: bounty })).rejects.toThrow('Callback gas exceeds limit')
	})

	test.each(['withdraw', 'price'] as const)('collateral earnings do not invoke a native %s reentry hook and later operations still execute', async mode => {
		await fixture.prepare(400n * unit, 100n * unit)
		const owner = fixture.owner()
		const receiver = await deployContract(owner, encodeDeployData({ abi: receiverArtifact.abi, bytecode: `0x${receiverArtifact.evm.bytecode.object}` }))
		const execute = (target: `0x${string}`, data: Hex, value = 0n) => writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'execute', args: [target, data], value }))
		const rep = await owner.readContract({ ...capital(), functionName: 'repToken' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: rep, functionName: 'transfer', args: [receiver, 3200n * unit] }))
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
		const feed = { abi: feedArtifact.abi, address: await owner.readContract({ abi: securityPoolArtifact.abi, address: fixture.securityPool, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] }) }
		const weth = await owner.readContract({ ...feed, functionName: 'weth' })
		await wrapWeth(owner, 100n * unit)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: weth, functionName: 'transfer', args: [receiver, 100n * unit] }))
		for (const token of [weth, rep]) await execute(token, encodeFunctionData({ abi: tokenArtifact.abi, functionName: 'approve', args: [feed.address, 200n * unit] }))
		let nestedReport: bigint | undefined
		const beforeSettlement = async () => {
			if (mode === 'withdraw') return
			for (const token of [weth, rep]) await approveToken(owner, token, feed.address)
			await wrapWeth(owner, 100n * unit)
			const bounty = 3n * (await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
			await writeContractAndWait(owner, () => owner.writeContract({ ...feed, functionName: 'requestSecurityPoolPrice', args: [2n * unit, 100n * unit, bounty], value: bounty }))
			nestedReport = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
			const state = (await loadOpenOracleEventState(owner, nestedReport)).latest
			const data = encodeFunctionData({ abi: oracleArtifact.abi, functionName: 'settle', args: [nestedReport, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper)] })
			await writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'setReceiveReentry', args: [getInfraContractAddresses().openOracle, data] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ abi: receiverArtifact.abi, address: receiver, functionName: 'setReceiveReentry', args: [fixture.capitalLedger, withdraw(unit, receiver).data] }))
		const operations = [
			{ gasLimit: 3_500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [receiver] }) },
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
