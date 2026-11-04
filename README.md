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
