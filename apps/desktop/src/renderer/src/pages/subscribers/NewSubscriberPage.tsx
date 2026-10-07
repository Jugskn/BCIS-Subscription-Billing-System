import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "react-router-dom";
import { useCallback, useState } from "react";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { applyApiFieldErrors } from "@/lib/api";

const formSchema = z.object({
  fullName: z.string().min(1, "Full name is required."),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  address: z.string().min(1, "Address is required."),
  collectionAreaId: z.string().optional(),
  collectorUserId: z.string().optional(),
  dueDay: z.number().int().min(1).max(28),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export function NewSubscriberPage() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [areaLabel, setAreaLabel] = useState("");
  const [collectorLabel, setCollectorLabel] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fullName: "",
      contactPhone: "",
      contactEmail: "",
      address: "",
      collectionAreaId: "",
      collectorUserId: "",
      dueDay: 15,
      notes: "",
    },
  });

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
    mutationFn: (values: FormValues) =>
      api.createSubscriber({
        fullName: values.fullName,
        contactPhone: values.contactPhone || undefined,
        contactEmail: values.contactEmail || undefined,
        address: values.address,
        collectionAreaId: values.collectionAreaId || null,
        collectorUserId: values.collectorUserId || null,
        dueDay: values.dueDay,
        notes: values.notes || undefined,
      }),
    onSuccess: async (subscriber) => {
      await qc.invalidateQueries({ queryKey: ["subscribers"] });
      toast.success("Subscriber created.");
      navigate(`/subscribers/${subscriber.id}`);
    },
    onError: (err) => {
      setError(applyApiFieldErrors(form.setError, err));
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">New subscriber</h1>
        <p className="mt-1 text-sm text-muted">
          Account number is assigned automatically on save.
        </p>
      </div>

      <form
        className="space-y-6 rounded-md border border-border bg-surface p-6"
        onSubmit={form.handleSubmit((values) => {
          setError(null);
          createMutation.mutate(values);
        })}
      >
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-ink">Identity</h2>
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name *</Label>
            <Input id="fullName" {...form.register("fullName")} />
            {form.formState.errors.fullName ? (
              <p className="text-sm text-danger">
                {form.formState.errors.fullName.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" {...form.register("contactPhone")} />
              {form.formState.errors.contactPhone ? (
                <p className="text-sm text-danger">
                  {form.formState.errors.contactPhone.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Email</Label>
              <Input id="contactEmail" type="email" {...form.register("contactEmail")} />
              {form.formState.errors.contactEmail ? (
                <p className="text-sm text-danger">
                  {form.formState.errors.contactEmail.message}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-ink">Address & collection</h2>
          <div className="space-y-2">
            <Label htmlFor="address">Address *</Label>
            <Input id="address" {...form.register("address")} />
            {form.formState.errors.address ? (
              <p className="text-sm text-danger">
                {form.formState.errors.address.message}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="dueDay">Due day (1–28) *</Label>
            <Input
              id="dueDay"
              type="number"
              min={1}
              max={28}
              {...form.register("dueDay", { valueAsNumber: true })}
            />
            {form.formState.errors.dueDay ? (
              <p className="text-sm text-danger">
                {form.formState.errors.dueDay.message}
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={3}
            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            {...form.register("notes")}
          />
        </section>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending}>
            Create subscriber
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/subscribers")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
