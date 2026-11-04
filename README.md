# Todo Studio

> **High-Performance Personal Task & Project Engine**  
> *"Calmness by default, power on demand."*

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3-000000?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![Next.js](https://img.shields.io/badge/Next.js-16.4.5-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.3.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-v1.2-FF4088?style=for-the-badge&logo=elysia&logoColor=white)](https://elysiajs.com)
[![Better Auth](https://img.shields.io/badge/Better_Auth-v1.7-black?style=for-the-badge)](https://better-auth.com)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-v0.45-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![SQLite](https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org)

---

## ⚡ Overview & Philosophy

**Todo Studio** is an ultra-fast, calm, and keyboard-centric personal task and project management monorepo designed with a strict standard of engineering excellence. It eliminates bloated enterprise UI patterns in favor of frictionless consumer simplicity inspired by Things 3 and Linear, powered by an end-to-end type-safe TypeScript backend and bleeding-edge React 19 frontend.

### Design Principles:
1. **Calmness by Default**: Zero modal fatigue. Single-line quick add, subtle hairline dividers, tactile color palette, and contextual disclosures that only appear when you need them.
2. **Speed & Zero Friction**: Sub-millisecond local operations, byte-order fractional indexing for $O(1)$ reorders, and cursor-based pagination.
3. **Deep Structural Organization**: Arbitrary hierarchy with Folders $\rightarrow$ Lists $\rightarrow$ Sections $\rightarrow$ Tasks $\rightarrow$ Subtasks (depth 3 recursion with cycle prevention) + Checklists + Tags.
4. **Resilience & Safety**: Transactional bulk operations with atomic rollbacks, recursive soft delete cascades with 1-click restore, and automated 30-day purge crons.

---

## 🏗️ Monorepo Architecture

The workspace is organized as an atomic Bun monorepo housing both high-throughput API services and modern client interfaces:

```
todo/
├── apps/
│   ├── backend/               # ElysiaJS REST API (Port 3001)
│   │   ├── src/
│   │   │   ├── auth.ts        # Better Auth config (Drizzle SQLite, 2FA, bearer tokens)
│   │   │   ├── db/            # Schema, WAL config, auto-migrations
│   │   │   ├── plugins/       # authMacro security middleware
│   │   │   ├── routes/        # Task, Container, Tag, Trash, Template endpoints
│   │   │   ├── utils/         # Fractional indexing, cursor pagination, recursive purge
│   │   │   └── index.ts       # Elysia application, Swagger docs, 03:00 daily cron
│   │   ├── test/              # 82 automated integration & unit tests
│   │   ├── drizzle/           # SQL migration files
│   │   ├── drizzle.config.ts  # Drizzle kit configuration
│   │   └── package.json       # @todo/backend package definition
│   │
│   └── frontend/              # Next.js 16.4.5 + React 19 App Router (Port 3000)
│       ├── src/
│       │   ├── app/           # App Router pages, layout, and Tailwind v4 theme
│       │   ├── components/    # Atomic UI components, modals, and task views
│       │   │   ├── app/       # Workspace, Sidebar, TaskPane, QuickAdd, DetailPanel
│       │   │   ├── auth/      # AuthModal, ProfileModal, UserNav, AuthSessionCard
│       │   │   ├── landing/   # Hero, FeaturesGrid, LiveDemoPreview, FAQSection
│       │   │   └── ui/        # Accessible Button, Input, Card, Badge, Skeleton
│       │   ├── hooks/         # Custom hooks (invite validator, shortcuts)
│       │   └── lib/           # Type-safe API client, adapters, and Better Auth client
│       ├── test/              # 43 automated integration & component tests
│       └── package.json       # @todo/frontend package definition
│
├── package.json               # Root monorepo workspace configuration
├── tsconfig.json              # Monorepo base TypeScript settings
└── bun.lock                   # Deterministic lockfile
```

### Application Breakdown

| Application | Technology Stack | Port | Description |
| :--- | :--- | :--- | :--- |
| **`@todo/backend`** | ElysiaJS, Better Auth, Drizzle ORM, `bun:sqlite` | `3001` | High-throughput, low-latency REST API with fractional ordering, transactional bulk mutations, OpenAPI 3 / Swagger documentation, and automated daily cleanup jobs. |
| **`@todo/frontend`** | Next.js 16.4.5, React 19.3.0, Tailwind CSS v4, Lucide | `3000` | Keyboard-driven web application featuring a tactile Deep Blue (`#051A4D`) & Bubblegum Pink (`#FD91CC`) design system, Things 3-style Quick Add, and instant client state sync. |


---

## 🚀 Getting Started & Local Development

### Prerequisites

- **[Bun](https://bun.sh/)** version `>= 1.3` (runtime, package manager, and test runner)
- **Node.js** `>= 20.0` (optional, for Next.js tooling compatibility)

### 1. Clone & Install

```bash
git clone https://github.com/faizan1250/todo.git
cd todo
bun install
```

### 2. Environment Setup

Default values work out of the box for local development without any required configuration. For custom environments, you can define the following environment variables:

#### Backend (`apps/backend/.env`)
```env
PORT=3001
DB_FILE=sqlite.db
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=dev-secret-key-change-in-production-todo-app
FRONTEND_URL=http://localhost:3000
```

#### Frontend (`apps/frontend/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Running the Development Servers

Start backend and frontend concurrently or independently using the monorepo root scripts:

```bash
# Terminal 1: Launch the ElysiaJS backend with hot reload (Port 3001)
bun run dev:backend

# Terminal 2: Launch the Next.js frontend with Turbopack (Port 3000)
bun run dev:frontend
```

Once running:
- **Web App**: Open [http://localhost:3000](http://localhost:3000) to view the Todo Studio interface.
- **Backend API**: Accessible at [http://localhost:3001](http://localhost:3001).
- **Interactive Swagger Docs**: Open [http://localhost:3001/swagger](http://localhost:3001/swagger) for the interactive OpenAPI explorer.

---

## 🛠️ Workspace Scripts & Tooling

The root `package.json` coordinates all monorepo workspaces using `bun --filter`:

| Command | Target | Purpose |
| :--- | :--- | :--- |
| `bun run dev:backend` | `@todo/backend` | Runs Elysia API with `--watch` on `http://localhost:3001` |
| `bun run dev:frontend` | `@todo/frontend` | Starts Next.js 16 with Turbopack on `http://localhost:3000` |
| `bun run build` | All packages | Compiles backend and generates production Next.js build |
| `bun run build:frontend`| `@todo/frontend` | Production build of Next.js frontend |
| `bun test` | All packages | Executes complete automated test suite (125+ tests) |
| `bun run typecheck` | All packages | Strict TypeScript validation across all workspaces (`tsc --noEmit`) |
| `bun run lint` | All packages | Runs ESLint 9 checks across frontend codebase |

### Test Suite Breakdown

Todo Studio maintains 100% green automated test coverage with **125+ passing tests** across both backend and frontend:

- **Backend (`82 passing tests`)**:
  - `test/auth.test.ts`: Email/password authentication, TOTP two-factor enrollment, session validation, and `/me` profile updates.
  - `test/health.test.ts`: Healthcheck, CORS headers, and preflight OPTIONS verification.
  - `test/containers.test.ts`: Folders, Lists, Sections CRUD, position ordering, and default Inbox lifecycle.
  - `test/tasks.test.ts`: Full task CRUD, keyset cursor pagination on `(position, id)`, and 3-query batch includes.
  - `test/subtasks.test.ts`: Subtask hierarchy, max depth 3 enforcement, and cycle prevention.
  - `test/templates.test.ts`: Snapshotting task trees, deep template copy, and template instantiation.
  - `test/trash.test.ts`: Recursive soft-delete cascading, 1-click restore with Inbox fallback, and purge cron.
  - `test/bulk.test.ts`: Transactional multi-task operations (`move`, `tag`, `untag`, `complete`, `reopen`, `archive`, `delete`, `set_priority`) with 404 atomic rollback.
- **Frontend (`43 passing tests`)**:
  - `test/auth-integration.test.ts`: API client authentication flows, token handling, and profile persistence.
  - `test/polish-and-sync.test.ts`: Accessible skeleton loaders, optimistic UI updates, and profile syncing.
  - `test/components.test.ts`: Task row interaction, status toggling, and dialog operations.

---

## ✨ Key Features & Architectural Capabilities

Todo Studio combines consumer-grade responsiveness with enterprise-grade data guarantees. Every layer of the stack is optimized for predictability, latency, and correctness.

### 1. Hierarchical Domain & Structural Organization
- **Multi-Level Containers**: Organize projects hierarchically into **Folders** $\rightarrow$ **Lists** $\rightarrow$ **Sections** $\rightarrow$ **Tasks**.
- **Deep Subtask Trees**: Tasks support recursive subtasks up to a maximum depth of 3 (`Parent -> Subtask -> Sub-subtask`) with automated cycle detection preventing circular task relationships.
- **Micro-Steps via Checklists**: Every task and subtask supports an ordered, toggleable checklist for atomic verification without task bloat.
- **Orthogonal Tag Taxonomy**: Global and list-scoped tags allow multi-dimensional filtering, searching, and batch categorization across disparate projects.
- **Automated Default Inbox**: User registration automatically provisions a reserved `Inbox` container that serves as the root destination for rapid capture and trash-restored orphan items.

### 2. Byte-Order Fractional Indexing ($O(1)$ Reorders)
- Implements byte-order lexicographical fractional indexing via `fractional-indexing`.
- Moving any item between two arbitrary siblings computes a mid-key string in constant $O(1)$ time without updating adjacent records or requiring sequential index re-writes.
- Eliminates locking contention and cascade updates across large lists, guaranteeing zero-downtime, conflict-free drag-and-drop reordering.

### 3. Keyset Cursor Pagination & Zero $N+1$ Batch Loader
- **Stable Keyset Pagination**: Queries paginate deterministically using composite cursor tuples `(position, id)`. Eliminates offset drift, phantom rows, and $O(N)$ scanning performance penalties on large datasets.
- **Parallel 3-Query Batch Loader**: When passing `include=subtasks,checklist,tags`, the backend dispatches 3 indexed queries executed in parallel via SQLite WAL connections, mapping results in-memory with $O(1)$ hash maps. Eliminates the $N+1$ query problem entirely.

### 4. Transactional Bulk Operations with Strict Rollback
- Perform batch operations (`move`, `tag`, `untag`, `complete`, `reopen`, `archive`, `delete`, `set_priority`, `set_due_date`) over dozens of tasks in a single atomic database transaction.
- **Strict 404 Rollback Guarantee**: If any target task ID does not exist, belongs to another user, or fails validation, the entire transaction rolls back immediately with zero partial state mutation.

### 5. Resilient Soft-Delete Cascade, 1-Click Restore & Daily Purge
- **Recursive Soft-Delete**: Deleting a folder, list, section, or task cascades `deletedAt` timestamps across all dependent child items, checklists, and tag relations.
- **Smart 1-Click Restore**: Restoring an item intelligently checks for ancestor viability. If the original container was permanently removed, the restored task automatically falls back safely to the user's default `Inbox`.
- **Automated Purge Cron**: Powered by `@elysiajs/cron`, an internal daemon runs daily at `03:00 UTC` to clean up and permanently purge soft-deleted records older than 30 days.

### 6. Deep Tree Duplication & Reusable Template Engine
- **Task Tree Snapshots**: Snapshot any complex task and its nested hierarchy (subtasks, checklist items, tags) into a reusable template definition (capped at 100 nodes, depth $\le 3$).
- **One-Click Instantiation**: Instantiate templates into any list or section with newly minted UUIDv7 identifiers and preserved relative tree topologies.
- **Deep Duplication**: Clone existing task trees instantaneously with automated ID re-mapping and position-right-after insertion.

### 7. Dual-Mode Authentication & Multi-Tenant Security
- **Instant Demo Experience**: Explore the full platform without barriers via an ephemeral guest demo session.
- **Production Better Auth**: Multi-tenant authentication with Argon2/scrypt password hashing, session tokens, TOTP two-factor authentication (2FA) with recovery backup codes, and strict user-scoped tenancy isolation on every database query.
