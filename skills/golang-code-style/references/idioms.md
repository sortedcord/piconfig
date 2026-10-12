# Go Idiom Essentials

A local baseline for naming and API review. Use companion skills for deeper design when available. Preserve established APIs and behavior; distinguish correctness requirements from conventions and project preferences.

## Constants and Identifier Names

Constants follow ordinary Go capitalization, not a special ALL_CAPS convention:

```go
const defaultTimeout = 5 * time.Second
const MaxPacketSize = 512
```

Use `mixedCaps` for unexported names and `MixedCaps` for exported names. An uppercase initial letter controls export, not whether a value is constant. Preserve conventional initialisms: `userID`, `HTTPClient`, `URL`. Acronyms may legitimately be all uppercase; do not mechanically lowercase every uppercase identifier.

Names describe a role, not just a value: `MaxPacketSize`, not `FiveHundredTwelve`. Short names work in small, obvious scopes (`i`, `r`, `s`); use more descriptive names as scope, distance from declaration, or ambiguity grows. Do not shorten every identifier to one letter.

## Group Declarations by Meaning

Related constants form a useful group:

```go
const (
    defaultTimeout = 5 * time.Second
    maxRetries     = 3
)
```

A local `var` block can express related zero-value state:

```go
var (
    buf   bytes.Buffer
    count int
)
```

Independent initialized locals can remain short declarations near their use:

```go
name := input.Name
normalized := normalizeName(name)
```

Multiple declarations do not by themselves justify grouping or hoisting them to function entry. Keep package-level groups cohesive; constants may live near the types they describe instead of in one large block at the top of a file.

## Must APIs: Deliberate Panic-on-Error

`MustX`/`mustX` conventionally names a helper that deliberately converts an otherwise reportable failure into a panic. Prefer an error-returning counterpart and document the panic condition:

```go
func ParseInt(s string) (int, error) {
    return strconv.Atoi(s)
}

// MustParseInt parses s as an integer and panics if parsing fails.
func MustParseInt(s string) int {
    n, err := ParseInt(s)
    if err != nil {
        panic(err)
    }
    return n
}

var defaultLimit = MustParseInt("100")
```

This pattern suits programmer-controlled setup values; ordinary user-input, network, and operational failures should normally return errors. A library should not decide that every operational failure is application-fatal. Test helpers may use a `must` name and stop only the test with `t.Fatal`, while marking themselves with `t.Helper`.

Do not rename every function that might panic to `MustX`: runtime panics and invalid-use contracts exist in many APIs without this prefix. `Must` signals a deliberate contract, not freedom from all other possible panics.

## Interfaces: Real Consumer Needs

Single-method interfaces commonly use an agent noun derived from the method: `Reader`, `Writer`, `Formatter`. This is a convention, not an obligatory suffix for every interface; `error`, `http.Handler`, `fs.FS`, and `net.Conn` are valid names. Multi-method interfaces should describe a coherent role. Reuse established method names with their expected signatures and semantics rather than giving unrelated operations familiar names.

Define the smallest interface a real consumer needs, generally in the consuming package. Usually return concrete implementations so consumers can choose their own abstraction. Do not invent producer-side interfaces solely for hypothetical mocking or future use.

```go
type Getter interface {
    Get(ctx context.Context, key string) ([]byte, error)
}

type Putter interface {
    Put(ctx context.Context, key string, value []byte) error
}

// ReadWriter is useful only if a consumer actually needs both capabilities.
type ReadWriter interface {
    Getter
    Putter
}
```

A consumer needing only reads should accept `Getter`, not the broader interface. Do not mechanically split every implementation into one-method interfaces or reject a coherent interface solely because it has four methods. Prefer existing standard interfaces where their contracts fit.

## Enum-Like Typed Constants

A named type with typed constants expresses a related set of values:

```go
type Suit uint8

const (
    SuitHearts Suit = iota
    SuitClubs
    SuitDiamonds
    SuitSpades
)
```

- Group the constants belonging to one conceptual set.
- Prefix names with the type when it clarifies meaning or avoids package-level collisions. Consider the package-qualified spelling; a prefix is not universally required.
- Decide deliberately whether zero is a valid default (as above) or an unknown/invalid sentinel. Neither starting at zero nor starting at one is a universal requirement.
- Named integer types are not closed enums: `Suit(99)` is representable. Validate values from untrusted inputs or external systems, including range before narrowing conversions that could wrap an invalid input into a valid code.
- Adding or reordering `iota` entries changes later numeric values. Preserve compatibility for persisted, transmitted, or externally specified codes, usually with explicit assignments.

```go
type WireStatus uint8

const (
    WireStatusUnknown WireStatus = 0
    WireStatusReady   WireStatus = 10
    WireStatusFailed  WireStatus = 20
)
```

## Constructors and Package-Qualified Names

Go has no special constructor syntax. Add a constructor when initialization must establish invariants, validate inputs, initialize writable state, or obtain dependencies. Simple data structs and zero-value-ready types may not need one.

`NewType` is conventional when it distinguishes among package types. Use `New` when the package context makes the result clear, such as `order.New`; `order.NewOrder` may repeat information unnecessarily. Do not rename established public constructors just to remove repetition.

Place constructors near their types when this helps readers. Prefer concrete return types; choose value versus pointer according to ownership, mutation, identity, no-copy contracts, and meaningful nil values—not a universal constructor rule.

```go
type Point struct {
    X float64
    Y float64
}

// A keyed literal suffices; no constructor is required.
var origin = Point{X: 0, Y: 0}
```

Omit zero-value fields when doing so improves clarity; `Point{}` is also valid. Keyed literals are a readability default, not evidence that every unkeyed local literal is incorrect.

## HTTP Handler Names and File Navigation

`handleGetUser` or `handleResizeImage` can be useful local conventions for HTTP entry points. They are not language-wide requirements: meaningful existing names and the `ServeHTTP` method of `http.Handler` remain valid. Preserve conventional initialisms such as `ID`.

Arrange files around related concepts and discoverability. Public entry points often deserve prominence; unexported core methods can be equally important. Keep helpers near their callers or below main operations as appropriate. Avoid wholesale reordering merely to enforce an exported-first policy.

## Sources and Authority

- [Effective Go: names](https://go.dev/doc/effective_go#names) — naming, package context, single-method interface conventions
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments) — variable scope, consumer interfaces, ordinary error handling
- [Google Go Style Decisions: constants](https://google.github.io/styleguide/go/decisions#constant-names) — a company guide documenting the established MixedCaps convention
- [Google Go Style Decisions: Must functions](https://google.github.io/styleguide/go/decisions#must-functions) — setup helper convention and inappropriate operational use
- [Go specification: constant declarations](https://go.dev/ref/spec#Constant_declarations) — typed constants and `iota` semantics

Grouping, exact file order, and handler prefixes are readability/project choices. Mutex ownership and copying contracts are correctness matters; see the main skill and [Code Style Details](./details.md).
