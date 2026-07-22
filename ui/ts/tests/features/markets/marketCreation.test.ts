/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createMarketParameters, createSecurityPoolParameters, hasDeployedStep, validateMarketForm } from '../../../features/markets/lib/marketCreation.js'
import { sortStringArrayByKeccak } from '@zoltar/shared/sortStringArrayByKeccak'
import type { MarketFormState, SecurityPoolFormState } from '../../../types/app.js'

void describe('market creation helpers', () => {
	const noopDeploy = async () => '0x0000000000000000000000000000000000000000000000000000000000000000' as const

	test('categorical outcomes are sorted by the contract hash order before submission', () => {
		const form: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: ['Cherry', 'Apple', 'Banana'],
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'test categorical question',
			startTime: '1000',
		}

		const parameters = createMarketParameters(form)

		expect(parameters.outcomeLabels).toEqual(sortStringArrayByKeccak(['Cherry', 'Apple', 'Banana']))
	})

	test('binary market creation includes fixed yes/no outcome labels', () => {
		const parameters = createMarketParameters({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'binary market',
			endTime: '2000',
			marketType: 'binary',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'binary question',
			startTime: '1000',
		})

		expect(parameters.marketType).toBe('binary')
		expect(parameters.outcomeLabels).toEqual(['Yes', 'No'])
	})

	test('scalar inputs map to the expected contract values', () => {
		const form: MarketFormState = {
			answerUnit: '$',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test scalar description',
			endTime: '2000',
			marketType: 'scalar',
			scalarIncrement: '0.1',
			scalarMax: '10',
			scalarMin: '1',
			title: 'test scalar question',
			startTime: '1000',
		}

		const parameters = createMarketParameters(form)

		expect(parameters.questionData.displayValueMin).toBe(1n * 10n ** 18n)
		expect(parameters.questionData.displayValueMax).toBe(10n * 10n ** 18n)
		expect(parameters.questionData.numTicks).toBe(90n)
	})

	test('validation reports missing required fields and impossible scalar combinations', () => {
		const validation = validateMarketForm({
			answerUnit: '$',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test scalar description',
			endTime: '',
			marketType: 'scalar',
			scalarIncrement: '0.4',
			scalarMax: '10',
			scalarMin: '1',
			title: '',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.title).toBe('Title is required')
		expect(validation.fieldErrors.endTime).toBe('End time is required')
		expect(validation.fieldErrors.scalarMin).toBe('Scalar min, max, and increment do not produce a whole number of ticks')
		expect(validation.notice).toContain('Missing required fields: Title, End Time')
		expect(validation.notice).toContain('Fix invalid fields: Scalar min, max, and increment do not produce a whole number of ticks')
	})

	test('checks deployment step completion for configured step ids', () => {
		expect(
			hasDeployedStep(
				[
					{ address: '0x1', dependencies: [], deployed: false, deploy: noopDeploy, id: 'proxyDeployer', label: 'Proxy deployer' },
					{ address: '0x2', dependencies: ['proxyDeployer'], deployed: true, deploy: noopDeploy, id: 'zoltar', label: 'Zoltar' },
				],
				'zoltar',
			),
		).toBe(true)
		expect(hasDeployedStep([{ address: '0x1', dependencies: [], deployed: false, deploy: noopDeploy, id: 'proxyDeployer', label: 'Proxy deployer' }], 'zoltar')).toBe(false)
	})

	test('validation catches malformed categorical outcomes after trimming', () => {
		const oneOutcome = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['  yes'],
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'test categorical question',
			startTime: '1000',
		})
		expect(oneOutcome.isValid).toBe(false)
		expect(oneOutcome.fieldErrors.categoricalOutcomes).toBe('Outcome 2 is required')

		const duplicateOutcomes = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: [' yes', 'yes', ''],
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'test categorical question',
			startTime: '1000',
		})
		expect(duplicateOutcomes.isValid).toBe(false)
		expect(duplicateOutcomes.fieldErrors.categoricalOutcomes).toBe('Outcomes must be unique')
	})

	test('validation requires a formatted scalarStart time', () => {
		const validation = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test binary description',
			endTime: '4000',
			marketType: 'binary',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'bad start-time market',
			startTime: 'not-a-timestamp',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.startTime).toBe('Start time is invalid')
		expect(validation.notice).toContain('Fix invalid fields: Start time is invalid')
	})

	test('categorical validation fails when all category fields are blank', () => {
		const noOutcomes = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['   ', '', '   '],
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'categorical market without outcomes',
			startTime: '1000',
		})

		expect(noOutcomes.isValid).toBe(false)
		expect(noOutcomes.fieldErrors.categoricalOutcomes).toBe('Outcome 1 and Outcome 2 are required')
		expect(noOutcomes.notice).toContain('Missing required fields: Outcome 1, Outcome 2')
	})

	test('categorical validation rejects a blank required slot even when later optional rows are populated', () => {
		const sparseOutcomesForm: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: ['', 'Yes', 'No'],
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'categorical market with a sparse outcome list',
			startTime: '1000',
		}

		const validation = validateMarketForm(sparseOutcomesForm)
		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.categoricalOutcomes).toBe('Outcome 1 is required')
		expect(validation.notice).toContain('Missing required fields: Outcome 1')
		expect(() => createMarketParameters(sparseOutcomesForm)).toThrow('Outcome 1 is required')
	})

	test('validation catches invalid time ordering for categorical and scalar forms', () => {
		expect(
			validateMarketForm({
				answerUnit: '',
				categoricalOutcomes: ['Yes', 'No'],
				description: 'test scalar description',
				endTime: '1000',
				marketType: 'scalar',
				scalarIncrement: '1',
				scalarMax: '1',
				scalarMin: '10',
				title: 'test scalar question',
				startTime: '2000',
			}).isValid,
		).toBe(false)

		expect(
			validateMarketForm({
				answerUnit: '',
				categoricalOutcomes: ['Yes', 'No'],
				description: 'test categorical description',
				endTime: '1000',
				marketType: 'categorical',
				scalarIncrement: '1',
				scalarMax: '0',
				scalarMin: '0',
				title: 'test categorical question',
				startTime: '2000',
			}).isValid,
		).toBe(false)
	})

	test('validates malformed end times as invalid timestamps', () => {
		const validation = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test',
			endTime: 'not-a-timestamp',
			marketType: 'binary',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'bad timestamp market',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.endTime).toBe('End time is invalid')
		expect(validation.notice).toContain('Fix invalid fields: End time is invalid')
	})

	test('validates start/end times during question creation', () => {
		const form: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test categorical description',
			endTime: '1500',
			marketType: 'binary',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'test binary question',
			startTime: '2000',
		}

		expect(() => createMarketParameters(form)).toThrow('End time must be after start time')
	})

	test('supports invalid market type paths in creation helpers without introducing silent defaults', () => {
		const form = {
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'broken market',
			endTime: '2000',
			marketType: 'invalid' as MarketFormState['marketType'],
			scalarIncrement: '0.1',
			scalarMax: '10',
			scalarMin: '1',
			title: 'bad market',
			startTime: '1000',
		} as unknown as MarketFormState
		expect(() => createMarketParameters(form)).toThrow('Unhandled discriminated union member: "invalid"')
	})

	test('validates scalar questions when all three values are missing', () => {
		const validation = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test',
			endTime: '4000',
			marketType: 'scalar',
			scalarIncrement: '',
			scalarMax: '',
			scalarMin: '',
			title: 'scalar market',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.scalarMin).toBe('Scalar Min is required')
		expect(validation.fieldErrors.scalarMax).toBe('Scalar Max is required')
		expect(validation.fieldErrors.scalarIncrement).toBe('Scalar Increment is required')
	})

	test('validates scalar questions with malformed numeric constraints across non-keyword paths', () => {
		const validation = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test',
			endTime: '4000',
			marketType: 'scalar',
			scalarIncrement: '2',
			scalarMax: '1',
			scalarMin: '0',
			title: 'scalar market',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.scalarMin).toBe('Scalar min, max, and increment do not produce a whole number of ticks')
		expect(validation.fieldErrors.scalarMax).toBe('Scalar min, max, and increment do not produce a whole number of ticks')
		expect(validation.fieldErrors.scalarIncrement).toBe('Scalar min, max, and increment do not produce a whole number of ticks')
		expect(validation.notice).toContain('Fix invalid fields: Scalar min, max, and increment do not produce a whole number of ticks')
	})

	test('requires a valid question id for security pool creation', () => {
		expect(() =>
			createSecurityPoolParameters({
				marketId: '   ',
				securityMultiplier: '3',
			} as SecurityPoolFormState),
		).toThrow('Question ID is required')
	})

	test('parses security-pool market IDs as decimal and hexadecimal values', () => {
		const form: SecurityPoolFormState = {
			marketId: '0x2a',
			securityMultiplier: '3',
		}

		const parameters = createSecurityPoolParameters(form)
		expect(parameters.questionId).toBe(42n)
	})

	test('normalizes and rejects malformed security-pool market IDs', () => {
		expect(
			createSecurityPoolParameters({
				marketId: '  55  ',
				securityMultiplier: '3',
			} as SecurityPoolFormState).questionId,
		).toBe(55n)

		expect(() =>
			createSecurityPoolParameters({
				marketId: 'not-a-number',
				securityMultiplier: '3',
			} as SecurityPoolFormState),
		).toThrow('Question ID must be a valid decimal or hex bigint')
	})

	test('validation maps scalar max/min ordering to both scalar bound fields', () => {
		const validation = validateMarketForm({
			answerUnit: '',
			categoricalOutcomes: ['Yes', 'No'],
			description: 'test scalar description',
			endTime: '4000',
			marketType: 'scalar',
			scalarIncrement: '1',
			scalarMax: '5',
			scalarMin: '5',
			title: 'scalar order market',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.scalarMin).toBe('Scalar max must be greater than scalar min')
		expect(validation.fieldErrors.scalarMax).toBe('Scalar max must be greater than scalar min')
		expect(validation.notice).toContain('Fix invalid fields: Scalar max must be greater than scalar min')
	})

	test('security pool creation parameters exclude origin retention input', () => {
		const parameters = createSecurityPoolParameters({
			marketId: '42',
			securityMultiplier: '2',
		} as SecurityPoolFormState)

		expect(parameters).toEqual({
			questionId: 42n,
			securityMultiplier: 2n,
		})
		expect('currentRetentionRate' in parameters).toBe(false)
	})

	test('security pool creation rejects multipliers the origin factory cannot accept', () => {
		for (const securityMultiplier of ['0', '1']) {
			expect(() =>
				createSecurityPoolParameters({
					marketId: '42',
					securityMultiplier,
				} as SecurityPoolFormState),
			).toThrow('Security multiplier must be greater than 1')
		}
	})
})
