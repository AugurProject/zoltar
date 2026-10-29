import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_PortfolioForkHarness_PortfolioForkHarness as rootArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkZoltarMock as zoltarArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
	test_statoblast_ShareTokenRecoveryTestPool_ShareTokenRecoveryTestPool as poolArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer as auctionDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer as capitalDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer as indexDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer as streamsDeployerArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolPortfolioPurchase_SecurityPoolPortfolioPurchase as purchaseArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'

const E = 10n ** 18n
const week = 7n * 24n * 60n * 60n

describe('Statoblast: composed shared fork capital and collateral', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let owner: WriteClient
	let alice: WriteClient
	let bob: WriteClient
	let buyer: WriteClient
	let root: Address
	let zoltar: Address
	let forks: Address
	let capital: Address
	let engine: Address
	let shares: Address
	let forkTime: bigint
	const forkTarget = () => ({ abi: forkArtifact.abi, address: forks })
	const rootTarget = () => ({ abi: rootArtifact.abi, address: root })
	const zoltarTarget = () => ({ abi: zoltarArtifact.abi, address: zoltar })
	const ledger = (address: Address) => ({ abi: capitalArtifact.abi, address })
	const deploy = async (data: Hex) => {
		const receipt = await owner.waitForTransactionReceipt({ hash: await owner.sendTransaction({ data }) })
		if (receipt.contractAddress === undefined) throw new Error('Fork test deployment address missing')
		return receipt.contractAddress
	}
	const moveTo = async (timestamp: bigint) => {
		const now = (await owner.getBlock()).timestamp
		if (timestamp > now) await getAnvilWindowEthereum().advanceTime(timestamp - now)
	}
	const childId = (outcome: bigint) => owner.readContract({ ...zoltarTarget(), functionName: 'getChildUniverseId', args: [0n, outcome] })
	const choose = (client: WriteClient, outcome: bigint) => writeContractAndWait(client, () => client.writeContract({ ...forkTarget(), functionName: 'choose', args: [0n, outcome] }))
	const start = (outcome: bigint) => writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'startBranch', args: [0n, outcome] }))
	const finalize = (child: bigint) => writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'finalizeBranch', args: [child] }))

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		alice = createWriteClient(ethereum, TEST_ADDRESSES[1])
		bob = createWriteClient(ethereum, TEST_ADDRESSES[2])
		buyer = createWriteClient(ethereum, TEST_ADDRESSES[3])
		zoltar = await deploy(`0x${zoltarArtifact.evm.bytecode.object}`)
		const capitals = await deploy(`0x${capitalDeployerArtifact.evm.bytecode.object}`)
		const indices = await deploy(`0x${indexDeployerArtifact.evm.bytecode.object}`)
		const streams = await deploy(`0x${streamsDeployerArtifact.evm.bytecode.object}`)
		const auctions = await deploy(`0x${auctionDeployerArtifact.evm.bytecode.object}`)
		root = await deploy(encodeDeployData({ abi: rootArtifact.abi, bytecode: `0x${rootArtifact.evm.bytecode.object}`, args: [zoltar, capitals, indices, streams, auctions] }))
		engine = await deploy(encodeDeployData({ abi: settlementArtifact.abi, bytecode: `0x${settlementArtifact.evm.bytecode.object}`, args: [root] }))
		const book = await deploy(encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [engine, 10n ** 12n] }))
		const reporter = await deploy(encodeDeployData({ abi: reporterArtifact.abi, bytecode: `0x${reporterArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
		forks = await deploy(encodeDeployData({ abi: forkArtifact.abi, bytecode: `0x${forkArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'initialize', args: [engine, book, reporter, forks] }))
		capital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [0n] })
		shares = await deploy(encodeDeployData({ abi: sharesArtifact.abi, bytecode: `0x${sharesArtifact.evm.bytecode.object}`, args: [owner.account.address, zoltar, 1n] }))
		const pool = await deploy(encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [shares, 0n, zeroAddress, root] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: sharesArtifact.abi, address: shares, functionName: 'authorize', args: [pool] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [0n, 1n, pool] }))
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [0n, E, Number(now + 100n * 24n * 60n * 60n)] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [0n] })
		for (const client of [alice, bob]) {
			await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'mint', args: [0n, client.account.address, 150n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, 150n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'depositFor', args: [client.account.address, 150n * E] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'fundExecutionReserve', args: [client.account.address], value: 100n * E }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'setHealthTarget', args: [12_000n] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'authorize', args: [100n * E] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'mintQuestion', args: [1n], value: 200n * E }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: sharesArtifact.abi, address: shares, functionName: 'mintCompleteSets', args: [0n, buyer.account.address, 200n * E] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [0n, 2n] }))
		forkTime = await owner.readContract({ ...zoltarTarget(), functionName: 'getForkTime', args: [0n] })
		await setBaselineSnapshot()
	})

	test('missing the choice cutoff releases unused parent execution funding', async () => {
		const parent = await bob.readContract({ ...ledger(capital), functionName: 'ownerAccount', args: [bob.account.address] })
		const assigned = await bob.readContract({ ...ledger(capital), functionName: 'positionExecutionReserveAttoEth', args: [parent.positionId] })
		expect(assigned).toBeGreaterThan(0n)
		await writeContractAndWait(bob, () => bob.writeContract({ ...ledger(capital), functionName: 'withdrawExecutionReserve', args: [parent.executionReserveAttoEth] }))
		await expect(writeContractAndWait(bob, () => bob.writeContract({ ...ledger(capital), functionName: 'withdrawExecutionReserve', args: [assigned] }))).rejects.toThrow('Execution reserve insufficient')
		await choose(alice, 1n)
		await moveTo(forkTime + 8n * week)
		await writeContractAndWait(bob, () => bob.writeContract({ ...ledger(capital), functionName: 'withdrawExecutionReserve', args: [assigned] }))
		expect(await bob.readContract({ ...ledger(capital), functionName: 'positionExecutionReserveAttoEth', args: [parent.positionId] })).toBe(0n)
		await expect(writeContractAndWait(bob, () => bob.writeContract({ ...ledger(capital), functionName: 'withdrawExecutionReserve', args: [1n] }))).rejects.toThrow('Execution reserve insufficient')
		await expect(choose(bob, 1n)).rejects.toThrow('Fork choice window closed')
	})

	test('a fully chosen branch activates without an auction or a zero-value recap transaction', async () => {
		await choose(alice, 1n)
		await choose(bob, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		expect((await owner.readContract({ ...forkTarget(), functionName: 'branches', args: [child] })).ready).toBe(true)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		expect(await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })).toBe(200n * E)
		expect((await alice.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [alice.account.address] })).targetHealthFactorBps).toBe(12_000n)
		expect((await alice.readContract({ ...ledger(capital), functionName: 'ownerAccount', args: [alice.account.address] })).freeAttoRep).toBe(0n)
	})

	test('different choices split cash once while each branch receives its complete nominal liabilities', async () => {
		await choose(alice, 1n)
		await choose(bob, 2n)
		await expect(choose(alice, 2n)).rejects.toThrow('Fork choice already recorded')
		await moveTo(forkTime + 8n * week)
		await start(1n)
		await start(2n)
		const first = await childId(1n)
		const second = await childId(2n)
		for (const child of [first, second]) expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })).toBe(0n)
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(200n * E)
		await moveTo(forkTime + 9n * week)
		await finalize(first)
		await finalize(second)
		const bookAddress = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		for (const child of [first, second]) {
			const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
			expect((await owner.readContract({ abi: bookArtifact.abi, address: bookAddress, functionName: 'totals', args: [bookId] })).slice(0, 2)).toEqual([100n * E, 200n * E])
		}
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(0n)
		expect(await owner.getBalance({ address: engine })).toBe(200n * E)
	})

	test('unchosen child REP belongs to outcome claimants without bids or a fresh child price', async () => {
		await choose(alice, 1n)
		await choose(bob, 2n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe(150n * E)
	})

	test('a stale source price cannot suppress claimant recovery or require a recap buyer', async () => {
		const expiry = await owner.readContract({ ...ledger(capital), functionName: 'priceValidUntil' })
		await moveTo(BigInt(expiry) + 1n)
		const staleForkTime = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setForkTimestamp', args: [0n, staleForkTime] }))
		await choose(alice, 2n)
		await choose(bob, 2n)
		await moveTo(staleForkTime + 9n * week)
		await start(1n)
		const child = await childId(1n)
		await finalize(child)
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [child, 1n, buyer.account.address] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'redeemQuestion', args: [child, 1n, 200n * E, buyer.account.address] }))
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [buyer.account.address] })).toBe(300n * E)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe(0n)
	})

	test('mint capacity stays zero when partial redemption rounds basket ETH back to one cash unit per unit', async () => {
		await choose(alice, 1n)
		await choose(bob, 2n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [child, 1n, buyer.account.address] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'redeemQuestion', args: [child, 1n, 200n * E - 1n, buyer.account.address] }))
		const bookAddress = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
		expect((await owner.readContract({ abi: bookArtifact.abi, address: bookAddress, functionName: 'totals', args: [bookId] })).slice(0, 2)).toEqual([1n, 1n])
		expect(await owner.readContract({ abi: bookArtifact.abi, address: bookAddress, functionName: 'recoveryRep', args: [bookId] })).toBeGreaterThan(0n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(forkTime + 10n * week)] }))
		await expect(owner.readContract({ abi: bookArtifact.abi, address: bookAddress, functionName: 'quoteMint', args: [bookId, 1n, E] })).rejects.toThrow('Settlement in runoff')
		const purchase = await deploy(encodeDeployData({ abi: purchaseArtifact.abi, bytecode: `0x${purchaseArtifact.evm.bytecode.object}`, args: [root] }))
		expect(await owner.readContract({ abi: purchaseArtifact.abi, address: purchase, functionName: 'availableMintCapacity', args: [child] })).toBe(0n)
	})

	test('a later fork migrates live recovery REP once and preserves each descendant basket', async () => {
		await choose(alice, 1n)
		await choose(bob, 2n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childToken = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [child, 3n] }))
		const secondTime = await owner.readContract({ ...zoltarTarget(), functionName: 'getForkTime', args: [child] })
		await writeContractAndWait(alice, () => alice.writeContract({ ...forkTarget(), functionName: 'choose', args: [child, 1n] }))
		await moveTo(secondTime + 9n * week)
		for (const outcome of [1n, 2n]) {
			await writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'startBranch', args: [child, outcome] }))
			const descendant = await owner.readContract({ ...zoltarTarget(), functionName: 'getChildUniverseId', args: [child, outcome] })
			await finalize(descendant)
			const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [descendant] })
			expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe(outcome === 1n ? 150n * E : 300n * E)
		}
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: childToken, functionName: 'balanceOf', args: [engine] })).toBe(0n)
		expect(await owner.readContract({ ...zoltarTarget(), functionName: 'getMigrationRepBalanceAttoRep', args: [forks, child] })).toBe(300n * E)
	})

	test('exhausted settlement units preserve neutral premium recovery and consume the right once', async () => {
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'fundRecoveryPremium', args: [1n], value: 20n * E }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setQuestionFee', args: [0n, 1n, 200n * E, Number(forkTime + 1n)] }))
		await moveTo(forkTime + 1n)
		const exhaustedForkTime = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setForkTimestamp', args: [0n, exhaustedForkTime] }))
		await moveTo(exhaustedForkTime + 8n * week)
		for (const amount of [80n * E, 120n * E]) await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, amount] }))
		expect((await owner.readContract({ ...forkTarget(), functionName: 'forks', args: [0n] })).units).toBe(0n)
		expect(await owner.readContract({ ...rootTarget(), functionName: 'recoveredPremiumAttoEth', args: [buyer.account.address] })).toBe(20n * E)
		expect(await owner.readContract({ ...forkTarget(), functionName: 'recoveredQuestionShares', args: [0n, 1n] })).toBe(200n * E)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 1n] }))).rejects.toThrow('Recovery requires unclaimed complete sets')
		expect(await owner.readContract({ ...rootTarget(), functionName: 'recoveredPremiumAttoEth', args: [buyer.account.address] })).toBe(20n * E)
	})

	test('already final zero-unit questions cannot redirect source premium through fork recovery', async () => {
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'fundRecoveryPremium', args: [1n], value: 20n * E }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setQuestionFee', args: [0n, 1n, 200n * E, Number(forkTime + 1n)] }))
		await moveTo(forkTime + 1n)
		const finalAfter = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setForkTimestamp', args: [0n, finalAfter] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'scheduleQuestionFinality', args: [0n, 1n, Number(finalAfter)] }))
		await moveTo(finalAfter + 1n)
		const finalForkTime = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setForkTimestamp', args: [0n, finalForkTime] }))
		await moveTo(finalForkTime + 8n * week)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 200n * E] }))).rejects.toThrow('No live source recovery right')
		expect(await owner.readContract({ ...rootTarget(), functionName: 'recoveredPremiumAttoEth', args: [buyer.account.address] })).toBe(0n)
	})

	test('unchosen cash is recoverable once without spending chosen branch or final-parent backing', async () => {
		await choose(alice, 1n)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 200n * E] }))).rejects.toThrow('Fork choices still open')
		await moveTo(forkTime + 8n * week)
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 200n * E] }))
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(100n * E)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 1n] }))).rejects.toThrow('Recovery requires unclaimed complete sets')
		await start(1n)
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(100n * E)
		await moveTo(forkTime + 9n * week)
		await finalize(await childId(1n))
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(0n)
		expect(await owner.getBalance({ address: engine })).toBe(100n * E)
	})

	test('split holders combine only their recovery rights and collect all unchosen cash in partial redemptions', async () => {
		const target = { abi: sharesArtifact.abi, address: shares }
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...target, functionName: 'safeBatchTransferFrom', args: [buyer.account.address, bob.account.address, [0n, 2n], [200n * E, 200n * E], '0x'] }))
		await choose(alice, 1n)
		await moveTo(forkTime + 8n * week)
		for (const client of [buyer, bob]) await expect(writeContractAndWait(client, () => client.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, E] }))).rejects.toThrow('unclaimed complete sets')
		await writeContractAndWait(bob, () => bob.writeContract({ ...target, functionName: 'transferPortfolioRecoveryRights', args: [0n, buyer.account.address, [200n * E, 0n, 200n * E]] }))
		for (const amount of [80n * E, 120n * E]) await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, amount] }))
		expect((await owner.readContract({ ...forkTarget(), functionName: 'forks', args: [0n] })).neutralCash).toBe(100n * E)
		expect(await owner.getBalance({ address: forks })).toBe(0n)
		expect(await owner.getBalance({ address: engine })).toBe(100n * E)
		expect(await owner.readContract({ ...target, functionName: 'balanceOfShares', args: [0n, buyer.account.address] })).toEqual([0n, 200n * E, 0n])
		expect(await owner.readContract({ ...target, functionName: 'balanceOfShares', args: [0n, bob.account.address] })).toEqual([200n * E, 0n, 200n * E])
		for (const client of [buyer, bob]) {
			expect(await owner.readContract({ ...target, functionName: 'balanceOfPortfolioRecoveryRights', args: [0n, client.account.address] })).toEqual([0n, 0n, 0n])
			await expect(writeContractAndWait(client, () => client.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 1n] }))).rejects.toThrow('unclaimed complete sets')
		}
		await start(1n)
		expect(await owner.getBalance({ address: engine })).toBe(100n * E)
	})
})
