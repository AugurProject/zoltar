import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '@zoltar/ui-statoblast-shared/protocol/index.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'

export const onchainStateDependencies = { getDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot, loadErc20Balance }
