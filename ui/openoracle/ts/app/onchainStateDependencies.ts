import { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { getOpenOracleDeploymentSteps, loadOpenOracleDeploymentStatus } from '../protocol/deployment.js'

export const onchainStateDependencies = { getDeploymentSteps: getOpenOracleDeploymentSteps, getWethAddress, loadDeploymentStatusOracleSnapshot: loadOpenOracleDeploymentStatus, loadErc20Balance }
