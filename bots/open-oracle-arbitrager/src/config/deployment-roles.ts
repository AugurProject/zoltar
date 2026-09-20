/** The canonical deployments live execution depends on, keyed the way the checklist, the inspection, and the snapshot decoder share them. */
export const deploymentRoles = ['open-oracle', 'security-pool-factory', 'uniswap-factory', 'uniswap-quoter', 'uniswap-router', 'uniswap-v2-router', 'uniswap-v4-pool-manager', 'uniswap-v4-quoter', 'weth'] as const

export type DeploymentRole = (typeof deploymentRoles)[number]
