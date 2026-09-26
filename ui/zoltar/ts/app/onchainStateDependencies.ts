import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

// Zoltar never uses WETH, so it neither reads nor reports the wallet's WETH balance.
export const onchainStateDependencies = { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance }
