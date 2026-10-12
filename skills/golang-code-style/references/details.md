# Code Style Details

## Extract Complex Conditions Without Changing Semantics

Name concepts when that makes a policy easier to understand. Operand count alone is not a reason to rewrite a clear condition. Pure, cheap checks on already-valid values can be extracted:

```go
isAdmin := user.Role == RoleAdmin
isOwner := resource.OwnerID == user.ID
if isAdmin || isOwner || expensivePermissionCheck(user, resource) {
    allow()
}
```

The final call remains lazy: it is skipped when an earlier condition grants access. Moving it into a variable, even the last declared variable, would evaluate it unconditionally.

Short-circuiting can be a correctness requirement, not merely a performance optimization:

```go
// Safe: user.IsActive and authorized are evaluated only after their guards.
if user != nil && user.IsActive && authorized(user) {
    allow()
}
```

Do not extract `user.IsActive` before checking `user != nil`. Do not eagerly call `authorized` when the original expression would skip it. Preserve side effects, error precedence, and evaluation order. Staged checks or lazy helper calls can make these dependencies explicit:

```go
func canPublish(user *User) bool {
    if user == nil || !user.IsActive {
        return false
    }
    return authorized(user)
}
```

For guarded lookups, retain the guard even when extracting a helper:

```go
func hasReadAccess(acl *ACL, userID string) bool {
    if !acl.HasEntry(userID) {
        return false
    }
    return acl.GetPermission(userID).Level >= MinReadLevel
}
```

Call the helper at the original short-circuit point. Merely computing `hasReadAccess` before the surrounding expression can still introduce an unwanted lookup.

## Value vs Pointer Arguments

These guidelines cover function parameters. Apply the same no-copy contract to receivers, assignments, returns, and iteration; companion structs/interfaces guidance can cover receiver design in more depth.

Normally pass small value types by value:

```go
func FormatUser(name string, age int, createdAt time.Time) string

// Caller-visible mutation requires a pointer to this struct.
func PopulateDefaults(cfg *Config)

// A pointer can distinguish an absent patch field from an empty string.
func UpdateUser(ctx context.Context, id string, name *string) error
```

Pointers are appropriate when:

- Mutating the caller's struct or preserving shared identity.
- Nil represents a meaningful absent/optional value.
- Copying would violate the type's contract. In particular, `sync.Mutex`, `sync.RWMutex`, and containing structs must not be copied after first use. Other synchronization/atomic types can impose similar restrictions; consult their documentation.
- Profiling or benchmarks demonstrate that avoiding a large copy helps.

A small synchronized type still needs pointer-based access to its shared state:

```go
type Counter struct {
    // mu protects n.
    mu sync.Mutex
    n  int
}

func Increment(c *Counter) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

A value parameter would copy the lock and counter. Pointer receivers alone do not prevent copying via assignment or range variables; review those paths too. Use `go vet`'s copylocks analysis as an aid, not proof that all ownership is correct.

Do not add pointers to strings, scalar values, or interface values merely to save a few bytes. Slices and maps already reference underlying state: modifying elements/entries does not ordinarily require a pointer to the slice/map, while replacing the caller's slice header or map variable does. Value copies can still alias backing storage or reference fields, so value passing does not imply deep immutability.

### Performance Is Contextual

There is no universal 128-byte cutoff. Allocation depends on escape analysis, not simply on using values or pointers. Copy cost, indirection, cache behavior, aliasing, architecture, compiler version, and lifetime all matter. Establish ownership and correctness first; benchmark representative workloads and inspect allocations when performance matters.

## Collection Contracts

- A nil slice has length and capacity zero and supports `range` and `append`; it is a useful default for internal accumulation.
- A nil map permits lookups, `len`, `range`, and `delete`, but assigning an entry panics. Allocate before assignment.
- With `encoding/json`, nil collections normally encode as `null`; initialized empty slices/maps encode as `[]`/`{}`. Field tags such as `omitempty` can omit empty fields. Test the actual API representation.
- Return nil or non-nil collections according to the documented contract. Do not make consumers distinguish nil from an empty slice without a concrete reason.
- A non-nil error can legitimately be accompanied by a nil result.
- Capacity is a hint, not a correctness requirement. For append-based construction, `make([]T, 0, estimate)` sets capacity without inserting zero-valued elements. `make([]T, n)` is appropriate when filling known positions by index.

## Sources

- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments): nil slices, copying, parameter/receiver choices
- [Go specification: logical operators](https://go.dev/ref/spec#Logical_operators): conditional evaluation of the right operand
- [sync package](https://pkg.go.dev/sync): lock and copying contracts
- [encoding/json](https://pkg.go.dev/encoding/json): representation and omission rules
