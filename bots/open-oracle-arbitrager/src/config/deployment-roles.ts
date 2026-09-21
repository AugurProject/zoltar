/** The canonical deployments live execution depends on, keyed the way the checklist, the inspection, and the snapshot decoder share them. */
export const deploymentRoles = ['open-oracle', 'security-pool-factory', 'uniswap-factory', 'uniswap-quoter', 'uniswap-router', 'uniswap-v2-router', 'uniswap-v4-pool-manager', 'uniswap-v4-quoter', 'weth'] as const

export type DeploymentRole = (typeof deploymentRoles)[number]

/** Which deployments a venue selection needs: the core contracts always, plus each enabled Uniswap version's contracts. */
export function requiredDeploymentRoles(venues: { v2: boolean; v3: boolean; v4: boolean }): readonly DeploymentRole[] {
	return ['open-oracle', 'weth', 'security-pool-factory', ...(venues.v3 ? (['uniswap-factory', 'uniswap-quoter', 'uniswap-router'] as const) : []), ...(venues.v2 ? (['uniswap-v2-router'] as const) : []), ...(venues.v4 ? (['uniswap-v4-pool-manager', 'uniswap-v4-quoter'] as const) : [])]
}
