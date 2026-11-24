import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, parseAbi, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact, statoblast_SecurityPool_SecurityPool as securityPoolArtifact, statoblast_openOracle_OpenOracle_OpenOracle as oracleArtifact } from '../types/contractArtifact'
import { writeContractAndWait, type WriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken } from '../testSupport/simulator/utils/utilities'
import { loadOpenOracleEventState, wrapWeth } from '../testSupport/simulator/utils/contracts/statoblast'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { unit, useSecurityPoolFixture } from './statoblast/securityPoolFixture'

const batchAbi = parseAbi(['function requestSecurityPoolPriceWithOperations(uint256 price,uint256 weth,uint256 bounty,(uint32 gasLimit,uint256 minimumPrice,uint256 maximumPrice,uint48 deadline,(uint32 gasLimit,bytes data)[] operations) batch) payable returns(uint256)'])

// Audit regression: OpenOracle.settle only reverts with InvalidGasLimit when little gas is LEFT after
// the callback. A callback that failed early on a gas-dependent `require` handed its unused gas back, so
// a settler could forward far less than callbackGasLimit and still settle the report unaccepted. The
// report escrow now consumes everything it is given when entered with less than the promised gas.
describe('audit: an under-gassed settlement cannot void a shared-feed report', () => {
	const fixture = useSecurityPoolFixture({ annualFeeBps: 0n })
	const capital = () => ({ abi: capitalArtifact.abi, address: fixture.capitalLedger })
	const prepare = async () => {
		await fixture.prepare(400n * unit, 100n * unit)
		await fixture.mint(100n * unit)
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
	const settleData = async (client: WriteClient, reportId: bigint): Promise<Hex> => {
		const state = (await loadOpenOracleEventState(client, reportId)).latest
		return encodeFunctionData({ abi: oracleArtifact.abi, functionName: 'settle', args: [reportId, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper)] })
	}
	// Returns the lowest gas limit (on a grid) with which OpenOracle.settle does not revert.
	const settleWithLeastGas = async (attacker: WriteClient, reportId: bigint, from: bigint, to: bigint, step: bigint) => {
		const openOracle = getInfraContractAddresses().openOracle
		const data = await settleData(attacker, reportId)
		for (let gas = from; gas <= to; gas += step) {
			try {
				await attacker.call({ account: attacker.account, to: openOracle, data, gas })
			} catch (error) {
				if (!(error instanceof Error) || !/revert|gas/i.test(error.message)) throw error
				continue
			}
			const hash = await attacker.sendTransaction({ to: openOracle, data, gas })
			const receipt = await attacker.waitForTransactionReceipt({ hash })
			if (receipt.status === 'success') return { gas, gasUsed: receipt.gasUsed }
		}
		throw new Error('No gas limit settled the report')
	}
	const settledAt = async (client: WriteClient, reportId: bigint) => (await client.readContract({ abi: oracleArtifact.abi, address: getInfraContractAddresses().openOracle, functionName: 'storedGame', args: [reportId] }))[4]

	test('batch report: the cheapest settlement that succeeds accepts the price and runs the operations', async () => {
		const { sponsor, feed } = await prepare()
		const attacker = fixture.owner()
		const operations = [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'withdrawPrincipal', args: [unit, sponsor.account.address] }) }]
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations }], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)

		const { gas } = await settleWithLeastGas(attacker, report, 150_000n, 4_900_000n, 10_000n)
		// The report's callbackGasLimit is 4,000,000 + 600,000: nothing cheaper settles it.
		expect(gas).toBeGreaterThanOrEqual(4_600_000n)
		expect(await settledAt(sponsor, report)).not.toBe(0)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect(await sponsor.readContract({ ...feed, functionName: 'isPriceValid' })).toBe(true)
		expect((await sponsor.readContract({ ...capital(), functionName: 'ownerAccount', args: [sponsor.account.address] })).freeAttoRep).toBe(2999n * unit)
	})

	test('rejects an operation batch whose callback could not be settled in one transaction', async () => {
		const { sponsor, feed } = await prepare()
		const operations = [{ gasLimit: 500_000n, data: encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [sponsor.account.address] }) }]
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		await expect(sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 6_000_001, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations }], value: bounty })).rejects.toThrow(
			'Callback gas exceeds limit',
		)
	})

	// Stored operation data is read back from storage inside the callback before the operation runs.
	// The per-operation overhead does not grow with that data, so 96 kB of ignored zero padding behind
	// an allowed selector used the whole callback allowance: the settlement stood with the callback
	// failed at any settler gas, and the price was accepted only if someone recovered the report.
	test('rejects operation data too long for the per-operation callback overhead to read back', async () => {
		const { sponsor, feed } = await prepare()
		// 36 bytes of selector and recipient leave 476 bytes of padding below the 512-byte limit.
		const claimEarnings = encodeFunctionData({ abi: capitalArtifact.abi, functionName: 'claimEarnings', args: [sponsor.account.address] })
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		const timestamp = (await sponsor.getBlock()).timestamp
		const request = (data: Hex) =>
			sponsor.writeContract({ abi: batchAbi, address: feed.address, functionName: 'requestSecurityPoolPriceWithOperations', args: [unit, 10n * unit, bounty, { gasLimit: 600_000n, minimumPrice: unit, maximumPrice: unit, deadline: timestamp + 1000n, operations: [{ gasLimit: 500_000n, data }] }], value: bounty })
		await expect(request(`${claimEarnings}${'00'.repeat(96_000)}`)).rejects.toThrow('Operation data too large')
		await expect(request(`${claimEarnings}${'00'.repeat(477)}`)).rejects.toThrow('Operation data too large')

		// Padding up to the limit still settles with the callback accepting the price.
		await writeContractAndWait(sponsor, () => request(`${claimEarnings}${'00'.repeat(476)}`))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		const attacker = fixture.owner()
		const hash = await attacker.sendTransaction({ to: getInfraContractAddresses().openOracle, data: await settleData(attacker, report), gas: 16_000_000n })
		expect((await attacker.waitForTransactionReceipt({ hash })).status).toBe('success')
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
	})

	test('ordinary report: the cheapest settlement that succeeds accepts the price', async () => {
		const { sponsor, feed } = await prepare()
		const attacker = fixture.owner()
		const bounty = 3n * (await sponsor.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' }))
		await writeContractAndWait(sponsor, () => sponsor.writeContract({ ...feed, functionName: 'requestSecurityPoolPrice', args: [unit, 10n * unit, bounty], value: bounty }))
		const report = await sponsor.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		const { gas } = await settleWithLeastGas(attacker, report, 100_000n, 4_200_000n, 10_000n)
		expect(gas).toBeGreaterThanOrEqual(4_000_000n)
		expect(await sponsor.readContract({ ...feed, functionName: 'reportOutcome', args: [report] })).toBe(1n)
		expect(await settledAt(sponsor, report)).not.toBe(0)
	})
})
