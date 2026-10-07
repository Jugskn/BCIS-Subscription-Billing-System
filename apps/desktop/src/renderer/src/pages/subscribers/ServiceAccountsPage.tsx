import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatCentavos, type ServiceAccountListItem } from "@bcis/shared";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/components/toast";
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

const createSchema = z.object({
  subscriberId: z.string().uuid("Select a subscriber."),
  servicePlanId: z.string().uuid("Select a plan."),
  collectionAreaId: z.union([z.string().uuid(), z.literal("")]).optional(),
  collectorUserId: z.union([z.string().uuid(), z.literal("")]).optional(),
  installationAddress: z.string().min(1),
  activationDate: z.string().min(1),
  billingStartDate: z.string().min(1),
  dueDay: z.number().int().min(1).max(28),
});

type CreateForm = z.infer<typeof createSchema>;

export function ServiceAccountsPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscriberLabel, setSubscriberLabel] = useState("");
  const [planLabel, setPlanLabel] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [collectorLabel, setCollectorLabel] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["service-accounts-all"],
    queryFn: () => api.listServiceAccounts({ page: 1, pageSize: 100 }),
  });

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      subscriberId: "",
      servicePlanId: "",
      collectionAreaId: "",
      collectorUserId: "",
      installationAddress: "",
      activationDate: new Date().toISOString().slice(0, 10),
      billingStartDate: new Date().toISOString().slice(0, 10),
      dueDay: 15,
    },
  });

  const loadSubscribers = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.subscriberOptions(search || undefined);
      return items.map((s) => ({
        value: s.id,
        label: `${s.accountNumber} — ${s.fullName}`,
      }));
    },
    [api],
  );

  const loadPlans = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.planOptions(search || undefined);
      return items.map((p) => ({
        value: p.id,
        label: `${p.code} — ${p.name} (${formatCentavos(BigInt(p.priceCentavos))})`,
      }));
    },
    [api],
  );

  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.areaOptions(search || undefined);
      return items.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
      }));
    },
    [api],
  );

  const loadCollectors = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.collectorOptions(search || undefined);
      return items.map((c) => ({
        value: c.id,
        label: `${c.fullName} (${c.username})`,
      }));
    },
    [api],
  );

  const createMutation = useMutation({
    mutationFn: async (values: CreateForm) => {
      const account = await api.createServiceAccount({
        subscriberId: values.subscriberId,
        servicePlanId: values.servicePlanId,
        installationAddress: values.installationAddress,
        activationDate: values.activationDate,
        billingStartDate: values.billingStartDate,
        dueDay: values.dueDay,
        collectorUserId: values.collectorUserId || null,
      });
      // Area lives on the subscriber; optionally align it when creating a service.
      if (values.collectionAreaId) {
        await api.updateSubscriber(values.subscriberId, {
          collectionAreaId: values.collectionAreaId,
        });
      }
      return account;
    },
    onSuccess: async () => {
      setOpen(false);
      form.reset();
      setSubscriberLabel("");
      setPlanLabel("");
      setAreaLabel("");
      setCollectorLabel("");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["service-accounts-all"] });
      toast.success("Service account created.");
    },
    onError: (err) => {
      setError(applyApiFieldErrors(form.setError, err));
    },
  });

  const columns = useMemo<ColumnDef<ServiceAccountListItem>[]>(
    () => [
      { accessorKey: "accountNumber", header: "Service account" },
      { accessorKey: "subscriberAccountNumber", header: "Subscriber" },
      { accessorKey: "subscriberName", header: "Name" },
      { accessorKey: "planName", header: "Plan" },
      { accessorKey: "serviceTypeName", header: "Type" },
      {
        accessorKey: "currentRateCentavos",
        header: "Rate",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.currentRateCentavos))}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Service accounts</h1>
          <p className="mt-1 text-sm text-muted">
            Active services across all subscribers.
          </p>
        </div>
        {can("service.manage") ? (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) {
                form.reset();
                setError(null);
                setSubscriberLabel("");
                setPlanLabel("");
                setAreaLabel("");
                setCollectorLabel("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button type="button">New service account</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>New service account</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={form.handleSubmit((values) => {
                  setError(null);
                  createMutation.mutate(values);
                })}
              >
                <div className="space-y-2">
                  <Label>Subscriber</Label>
                  <Controller
                    control={form.control}
                    name="subscriberId"
                    render={({ field }) => (
                      <AsyncCombobox
                        value={field.value}
                        selectedLabel={subscriberLabel}
                        loadOptions={loadSubscribers}
                        placeholder="Search subscriber…"
                        onChange={(v, opt) => {
                          field.onChange(v);
                          setSubscriberLabel(opt?.label ?? "");
                        }}
                      />
                    )}
                  />
                  {form.formState.errors.subscriberId ? (
                    <p className="text-sm text-danger">
                      {form.formState.errors.subscriberId.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Controller
                    control={form.control}
                    name="servicePlanId"
                    render={({ field }) => (
                      <AsyncCombobox
                        value={field.value}
                        selectedLabel={planLabel}
                        loadOptions={loadPlans}
                        placeholder="Search plan…"
                        onChange={(v, opt) => {
                          field.onChange(v);
                          setPlanLabel(opt?.label ?? "");
                        }}
                      />
                    )}
                  />
                  {form.formState.errors.servicePlanId ? (
                    <p className="text-sm text-danger">
                      {form.formState.errors.servicePlanId.message}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Collection area</Label>
                  <Controller
                    control={form.control}
                    name="collectionAreaId"
                    render={({ field }) => (
                      <AsyncCombobox
                        value={field.value ?? ""}
                        selectedLabel={areaLabel}
                        loadOptions={loadAreas}
                        placeholder="Search area…"
                        onChange={(v, opt) => {
                          field.onChange(v);
                          setAreaLabel(opt?.label ?? "");
                        }}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Collector</Label>
                  <Controller
                    control={form.control}
                    name="collectorUserId"
                    render={({ field }) => (
                      <AsyncCombobox
                        value={field.value ?? ""}
                        selectedLabel={collectorLabel}
                        loadOptions={loadCollectors}
                        placeholder="Search collector…"
                        onChange={(v, opt) => {
                          field.onChange(v);
                          setCollectorLabel(opt?.label ?? "");
                        }}
                      />
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Installation address</Label>
                  <Input {...form.register("installationAddress")} />
                  {form.formState.errors.installationAddress ? (
                    <p className="text-sm text-danger">
                      {form.formState.errors.installationAddress.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Activation date</Label>
                    <Input type="date" {...form.register("activationDate")} />
                  </div>
                  <div className="space-y-2">
                    <Label>Billing start</Label>
                    <Input type="date" {...form.register("billingStartDate")} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Due day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    {...form.register("dueDay", { valueAsNumber: true })}
                  />
                </div>
                {error ? <p className="text-sm text-danger">{error}</p> : null}
                <Button type="submit" disabled={createMutation.isPending}>
                  Create
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {accountsQuery.isError ? (
        <p className="text-sm text-danger">
          {accountsQuery.error instanceof ApiClientError
            ? accountsQuery.error.message
            : "Failed to load service accounts."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={accountsQuery.data?.items ?? []}
        searchPlaceholder="Search service accounts…"
      />
    </div>
  );
}
