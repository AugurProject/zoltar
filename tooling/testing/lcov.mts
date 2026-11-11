import { isAbsolute, relative } from 'node:path'

export type LcovRecord = {
	file: string
	lineHits: Map<number, number>
	functions: {
		covered: number
		total: number
		definitions?: Map<string, number>
		hits?: Map<string, number>
	}
	branches?: {
		covered: number
		total: number
		hits?: Map<string, number | undefined>
	}
}

export function normalizePath(filePath: string, repositoryRoot = process.cwd()) {
	const normalized = filePath.replaceAll('\\', '/')
	if (!isAbsolute(normalized)) return normalized.replace(/^\.\//, '')
	return relative(repositoryRoot, normalized).replaceAll('\\', '/')
}

export function parseLcov(contents: string, repositoryRoot = process.cwd()) {
	const records = new Map<string, LcovRecord>()
	let currentFile: string | undefined
	let lineHits = new Map<number, number>()
	let functionTotal = 0
	let functionCovered = 0
	let branchTotal = 0
	let branchCovered = 0
	let sawBranchData = false
	let declaredLines: number | undefined
	let declaredCoveredLines: number | undefined
	let declaredBranches: number | undefined
	let declaredCoveredBranches: number | undefined
	let declaredFunctions = false
	let declaredCoveredFunctions = false
	let recordTerminated = true
	const branchIdentities = new Set<string>()
	const branchHits = new Map<string, number | undefined>()
	const functionDefinitions = new Set<string>()
	const functionDefinitionLines = new Map<string, number>()
	const functionHits = new Map<string, number>()
	const parseNonNegativeInteger = (text: string, label: string) => {
		if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new Error(`Invalid LCOV ${label}: ${text}`)
		const value = Number(text)
		if (!Number.isSafeInteger(value)) throw new Error(`Invalid LCOV ${label}: ${text}`)
		return value
	}

	const finishRecord = () => {
		if (currentFile === undefined) return
		if (!recordTerminated) throw new Error(`Unterminated LCOV record: ${currentFile}`)
		if (records.has(currentFile)) throw new Error(`Duplicate LCOV SF record: ${currentFile}`)
		if (declaredLines === undefined || declaredCoveredLines === undefined) throw new Error(`LCOV record is missing LF/LH totals: ${currentFile}`)
		if (!declaredFunctions || !declaredCoveredFunctions) throw new Error(`LCOV record is missing FNF/FNH totals: ${currentFile}`)
		const hasDetailedFunctionEvidence = functionDefinitions.size > 0 || functionHits.size > 0
		if (hasDetailedFunctionEvidence && (functionDefinitions.size !== functionTotal || functionHits.size !== functionTotal || [...functionHits.keys()].some(name => !functionDefinitions.has(name)))) throw new Error(`LCOV FNF total does not match FN/FNDA entries: ${currentFile}`)
		if (hasDetailedFunctionEvidence && [...functionHits.values()].filter(hits => hits > 0).length !== functionCovered) throw new Error(`LCOV FNH total does not match FNDA entries: ${currentFile}`)
		const coveredLines = [...lineHits.values()].filter(hits => hits > 0).length
		if (declaredLines !== lineHits.size || declaredCoveredLines !== coveredLines) throw new Error(`LCOV LF/LH totals do not match DA entries: ${currentFile}`)
		if (functionCovered > functionTotal) throw new Error(`LCOV FNH exceeds FNF: ${currentFile}`)
		if ((sawBranchData || declaredBranches !== undefined || declaredCoveredBranches !== undefined) && (declaredBranches !== branchTotal || declaredCoveredBranches !== branchCovered)) throw new Error(`LCOV BRF/BRH totals do not match BRDA entries: ${currentFile}`)
		records.set(currentFile, {
			file: currentFile,
			lineHits,
			functions: {
				covered: functionCovered,
				total: functionTotal,
				...(hasDetailedFunctionEvidence ? { definitions: new Map(functionDefinitionLines), hits: new Map(functionHits) } : {}),
			},
			...(sawBranchData ? { branches: { covered: branchCovered, total: branchTotal, hits: new Map(branchHits) } } : {}),
		})
		currentFile = undefined
		lineHits = new Map()
		functionTotal = 0
		functionCovered = 0
		branchTotal = 0
		branchCovered = 0
		sawBranchData = false
		declaredLines = undefined
		declaredCoveredLines = undefined
		declaredBranches = undefined
		declaredCoveredBranches = undefined
		declaredFunctions = false
		declaredCoveredFunctions = false
		branchIdentities.clear()
		branchHits.clear()
		functionDefinitions.clear()
		functionDefinitionLines.clear()
		functionHits.clear()
	}

	for (const line of contents.split(/\r?\n/)) {
		if (line.startsWith('SF:')) {
			if (currentFile !== undefined) finishRecord()
			currentFile = normalizePath(line.slice(3), repositoryRoot)
			if (currentFile === '') throw new Error('LCOV SF path must not be empty')
			recordTerminated = false
			continue
		}
		if (/^(?:LF|LH|FN|FNDA|FNF|FNH|BRDA|BRF|BRH):/.test(line) && currentFile === undefined) throw new Error(`LCOV record field appears outside a record: ${line}`)
		if (line.startsWith('DA:')) {
			if (currentFile === undefined) throw new Error('LCOV DA entry appears outside a record')
			const [lineNumberValue, hitCountValue] = line.slice(3).split(',', 2)
			const lineNumber = parseNonNegativeInteger(lineNumberValue ?? '', 'DA line')
			const hitCount = parseNonNegativeInteger(hitCountValue ?? '', 'DA hits')
			if (lineNumber === 0) throw new Error('LCOV DA line numbers must be positive')
			if (lineHits.has(lineNumber)) throw new Error(`Duplicate LCOV DA entry: ${lineNumber.toString()}`)
			lineHits.set(lineNumber, hitCount)
			continue
		}
		if (line.startsWith('LF:')) {
			if (declaredLines !== undefined) throw new Error('Duplicate LCOV LF declaration')
			declaredLines = parseNonNegativeInteger(line.slice(3), 'LF')
		}
		if (line.startsWith('LH:')) {
			if (declaredCoveredLines !== undefined) throw new Error('Duplicate LCOV LH declaration')
			declaredCoveredLines = parseNonNegativeInteger(line.slice(3), 'LH')
		}
		if (line.startsWith('FNF:')) {
			if (declaredFunctions) throw new Error('Duplicate LCOV FNF declaration')
			declaredFunctions = true
			functionTotal = parseNonNegativeInteger(line.slice(4), 'FNF')
			continue
		}
		if (line.startsWith('FN:')) {
			const separator = line.indexOf(',', 3)
			if (separator === -1) throw new Error(`Invalid LCOV FN entry: ${line}`)
			const functionLine = parseNonNegativeInteger(line.slice(3, separator), 'FN line')
			const name = line.slice(separator + 1)
			if (functionLine === 0 || name === '' || functionDefinitions.has(name)) throw new Error(`Invalid or duplicate LCOV FN entry: ${line}`)
			functionDefinitions.add(name)
			functionDefinitionLines.set(name, functionLine)
			continue
		}
		if (line.startsWith('FNDA:')) {
			const separator = line.indexOf(',', 5)
			if (separator === -1) throw new Error(`Invalid LCOV FNDA entry: ${line}`)
			const hits = parseNonNegativeInteger(line.slice(5, separator), 'FNDA hits')
			const name = line.slice(separator + 1)
			if (name === '' || functionHits.has(name)) throw new Error(`Invalid or duplicate LCOV FNDA entry: ${line}`)
			functionHits.set(name, hits)
			continue
		}
		if (line.startsWith('FNH:')) {
			if (declaredCoveredFunctions) throw new Error('Duplicate LCOV FNH declaration')
			declaredCoveredFunctions = true
			functionCovered = parseNonNegativeInteger(line.slice(4), 'FNH')
			continue
		}
		if (line.startsWith('BRDA:')) {
			sawBranchData = true
			const fields = line.slice(5).split(',')
			if (fields.length !== 4) throw new Error(`Invalid LCOV BRDA entry: ${line}`)
			const [lineText, blockText, branchText, taken] = fields
			if (parseNonNegativeInteger(lineText ?? '', 'BRDA line') === 0) throw new Error('LCOV BRDA line numbers must be positive')
			parseNonNegativeInteger(blockText ?? '', 'BRDA block')
			parseNonNegativeInteger(branchText ?? '', 'BRDA branch')
			const identity = fields.slice(0, 3).join(',')
			if (branchIdentities.has(identity)) throw new Error(`Duplicate LCOV BRDA entry: ${identity}`)
			branchIdentities.add(identity)
			branchHits.set(identity, taken === undefined || taken === '-' ? undefined : parseNonNegativeInteger(taken, 'BRDA taken'))
			branchTotal += 1
			if (taken !== undefined && taken !== '-' && parseNonNegativeInteger(taken, 'BRDA taken') > 0) branchCovered += 1
			continue
		}
		if (line.startsWith('BRF:')) {
			if (declaredBranches !== undefined) throw new Error('Duplicate LCOV BRF declaration')
			declaredBranches = parseNonNegativeInteger(line.slice(4), 'BRF')
		}
		if (line.startsWith('BRH:')) {
			if (declaredCoveredBranches !== undefined) throw new Error('Duplicate LCOV BRH declaration')
			declaredCoveredBranches = parseNonNegativeInteger(line.slice(4), 'BRH')
		}
		if (line === 'end_of_record') {
			if (currentFile === undefined) throw new Error('LCOV end_of_record appears outside a record')
			recordTerminated = true
			finishRecord()
		}
	}
	if (currentFile !== undefined) finishRecord()
	return records
}

export function mergeLcovRecords(collections: readonly Map<string, LcovRecord>[]) {
	const merged = new Map<string, LcovRecord>()
	for (const records of collections) {
		for (const [file, record] of records) {
			const existing = merged.get(file)
			if (existing === undefined) {
				merged.set(file, {
					...record,
					lineHits: new Map(record.lineHits),
					functions: {
						...record.functions,
						...(record.functions.definitions === undefined ? {} : { definitions: new Map(record.functions.definitions) }),
						...(record.functions.hits === undefined ? {} : { hits: new Map(record.functions.hits) }),
					},
					...(record.branches === undefined ? {} : { branches: { ...record.branches, ...(record.branches.hits === undefined ? {} : { hits: new Map(record.branches.hits) }) } }),
				})
				continue
			}
			for (const [lineNumber, hitCount] of record.lineHits) {
				existing.lineHits.set(lineNumber, (existing.lineHits.get(lineNumber) ?? 0) + hitCount)
			}
			if (existing.functions.definitions !== undefined && existing.functions.hits !== undefined && record.functions.definitions !== undefined && record.functions.hits !== undefined) {
				for (const [name, line] of record.functions.definitions) {
					const existingLine = existing.functions.definitions.get(name)
					if (existingLine !== undefined && existingLine !== line) throw new Error(`LCOV function ${name} has inconsistent definition lines in ${file}`)
					existing.functions.definitions.set(name, line)
				}
				for (const [name, hits] of record.functions.hits) existing.functions.hits.set(name, (existing.functions.hits.get(name) ?? 0) + hits)
				existing.functions.total = existing.functions.definitions.size
				existing.functions.covered = [...existing.functions.hits.values()].filter(hits => hits > 0).length
			} else {
				existing.functions.total = Math.max(existing.functions.total, record.functions.total)
				existing.functions.covered = Math.max(existing.functions.covered, record.functions.covered)
				delete existing.functions.definitions
				delete existing.functions.hits
			}
			if (record.branches !== undefined) {
				if (existing.branches === undefined) {
					existing.branches = { ...record.branches, ...(record.branches.hits === undefined ? {} : { hits: new Map(record.branches.hits) }) }
				} else if (existing.branches.hits !== undefined && record.branches.hits !== undefined) {
					for (const [identity, hits] of record.branches.hits) {
						const priorHits = existing.branches.hits.get(identity)
						existing.branches.hits.set(identity, priorHits === undefined && hits === undefined ? undefined : (priorHits ?? 0) + (hits ?? 0))
					}
					existing.branches.total = existing.branches.hits.size
					existing.branches.covered = [...existing.branches.hits.values()].filter(hits => hits !== undefined && hits > 0).length
				} else {
					existing.branches = {
						total: Math.max(existing.branches?.total ?? 0, record.branches.total),
						covered: Math.max(existing.branches?.covered ?? 0, record.branches.covered),
					}
				}
			}
		}
	}
	return merged
}

export function renderLcovRecords(records: Map<string, LcovRecord>) {
	const output: string[] = []
	for (const [file, record] of [...records].sort(([left], [right]) => left.localeCompare(right))) {
		output.push(`SF:${file}`)
		if (record.functions.definitions !== undefined && record.functions.hits !== undefined) {
			for (const [name, line] of [...record.functions.definitions].sort(([leftName, leftLine], [rightName, rightLine]) => leftLine - rightLine || leftName.localeCompare(rightName))) output.push(`FN:${line.toString()},${name}`)
			for (const [name, hits] of [...record.functions.hits].sort(([left], [right]) => left.localeCompare(right))) output.push(`FNDA:${hits.toString()},${name}`)
		}
		for (const [line, hits] of [...record.lineHits].sort(([left], [right]) => left - right)) output.push(`DA:${line.toString()},${hits.toString()}`)
		output.push(`FNF:${record.functions.total.toString()}`, `FNH:${record.functions.covered.toString()}`)
		if (record.branches?.hits !== undefined) {
			for (const [identity, hits] of [...record.branches.hits].sort(([left], [right]) => left.localeCompare(right))) output.push(`BRDA:${identity},${hits?.toString() ?? '-'}`)
			output.push(`BRF:${record.branches.total.toString()}`, `BRH:${record.branches.covered.toString()}`)
		}
		output.push(`LF:${record.lineHits.size.toString()}`, `LH:${[...record.lineHits.values()].filter(hits => hits > 0).length.toString()}`, 'end_of_record')
	}
	return `${output.join('\n')}\n`
}
