import { expect, test } from 'bun:test'
import example from '../../config/operator.example.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import { parseSettings, serializedSettings } from '../../src/config/settings.ts'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'

test('derives canonical addresses without configuration placeholders', () => {
	for (const manifest of [mainnet, sepolia]) {
		const settings = parseSettings({ ...example, network: { ...example.network, name: manifest.network.id, chainId: manifest.network.chainId } })
		const root = manifest.deploymentSteps.find(step => step.id === 'zoltar')
		if (root === undefined) throw new Error('Missing canonical Zoltar deployment')
		expect(settings.deployment.zoltar).toBe(getAddress(root.address))
		expect(settings.deployment.weth).toBe(getAddress(manifest.network.wethAddress))
		for (const address of Object.values(settings.deployment)) expect(address).not.toBe(zeroAddress)
	}
})

test('ignores obsolete address overrides and omits them from saved configuration', () => {
	const supplied = '0x0000000000000000000000000000000000000001'
	const settings = parseSettings({ ...example, deployment: { zoltar: supplied } })
	expect(settings.deployment.zoltar).not.toBe(supplied)
	expect(serializedSettings(settings)).not.toHaveProperty('deployment')
	expect(Object.values(parseSettings({ ...example, network: { ...example.network, kind: 'custom', name: 'Local test', chainId: 31337 } }).deployment)).not.toContain(zeroAddress)
})
