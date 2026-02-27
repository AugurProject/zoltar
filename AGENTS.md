# Agents Coding Standards

This document outlines the coding standards and best practices that all agents must follow when modifying code in this repository.

## Never Use `any`

The `any` type in TypeScript defeats the purpose of static type checking and can lead to runtime errors that would otherwise be caught at compile time.

### ❌ Bad

```typescript
function process(data: any) {
  return data.value * 2
}
```

### ✅ Good

```typescript
interface Data {
  value: number
}

function process(data: Data) {
  return data.value * 2
}
```

Or when the type is unknown:

```typescript
function process(data: unknown): number {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Expected object')
  }
  const { value } = data as { value: number }
  return value * 2
}
```

## General Principles

1. **Type Safety First**: Always prefer specific, descriptive types over generic ones.
2. **Avoid Type Assertions**: Use `as` sparingly; prefer type guards and narrowing.
3. **Leverage Inference**: Let TypeScript infer types when obvious, but be explicit when clarity is needed.
4. **Document Edge Cases**: Use JSDoc comments for complex logic, not to compensate for unclear types.

## When You Need Unknown Types

Use `unknown` instead of `any` for values whose type you don't know:

```typescript
// Accept any value but require type checking before use
function safeLog(value: unknown): void {
  console.log(String(value))
}

// Use type guards
function isString(value: unknown): value is string {
  return typeof value === 'string'
}
```

## Third-Party Types

If a library has poor or missing types:
- Prefer well-typed alternatives
- Write local declaration files with specific types you actually use
- Never use `any` to silence type errors

## Exceptions

The only exception is for temporary debugging or prototyping, which must be cleaned up before finalizing changes.

---

**Remember**: If TypeScript complains about types, it's trying to help you. Work with the type system, not against it.
