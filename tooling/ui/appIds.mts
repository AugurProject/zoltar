export const UI_APP_IDS = ['zoltar', 'statoblast', 'trading'] as const
export type UiAppId = (typeof UI_APP_IDS)[number]

export function isUiAppId(candidate: string): candidate is UiAppId {
	return UI_APP_IDS.some(app => app === candidate)
}

export function parseUiAppId(candidate: string | undefined, context: string): UiAppId {
	if (candidate === undefined || candidate === '') throw new Error(`Missing UI app ID for ${context}; expected one of: ${UI_APP_IDS.join(', ')}`)
	if (!isUiAppId(candidate)) throw new Error(`Unknown UI app ID '${candidate}' for ${context}; expected one of: ${UI_APP_IDS.join(', ')}`)
	return candidate
}
