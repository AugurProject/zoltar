import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_PortfolioForkHarness_PortfolioForkHarness as rootArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkZoltarMock as zoltarArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkRecoverySharesMock as sharesArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkQuestionMock as poolArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer as auctionDeployerArtifact,
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

describe('Statoblast: chosen underwriting and claimant recovery remain separate', () => {
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
		shares = await deploy(`0x${sharesArtifact.evm.bytecode.object}`)
		const pool = await deploy(encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [shares] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [0n, 1n, pool] }))
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [0n, E, Number(now + 100n * 24n * 60n * 60n)] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [0n] })
		for (const [client, principal, commitment] of [
			[owner, 10000n * E, E],
			[alice, (105n * E) / 100n, E],
			[bob, 104n * E, 99n * E],
			[buyer, 1000n * E, 99n * E],
		] as const) {
			await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'mint', args: [0n, client.account.address, principal] }))
			await writeContractAndWait(client, () => client.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [capital, principal] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'depositFor', args: [client.account.address, principal] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'setHealthTarget', args: [10_000n] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'authorize', args: [commitment] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'mintQuestion', args: [1n], value: 200n * E }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: sharesArtifact.abi, address: shares, functionName: 'setHolding', args: [0n, buyer.account.address, 200n * E] }))

		for (const client of [alice, bob]) {
			const account = await client.readContract({ ...ledger(capital), functionName: 'ownerAccount', args: [client.account.address] })
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'requestRetirement', args: [account.positionId, client === bob ? 80n * E : 0n] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [0n, 2n] }))
		forkTime = await owner.readContract({ ...zoltarTarget(), functionName: 'getForkTime', args: [0n] })
		await setBaselineSnapshot()
	})

	test('excess collateral cannot move cash beyond accepted commitment', async () => {
		await choose(owner, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const branch = await owner.readContract({ ...forkTarget(), functionName: 'branches', args: [child] })
		expect(branch.parentCash).toBe(E)
		expect(branch.chosenCommitment).toBe(E)
		expect(await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })).toBe(E)
		expect((await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [forks] })).positionId).toBe(0n)
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe((110_505n * E) / 100n)
	})

	test('claim basket redemptions free actual cash demand without adding protocol retirement work', async () => {
		await choose(owner, 1n)
		await choose(alice, 1n)
		await choose(bob, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const first = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [alice.account.address] })
		const second = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [bob.account.address] })
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [child, 1n, buyer.account.address] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'redeemQuestion', args: [child, 1n, 20n * E, buyer.account.address] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement', args: [0n] }))
		const firstPosition = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [first.positionId] })
		const secondPosition = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [second.positionId] })
		expect(firstPosition.commitment).toBe(0n)
		expect(firstPosition.releasedRep).toBe((105n * E) / 100n)
		expect(secondPosition.commitment).toBe((899n * E) / 10n)
		expect(await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })).toBe((909n * E) / 10n)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [buyer.account.address] })).toBe(100n * E)
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe(900n * E)
	})

	test('a zero-choice branch has no capital position but preserves the full REP recovery basket', async () => {
		await moveTo(forkTime + 9n * week)
		await writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'startBranch', args: [0n, 1n] }))
		const child = await childId(1n)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		expect(await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })).toBe(0n)
		expect((await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [forks] })).positionId).toBe(0n)
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [engine] })).toBe((1_110_505n * E) / 100n)
	})
	test('a chosen partial retirement carries its stop into the child and keeps its owners REP', async () => {
		await choose(bob, 1n)
		const child = await childId(1n)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const holder = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [bob.account.address] })
		const childPosition = () => owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [holder.positionId] })
		expect(await childPosition()).toMatchObject({ commitment: 99n * E, remainingCommitment: 80n * E })
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'registerQuestion', args: [child, 1n, buyer.account.address] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'redeemQuestion', args: [child, 1n, 100n * E, buyer.account.address] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement', args: [0n] }))
		expect(await childPosition()).toMatchObject({ rep: 104n * E, commitment: 80n * E, remainingCommitment: 0n, batch: 0n, releasedRep: 0n })
	})
})
