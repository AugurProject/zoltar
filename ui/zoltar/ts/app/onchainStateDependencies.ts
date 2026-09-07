import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '@zoltar/ui-zoltar-domain/protocol/deployment.js'
import { getWethAddress } from '@zoltar/ui-zoltar-domain/protocol/uniswapQuoter.js'

export const onchainStateDependencies = { getDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot, loadErc20Balance }
