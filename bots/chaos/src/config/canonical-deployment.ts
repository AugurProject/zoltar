import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { DeploymentSettings } from './settings.ts'
import { tradingRootDeploymentPlans } from '../operations/trading.ts'

// These manifests are generated from the canonical CREATE2 init-code graph and
// checked against current compiler output by check:mainnet-deployment:generated.
export function canonicalDeployment(chainId: number): DeploymentSettings {
	// The canonical test deployment uses the same CREATE2 init code on every
	// non-mainnet chain; only mainnet uses the existing mainnet REP and WETH.
	const manifest = chainId === 1 ? mainnet : sepolia
	const address = (id: string) => {
		const step = [...manifest.deploymentSteps, ...manifest.derivedContracts].find(step => step.id === id)
		if (step === undefined) throw new Error(`Canonical CREATE2 manifest is missing ${id}`)
		return getAddress(step.address)
	}
	const core = {
		zoltar: address('zoltar'),
		questionData: address('zoltarQuestionData'),
		openOracle: address('openOracle'),
		securityPoolFactory: address('securityPoolFactory'),
		securityPoolForker: address('securityPoolForker'),
		weth: getAddress(manifest.network.wethAddress),
		uniswapV3Factory: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
	}
	const trading = tradingRootDeploymentPlans(core.securityPoolFactory)
	return { ...core, tradingFactory: trading.factoryAddress, tradingRouter: trading.routerAddress }
}
