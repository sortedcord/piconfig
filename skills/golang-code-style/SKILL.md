---
name: golang-code-style
description: "Go code style and idiom essentials — declarations, struct literals, synchronization ownership, control flow, function design, naming and API basics. Use when writing or reviewing Go code, asking about clarity or idiomatic Go, or establishing coding standards. Includes a local baseline for naming, interfaces, constructors, Must APIs, and enum-like constants; companion skills cover deeper design, linter configuration, and documentation."
user-invocable: true
license: MIT
compatibility: Designed for Claude Code, Codex or similar harness, and for projects using Golang.
metadata:
  author: samber
  version: "1.4.0"
  openclaw:
    emoji: "🎨"
    homepage: https://github.com/samber/cc-skills-golang
    requires:
      bins:
        - go
    install: []
allowed-tools: Read Edit Write Glob Grep Bash(go:*) Bash(golangci-lint:*) Bash(git:*) Agent
paths:
  - "**/*.go"
---

**Orchestration mode:** Fan out the sub-agents described in the "Parallelizing Code Style Reviews" section, each covering an independent style concern, when reviewing code style across a large codebase, and merge their findings. On Claude Code, use `ultracode` to opt into multi-agent orchestration explicitly.

> **Community default.** A company skill that explicitly supersedes `samber/cc-skills-golang@golang-code-style` skill takes precedence.

# Go Code Style

Style rules that require human judgment — formatters handle mechanical layout, this skill handles clarity. Read [Idiom Essentials](./references/idioms.md) when reviewing naming, interfaces, constructors, panic-on-error APIs, or enum-like constants. It provides a local baseline even when companion skills are not installed. Companion naming, design-pattern, and structs/interfaces skills provide deeper guidance when available.

> "Clear is better than clever." — Go Proverbs

## Rule Authority & Review Scope

- **Correctness requirements**: preserve evaluation semantics, initialize maps before entry assignment, and respect synchronization/no-copy contracts. These are not cosmetic preferences.
- **Community conventions**: use `gofmt`, meaningful MixedCaps names, keyed struct literals, focused interfaces, and shallow error paths. Apply them with context rather than mechanical thresholds.
- **Project preferences**: line limits, argument-count thresholds, handler prefixes, and exact file ordering are local policies, not universal Go requirements. Follow explicit project policy and preserve coherent existing style.
- Do not redesign a public API, change serialized values, or disregard an explicit task requirement merely to satisfy a style preference. Explain trade-offs when requirements conflict.
- Comment non-obvious intent, invariants, ownership, and compatibility constraints. Do not add comments merely to justify every stylistic exception or narrate obvious code.

## Line Length & Breaking

Go has no fixed line limit. Review long lines (roughly 120 characters is a useful cue), but wrap for readability rather than a mandatory column or argument count. Break at **semantic boundaries**, not inside names or literals. Multi-line calls often read best with one argument per line and a trailing comma:

```go
// Good — each argument on its own line, closing paren separate
mux.HandleFunc("/api/users", func(w http.ResponseWriter, r *http.Request) {
    handleUsers(
        w,
        r,
        serviceName,
        cfg,
        logger,
        authMiddleware,
    )
})
```

When a function signature is hard to understand, consider **cohesive parameter grouping** rather than merely wrapping it. Do not invent an options struct solely to meet a count or break an existing public API. For multi-line signatures, one parameter per line is a useful default.

## Variable Declarations

Prefer `:=` for initialized locals and `var` when deliberately relying on a zero value. This signals intent; explicit types, scope, and required conversions can justify other forms.

```go
var count int              // zero value, set later
name := "default"          // non-zero, := is appropriate
var buf bytes.Buffer       // zero value is ready to use
```

### Group Related Declarations

Group constants and package-level variables by shared purpose, not simply because several exist. Local `var` blocks can express related zero-value state; adjacent initialized locals need not be converted from `:=`. Declare locals near their first use and keep scope narrow. [Examples](./references/idioms.md)

### Slice & Map Initialization

Nil slices are idiomatic for ordinary empty-slice declarations. They support `len`, `range`, and `append`. Use a non-nil empty slice when the API contract requires it: with `encoding/json`, a nil slice normally encodes as `null`, while an initialized empty slice encodes as `[]`; field tags can affect omission.

Nil maps support reads, `len`, `range`, and `delete`, but entry assignment panics. Initialize a map before assigning entries, or before returning it when callers are promised a writable map. Follow the documented contract rather than prohibiting all nil collection returns.

