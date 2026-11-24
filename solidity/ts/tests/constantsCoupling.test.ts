import { beforeAll, describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	test_ConstantsCouplingHarness_ConstantsCouplingHarness as harnessArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolPurchase_SecurityPoolPurchase as purchaseArtifact,
	statoblast_SecurityPoolResolutionPremiumBook_SecurityPoolResolutionPremiumBook as premiumArtifact,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer as bookDeployerArtifact,
} from '../types/contractArtifact'
import { deployContract } from '../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'

const DAY = 86_400n
const WEEK = 7n * DAY
// Fee-end keys are bucket numbers below FEE_END_LIMIT / granularity; the redemption gas bound assumes at most 17 levels.
const MAXIMUM_FEE_END_LEVELS = 17n
const contractsRoot = join(import.meta.dir, '../../contracts')

// #1479: these safety properties depend on separately named constants agreeing or staying ordered.
describe('protocol constant coupling', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let client: WriteClient

	beforeAll(async () => {
		const ethereum = getAnvilWindowEthereum()
		await setupTestAccounts(ethereum)
		client = createWriteClient(ethereum, TEST_ADDRESSES[0])
	})

	// Public contract constants do not depend on storage or immutables, so runtime code at a scratch address serves them.
	const installRuntime = async (artifact: { evm: { deployedBytecode: { object: string } } }, address: Address) => {
		const runtime = artifact.evm.deployedBytecode.object.replace(/__\$[0-9a-f]{34}\$__/g, '0'.repeat(40))
		await getAnvilWindowEthereum().request({ method: 'anvil_setCode', params: [address, `0x${runtime}`] })
		return address
	}

	test('the fork response, premium window, payout split, fee-end depth and clone layout stay coupled', async () => {
		const harness = await deployContract(client, encodeDeployData({ abi: harnessArtifact.abi, bytecode: `0x${harnessArtifact.evm.bytecode.object}` }))
		const constants = await client.readContract({ abi: harnessArtifact.abi, address: harness, functionName: 'coupling' })
		const book = await installRuntime(bookArtifact, '0x0000000000000000000000000000000000c01001')
		const purchase = await installRuntime(purchaseArtifact, '0x0000000000000000000000000000000000c01002')
		const premium = await installRuntime(premiumArtifact, '0x0000000000000000000000000000000000c01003')
		const bookDeployer = await installRuntime(bookDeployerArtifact, '0x0000000000000000000000000000000000c01004')
		const feeEndLimit = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'FEE_END_LIMIT' })
		const resolutionWindow = await client.readContract({ abi: purchaseArtifact.abi, address: purchase, functionName: 'RESOLUTION_WINDOW' })
		const maximumReportingWindow = await client.readContract({ abi: premiumArtifact.abi, address: premium, functionName: 'MAXIMUM_REPORTING_WINDOW' })
		const feeEndGranularity = await client.readContract({ abi: bookDeployerArtifact.abi, address: bookDeployer, functionName: 'FEE_END_GRANULARITY' })

		// One three-day response period: game activation and fixed-outcome inherited finality.
		expect(constants.forkResponseDelay).toBe(3n * DAY)
		expect(constants.activationDelay).toBe(constants.forkResponseDelay)
		// A child universe cannot fork again before inherited outcomes finalize.
		expect(constants.forkResponseTime).toBeGreaterThan(constants.forkResponseDelay)
		// The premium is paid and streamed over the same window: activation delay plus escalation length.
		expect(constants.escalationTimeLength).toBe(7n * WEEK)
		expect(constants.resolutionPremiumWindow).toBe(constants.forkResponseDelay + constants.escalationTimeLength)
		expect(resolutionWindow).toBe(constants.resolutionPremiumWindow)
		expect(BigInt(maximumReportingWindow)).toBe(constants.resolutionPremiumWindow)
		// Bonus and burn split binding capital; after an own-question fork the child escrow (2N − T/d)
		// covers winners (N + bonus) only when the minimum burn divisor is large enough.
		expect(constants.winnerBonusNumerator + constants.burnNumerator).toBe(constants.payoutDenominator)
		expect(constants.minimumForkBurnDivisor * (constants.payoutDenominator - constants.winnerBonusNumerator)).toBeGreaterThanOrEqual(2n * constants.payoutDenominator)
		// The fee-end granularity keeps every bucket number within the 17-level gas bound.
		expect(((BigInt(feeEndLimit) - 1n) / BigInt(feeEndGranularity)).toString(2).length).toBeLessThanOrEqual(Number(MAXIMUM_FEE_END_LEVELS))
		// Auction vault bindings start right after the shared forwarder prologue.
		expect(constants.repairAuctionVaultRuntimeLength).toBe(constants.forwarderLength + constants.repairAuctionVaultBindingsLength)
	})

	test('the three-day response is defined once and not repeated as a literal', async () => {
		const files = (await readdir(contractsRoot, { recursive: true })).filter(file => file.endsWith('.sol') && !file.startsWith('test') && !file.includes('openOracle'))
		const repeated: string[] = []
		for (const file of files) {
			const lines = (await readFile(join(contractsRoot, file), 'utf8')).split('\n')
			for (const [index, line] of lines.entries()) {
				if (/\b3 days\b/.test(line.replace(/\/\/.*$/, '')) && !line.includes('FORK_RESPONSE_DELAY = 3 days')) repeated.push(`${file}:${index + 1}`)
			}
		}
		expect(repeated).toEqual([])
	})
})
