import { Outlet } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Lock, LogOut } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { UserIdentity } from "@/components/user-identity";
import { useAuth } from "@/lib/auth";

export function AppShell() {
  const { lock, logout, user } = useAuth();

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-end border-b border-border bg-surface px-6 py-2">
          {user ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy/30"
                  aria-label="Open user menu"
                >
                  <UserIdentity user={user} align="right" />
                  <ChevronDown className="h-4 w-4 text-muted" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg"
                >
                  <DropdownMenu.Item
                    onSelect={lock}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-ink outline-none hover:bg-canvas focus:bg-canvas"
                  >
                    <Lock className="h-4 w-4" />
                    Lock screen
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => void logout()}
                    className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-danger outline-none hover:bg-canvas focus:bg-canvas"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
