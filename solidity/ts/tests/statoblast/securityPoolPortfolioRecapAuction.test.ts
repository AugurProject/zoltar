import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import type { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { getETHBalance, setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { statoblast_SecurityPoolPortfolioRecapAuction_SecurityPoolPortfolioRecapAuction as artifact } from '../../types/contractArtifact'

const unit = 10n ** 18n

describe('Statoblast: atomic portfolio recapitalization', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let ethereum: AnvilWindowEthereum
	let owner: WriteClient
	let buyer: WriteClient
	let auction: Address
	const choiceDeadline = 1_000n
	const recapitalizationDeadline = 2_000n

	const deploy = async (overrides: { unchosenRepAttoRep?: bigint; missingCashAttoEth?: bigint; referencePriceAttoRepPerEth?: bigint; startingPriceAttoEthPerRep?: bigint; securityMultiplierBps?: bigint; maximumCommitmentAttoEth?: bigint } = {}) => {
		auction = await deployContract(
			owner,
			encodeDeployData({
				abi: artifact.abi,
				bytecode: `0x${artifact.evm.bytecode.object}`,
				args: [
					{
						owner: owner.account.address,
						choiceDeadline: Number(choiceDeadline),
						recapitalizationDeadline: Number(recapitalizationDeadline),
						unchosenRepAttoRep: 1_000n * unit,
						missingCashAttoEth: 100n * unit,
						referencePriceAttoRepPerEth: unit,
						startingPriceAttoEthPerRep: unit,
						securityMultiplierBps: 20_000n,
						maximumCommitmentAttoEth: 100n * unit,
						...overrides,
					},
				],
			}),
		)
	}
	const quote = async (eth: bigint, rep = 2n ** 256n - 1n) => {
		const result = await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'quote', args: [eth, rep] })
		return [result[0], result[1], result[2]] as const
	}
	const fill = async (eth: bigint, maximumRep = 2n ** 256n - 1n) => {
		// These unit calls span blocks. Exact-cost fixtures use the stable floor or
		// atto-REP fills whose rounded cost stays unchanged; the coordinator quotes atomically.
		const result = await quote(eth, maximumRep)
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, result[0], result[1]], value: result[2] }))
		return { result, receipt: await owner.waitForTransactionReceipt({ hash }) }
	}
	const finalize = () => writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'finalize' }))

	beforeEach(async () => {
		ethereum = getAnvilWindowEthereum()
		owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		buyer = createWriteClient(ethereum, TEST_ADDRESSES[1])
		await setupTestAccounts(ethereum)
		await deploy()
	})

	test('a free-surplus fill transfers no commitment and has no winner claim', async () => {
		await deploy({ startingPriceAttoEthPerRep: 1n })
		await ethereum.setTime(choiceDeadline)
		expect((await fill(1n)).result).toEqual([unit, 0n, 1n])
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(unit)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'assignedCommitmentAttoEth' })).toBe(0n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(100n * unit)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'finalized' })).toBe(false)
		expect(await getETHBalance(owner, auction)).toBe(1n)
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'withdrawProceeds' }))).rejects.toThrow('Recap auction is not final')
		await ethereum.setTime(recapitalizationDeadline)
		await finalize()
		await writeContractAndWait(owner, () => owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'withdrawProceeds' }))
		expect(await getETHBalance(owner, auction)).toBe(0n)
		await expect(finalize()).rejects.toThrow('Recap auction is already final')
	})

	test('the immutable price curve never rises or crosses the reserve and deadlines cannot reopen', async () => {
		await deploy({ startingPriceAttoEthPerRep: 3n * unit })
		for (const [timestamp, expected] of [
			[0n, 3n * unit],
			[1_000n, 3n * unit],
			[1_250n, 2n * unit],
			[1_500n, unit],
			[1_750n, 1n],
			[2_000n, 1n],
			[9_000n, 1n],
		] as const) {
			expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'priceAt', args: [timestamp] })).toBe(expected)
		}
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await ethereum.setTime(1_500n)
		expect(await quote(2n * unit)).toEqual([2n * unit, 0n, 2n * unit])
		await expect(finalize()).rejects.toThrow('Recap purchases are still active')
		await ethereum.setTime(recapitalizationDeadline)
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await finalize()
		await deploy()
		await expect(quote(unit)).rejects.toThrow('Recap purchases are closed')
		await finalize()
	})

	test('the discount reaches a nominal floor while purchases are still open', async () => {
		await ethereum.setTime(1_750n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'priceAt', args: [1_750n] })).toBe(1n)
		// The old spot-value inventory cap must not leave useful REP unavailable.
		expect((await fill(1_000n)).result).toEqual([1_000n * unit, 100n * unit, 1_000n])
		await expect(quote(unit)).resolves.toEqual([0n, 0n, 0n])
	})

	test('discounted free surplus can clear without paying the old cash-based minimum', async () => {
		await ethereum.setTime(1_750n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'minimumFillAttoEth' })).toBe(1n)
		expect((await fill(800n)).result).toEqual([800n * unit, 0n, 800n])
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(100n * unit)
		expect((await fill(200n)).result).toEqual([200n * unit, 100n * unit, 200n])
	})

	test('surplus clears before backing and each further fill moves only required commitment', async () => {
		await deploy({ missingCashAttoEth: 1_000n, startingPriceAttoEthPerRep: 1n })
		await ethereum.setTime(choiceDeadline)
		expect((await fill(800n)).result).toEqual([800n * unit, 0n, 800n])
		expect((await fill(100n)).result).toEqual([100n * unit, 50n * unit, 100n])
		expect((await fill(100n)).result).toEqual([100n * unit, 50n * unit, 100n])
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(0n)
	})

	test('low reference prices preserve nested-rounding collateral safety for every partial fill', async () => {
		await deploy({ unchosenRepAttoRep: 9n, maximumCommitmentAttoEth: 40n, referencePriceAttoRepPerEth: unit / 10n, missingCashAttoEth: 100n })
		await ethereum.setTime(choiceDeadline)
		let assigned = 0n
		for (let sold = 1n; sold <= 9n; sold++) {
			const { result } = await fill(1n)
			assigned += result[1]
			const remainingCapacity = ((9n - sold) / 2n) * 10n
			expect(40n - assigned).toBe(remainingCapacity)
		}
		expect(assigned).toBe(40n)
	})

	test('only the authenticated coordinator can fill and each fill enforces explicit buyer limits', async () => {
		await deploy({ unchosenRepAttoRep: 200_000n * unit, maximumCommitmentAttoEth: 100_000n * unit, missingCashAttoEth: 200_000n, startingPriceAttoEthPerRep: 1n })
		await ethereum.setTime(choiceDeadline)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'minimumFillAttoEth' })).toBe(2n)
		await expect(buyer.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit], value: 1n })).rejects.toThrow('Only the portfolio can coordinate recapitalization')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit / 10n - 1n], value: 1n })).rejects.toThrow('Recap commitment exceeds buyer consent')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, unit, unit], value: 2n })).rejects.toThrow('Recap payment must equal quoted cost')
		await expect(owner.writeContract({ abi: artifact.abi, address: auction, functionName: 'commitFill', args: [buyer.account.address, 1n, 1n], value: 1n })).rejects.toThrow('Recap purchase is too small')
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(0n)
	})

	test('both inventory and cash caps apply cumulatively without charging for unfilled REP', async () => {
		await deploy({ unchosenRepAttoRep: 10n * unit, maximumCommitmentAttoEth: 5n * unit, startingPriceAttoEthPerRep: 1n })
		await ethereum.setTime(choiceDeadline)
		expect((await fill(3n)).result).toEqual([3n * unit, (3n * unit) / 2n, 3n])
		expect((await fill(100n)).result).toEqual([7n * unit, (7n * unit) / 2n, 7n])
		expect(await quote(100n)).toEqual([0n, 0n, 0n])
		expect(await getETHBalance(owner, auction)).toBe(10n)
		await deploy({ missingCashAttoEth: 100n, startingPriceAttoEthPerRep: 1n })
		expect((await fill(60n)).result).toEqual([60n * unit, 0n, 60n])
		expect((await fill(60n)).result).toEqual([40n * unit, 0n, 40n])
		expect(await quote(unit)).toEqual([0n, 0n, 0n])
		expect(await getETHBalance(owner, auction)).toBe(100n)
	})

	test('cumulative commitment rounding conserves every unit and ceil cost never sells unpaid dust', async () => {
		await deploy({ unchosenRepAttoRep: 101n, missingCashAttoEth: 83n, maximumCommitmentAttoEth: 47n, startingPriceAttoEthPerRep: (15n * unit) / 10n })
		await ethereum.setTime(choiceDeadline)
		let sold = 0n
		let assigned = 0n
		let paid = 0n
		for (const budget of [2n, 7n, 9n, 3n, 11n, 19n]) {
			const {
				result: [rep, commitment, cost],
			} = await fill(budget)
			expect(cost).toBe((rep * 3n + 1n) / 2n)
			expect(cost).toBeLessThanOrEqual(budget)
			sold += rep
			assigned += commitment
			paid += cost
			expect(assigned).toBe(47n - ((101n - sold) / 2n > 47n ? 47n : (101n - sold) / 2n))
			expect((47n - assigned) * 2n).toBeLessThanOrEqual(101n - sold)
		}
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(47n - assigned)
		expect(await getETHBalance(owner, auction)).toBe(paid)
	})

	test('zero-sale and zero-fill auctions finalize at their original end without fabricated ownership', async () => {
		await deploy({ missingCashAttoEth: 0n })
		await ethereum.setTime(choiceDeadline)
		expect(await quote(unit)).toEqual([0n, 0n, 0n])
		await ethereum.setTime(recapitalizationDeadline)
		await finalize()
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'retainedCommitmentAttoEth' })).toBe(100n * unit)
		await deploy({ unchosenRepAttoRep: 0n, maximumCommitmentAttoEth: 0n })
		await finalize()
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(0n)
		await expect(deploy({ unchosenRepAttoRep: 0n })).rejects.toThrow('Empty inventory has commitment')
		await expect(deploy({ startingPriceAttoEthPerRep: 0n })).rejects.toThrow('Recap starting price is below reserve')
		await expect(deploy({ maximumCommitmentAttoEth: 501n * unit })).rejects.toThrow('Recap reserve cannot back commitment')
		await expect(deploy({ referencePriceAttoRepPerEth: 0n })).rejects.toThrow('Recap reference price is zero')
	})

	test('fill and finalization gas are constant after hundreds of prior buyers', async () => {
		await deploy({ unchosenRepAttoRep: 1_000_000n, missingCashAttoEth: 100_000n, maximumCommitmentAttoEth: 100_000n })
		await ethereum.setTime(choiceDeadline)
		const first = await fill(10n)
		let sold = first.result[0]
		let paid = first.result[2]
		for (let index = 0; index < 256; index++) {
			const { result } = await fill(10n)
			sold += result[0]
			paid += result[2]
		}
		const last = await fill(10n)
		sold += last.result[0]
		paid += last.result[2]
		expect(last.receipt.gasUsed).toBeLessThanOrEqual(first.receipt.gasUsed)
		expect(last.receipt.gasUsed).toBeLessThan(100_000n)
		await ethereum.setTime(recapitalizationDeadline)
		const receipt = await owner.waitForTransactionReceipt({ hash: await finalize() })
		expect(receipt.gasUsed).toBeLessThan(75_000n)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'soldAttoRep' })).toBe(sold)
		expect(await owner.readContract({ abi: artifact.abi, address: auction, functionName: 'raisedAttoEth' })).toBe(paid)
		expect(await getETHBalance(owner, auction)).toBe(paid)
		if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ recapFillGas: last.receipt.gasUsed, recapFinalizeGas: receipt.gasUsed })
	})
})
