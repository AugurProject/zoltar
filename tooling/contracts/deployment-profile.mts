export type DeploymentProfile = 'minimal' | 'with-quote-venues'

export function parseDeploymentProfile(value: string | undefined): DeploymentProfile {
	const profile = value ?? 'minimal'
	if (profile !== 'minimal' && profile !== 'with-quote-venues') throw new Error('DEPLOYMENT_PROFILE must be "minimal" or "with-quote-venues"')
	return profile
}
