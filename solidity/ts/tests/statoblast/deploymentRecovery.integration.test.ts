import { describe, expect, test } from 'bun:test'
import { encodeDeployData, RpcError } from '@zoltar/core-shared/evm/ethereum'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { MAINNET_NETWORK_PROFILE, resetRuntimeNetworkProfile, setRuntimeNetworkProfile } from '../../../../ui/coreShared/ts/wallet/networkProfile.js'
import { recoverSecurityPoolDeployment, readSecurityPoolCreationCount } from '../../../../ui/statoblastShared/ts/protocol/deploymentRecovery.js'
import { securityPoolAddressFromCreationReceipt, securityPoolCreationRequest } from '../../../../ui/statoblastShared/ts/protocol/securityPool.js'
import { deployContract } from '../../testSupport/deployContract'
import { statoblast_SecurityPoolOpenAdmissionPolicy_SecurityPoolOpenAdmissionPolicy as openRules } from '../../types/contractArtifact'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { GENESIS_REPUTATION_TOKEN } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { maximumQuestionHorizonSeconds, securityPoolEconomics } from './securityPoolFixture'
import { useSecurityPoolProtocolFixture } from './securityPoolProtocolFixture'

describe('deployment recovery against the canonical factory', () => {
	const fixture = useSecurityPoolProtocolFixture()

	test('derives a mined pool address and reads the per-creator counter from Anvil', async () => {
		setRuntimeNetworkProfile({ ...MAINNET_NETWORK_PROFILE, genesisRepTokenAddress: addressString(GENESIS_REPUTATION_TOKEN) })
		try {
			const client = fixture.client
			const owner = client.account.address
			const factory = getInfraContractAddresses().securityPoolFactory
			const rules = await deployContract(client, encodeDeployData({ abi: openRules.abi, bytecode: `0x${openRules.evm.bytecode.object}` }))
			const request = securityPoolCreationRequest(
				owner,
				{
					collateralToken: MAINNET_NETWORK_PROFILE.wethAddress,
					minimumReportCollateral: 10n ** 16n,
					universeId: fixture.genesisUniverse,
					securityMultiplierBps: fixture.statoblastSecurityMultiplierBps,
					reportPriorityFeeAttoEthPerGas: DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
				},
				maximumQuestionHorizonSeconds,
				rules,
				securityPoolEconomics,
			)
			expect(request.to).toBe(factory)
			const countBefore = await readSecurityPoolCreationCount(client, owner)
			expect(countBefore).toBe(0n)
			const hash = await client.sendTransaction({ ...request, gas: 16_777_216n })
			const receipt = await client.waitForTransactionReceipt({ hash })
			expect(receipt.status).toBe('success')
			expect(await readSecurityPoolCreationCount(client, owner, receipt.blockNumber)).toBe(1n)
			const minedNonce = (await client.getTransaction({ hash })).nonce
			const deployedPool = securityPoolAddressFromCreationReceipt(receipt)
			await fixture.mockWindow.request({ method: 'anvil_mine', params: ['0xc'] })
			// Simulate a transport which only serves numbered blocks or latest while forwarding all state reads to Anvil.
			const reader = {
				...client,
				getBlock: (options?: Parameters<typeof client.getBlock>[0]) => {
					if (options?.blockTag === 'finalized' || options?.blockTag === 'safe') throw new RpcError(`upstream: ${options.blockTag} block not found`, { code: -32000 })
					return client.getBlock(options)
				},
			}
			expect(await recoverSecurityPoolDeployment(reader, owner, minedNonce, request, countBefore)).toEqual({ pool: deployedPool })
			expect(await recoverSecurityPoolDeployment(reader, owner, minedNonce, request)).toEqual({ pool: deployedPool })
		} finally {
			resetRuntimeNetworkProfile()
		}
	})
})
