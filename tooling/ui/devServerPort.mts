import type { UiAppId } from './appPaths.mts'

const DEFAULT_PORTS: Record<UiAppId, number> = { statoblast: 12347, trading: 4163, zoltar: 4153 }

/** The app's fixed development port, unless `UI_DEV_SERVER_PORT` overrides it; 0 picks a free port for tools that need their own server. */
export function resolveDevServerPort(appId: UiAppId, override: string | undefined = process.env['UI_DEV_SERVER_PORT']): number {
	if (override === undefined) return DEFAULT_PORTS[appId]
	const port = /^\d+$/.test(override) ? Number(override) : Number.NaN
	if (!Number.isInteger(port) || port > 65_535) throw new Error(`Invalid UI_DEV_SERVER_PORT '${override}'; expected a port number from 0 to 65535.`)
	return port
}