```go
var users []User                       // idiomatic internal accumulator
users = append(users, user)
responseUsers := []User{}               // API requires [] when empty
counts := make(map[string]int)          // ready for entry assignment
results := make([]Result, 0, len(ids))   // useful when expected output warrants it
```

Preallocate when the expected size is known or a capacity hint is justified. An upper bound is not necessarily a good estimate: filtering millions of inputs to a few outputs may not justify allocating for every input. Avoid speculative large constants. Distinguish slice length from capacity when appending.

### Struct Literals

Prefer keyed **struct** literals, especially for configuration and types from other packages. Keys expose meaning and avoid dependence on field order. Adding a field usually makes an unkeyed literal fail to compile; reordering compatible field types can silently change its meaning. Empty literals intentionally rely on zero values. This guidance does not apply to slice, array, or map literals, which do not have struct field names:

```go
srv := &http.Server{
    Addr:         ":8080",
    ReadTimeout:  5 * time.Second,
    WriteTimeout: 10 * time.Second,
}
```

## Control Flow

### Reduce Nesting

Prefer handling errors and edge cases first (early return). Keep the happy path at minimal indentation without changing cleanup, side effects, or error precedence:

```go
func process(data []byte) (*Result, error) {
    if len(data) == 0 {
        return nil, errors.New("empty data")
    }

    parsed, err := parse(data)
    if err != nil {
        return nil, fmt.Errorf("parsing: %w", err)
    }

    return transform(parsed), nil
}
```

### Eliminate Unnecessary `else`

Prefer dropping `else` when the `if` body ends with `return`/`break`/`continue`, preserving scope and behavior. Default-then-override is useful for simple assignments; a `switch` can express mutually exclusive overrides. An ordinary if/else assignment is also valid when clearer:

```go
// Good — default-then-override with switch (cleanest for mutually exclusive overrides)
level := slog.LevelInfo
switch {
case debug:
    level = slog.LevelDebug
case verbose:
    level = slog.LevelWarn
}

// Also valid — choose this form when the direct branch assignment is clearer
if debug {
    level = slog.LevelDebug
} else if verbose {
    level = slog.LevelWarn
} else {
    level = slog.LevelInfo
}
```

### Complex Conditions & Init Scope

Extract complex conditions into meaningful booleans or helper functions when that clarifies the business rule; three operands alone do not make a condition unreadable. Preserve evaluation order, nil guards, side effects, and short-circuit behavior. Keep guarded or expensive checks inline, or use staged checks/lazy helpers. Computing a boolean "last" still evaluates it eagerly. [Details](./references/details.md)

```go
// Good — named booleans make intent clear
isAdmin := user.Role == RoleAdmin
isOwner := resource.OwnerID == user.ID
isPublicVerified := resource.IsPublic && user.IsVerified
if isAdmin || isOwner || isPublicVerified || permissions.Contains(PermOverride) {
    allow()
}
```

Scope variables to `if` blocks when only needed for the check:

```go
if err := validate(input); err != nil {
    return err
}
```

### Switch Over If-Else Chains

When comparing the same variable multiple times, prefer `switch`:

```go
switch status {
case StatusActive:
    activate()
case StatusInactive:
    deactivate()
default:
    return fmt.Errorf("unexpected status: %d", status)
}
```

## Function Design

- Functions SHOULD be **short and focused** — one function, one job.
- A long parameter list is a review cue, not a fixed four-parameter ceiling. Group cohesive inputs or configuration when it improves the API; avoid catch-all options bags and needless signature changes.
- **Parameter order**: `context.Context` first, then inputs, then output destinations.
- Naked returns can help in very short functions where the results are obvious, but become confusing when readers must scroll to discover what is returned. Prefer explicit return expressions in longer functions.

```go
func FetchUser(ctx context.Context, id string) (*User, error)
func SendEmail(ctx context.Context, msg EmailMessage) error  // grouped into struct
```

### Prefer `range` for Iteration

SHOULD use `range` over index-based loops. Use `range n` (Go 1.22+) for simple counting.

```go
for _, user := range users {
    process(user)
}
```

## Value vs Pointer Arguments

Normally pass small value types (`string`, `int`, `bool`, `time.Time`) by value. Use pointers for caller-visible mutation, meaningful nil values, shared identity, or types whose copy contract forbids copying after use. A small struct containing a mutex is not an ordinary copyable value. For large structs, measure copying/allocation trade-offs rather than applying a fixed byte threshold. [Details](./references/details.md)

## Synchronization Ownership in Structs

Group a mutex with the state it protects, normally immediately before that state. Name distinct locks meaningfully and document the protected fields/invariant; adjacency alone is not a synchronization contract.

