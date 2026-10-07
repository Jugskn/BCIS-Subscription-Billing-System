import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function LockScreen() {
  const { user, unlock, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Unable to unlock session.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md border border-border bg-surface p-8">
        <h1 className="text-xl font-semibold text-ink">Session locked</h1>
        <p className="mt-1 text-sm text-muted">
          Enter the password for <span className="text-ink">{user?.username}</span>{" "}
          to continue.
        </p>
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="lock-password">Password</Label>
            <Input
              id="lock-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={busy}>
            Unlock
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
