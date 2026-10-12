# Code Style Evaluation Fixtures

`evals.json` contains 36 prompt-based review/generation cases. Each case has an integer `id`, a unique `name`, a `description`, a `prompt`, a `trap` explaining the failure mode, and assertions with unique string IDs.

These are model-evaluation fixtures, not an executable Go test suite. JSON parsing, link checks, and snippet syntax checks validate the files but do not establish that a model passes the cases. There is no bundled model runner.

## Running a Model Evaluation

1. Start an isolated session per case with this skill loaded. Load the bundled references when relevant.
2. Submit the case's `prompt` as the user request; keep `trap` and `assertions` out of that request.
3. Evaluate the answer against every assertion. Report per-assertion results, rationale, model/version, and loaded skill version.
4. For runnable Go output, use an isolated temporary module and run formatting, compilation, tests, and `go vet` where relevant. Test behavior rather than just searching for keywords.
5. Treat inability to run code or missing dependencies as a validation limitation, not a passing result.

For case 13, assert the actual empty-response JSON representation. For cases 11 and 19, instrument permission/ACL calls and check both ordering and skipped calls. For cases 25 and 26, inspect ownership and copying paths; `go vet` and race-enabled tests help, but passing either does not prove complete concurrency safety. For case 33, test undefined codes and values outside the target integer type's range before narrowing.

## Coverage

Cases 1–24 retain the original review areas with revised contracts and contextual judgments: collections, struct literals, error flow, APIs, strings, conditions, line wrapping, exports, allocation, and ETL. Cases 25–36 cover synchronization ownership/copying, declaration grouping, naming, Must APIs, consumer interfaces, enum compatibility, constructors, handlers/file navigation, dependencies, and comments.

Include negative cases to detect over-enforcement: legal nil slices, clear short calls, explicit educational examples, existing public APIs, meaningful interface names without an `-er` suffix, and zero-value-ready types without constructors.
