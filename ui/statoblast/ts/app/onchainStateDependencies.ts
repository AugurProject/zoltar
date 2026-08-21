import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '../protocol/index.js'
import { getWethAddress } from '@zoltar/ui-zoltar/protocol/uniswapQuoter.js'

export const onchainStateDependencies = { getDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot, loadErc20Balance }
