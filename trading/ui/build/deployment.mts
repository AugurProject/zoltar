import path from 'node:path'

export function resolveDeploymentSource(value: string | undefined): string | undefined {
	return value === undefined || value.trim() === '' ? undefined : path.resolve(value)
}
