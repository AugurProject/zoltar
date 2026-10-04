import { booleanField, compact, operationClassificationField, publicStrings, record, stringField } from './public-fields.ts'

function publicCandidateCount(value: unknown) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined
	const count = BigInt(value)
	return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString()
}

function publicEvaluation(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	const definition = record(source['definition']) ?? source
	const eligibility = record(source['eligibility']) ?? source
	const plan = record(source['plan'])
	return compact({
		blockers: publicStrings(eligibility['blockers']),
		candidateCount: publicCandidateCount(source['candidateCount']) ?? (plan === undefined ? 0 : 1),
		classification: operationClassificationField(definition, 'classification') ?? operationClassificationField(source, 'classification'),
		description: stringField(definition, 'description'),
		ecosystem: stringField(definition, 'ecosystem'),
		eligible: booleanField(eligibility, 'eligible'),
		enabled: booleanField(source, 'enabled'),
		id: stringField(definition, 'id'),
		independentlyExecutable: booleanField(definition, 'independentlyExecutable') ?? booleanField(source, 'independentlyExecutable'),
		label: stringField(definition, 'label'),
		randomAllowed: booleanField(source, 'randomAllowed'),
		randomEligible: booleanField(source, 'randomEligible'),
		lifecycleEligible: booleanField(source, 'lifecycleEligible'),
		prerequisites: publicStrings(source['prerequisites']),
		risk: stringField(definition, 'risk'),
	})
}

export function groupedPublicEvaluations(value: unknown) {
	if (!Array.isArray(value)) return []
	const grouped = new Map<string, Record<string, unknown>>()
	for (const entry of value) {
		const projected = publicEvaluation(entry)
		if (projected === undefined) continue
		const source = record(projected)
		if (source === undefined) continue
		const key = [stringField(source, 'id') ?? '', stringField(source, 'ecosystem') ?? '', stringField(source, 'label') ?? '', stringField(source, 'classification') ?? ''].join('\u0000')
		const previous = grouped.get(key)
		if (previous === undefined) {
			grouped.set(key, source)
			continue
		}
		const previousCount = publicCandidateCount(previous['candidateCount']) ?? 0
		const currentCount = publicCandidateCount(source['candidateCount']) ?? 0
		const totalCount = BigInt(previousCount) + BigInt(currentCount)
		previous['candidateCount'] = totalCount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalCount) : totalCount.toString()
		previous['blockers'] = [...new Set([...publicStrings(previous['blockers']), ...publicStrings(source['blockers'])])]
		previous['prerequisites'] = [...new Set([...publicStrings(previous['prerequisites']), ...publicStrings(source['prerequisites'])])]
		for (const field of ['randomAllowed', 'randomEligible', 'lifecycleEligible']) {
			if (previous[field] !== undefined || source[field] !== undefined) previous[field] = previous[field] === true || source[field] === true
		}
		previous['eligible'] = previous['eligible'] === true || source['eligible'] === true
		if (previous['enabled'] === true || source['enabled'] === true) previous['enabled'] = true
		else if (previous['enabled'] === false || source['enabled'] === false) previous['enabled'] = false
	}
	return [...grouped.values()]
}
