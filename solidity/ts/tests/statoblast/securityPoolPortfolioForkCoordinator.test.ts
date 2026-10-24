import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioForkCollectProtectedRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	test_statoblast_PortfolioForkHarness_PortfolioForkHarness as rootArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkZoltarMock as zoltarArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
	test_statoblast_ShareTokenRecoveryTestPool_ShareTokenRecoveryTestPool as poolArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer as auctionDeployerArtifact,
	statoblast_SecurityPoolPortfolioRecapAuction_SecurityPoolPortfolioRecapAuction as auctionArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer as capitalDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer as indexDeployerArtifact,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer as streamsDeployerArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolCommitmentIndex_SecurityPoolCommitmentIndex as indexArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
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
		root = await deploy(encodeDeployData({ abi: rootArtifact.abi, bytecode: `0x${rootArtifact.evm.bytecode.object}`, args: [zoltar, capitals, indices, streams] }))
		engine = await deploy(encodeDeployData({ abi: settlementArtifact.abi, bytecode: `0x${settlementArtifact.evm.bytecode.object}`, args: [root] }))
		const book = await deploy(encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [engine, 10n ** 12n] }))
		const reporter = await deploy(encodeDeployData({ abi: reporterArtifact.abi, bytecode: `0x${reporterArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
		const auctions = await deploy(`0x${auctionDeployerArtifact.evm.bytecode.object}`)
		forks = await deploy(encodeDeployData({ abi: forkArtifact.abi, bytecode: `0x${forkArtifact.evm.bytecode.object}`, args: [root, zoltar, auctions] }))
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
		const bookAddress = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		for (const child of [first, second]) {
			const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
			expect((await owner.readContract({ abi: bookArtifact.abi, address: bookAddress, functionName: 'totals', args: [bookId] })).slice(0, 2)).toEqual([100n * E, 200n * E])
		}
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(0n)
		expect(await owner.getBalance({ address: engine })).toBe(200n * E)
	})

	test('the permissionless collection SDK burns retired protocol REP without paying the keeper or touching chosen principal', async () => {
		await choose(alice, 1n)
		const child = await childId(1n)
		const collect = () => writeContractAndWait(buyer, () => buyer.sendTransaction(buildPortfolioForkCollectProtectedRequest({ owner: buyer.account.address, controller: forks, universeId: child })))
		await expect(collect()).rejects.toThrow('Branch is not active')
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const chosen = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [alice.account.address] })
		const supply = await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await collect()
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })).toBe(supply - 150n * E)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [buyer.account.address] })).toBe(0n)
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [chosen.positionId] })).rep).toBe(150n * E)
		expect(await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })).toBe(100n * E)
		await collect()
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })).toBe(supply - 150n * E)
	})

	test('a price decline between quote and execution refunds the unused purchase budget', async () => {
		await choose(alice, 1n)
		await moveTo(forkTime + 8n * week)
		await start(1n)
		const child = await childId(1n)
		const branch = await owner.readContract({ ...forkTarget(), functionName: 'branches', args: [child] })
		const quote = await owner.readContract({ abi: auctionArtifact.abi, address: branch.auction, functionName: 'quote', args: [20n * E, 10n * E] })
		await getAnvilWindowEthereum().advanceTime(1000n)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'buyRecapitalization', args: [child, quote[0], quote[0], 100n * E, 0n, 10_000n, 2n * E], value: quote[2] + 2n * E }))
		const account = await buyer.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [buyer.account.address] })
		const index = await buyer.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		expect((await buyer.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [account.positionId] })).rep).toBe(quote[0])
		expect(await owner.readContract({ abi: auctionArtifact.abi, address: branch.auction, functionName: 'raisedAttoEth' })).toBeLessThan(quote[2])
	})

	test('unchosen cash is recoverable once without spending chosen branch or final-parent backing', async () => {
		await choose(alice, 1n)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 200n * E] }))).rejects.toThrow('Fork choices still open')
		await moveTo(forkTime + 8n * week)
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 200n * E] }))
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'availableForkCashAttoEth', args: [0n] })).toBe(100n * E)
		await expect(writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'recoverUnchosenCash', args: [0n, 1n, 1n] }))).rejects.toThrow('Recovery requires unclaimed complete sets')
		await start(1n)
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

	test('a recap buyer can explicitly top up an existing chosen position to a higher health target', async () => {
		await choose(alice, 1n)
		await moveTo(forkTime + 8n * week)
		await start(1n)
		const child = await childId(1n)
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'mint', args: [child, alice.account.address, 100n * E] }))
		await writeContractAndWait(alice, () => alice.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [forks, 100n * E] }))
		const branch = await owner.readContract({ ...forkTarget(), functionName: 'branches', args: [child] })
		const quote = await owner.readContract({ abi: auctionArtifact.abi, address: branch.auction, functionName: 'quote', args: [20n * E, 10n * E] })
		await writeContractAndWait(alice, () => alice.writeContract({ ...forkTarget(), functionName: 'buyRecapitalization', args: [child, quote[0], quote[0], 100n * E, 100n * E, 20_000n, 2n * E], value: quote[2] + 2n * E }))
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const account = await alice.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [alice.account.address] })
		const index = await alice.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const position = await alice.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [account.positionId] })
		expect(position.rep).toBeGreaterThan(210n * E)
		expect(position.rep).toBe(await alice.readContract({ ...ledger(childCapital), functionName: 'requiredRep', args: [position.commitment, 20_000n] }))
	})
})
