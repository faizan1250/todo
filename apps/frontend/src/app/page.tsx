import { BackendStatusBadge } from "@/components/backend-status-badge";
import { TodoDashboard } from "@/components/todo-dashboard";
import { UserNav, AuthSessionCard } from "@/components/auth";
import { ListTodoIcon } from "@/components/icons";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-zinc-50/60 text-zinc-900 selection:bg-zinc-900 selection:text-white dark:bg-black dark:text-zinc-50 dark:selection:bg-zinc-100 dark:selection:text-zinc-950">
      {/* Top Navigation / App Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950">
              <ListTodoIcon className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight text-zinc-950 dark:text-white">
                Todo Studio
              </span>
              <span className="ml-2 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                v0.1.0
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Backend Healthcheck Status Indicator */}
            <BackendStatusBadge />
            {/* Authenticated / Unauthenticated Navigation Trigger */}
            <UserNav />
          </div>
        </div>
      </header>

      {/* Main Workspace View */}
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl dark:text-white">
            Sprint Board & Milestones
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            High-performance task orchestration interface paired with ElysiaJS backend.
          </p>
        </div>

        {/* Live Auth Session / Invite Guard Showcase */}
        <AuthSessionCard />

        {/* Dashboard Surface */}
        <section
          aria-label="Todo Management Workspace"
          className="rounded-2xl border border-zinc-200/80 bg-white/90 p-5 shadow-sm backdrop-blur-xs sm:p-7 dark:border-zinc-800/90 dark:bg-zinc-900/40"
        >
          <TodoDashboard />
        </section>

        {/* Architecture Spec Summary */}
        <footer className="mt-10 border-t border-zinc-200/70 pt-6 text-center text-xs text-zinc-400 dark:border-zinc-800/70 dark:text-zinc-600">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono">
            <span>Next.js 16 (App Router)</span>
            <span>•</span>
            <span>TailwindCSS v4</span>
            <span>•</span>
            <span>Better Auth</span>
            <span>•</span>
            <span>ElysiaJS Backend (:3001)</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
