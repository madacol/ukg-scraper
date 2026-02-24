# Rules

- Use JSDoc annotations for all functions (params, return types, and typedefs).
- Never use `@type {any}` or `@type {*}`. Always use the most specific type possible.
- Prefer defining `@typedef` for recurring object shapes.
- Apply red/green TDD: write a failing test first, then write the minimal code to make it pass.
- After result is successfull and passes tests, commit
