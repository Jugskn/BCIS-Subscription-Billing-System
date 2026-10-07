import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { SERVICE_TYPE_CODES, type ServicePlanListItem } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
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

const createSchema = z
  .object({
    serviceTypeCode: z.enum(SERVICE_TYPE_CODES),
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.string().min(1),
    installationFee: z.string().optional(),
    speedMbps: z.number().int().positive().optional(),
    channelCount: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.serviceTypeCode === "INTERNET" && !data.speedMbps) {
      ctx.addIssue({ code: "custom", message: "Speed required", path: ["speedMbps"] });
    }
    if (data.serviceTypeCode === "CABLE" && !data.channelCount) {
      ctx.addIssue({ code: "custom", message: "Channels required", path: ["channelCount"] });
    }
  });

const editSchema = z.object({
  name: z.string().min(1, "Name is required."),
  description: z.string().optional(),
  price: z.string().min(1, "Price is required."),
  isActive: z.boolean(),
});

type CreateForm = z.infer<typeof createSchema>;
type EditForm = z.infer<typeof editSchema>;

function centavosToPesosInput(centavos: string): string {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return "0.00";
  return (n / 100).toFixed(2);
}

export function PlansPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<ServicePlanListItem | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const plansQuery = useQuery({
    queryKey: ["service-plans"],
    queryFn: () => api.listServicePlans({ page: 1, pageSize: 100 }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      serviceTypeCode: "INTERNET",
      code: "",
      name: "",
      description: "",
      price: "",
      installationFee: "0",
      speedMbps: undefined,
      channelCount: undefined,
    },
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", description: "", price: "", isActive: true },
  });

  const serviceType = form.watch("serviceTypeCode");

  const createMutation = useMutation({
    mutationFn: (values: CreateForm) =>
      api.createServicePlan({
        serviceTypeCode: values.serviceTypeCode,
        code: values.code,
        name: values.name,
        description: values.description,
        price: values.price,
        installationFee: values.installationFee || "0",
        speedMbps: values.speedMbps,
        channelCount: values.channelCount,
      }),
    onSuccess: async () => {
      setOpen(false);
      form.reset();
      setCreateError(null);
      await qc.invalidateQueries({ queryKey: ["service-plans"] });
      toast.success("Plan created.");
    },
    onError: (err) => {
      setCreateError(applyApiFieldErrors(form.setError, err));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditForm }) =>
      api.updateServicePlan(id, {
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        price: values.price.trim(),
        isActive: values.isActive,
      }),
    onSuccess: async () => {
      setEditPlan(null);
      editForm.reset();
      setEditError(null);
      await qc.invalidateQueries({ queryKey: ["service-plans"] });
      toast.success("Plan updated.");
    },
    onError: (err) => {
      setEditError(applyApiFieldErrors(editForm.setError, err));
    },
  });

  const columns = useMemo<ColumnDef<ServicePlanListItem>[]>(
    () => [
      { accessorKey: "code", header: "Code" },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "serviceTypeName", header: "Type" },
      {
        accessorKey: "priceCentavos",
        header: "Price",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.priceCentavos))}
          </span>
        ),
      },
      {
        id: "details",
        header: "Details",
        cell: ({ row }) => {
          const p = row.original;
          if (p.speedMbps) return `${p.speedMbps} Mbps`;
          if (p.channelCount) return `${p.channelCount} channels`;
          return "—";
        },
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
      ...(can("service.manage")
        ? [
            {
              id: "actions",
              header: "Actions",
              cell: ({ row }) => (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditError(null);
                    editForm.reset({
                      name: row.original.name,
                      description: row.original.description ?? "",
                      price: centavosToPesosInput(row.original.priceCentavos),
                      isActive: row.original.isActive,
                    });
                    setEditPlan(row.original);
                  }}
                >
                  Edit
                </Button>
              ),
            } satisfies ColumnDef<ServicePlanListItem>,
          ]
        : []),
    ],
    [can, editForm],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Service plans</h1>
          <p className="mt-1 text-sm text-muted">
            Internet, Cable, and Combo plans. Price changes affect future billing only.
          </p>
        </div>
        {can("service.manage") ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button">New plan</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>New service plan</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit((values) => {
                  setCreateError(null);
                  createMutation.mutate(values);
                })}
              >
                <div className="space-y-2">
                  <Label>Service type</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-border px-3 text-sm"
                    {...form.register("serviceTypeCode")}
                  >
                    {SERVICE_TYPE_CODES.map((c: (typeof SERVICE_TYPE_CODES)[number]) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Code</Label>
                    <Input {...form.register("code")} />
                    {form.formState.errors.code ? (
                      <p className="text-sm text-danger">
                        {form.formState.errors.code.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input {...form.register("name")} />
                    {form.formState.errors.name ? (
                      <p className="text-sm text-danger">
                        {form.formState.errors.name.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Price (PHP)</Label>
                    <Input placeholder="999.00" {...form.register("price")} />
                    {form.formState.errors.price ? (
                      <p className="text-sm text-danger">
                        {form.formState.errors.price.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Install fee (PHP)</Label>
                    <Input placeholder="0.00" {...form.register("installationFee")} />
                  </div>
                </div>
                {serviceType === "INTERNET" ? (
                  <div className="space-y-2">
                    <Label>Speed (Mbps)</Label>
                    <Input
                      type="number"
                      {...form.register("speedMbps", { valueAsNumber: true })}
                    />
                    {form.formState.errors.speedMbps ? (
                      <p className="text-sm text-danger">
                        {form.formState.errors.speedMbps.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {serviceType === "CABLE" ? (
                  <div className="space-y-2">
                    <Label>Channel count</Label>
                    <Input
                      type="number"
                      {...form.register("channelCount", { valueAsNumber: true })}
                    />
                    {form.formState.errors.channelCount ? (
                      <p className="text-sm text-danger">
                        {form.formState.errors.channelCount.message}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input {...form.register("description")} />
                </div>
                {createError ? <p className="text-sm text-danger">{createError}</p> : null}
                <Button type="submit" disabled={createMutation.isPending}>
                  Create plan
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {plansQuery.isError ? (
        <p className="text-sm text-danger">
          {plansQuery.error instanceof ApiClientError
            ? plansQuery.error.message
            : "Failed to load plans."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={plansQuery.data?.items ?? []}
        searchPlaceholder="Search plans…"
      />

      <Dialog
        open={editPlan !== null}
        onOpenChange={(openState) => {
          if (!openState) {
            setEditPlan(null);
            editForm.reset();
            setEditError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit plan {editPlan?.code}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={editForm.handleSubmit((values) => {
              if (!editPlan) return;
              setEditError(null);
              updateMutation.mutate({ id: editPlan.id, values });
            })}
          >
            <div className="space-y-2">
              <Label>Name</Label>
              <Input {...editForm.register("name")} />
              {editForm.formState.errors.name ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Price (PHP)</Label>
              <Input {...editForm.register("price")} className="tabular-nums" />
              {editForm.formState.errors.price ? (
                <p className="text-sm text-danger">
                  {editForm.formState.errors.price.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input {...editForm.register("description")} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...editForm.register("isActive")} />
              Active
            </label>
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