```go
type Server struct {
    listenAddr string // Immutable after construction.

    // mu protects peers and running.
    mu      sync.RWMutex
    peers   map[string]net.Conn
    running bool
}
```

- Apply the same protection contract to relevant reads, writes, and multi-field invariants. Protecting a map does not automatically protect other mutable fields.
- Concurrent map reads are safe in the absence of concurrent writes; unsynchronized concurrent access involving writes is unsafe.
- Prefer named mutex fields to embedding unless exposing locking methods is intentional. Zero-value mutexes are ready to use.
- Do not copy a mutex after first use, including through containing structs, function arguments, range variables, or value receivers. Use pointer-based access to shared synchronized state.
- Choose `Mutex` versus `RWMutex` based on the synchronization design and measured workload, not merely because a map is present.

## Code Organization Within Files

- **Group related declarations**: keep a type, its constructor (if needed), and methods near each other. Group related constants near the concept they describe.
- **Optimize navigation**: package documentation and imports come first; then arrange cohesive declarations so readers can discover the main API before incidental details. Helpers may follow callers or live near related methods. Do not mechanically sort by export status or separate every type from its methods.
- **One primary type per file** is a useful default when it has significant methods, not a reason to split tightly related small types.
- **Blank imports** (`_ "pkg"`) register side effects (init functions). Prefer application roots and tests when feasible; a library using registration must make that behavior explicit.
- **Dot imports** obscure where names come from; avoid them in library code.
- **Minimize exports** for new APIs. Do not unexport existing public symbols without explicit approval for the breaking change. If the companion gopls skill/tooling is available, use semantic rename and verify interface satisfaction and callers; otherwise explain tooling limits rather than assuming atomic safety.

## String Handling

Use `strconv` for simple conversions (faster), `fmt.Sprintf` for complex formatting. Use `%q` in error messages to make string boundaries visible. Use `strings.Builder` for loops, `+` for simple concatenation.

## Type Conversions

Prefer explicit conversions and validate external values before a narrowing conversion can truncate or wrap them. Prefer concrete types when sufficient; use generics for real type variation rather than losing type information through `any`:

```go
func Contains[T comparable](slice []T, target T) bool  // not []any
```

## Naming & API Idioms

Read [Idiom Essentials](./references/idioms.md) for constant capitalization, scope-sensitive variable names, `Must` wrappers, consumer-focused interfaces, typed constants, constructor names, and handler conventions. Do not mandate an `-er` suffix for every interface, a `Must` prefix for every possible panic, a constructor for every struct, or a `handle` prefix for every HTTP handler.

## Philosophy

- **"A little copying is better than a little dependency"**
- **Prefer standard-library tools**, including `slices` and `maps` where supported by the project's Go version. Ordinary loops are appropriate for filtering/grouping; use third-party helpers such as `github.com/samber/lo` only when their benefit justifies the dependency or the project already adopts them.
- **"Reflection is never clear"** — avoid `reflect` unless necessary
- **Don't abstract prematurely** — extract when the pattern is stable
- **Minimize public surface** — every exported name is a commitment

## Parallelizing Code Style Reviews

When reviewing code style across a large codebase, use up to 5 parallel sub-agents, each targeting an independent style concern (e.g. control flow, function design, variable declarations, string handling, code organization).

## Enforce with Linters

Many rules are enforced automatically: `gofmt`, `gofumpt`, `goimports`, `gocritic`, `revive`, `wsl_v5`. → See the `samber/cc-skills-golang@golang-lint` skill.

## Cross-References

Bundled references work without installing another skill:

- [Code Style Details](./references/details.md): evaluation semantics, pointer/value decisions, and collection contracts
- [Idiom Essentials](./references/idioms.md): local naming/API baseline, examples, and primary sources

The following companion skills are optional; use them when available rather than assuming their instructions or tools are installed:

- → See the `samber/cc-skills-golang@golang-naming` skill for identifier naming conventions
- → See the `samber/cc-skills-golang@golang-structs-interfaces` skill for pointer vs value receivers, interface design
- → See the `samber/cc-skills-golang@golang-design-patterns` skill for functional options, builders, constructors
- → See the `samber/cc-skills-golang@golang-lint` skill for automated formatting enforcement
- → See `samber/cc-skills-golang@golang-continuous-integration` skill for automated AI-driven code review in CI using these guidelines
- → See `samber/cc-skills-golang@golang-refactoring` skill for mechanically applying guard-clause conversion, function extraction, and options-struct migration safely across many call sites once a review surfaces violations at scale
