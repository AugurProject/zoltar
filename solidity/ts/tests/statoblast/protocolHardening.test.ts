import { describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import * as artifacts from '../../types/contractArtifact'
import { existsSync } from 'node:fs'
import { statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier as verifierArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact } from '../../types/contractArtifact'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('protocol boundary hardening', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('#1355 rejects native ETH at every ERC20 portfolio custody module', async () => {
		await fixture.register(fixture.base.questionId)
		const owner = fixture.owner()
		const target = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const addresses = [fixture.portfolio, fixture.poolFor(fixture.base.questionId).securityPool, await owner.readContract({ ...target, functionName: 'forkController' }), await owner.readContract({ ...target, functionName: 'services' })]
		for (const to of addresses) {
			const before = await owner.getBalance({ address: to })
			await expect(writeContractAndWait(owner, () => owner.sendTransaction({ to, value: 1n }))).rejects.toThrow()
			expect(await owner.getBalance({ address: to })).toBe(before)
		}
	})
	test('#1357 rejects a zero logarithm denominator without exhausting gas', async () => {
		await expect(fixture.owner().readContract({ abi: verifierArtifact.abi, address: getInfraContractAddresses().escalationGameProofVerifier, functionName: 'computeLnRatioScaled', args: [0n, 1n], gas: 100_000n })).rejects.toThrow('Invalid logarithm inputs')
	})
	test('#1357 rejects an attrition exponent that cannot fit its fixed-point word', async () => {
		await expect(fixture.owner().readContract({ abi: verifierArtifact.abi, address: getInfraContractAddresses().escalationGameProofVerifier, functionName: 'computeIterativeAttritionCostAttoRep', args: [1n, (1n << 256n) - 1n, 500n * 693_147n, 1n, 2n] })).rejects.toThrow('Attrition exponent too large')
	})
	test('#1357 accepts the complete clock domain and rejects timestamp truncation', async () => {
		const artifact = artifacts.test_CheckedCastHarness_CheckedCastHarness
		const address = await deployContract(fixture.owner(), encodeDeployData({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` }))
		const target = { abi: artifact.abi, address }
		expect(await fixture.owner().readContract({ ...target, functionName: 'toUint48', args: [(1n << 48n) - 1n] })).toBe((1n << 48n) - 1n)
		await expect(fixture.owner().readContract({ ...target, functionName: 'toUint48', args: [1n << 48n] })).rejects.toThrow('Timestamp exceeds uint48')
	})
	test('#1357 handles full-width logarithm inputs without overflowing the normalization loop', async () => {
		const result = await fixture.owner().readContract({ abi: verifierArtifact.abi, address: getInfraContractAddresses().escalationGameProofVerifier, functionName: 'computeLnRatioScaled', args: [1n, (1n << 256n) - 1n] })
		expect(result).toBeGreaterThan(177_000_000n)
		expect(result).toBeLessThan(178_000_000n)
	})
	test('#1356 excludes the unused per-pool migration proxy from production sources', () => {
		expect(existsSync(new URL('../../../contracts/statoblast/SecurityPoolMigrationProxy.sol', import.meta.url))).toBe(false)
		expect(Object.keys(artifacts).some(name => name.includes('SecurityPoolMigrationProxy'))).toBe(false)
	})
})
