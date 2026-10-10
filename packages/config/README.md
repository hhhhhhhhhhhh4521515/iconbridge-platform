# @iconbridge/config

Shared presets, so every workspace lints, formats and compiles the same way.

| Export                                                   | Use                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@iconbridge/config/eslint/base`                         | `base(import.meta.dirname)` for Node TypeScript packages (type-aware, `any` forbidden) |
| `@iconbridge/config/eslint/nest`                         | `nest(import.meta.dirname)` for the API                                                |
| `@iconbridge/config/eslint/next`                         | `next()` for the web app                                                               |
| `@iconbridge/config/prettier`                            | Prettier options, re-exported by the root `prettier.config.mjs`                        |
| `@iconbridge/config/tsconfig/{base,node,nest,next}.json` | `extends` targets for `tsconfig.json`                                                  |
