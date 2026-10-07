import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ROLES, type UserListItem } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

const createSchema = z.object({
  username: z.string().min(3),
  fullName: z.string().min(1),
  password: z.string().min(8),
  roleNames: z.array(z.string()).min(1),
});

type CreateForm = z.infer<typeof createSchema>;

export function UsersPage() {
  const { api } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [assignUser, setAssignUser] = useState<UserListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api.listUsers({ page: 1, pageSize: 100 }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: "",
      fullName: "",
      password: "",
      roleNames: ["Viewer"],
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) => api.createUser(values),
    onSuccess: async () => {
      setOpen(false);
      form.reset({ username: "", fullName: "", password: "", roleNames: ["Viewer"] });
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Create failed.");
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.deactivateUser(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, roleNames }: { id: string; roleNames: string[] }) =>
      api.assignRoles(id, roleNames),
    onSuccess: async () => {
      setAssignUser(null);
      await qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const columns = useMemo<ColumnDef<UserListItem>[]>(
    () => [
      { accessorKey: "username", header: "Username" },
      { accessorKey: "fullName", header: "Full name" },
      {
        accessorKey: "roles",
        header: "Roles",
        cell: ({ row }) => row.original.roles.join(", "),
      },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "success" : "muted"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAssignUser(row.original)}
            >
              Assign role
            </Button>
            {row.original.isActive ? (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => deactivateMutation.mutate(row.original.id)}
              >
                Deactivate
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [deactivateMutation],
  );

  const selectedRoles = form.watch("roleNames");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Users</h1>
          <p className="mt-1 text-sm text-muted">
            Create accounts, assign roles, and deactivate users.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button">Create user</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((values) => {
                setError(null);
                createMutation.mutate(values);
              })}
            >
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" {...form.register("username")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" {...form.register("fullName")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...form.register("password")} />
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLES.map((role) => {
                    const checked = selectedRoles.includes(role);
                    return (
                      <label key={role} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selectedRoles, role]
                              : selectedRoles.filter((r) => r !== role);
                            form.setValue("roleNames", next, { shouldValidate: true });
                          }}
                        />
                        {role}
                      </label>
                    );
                  })}
                </div>
              </div>
              {error ? <p className="text-sm text-danger">{error}</p> : null}
              <Button type="submit" disabled={createMutation.isPending}>
                Save
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {usersQuery.isError ? (
        <p className="text-sm text-danger">
          {usersQuery.error instanceof ApiClientError
            ? usersQuery.error.message
            : "Failed to load users."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={usersQuery.data?.items ?? []}
        searchPlaceholder="Search users…"
      />

      <Dialog open={Boolean(assignUser)} onOpenChange={(v) => !v && setAssignUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign roles — {assignUser?.username}</DialogTitle>
          </DialogHeader>
          {assignUser ? (
            <AssignRolesForm
              initial={assignUser.roles}
              onSave={(roleNames) =>
                assignMutation.mutate({ id: assignUser.id, roleNames })
              }
              busy={assignMutation.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignRolesForm({
  initial,
  onSave,
  busy,
}: {
  initial: string[];
  onSave: (roles: string[]) => void;
  busy: boolean;
}) {
  const [roleNames, setRoleNames] = useState(initial);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={roleNames.includes(role)}
              onChange={(e) => {
                setRoleNames((prev) =>
                  e.target.checked
                    ? [...prev, role]
                    : prev.filter((r) => r !== role),
                );
              }}
            />
            {role}
          </label>
        ))}
      </div>
      <Button
        type="button"
        disabled={busy || roleNames.length === 0}
        onClick={() => onSave(roleNames)}
      >
        Save roles
      </Button>
    </div>
  );
}
