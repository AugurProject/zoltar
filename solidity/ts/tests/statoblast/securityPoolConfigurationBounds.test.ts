import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, parseAbiParameters, encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact } from '../../types/contractArtifact'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { useSecurityPoolFixture, securityPoolEconomics, maximumQuestionHorizonSeconds } from './securityPoolFixture'

const inputs = parseAbiParameters('address,uint256,uint248,uint256,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint48')
const max128 = (1n << 128n) - 1n
const maxRep = 11_000_000n * 10n ** 18n

describe('security pool absolute configuration bounds', () => {
	const f = useSecurityPoolFixture()
	const deploy = async (changes: { floor?: bigint; multiplier?: bigint; commitment?: bigint; fee?: bigint }) => {
		const client = f.owner()
		const policy = await client.readContract({ abi: poolArtifact.abi, address: f.securityPool, functionName: 'questionAdmissionPolicy' })
		const collateral = await client.readContract({ abi: poolArtifact.abi, address: f.securityPool, functionName: 'collateralToken' })
		const e = securityPoolEconomics
		const configuration = encodeAbiParameters(inputs, [
			collateral,
			changes.floor ?? 10n ** 16n,
			f.base.genesisUniverse,
			changes.multiplier ?? 20_000n,
			10_000_000_000n,
			maximumQuestionHorizonSeconds,
			policy,
			e.purchaseFeeBps,
			e.annualFeeBps,
			changes.fee ?? e.minimumPurchaseFeeAttoEth,
			changes.commitment ?? e.minimumCommitmentAttoEth,
			e.minimumOutcomeRate,
			e.rewardVestingSeconds,
		])
		return client.simulateContract({ abi: factoryArtifact.abi, address: getInfraContractAddresses().securityPoolFactory, functionName: 'deploySecurityPool', args: [`0x${poolArtifact.evm.bytecode.object}`, configuration] })
	}
	test('#1725 rejects an immutable fee exceeding an empty stream capacity', async () => {
		await expect(deploy({ fee: max128 + 1n })).rejects.toThrow('Minimum purchase fee exceeds fee stream capacity')
		await expect(deploy({ fee: max128 })).resolves.toBeDefined()
	})
	test('#1625 enforces the configured report halt range at deployment', async () => {
		await expect(deploy({ floor: max128 / 10n + 1n })).rejects.toThrow('Invalid report collateral floor')
		await expect(deploy({ floor: max128 / 10n })).resolves.toBeDefined()
	})
	test('#1647 rejects impossible commitments and REP grids', async () => {
		for (const multiplier of [maxRep * 10_000n + 1n, maxRep + 1n]) await expect(deploy({ multiplier })).rejects.toThrow('REP supply')
		await expect(deploy({ multiplier: maxRep * 10_000n })).resolves.toBeDefined()
		const maximum = 100n * (max128 - 10n ** 16n)
		await expect(deploy({ commitment: maximum + 1n })).rejects.toThrow('Minimum commitment exceeds report exposure')
		await expect(deploy({ commitment: maximum })).resolves.toBeDefined()
	})
	test('#1626 rejects empty lifecycle and auction delegates', async () => {
		for (const name of ['lifecycleDelegate', 'repairAuctionDelegate'] as const) {
			const lifecycle = await f.owner().readContract({ abi: capitalArtifact.abi, address: f.capitalLedger, functionName: 'lifecycleDelegate' })
			const auction = await f.owner().readContract({ abi: capitalArtifact.abi, address: f.capitalLedger, functionName: 'repairAuctionDelegate' })
			const data = encodeDeployData({ abi: capitalArtifact.abi, bytecode: `0x${capitalArtifact.evm.bytecode.object}`, args: [f.securityPool, getZoltarAddress(), 20_000n, 1n, name === 'lifecycleDelegate' ? zeroAddress : lifecycle, name === 'repairAuctionDelegate' ? zeroAddress : auction] })
			await expect(f.owner().call({ data })).rejects.toThrow('Capital delegate has no code')
		}
	})
})
