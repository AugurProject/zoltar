import { createHash } from 'node:crypto'
import type { Address } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from './settings.ts'

export function deploymentFactoryId(profileId: string, factory: Address) {
	return `factory:v1:${createHash('sha256')
		.update(JSON.stringify({ profileId, factory: factory.toLowerCase() }))
		.digest('hex')}`
}

export function executionProfileId(settings: Pick<OperatorSettings, 'deployment' | 'network'>) {
	const deployment = {
		openOracle: settings.deployment.openOracle.toLowerCase(),
		questionData: settings.deployment.questionData.toLowerCase(),
		securityPoolFactory: settings.deployment.securityPoolFactory.toLowerCase(),
		securityPoolForker: settings.deployment.securityPoolForker.toLowerCase(),
		tradingFactory: settings.deployment.tradingFactory.toLowerCase(),
		tradingRouter: settings.deployment.tradingRouter.toLowerCase(),
		weth: settings.deployment.weth.toLowerCase(),
		zoltar: settings.deployment.zoltar.toLowerCase(),
	}
	return `profile:v1:${createHash('sha256')
		.update(JSON.stringify({ chainId: settings.network.chainId, deployment }))
		.digest('hex')}`
}
