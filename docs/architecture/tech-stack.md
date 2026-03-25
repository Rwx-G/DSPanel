# Tech Stack

### Cloud Infrastructure

- **Provider**: N/A - Desktop application, no cloud hosting required
- **Key Services**: Azure AD App Registration (for Microsoft Graph access to Entra ID / Exchange Online)
- **Deployment**: GitHub Releases (.msi for Windows, .dmg for macOS, .AppImage/.deb for Linux)

### Technology Stack Table

| Category                   | Technology            | Version        | Purpose                                      | Rationale                                                       |
| -------------------------- | --------------------- | -------------- | -------------------------------------------- | --------------------------------------------------------------- |
| **Backend Language**       | Rust                  | 1.85+ (stable) | Backend logic, system operations             | Memory safety, performance, strong type system, no GC           |
| **Frontend Language**      | TypeScript            | 5.x            | Frontend UI development                      | Type safety, excellent React integration, developer tooling     |
| **Desktop Framework**      | Tauri                 | 2.x            | Desktop app shell, IPC bridge                | Small binary size, native webview, Rust backend, cross-platform |
| **UI Framework**           | React                 | 18.x           | Frontend component framework                 | Component model, hooks, large ecosystem, mature tooling         |
| **Bundler**                | Vite                  | 6.x            | Frontend build tool                          | Fast HMR, native ESM, optimized builds                          |
| **LDAP**                   | ldap3                 | 0.11.x         | AD on-prem queries (Rust)                    | Pure Rust LDAP client, async, TLS support                       |
| **HTTP Client**            | reqwest               | 0.12.x         | Graph API, HIBP, GitHub API (Rust)            | Async HTTP, TLS, connection pooling, widely used                |
| **Logging**                | tracing               | 0.1.x          | Structured logging (Rust)                    | Structured spans, multiple subscribers, async-aware             |
| **Logging Subscriber**     | tracing-subscriber    | 0.3.x          | Log output formatting (Rust)                 | File + console output, filtering, JSON format                   |
| **Logging File**           | tracing-appender      | 0.2.x          | Rolling file logs (Rust)                     | Non-blocking file appender, daily rotation                      |
| **Serialization**          | serde + serde_json    | 1.x            | JSON serialization (Rust)                    | De facto Rust serialization, derive macros, performant          |
| **Local DB**               | rusqlite              | 0.32.x         | Audit log + snapshots storage (Rust)         | Lightweight SQLite binding, bundled SQLite                      |
| **Error Handling**         | thiserror + anyhow    | 1.x / 1.x      | Typed + ad-hoc errors (Rust)                 | Ergonomic error types, context chaining                         |
| **Password Hash**          | sha1                  | 0.10.x         | SHA1 for HIBP k-anonymity (Rust)             | Lightweight, pure Rust                                          |
| **PDF Export**             | printpdf or genpdf    | latest         | PDF report generation (Rust)                 | Pure Rust, no external dependencies                             |
| **CSV Export**             | csv                   | 1.x            | CSV export (Rust)                            | Fast, RFC 4180 compliant, serde integration                     |
| **State Management**       | React Context + hooks | built-in       | Frontend state management                    | Simple, built-in, sufficient for desktop app state              |
| **Styling**                | Tailwind CSS          | 4.x            | Utility-first CSS framework                  | Rapid UI development, consistent design, small bundle           |
| **Rust Testing**           | cargo test            | built-in       | Rust unit + integration tests                | Built-in test framework, no external dependency                 |
| **Frontend Testing**       | vitest                | 3.x            | Frontend unit + component tests              | Vite-native, fast, Jest-compatible API                          |
| **Component Testing**      | React Testing Library | 16.x           | React component tests                        | User-centric testing, widely adopted                            |
| **Rust Linting**           | clippy                | built-in       | Rust static analysis                         | Comprehensive lints, idiomatic Rust enforcement                 |
| **Rust Formatting**        | rustfmt               | built-in       | Rust code formatting                         | Standard formatting, zero config                                |
| **Frontend Linting**       | ESLint                | 9.x            | TypeScript/React linting                     | Configurable rules, React-specific plugins                      |
| **Frontend Formatting**    | Prettier              | 3.x            | Frontend code formatting                     | Opinionated, consistent formatting                              |
| **Package Manager (Rust)** | cargo                 | built-in       | Rust dependency management                   | Built-in, crates.io ecosystem                                   |
| **Package Manager (JS)**   | pnpm                  | 10.x           | Frontend dependency management               | Fast, disk-efficient, strict dependency resolution              |

---
