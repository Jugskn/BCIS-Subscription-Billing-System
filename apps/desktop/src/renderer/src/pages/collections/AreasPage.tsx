import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CollectionAreaListItem } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { useToast } from "@/components/toast";
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
import { ApiClientError, applyApiFieldErrors } from "@/lib/api";

const areaFormSchema = z.object({
  code: z.string().min(1, "Code is required."),
  name: z.string().min(1, "Name is required."),
  description: z.string().optional(),
});

type AreaForm = z.infer<typeof areaFormSchema>;

function emptyToNull(description: string | undefined): string | null {
  const trimmed = description?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function AreasPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editArea, setEditArea] = useState<CollectionAreaListItem | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const areasQuery = useQuery({
    queryKey: ["collection-areas"],
    queryFn: () => api.listCollectionAreas({ page: 1, pageSize: 100 }),
  });

  const createForm = useForm<AreaForm>({
    resolver: zodResolver(areaFormSchema),
    defaultValues: { code: "", name: "", description: "" },
  });

  const editForm = useForm<AreaForm>({
    resolver: zodResolver(areaFormSchema),
    defaultValues: { code: "", name: "", description: "" },
  });

  const createMutation = useMutation({
    mutationFn: (values: AreaForm) =>
      api.createCollectionArea({
        code: values.code,
        name: values.name,
        description: emptyToNull(values.description),
      }),
    onSuccess: async () => {
      setCreateOpen(false);
      createForm.reset();
      setCreateError(null);
      await qc.invalidateQueries({ queryKey: ["collection-areas"] });
      toast.success("Area created.");
    },
    onError: (err) => {
      setCreateError(applyApiFieldErrors(createForm.setError, err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: AreaForm }) =>
      api.updateCollectionArea(id, {
        code: values.code.trim(),
        name: values.name.trim(),
        description: emptyToNull(values.description),
      }),
    onSuccess: async () => {
      setEditArea(null);
      editForm.reset({ code: "", name: "", description: "" });
      setEditError(null);
      await qc.invalidateQueries({ queryKey: ["collection-areas"] });
      toast.success("Area updated.");
    },
    onError: (err) => {
      setEditError(applyApiFieldErrors(editForm.setError, err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCollectionArea(id),
    onSuccess: async () => {
      setActionError(null);
      await qc.invalidateQueries({ queryKey: ["collection-areas"] });
      toast.success("Area deleted.");
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiClientError ? err.message : "Delete failed.",
      );
    },
  });

  const columns = useMemo<ColumnDef<CollectionAreaListItem>[]>(
    () => [
      { accessorKey: "code", header: "Code" },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "description", header: "Description" },
      {
        accessorKey: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "success" : "muted"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      },
      ...(can("collection.create")
        ? [
            {
              id: "actions",
              header: "Actions",
              cell: ({ row }) => (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditError(null);
                      editForm.reset({
                        code: row.original.code,
                        name: row.original.name,
                        description: row.original.description ?? "",
                      });
                      setEditArea(row.original);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete area ${row.original.code}? Only allowed if no subscribers use it.`,
                        )
                      ) {
                        return;
                      }
                      setActionError(null);
                      deleteMutation.mutate(row.original.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ),
            } satisfies ColumnDef<CollectionAreaListItem>,
          ]
        : []),
    ],
    [can, deleteMutation.isPending, editForm],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Areas & routes</h1>
          <p className="mt-1 text-sm text-muted">
            Collection areas for house-to-house billing routes.
          </p>
        </div>
        {can("collection.create") ? (
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) {
                createForm.reset();
                setCreateError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button type="button">New area</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New collection area</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={createForm.handleSubmit((values) => {
                  setCreateError(null);
                  createMutation.mutate(values);
                })}
              >
                <div className="space-y-2">
                  <Label htmlFor="area-create-code">Code</Label>
                  <Input id="area-create-code" {...createForm.register("code")} />
                  {createForm.formState.errors.code ? (
                    <p className="text-sm text-danger">
                      {createForm.formState.errors.code.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="area-create-name">Name</Label>
                  <Input id="area-create-name" {...createForm.register("name")} />
                  {createForm.formState.errors.name ? (
                    <p className="text-sm text-danger">
                      {createForm.formState.errors.name.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="area-create-description">Description</Label>
                  <Input
                    id="area-create-description"
                    {...createForm.register("description")}
                  />
                  {createForm.formState.errors.description ? (
                    <p className="text-sm text-danger">
                      {createForm.formState.errors.description.message}
                    </p>
                  ) : null}
                </div>
                {createError ? (
                  <p className="text-sm text-danger">{createError}</p>
                ) : null}
                <Button type="submit" disabled={createMutation.isPending}>
                  Create area
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
      {areasQuery.isError ? (
        <p className="text-sm text-danger">
          {areasQuery.error instanceof ApiClientError
            ? areasQuery.error.message
            : "Failed to load areas."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={areasQuery.data?.items ?? []}
        searchPlaceholder="Search areas…"
      />

      <Dialog
        open={editArea !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditArea(null);
            editForm.reset({ code: "", name: "", description: "" });
            setEditError(null);
          }
        }}
      >
        <DialogContent
          onPointerDownOutside={(e) => {
            if (updateMutation.isPending) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (updateMutation.isPending) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit collection area</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={editForm.handleSubmit((values) => {
              if (!editArea) return;
              setEditError(null);
              updateMutation.mutate({ id: editArea.id, values });
            })}
          >
            <div className="space-y-2">
              <Label htmlFor="area-edit-code">Code</Label>
              <Input id="area-edit-code" {...editForm.register("code")} />
              {editForm.formState.errors.code ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.code.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="area-edit-name">Name</Label>
              <Input id="area-edit-name" {...editForm.register("name")} />
              {editForm.formState.errors.name ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="area-edit-description">Description</Label>
              <Input
                id="area-edit-description"
                {...editForm.register("description")}
              />
              {editForm.formState.errors.description ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.description.message}
                </p>
              ) : null}
            </div>
            {editError ? <p className="text-sm text-danger">{editError}</p> : null}
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
