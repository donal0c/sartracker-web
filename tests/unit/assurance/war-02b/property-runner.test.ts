// @vitest-environment node
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  formatBoundedPropertyFailure,
  runBoundedAsyncProperty,
  runBoundedProperty,
  WAR_02B_MAX_RUNS,
} from './property-runner'

describe('WAR-02B bounded property runner', () => {
  it('retains deterministic seed, shrunk counterexample, path, and replay data', () => {
    const result = runBoundedProperty(
      'runner failure fixture',
      fc.record({ value: fc.integer({ min: 0, max: 100 }) }),
      () => false,
      { seed: 77, numRuns: 1 },
    )

    const failure = formatBoundedPropertyFailure('runner failure fixture', result)
    expect(result.failed).toBe(true)
    expect(failure).toContain('seed=77')
    expect(result.counterexample).toEqual([{ value: 0 }])
    expect(result.numShrinks).toBeGreaterThan(0)
    expect(result.counterexamplePath).toEqual(expect.any(String))
    expect(failure).toContain('counterexample={"value":0}')
    expect(failure).toContain(`path=${result.counterexamplePath}`)
    expect(failure).toContain(`replay=seed=77 path=${result.counterexamplePath}`)
  })

  it('runs a passing property for the requested bounded budget', () => {
    const result = runBoundedProperty(
      'runner success fixture',
      fc.constant(1),
      (value) => value === 1,
      { seed: 76, numRuns: 3 },
    )

    expect(result.failed).toBe(false)
    expect(result.interrupted).toBe(false)
    expect(result.seed).toBe(76)
    expect(result.numRuns).toBe(3)
  })

  it('rejects an unbounded CI run request', () => {
    expect(() => runBoundedProperty(
      'runner budget fixture',
      fc.constant(1),
      () => true,
      { numRuns: WAR_02B_MAX_RUNS + 1 },
    )).toThrow(`WAR-02B numRuns must be an integer from 1 to ${WAR_02B_MAX_RUNS}.`)
    expect(() => runBoundedProperty('zero budget fixture', fc.constant(1), () => true, { numRuns: 0 }))
      .toThrow(`WAR-02B numRuns must be an integer from 1 to ${WAR_02B_MAX_RUNS}.`)
    expect(() => runBoundedProperty('fractional budget fixture', fc.constant(1), () => true, { numRuns: 1.5 }))
      .toThrow(`WAR-02B numRuns must be an integer from 1 to ${WAR_02B_MAX_RUNS}.`)
  })

  it('rejects non-replayable seeds', () => {
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => runBoundedProperty(
        'invalid seed fixture',
        fc.constant(1),
        () => true,
        { seed },
      )).toThrow('WAR-02B seed must be a finite integer.')
    }
  })

  it('fails closed when a runtime predicate returns a non-boolean value', () => {
    const malformedPredicate = (() => undefined) as unknown as (value: number) => boolean

    const result = runBoundedProperty(
      'runtime predicate contract fixture',
      fc.constant(1),
      malformedPredicate,
      { seed: 78, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'TypeError',
      message: 'WAR-02B predicate "runtime predicate contract fixture" must return boolean; received undefined',
    })
  })

  it('fails closed when an async runtime predicate resolves to a non-boolean value', async () => {
    const malformedPredicate = (async () => undefined) as unknown as (
      value: number
    ) => Promise<boolean>

    const result = await runBoundedAsyncProperty(
      'async runtime predicate contract fixture',
      fc.constant(1),
      malformedPredicate,
      { seed: 79, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'TypeError',
      message: 'WAR-02B predicate "async runtime predicate contract fixture" must return boolean; received undefined',
    })
  })

  it('retains a synchronous predicate exception as the property failure cause', () => {
    const result = runBoundedProperty(
      'sync exception fixture',
      fc.constant(1),
      () => {
        throw new Error('fixture exploded')
      },
      { seed: 80, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'Error',
      message: 'fixture exploded',
    })
  })

  it('retains an async predicate rejection as the property failure cause', async () => {
    const result = await runBoundedAsyncProperty(
      'async rejection fixture',
      fc.constant(1),
      async () => {
        throw new Error('fixture rejected')
      },
      { seed: 81, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'Error',
      message: 'fixture rejected',
    })
  })

  it('fails closed when a sync predicate returns a Promise', () => {
    const malformedPredicate = (() => Promise.resolve(true)) as unknown as (value: number) => boolean

    const result = runBoundedProperty(
      'sync promise predicate fixture',
      fc.constant(1),
      malformedPredicate,
      { seed: 82, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'TypeError',
      message: 'WAR-02B predicate "sync promise predicate fixture" must return boolean; received object',
    })
  })

  it('fails closed when an async predicate resolves to a truthy non-boolean', async () => {
    const malformedPredicate = (async () => 'true') as unknown as (
      value: number
    ) => Promise<boolean>

    const result = await runBoundedAsyncProperty(
      'async truthy predicate fixture',
      fc.constant(1),
      malformedPredicate,
      { seed: 83, numRuns: 1 },
    )

    expect(result.failed).toBe(true)
    expect(result.errorInstance).toMatchObject({
      name: 'TypeError',
      message: 'WAR-02B predicate "async truthy predicate fixture" must return boolean; received string',
    })
  })
})
