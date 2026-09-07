import { describe, expect, test } from 'bun:test'
import { ZoltarQuestionData_ZoltarQuestionData, Zoltar_Zoltar } from '../types/contractArtifact'

function eventNames(abi: readonly { name?: string; type: string }[]) {
	return abi.filter(entry => entry.type === 'event').map(entry => entry.name)
}

function functionNames(abi: readonly { name?: string; type: string }[]) {
	return abi.filter(entry => entry.type === 'function').map(entry => entry.name)
}

describe('deletion-first architecture characterization', () => {
	test('question and child registries have replayable creation events before enumeration is removed', () => {
		expect(eventNames(ZoltarQuestionData_ZoltarQuestionData.abi)).toContain('QuestionCreated')
		expect(eventNames(Zoltar_Zoltar.abi)).toContain('DeployChild')
	})

	test('deterministic identity functions exist independently of enumeration getters', () => {
		const questionFunctions = functionNames(ZoltarQuestionData_ZoltarQuestionData.abi)
		const zoltarFunctions = functionNames(Zoltar_Zoltar.abi)
		expect(questionFunctions).toContain('getQuestionId')
		expect(questionFunctions).not.toContain('getQuestions')
		expect(questionFunctions).not.toContain('getOutcomeLabels')
		expect(zoltarFunctions).toContain('getChildUniverseId')
		expect(zoltarFunctions).not.toContain('getDeployedChildUniverses')
	})

	test('branch-neutral Zoltar exposes no canonical-child selection or deletion entry point', () => {
		const zoltarFunctions = functionNames(Zoltar_Zoltar.abi)
		expect(zoltarFunctions.some(name => name?.toLowerCase().includes('canonical') === true)).toBe(false)
		expect(zoltarFunctions.some(name => name?.toLowerCase().includes('deletechild') === true)).toBe(false)
		expect(zoltarFunctions).toContain('splitMigrationRep')
	})
})
