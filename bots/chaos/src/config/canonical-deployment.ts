import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { DeploymentSettings } from './settings.ts'
import { tradingRootDeploymentPlans } from '../operations/trading.ts'

export function canonicalDeployment(chainId: number): DeploymentSettings {
	const core = canonicalCoreDeployment(chainId === 1 ? mainnet : sepolia)
	const trading = tradingRootDeploymentPlans(core.securityPoolFactory)
	return {
		openOracle: core.openOracle,
		questionData: core.questionData,
		securityPoolFactory: core.securityPoolFactory,
		securityPoolForker: core.securityPoolForker,
		tradingFactory: trading.factoryAddress,
		tradingRouter: trading.routerAddress,
		uniswapV3Factory: canonicalUniswapDeployment(chainId).factory,
		weth: core.weth,
		zoltar: core.zoltar,
	}
}

// Sepolia deployment from the manifest preceding 917babb8c. Existing unpinned
// operators need its roots and Uniswap factory to resume their durable state.
export function legacyDeploymentForProfile(chainId: number, profileId: string): DeploymentSettings | undefined {
	if (chainId !== 11_155_111 || profileId !== 'profile:v1:831bd7a49fd68a696ac753b612ce41ec5c50580b093ab8e1e5151a26883e29ae') return undefined
	return {
		openOracle: getAddress('0x37aB1c474fef602D1C7278C2093677002c9a3618'),
		questionData: getAddress('0x98927dA4cD6C97d95c8CC97E77948389a84559fC'),
		securityPoolFactory: getAddress('0x407de3551D9E87539E77eC6Fc188FDCb94C99429'),
		securityPoolForker: getAddress('0x6a954a41ae4aDE34480a08F11636D40DF9C0498B'),
		tradingFactory: getAddress('0x93339B00B128ffa8801B5996c43c054AF6378944'),
		tradingRouter: getAddress('0xeF12F6aFb428De1E191Aa5953C55280fD3DB05a4'),
		uniswapV3Factory: getAddress('0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4'),
		weth: getAddress('0x65156FD21726b8efcB627fa38c506E3f3542F601'),
		zoltar: getAddress('0xfAa07F49C2d97DCD49b7a2c1Ce34E0735896b626'),
	}
}
