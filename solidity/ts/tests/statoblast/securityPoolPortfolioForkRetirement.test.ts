import { beforeAll, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_PortfolioForkHarness_PortfolioForkHarness as rootArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkZoltarMock as zoltarArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkRecoverySharesMock as sharesArtifact,
	test_statoblast_PortfolioForkHarness_PortfolioForkQuestionMock as poolArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer as auctionDeployerArtifact,
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

describe('Statoblast: fork reserve retirement priority', () => {
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
		root = await deploy(encodeDeployData({ abi: rootArtifact.abi, bytecode: `0x${rootArtifact.evm.bytecode.object}`, args: [zoltar, capitals, indices, streams] }))
		engine = await deploy(encodeDeployData({ abi: settlementArtifact.abi, bytecode: `0x${settlementArtifact.evm.bytecode.object}`, args: [root] }))
		const book = await deploy(encodeDeployData({ abi: bookArtifact.abi, bytecode: `0x${bookArtifact.evm.bytecode.object}`, args: [engine, 10n ** 12n] }))
		const reporter = await deploy(encodeDeployData({ abi: reporterArtifact.abi, bytecode: `0x${reporterArtifact.evm.bytecode.object}`, args: [root, zoltar] }))
		const auctions = await deploy(`0x${auctionDeployerArtifact.evm.bytecode.object}`)
		forks = await deploy(encodeDeployData({ abi: forkArtifact.abi, bytecode: `0x${forkArtifact.evm.bytecode.object}`, args: [root, zoltar, auctions] }))
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
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'fundExecutionReserve', args: [client.account.address], value: 100n * E }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'setHealthTarget', args: [10_000n] }))
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'authorize', args: [principal, commitment] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'mintQuestion', args: [1n], value: 200n * E }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: sharesArtifact.abi, address: shares, functionName: 'setHolding', args: [0n, buyer.account.address, 200n * E] }))

		for (const client of [alice, bob]) {
			const account = await client.readContract({ ...ledger(capital), functionName: 'ownerAccount', args: [client.account.address] })
			await writeContractAndWait(client, () => client.writeContract({ ...ledger(capital), functionName: 'requestRetirement', args: [account.positions[0]] }))
		}
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [0n, 2n] }))
		forkTime = await owner.readContract({ ...zoltarTarget(), functionName: 'getForkTime', args: [0n] })
		await setBaselineSnapshot()
	})

	test('zero-sale reserve stays behind both inherited owner retirement cohorts', async () => {
		await choose(owner, 1n)
		await choose(alice, 1n)
		await choose(bob, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const accounts = await Promise.all([alice.account.address, bob.account.address, forks].map(address => owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [address] })))
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		const demand = await owner.readContract({ ...ledger(childCapital), functionName: 'demandAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement' }))
		const [current, next, reserve] = await Promise.all(accounts.map(account => owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [account.positions[0]] })))
		const nextRetired = 200n * E - demand - E
		expect(current?.releasedRep).toBe((105n * E) / 100n)
		expect(next?.releasedRep).toBe((104n * E * nextRetired) / (99n * E))
		expect(next?.commitment).toBe(99n * E - nextRetired)
		expect(reserve?.releasedRep).toBe(0n)
		expect(reserve?.rep).toBe(1000n * E)
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleActiveCommitment', args: [E] })).toBe(E)
	})

	test('already released protocol principal can be collected after a subsequent fork', async () => {
		await choose(owner, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const protocol = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [forks] })
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement' }))
		const position = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [protocol.positions[0]] })
		const released = position.releasedRep
		expect(released).toBeGreaterThan(0n)
		expect(position.commitment).toBeGreaterThan(0n)
		expect(position.maxHealthyPrice).toBe(await owner.readContract({ ...ledger(childCapital), functionName: 'maximumHealthyPrice', args: [position.rep, position.commitment] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [child, 3n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'freeze', args: [child] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		const supply = await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'collectProtectedPrincipal', args: [child] }))
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })).toBe(supply - released)
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'collectProtectedPrincipal', args: [child] }))
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'totalSupply' })).toBe(supply - released)
	})

	test('a cascading fork keeps the remaining owner queue ahead of one new protocol reserve', async () => {
		await choose(owner, 1n)
		await choose(alice, 1n)
		await choose(bob, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement' }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'setFork', args: [child, 3n] }))
		for (const client of [owner, bob]) await writeContractAndWait(client, () => client.writeContract({ ...forkTarget(), functionName: 'choose', args: [child, 1n] }))
		const grandchild = await owner.readContract({ ...zoltarTarget(), functionName: 'getChildUniverseId', args: [child, 1n] })
		const childForkTime = await owner.readContract({ ...zoltarTarget(), functionName: 'getForkTime', args: [child] })
		await moveTo(childForkTime + 9n * week)
		await finalize(grandchild)
		const grandchildCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [grandchild] })
		const index = await owner.readContract({ ...ledger(grandchildCapital), functionName: 'commitmentIndex' })
		const retiring = await owner.readContract({ ...ledger(grandchildCapital), functionName: 'ownerAccount', args: [bob.account.address] })
		const protocol = await owner.readContract({ ...ledger(grandchildCapital), functionName: 'ownerAccount', args: [forks] })
		expect(retiring.positions.filter(id => id !== 0n)).toHaveLength(1)
		expect(protocol.positions.filter(id => id !== 0n)).toHaveLength(1)
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'protocolReserveId' })).toBe(protocol.positions[0])
		const grandchildNow = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [grandchild, E, Number(grandchildNow + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(grandchildCapital), functionName: 'serveRetirement' }))
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [retiring.positions[0]] })).releasedRep).toBeGreaterThan(0n)
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [protocol.positions[0]] })).releasedRep).toBe(0n)
	})

	test('an unhealthy protocol reserve can be cured and taken over into ordinary private capital', async () => {
		await choose(owner, 1n)
		const child = await childId(1n)
		await moveTo(forkTime + 9n * week)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const protocol = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [forks] })
		const id = protocol.positions[0]
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, 10n * E, Number(now + 86_400n)] }))
		const before = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...ledger(childCapital), functionName: 'cure', args: [id] }))
		const cured = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })
		expect(cured.commitment).toBeLessThan(before.commitment)
		expect(cured.rep).toBe(before.rep)
		await getAnvilWindowEthereum().advanceTime(3600n)
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...zoltarTarget(), functionName: 'mint', args: [child, buyer.account.address, 4000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [childCapital, 4000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...ledger(childCapital), functionName: 'depositFor', args: [buyer.account.address, 4000n * E] }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...ledger(childCapital), functionName: 'fundExecutionReserve', args: [buyer.account.address], value: 100n * E }))
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...ledger(childCapital), functionName: 'takeOver', args: [id, cured.commitment, cured.rep, 4000n * E] }))
		const receiver = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [buyer.account.address] })
		expect(receiver.positions.filter(positionId => positionId !== 0n)).toHaveLength(1)
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [receiver.positions[0]] })).batch).toBe(0n)
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [id] })).commitment).toBe(0n)
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleActiveCommitment', args: [10n * E] })).toBe(cured.commitment + E)
	})

	test('a zero-choice branch releases its only reserve without adding mint capacity', async () => {
		await moveTo(forkTime + 9n * week)
		await writeContractAndWait(owner, () => owner.writeContract({ ...forkTarget(), functionName: 'startBranch', args: [0n, 1n] }))
		const child = await childId(1n)
		await finalize(child)
		const childCapital = await owner.readContract({ ...rootTarget(), functionName: 'capitalLedger', args: [child] })
		const index = await owner.readContract({ ...ledger(childCapital), functionName: 'commitmentIndex' })
		const protocol = await owner.readContract({ ...ledger(childCapital), functionName: 'ownerAccount', args: [forks] })
		const reserve = await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [protocol.positions[0]] })
		expect(reserve.commitment).toBe(200n * E)
		expect(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'eligibleActiveCommitment', args: [E] })).toBe(0n)
		const now = (await owner.getBlock()).timestamp
		await writeContractAndWait(owner, () => owner.writeContract({ ...rootTarget(), functionName: 'setPrice', args: [child, E, Number(now + 86_400n)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...ledger(childCapital), functionName: 'serveRetirement' }))
		expect([...(await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'totals' }))]).toEqual([0n, 0n])
		expect((await owner.readContract({ abi: indexArtifact.abi, address: index, functionName: 'accountOf', args: [protocol.positions[0]] })).releasedRep).toBe(reserve.rep)
		await writeContractAndWait(buyer, () => buyer.writeContract({ ...forkTarget(), functionName: 'collectProtectedPrincipal', args: [child] }))
		const token = await owner.readContract({ ...zoltarTarget(), functionName: 'getRepToken', args: [child] })
		expect(await owner.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [childCapital] })).toBe(0n)
	})
})
