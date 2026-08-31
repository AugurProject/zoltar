import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '../protocol/deployment.js'
import { getWethAddress } from '../protocol/uniswapQuoter.js'

export const onchainStateDependencies = { getDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot, loadErc20Balance }
