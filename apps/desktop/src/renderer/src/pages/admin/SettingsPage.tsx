import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  GCASH_DUPLICATE_POLICY,
  PAYMENT_METHODS,
  PROOF_FILE_TYPES,
  pesosToCentavos,
  type SettingSection,
} from "@bcis/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { ApiClientError, applyApiFieldErrors } from "@/lib/api";
import { cn } from "@/lib/utils";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-sm text-danger">{message}</p>;
}

function pesosField(centavos: unknown): string {
  try {
    const n = BigInt(String(centavos ?? 0));
    const neg = n < 0n;
    const abs = neg ? -n : n;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, "0");
    return `${neg ? "-" : ""}${whole}.${frac}`;
  } catch {
    return "0.00";
  }
}

function parsePesosToCentavos(raw: string): number {
  const cleaned = raw.trim().replace(/,/g, "");
  if (!cleaned) return 0;
  return Number(pesosToCentavos(cleaned));
}

type SectionCardProps = {
  title: string;
  description?: string;
  section: SettingSection;
  canManage: boolean;
  onRestore: (section: SettingSection) => void;
  restoring: boolean;
  children: React.ReactNode;
  onSave: () => void;
  saving: boolean;
};

function SectionCard({
  title,
  description,
  section,
  canManage,
  onRestore,
  restoring,
  children,
  onSave,
  saving,
}: SectionCardProps) {
  return (
    <section className="border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {canManage ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={restoring || saving}
                onClick={() => onRestore(section)}
              >
                Restore defaults
              </Button>
              <Button type="button" disabled={saving} onClick={onSave}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { api, can } = useAuth();
  const canManage = can("settings.manage");
  const toast = useToast();
  const qc = useQueryClient();
  const [restoreSection, setRestoreSection] = useState<SettingSection | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
    enabled: can("settings.view"),
  });

  const historyQuery = useQuery({
    queryKey: ["settings-history"],
    queryFn: () => api.getSettingsHistory({ page: 1, pageSize: 50 }),
    enabled: can("settings.view"),
  });

  const meta = settingsQuery.data?.meta;
  const system = settingsQuery.data?.system;

  const companyForm = useForm({
    defaultValues: {
      company_name: "",
      company_address: "",
      company_contact_number: "",
      company_email: "",
      company_tin: "",
    },
  });

  const billingForm = useForm({
    defaultValues: {
      default_due_day: 15,
      invoice_number_prefix: "INV",
      billing_generation_day_note: "",
      penalties_enabled: false,
      penalty_type: "fixed" as "fixed" | "percent",
      penalty_value: "0.00",
      reconnection_fee_default_centavos: "0.00",
      installation_fee_default_centavos: "0.00",
    },
  });

  const receivablesForm = useForm({
    defaultValues: {
      grace_days: 5,
      suspension_threshold_months: 3,
      suspension_threshold_centavos: "2000.00",
      follow_up_threshold_days: 7,
    },
  });

  const paymentsForm = useForm({
    defaultValues: {
      receipt_number_prefix: "RCPT",
      enabled_payment_methods: [...PAYMENT_METHODS] as string[],
      proof_max_size_mb: 5,
      proof_allowed_types: [...PROOF_FILE_TYPES] as string[],
    },
  });

  const securityForm = useForm({
    defaultValues: {
      session_timeout_minutes: 30,
      login_max_attempts: 5,
      login_lockout_minutes: 15,
      min_password_length: 8,
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    const st = settingsQuery.data.settings;
    companyForm.reset({
      company_name: String(st.company_name ?? ""),
      company_address: String(st.company_address ?? ""),
      company_contact_number: String(st.company_contact_number ?? ""),
      company_email: String(st.company_email ?? ""),
      company_tin: String(st.company_tin ?? ""),
    });
    billingForm.reset({
      default_due_day: Number(st.default_due_day ?? 15),
      invoice_number_prefix: String(st.invoice_number_prefix ?? "INV"),
      billing_generation_day_note: String(st.billing_generation_day_note ?? ""),
      penalties_enabled: Boolean(st.penalties_enabled),
      penalty_type: (st.penalty_type as "fixed" | "percent") ?? "fixed",
      penalty_value:
        st.penalty_type === "percent"
          ? String(st.penalty_value ?? 0)
          : pesosField(st.penalty_value),
      reconnection_fee_default_centavos: pesosField(
        st.reconnection_fee_default_centavos,
      ),
      installation_fee_default_centavos: pesosField(
        st.installation_fee_default_centavos,
      ),
    });
    receivablesForm.reset({
      grace_days: Number(st.grace_days ?? 5),
      suspension_threshold_months: Number(st.suspension_threshold_months ?? 3),
      suspension_threshold_centavos: pesosField(
        st.suspension_threshold_centavos,
      ),
      follow_up_threshold_days: Number(st.follow_up_threshold_days ?? 7),
    });
    paymentsForm.reset({
      receipt_number_prefix: String(st.receipt_number_prefix ?? "RCPT"),
      enabled_payment_methods: (st.enabled_payment_methods as string[]) ?? [
        ...PAYMENT_METHODS,
      ],
      proof_max_size_mb: Number(st.proof_max_size_mb ?? 5),
      proof_allowed_types: (st.proof_allowed_types as string[]) ?? [
        ...PROOF_FILE_TYPES,
      ],
    });
    securityForm.reset({
      session_timeout_minutes: Number(st.session_timeout_minutes ?? 30),
      login_max_attempts: Number(st.login_max_attempts ?? 5),
      login_lockout_minutes: Number(st.login_lockout_minutes ?? 15),
      min_password_length: Number(st.min_password_length ?? 8),
    });
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateSettings(patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["settings-history"] });
      toast.success("Settings saved.");
      setFormError(null);
    },
    onError: (err, _vars, context) => {
      const setError = (context as { setError?: typeof companyForm.setError })
        ?.setError;
      if (setError) {
        setFormError(applyApiFieldErrors(setError as never, err));
      } else {
        setFormError(
          err instanceof ApiClientError ? err.message : "Cannot reach the server",
        );
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (section: SettingSection) => api.restoreSettingsDefaults(section),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await qc.invalidateQueries({ queryKey: ["settings-history"] });
      setRestoreSection(null);
      toast.success("Defaults restored.");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    },
  });

  if (!can("settings.view")) {
    return (
      <p className="text-sm text-muted">
        You do not have permission to view settings.
      </p>
    );
  }

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-muted">Loading settings…</p>;
  }

  if (settingsQuery.isError) {
    return (
      <p className="text-sm text-danger">
        {settingsQuery.error instanceof ApiClientError
          ? settingsQuery.error.message
          : "Could not load settings."}
      </p>
    );
  }

  const readOnly = !canManage;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Settings</h1>
        <p className="mt-2 text-sm text-muted">
          Application configuration. Changes apply going forward and never alter
          posted invoices, ledger entries, or payments.
          {readOnly ? " You have read-only access." : null}
        </p>
      </div>

      {formError ? <p className="text-sm text-danger">{formError}</p> : null}

      <SectionCard
        title="Company profile"
        description="Used in receipt, SOA, route sheet, and report headers."
        section="company"
        canManage={canManage}
        onRestore={setRestoreSection}
        restoring={restoreMutation.isPending}
        saving={saveMutation.isPending}
        onSave={() => {
          const v = companyForm.getValues();
          saveMutation.mutate(v, {
            onError: (err) => {
              setFormError(
                applyApiFieldErrors(companyForm.setError as never, err),
              );
            },
          });
        }}
      >
        {(
          [
            ["company_name", "Company name"],
            ["company_address", "Address"],
            ["company_contact_number", "Contact number (+63)"],
            ["company_email", "Email"],
            ["company_tin", "TIN (optional)"],
          ] as const
        ).map(([name, label]) => (
          <div key={name} className={name === "company_address" ? "sm:col-span-2" : ""}>
            <Label htmlFor={name}>{label}</Label>
            <Input
              id={name}
              className="mt-1"
              disabled={readOnly}
              {...companyForm.register(name)}
            />
            <FieldError message={companyForm.formState.errors[name]?.message} />
          </div>
        ))}
      </SectionCard>

      <SectionCard
        title="Billing"
        section="billing"
        canManage={canManage}
        onRestore={setRestoreSection}
        restoring={restoreMutation.isPending}
        saving={saveMutation.isPending}
        onSave={() => {
          const v = billingForm.getValues();
          const penaltyValue =
            v.penalty_type === "percent"
              ? Number(v.penalty_value)
              : parsePesosToCentavos(v.penalty_value);
          saveMutation.mutate(
            {
              default_due_day: Number(v.default_due_day),
              invoice_number_prefix: v.invoice_number_prefix.toUpperCase(),
              billing_generation_day_note: v.billing_generation_day_note,
              penalties_enabled: v.penalties_enabled,
              penalty_type: v.penalty_type,
              penalty_value: penaltyValue,
              reconnection_fee_default_centavos: parsePesosToCentavos(
                v.reconnection_fee_default_centavos,
              ),
              installation_fee_default_centavos: parsePesosToCentavos(
                v.installation_fee_default_centavos,
              ),
            },
            {
              onError: (err) => {
                setFormError(
                  applyApiFieldErrors(billingForm.setError as never, err),
                );
              },
            },
          );
        }}
      >
        <div>
          <Label htmlFor="default_due_day">Default due day (1–28)</Label>
          <Input
            id="default_due_day"
            type="number"
            className="mt-1"
            disabled={readOnly}
            {...billingForm.register("default_due_day", { valueAsNumber: true })}
          />
          <FieldError
            message={billingForm.formState.errors.default_due_day?.message}
          />
        </div>
        <div>
          <Label htmlFor="invoice_number_prefix">Invoice number prefix</Label>
          <Input
            id="invoice_number_prefix"
            className="mt-1"
            disabled={readOnly}
            {...billingForm.register("invoice_number_prefix")}
          />
          <p className="mt-1 text-xs text-muted">
            Counter (display only): {meta?.invoiceCounter ?? 0}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="billing_generation_day_note">
            Billing generation day note
          </Label>
          <Input
            id="billing_generation_day_note"
            className="mt-1"
            disabled={readOnly}
            {...billingForm.register("billing_generation_day_note")}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="penalties_enabled"
            type="checkbox"
            disabled={readOnly}
            checked={billingForm.watch("penalties_enabled")}
            onChange={(e) =>
              billingForm.setValue("penalties_enabled", e.target.checked)
            }
          />
          <Label htmlFor="penalties_enabled">Enable penalties (default OFF)</Label>
        </div>
        <div>
          <Label htmlFor="penalty_type">Penalty type</Label>
          <select
            id="penalty_type"
            className="mt-1 flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
            disabled={readOnly}
            {...billingForm.register("penalty_type")}
          >
            <option value="fixed">Fixed amount</option>
            <option value="percent">Percent</option>
          </select>
        </div>
        <div>
          <Label htmlFor="penalty_value">
            Penalty value{" "}
            {billingForm.watch("penalty_type") === "percent"
              ? "(%)"
              : "(pesos)"}
          </Label>
          <Input
            id="penalty_value"
            className="mt-1 tabular-nums"
            disabled={readOnly}
            {...billingForm.register("penalty_value")}
          />
        </div>
        <div>
          <Label htmlFor="reconnection_fee_default_centavos">
            Reconnection fee default (pesos)
          </Label>
          <Input
            id="reconnection_fee_default_centavos"
            className="mt-1 tabular-nums"
            disabled={readOnly}
            {...billingForm.register("reconnection_fee_default_centavos")}
          />
        </div>
        <div>
          <Label htmlFor="installation_fee_default_centavos">
            Installation fee default (pesos)
          </Label>
          <Input
            id="installation_fee_default_centavos"
            className="mt-1 tabular-nums"
            disabled={readOnly}
            {...billingForm.register("installation_fee_default_centavos")}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Receivables"
        description="Overdue = today > due date + grace period. Changes affect overdue status, aging flags, and suspension candidates from now on."
        section="receivables"
        canManage={canManage}
        onRestore={setRestoreSection}
        restoring={restoreMutation.isPending}
        saving={saveMutation.isPending}
        onSave={() => {
          const v = receivablesForm.getValues();
          saveMutation.mutate(
            {
              grace_days: Number(v.grace_days),
              suspension_threshold_months: Number(v.suspension_threshold_months),
              suspension_threshold_centavos: parsePesosToCentavos(
                v.suspension_threshold_centavos,
              ),
              follow_up_threshold_days: Number(v.follow_up_threshold_days),
            },
            {
              onError: (err) => {
                setFormError(
                  applyApiFieldErrors(receivablesForm.setError as never, err),
                );
              },
            },
          );
        }}
      >
        <div>
          <Label htmlFor="grace_days">Grace period (days)</Label>
          <Input
            id="grace_days"
            type="number"
            className="mt-1"
            disabled={readOnly}
            {...receivablesForm.register("grace_days", { valueAsNumber: true })}
          />
          <FieldError
            message={receivablesForm.formState.errors.grace_days?.message}
          />
        </div>
        <div>
          <Label htmlFor="follow_up_threshold_days">Follow-up threshold (days)</Label>
          <Input
            id="follow_up_threshold_days"
            type="number"
            className="mt-1"
            disabled={readOnly}
            {...receivablesForm.register("follow_up_threshold_days", {
              valueAsNumber: true,
            })}
          />
        </div>
        <div>
          <Label htmlFor="suspension_threshold_months">
            Suspension threshold (months unpaid)
          </Label>
          <Input
            id="suspension_threshold_months"
            type="number"
            className="mt-1"
            disabled={readOnly}
            {...receivablesForm.register("suspension_threshold_months", {
              valueAsNumber: true,
            })}
          />
        </div>
        <div>
          <Label htmlFor="suspension_threshold_centavos">
            Suspension threshold (pesos)
          </Label>
          <Input
            id="suspension_threshold_centavos"
            className="mt-1 tabular-nums"
            disabled={readOnly}
            {...receivablesForm.register("suspension_threshold_centavos")}
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Payments and receipts"
        section="payments"
        canManage={canManage}
        onRestore={setRestoreSection}
        restoring={restoreMutation.isPending}
        saving={saveMutation.isPending}
        onSave={() => {
          const v = paymentsForm.getValues();
          saveMutation.mutate(
            {
              receipt_number_prefix: v.receipt_number_prefix.toUpperCase(),
              enabled_payment_methods: v.enabled_payment_methods,
              proof_max_size_mb: Number(v.proof_max_size_mb),
              proof_allowed_types: v.proof_allowed_types,
            },
            {
              onError: (err) => {
                setFormError(
                  applyApiFieldErrors(paymentsForm.setError as never, err),
                );
              },
            },
          );
        }}
      >
        <div>
          <Label htmlFor="receipt_number_prefix">Receipt number prefix</Label>
          <Input
            id="receipt_number_prefix"
            className="mt-1"
            disabled={readOnly}
            {...paymentsForm.register("receipt_number_prefix")}
          />
          <p className="mt-1 text-xs text-muted">
            Counter (display only, not editable): {meta?.receiptCounter ?? 0}
          </p>
        </div>
        <div>
          <Label>GCash duplicate-reference policy</Label>
          <Input
            className="mt-1"
            value={meta?.gcashDuplicatePolicy ?? GCASH_DUPLICATE_POLICY}
            disabled
            readOnly
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Enabled payment methods</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {PAYMENT_METHODS.map((method) => {
              const selected = paymentsForm
                .watch("enabled_payment_methods")
                .includes(method);
              return (
                <label key={method} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected}
                    onChange={(e) => {
                      const cur = paymentsForm.getValues(
                        "enabled_payment_methods",
                      );
                      paymentsForm.setValue(
                        "enabled_payment_methods",
                        e.target.checked
                          ? [...cur, method]
                          : cur.filter((m) => m !== method),
                      );
                    }}
                  />
                  {method}
                </label>
              );
            })}
          </div>
        </div>
        <div>
          <Label htmlFor="proof_max_size_mb">Proof max size (MB)</Label>
          <Input
            id="proof_max_size_mb"
            type="number"
            className="mt-1"
            disabled={readOnly}
            {...paymentsForm.register("proof_max_size_mb", {
              valueAsNumber: true,
            })}
          />
        </div>
        <div>
          <Label>Proof allowed types</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {PROOF_FILE_TYPES.map((type) => {
              const selected = paymentsForm
                .watch("proof_allowed_types")
                .includes(type);
              return (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected}
                    onChange={(e) => {
                      const cur = paymentsForm.getValues("proof_allowed_types");
                      paymentsForm.setValue(
                        "proof_allowed_types",
                        e.target.checked
                          ? [...cur, type]
                          : cur.filter((t) => t !== type),
                      );
                    }}
                  />
                  {type}
                </label>
              );
            })}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Security"
        section="security"
        canManage={canManage}
        onRestore={setRestoreSection}
        restoring={restoreMutation.isPending}
        saving={saveMutation.isPending}
        onSave={() => {
          const v = securityForm.getValues();
          saveMutation.mutate(
            {
              session_timeout_minutes: Number(v.session_timeout_minutes),
              login_max_attempts: Number(v.login_max_attempts),
              login_lockout_minutes: Number(v.login_lockout_minutes),
              min_password_length: Number(v.min_password_length),
            },
            {
              onError: (err) => {
                setFormError(
                  applyApiFieldErrors(securityForm.setError as never, err),
                );
              },
            },
          );
        }}
      >
        {(
          [
            ["session_timeout_minutes", "Session timeout / auto-lock (minutes)"],
            ["login_max_attempts", "Max failed logins"],
            ["login_lockout_minutes", "Lockout minutes"],
            ["min_password_length", "Minimum password length"],
          ] as const
        ).map(([name, label]) => (
          <div key={name}>
            <Label htmlFor={name}>{label}</Label>
            <Input
              id={name}
              type="number"
              className="mt-1"
              disabled={readOnly}
              {...securityForm.register(name, { valueAsNumber: true })}
            />
            <FieldError
              message={securityForm.formState.errors[name]?.message}
            />
          </div>
        ))}
      </SectionCard>

      <section className="border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-ink">System info</h2>
        <p className="mt-1 text-sm text-muted">Read-only. No secrets shown.</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
          {[
            ["App version", system?.appVersion],
            ["API version", system?.apiVersion],
            ["Database name", system?.databaseName],
            ["API base URL", system?.apiBaseUrl],
            ["Attachments folder", system?.attachmentsPath],
            ["Backups folder", system?.backupsPath],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-muted">{label}</dt>
              <dd className="mt-0.5 font-medium text-ink break-all">
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border border-border bg-surface p-4">
        <h2 className="text-lg font-semibold text-ink">Settings change history</h2>
        {historyQuery.isLoading ? (
          <p className="mt-3 text-sm text-muted">Loading history…</p>
        ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-muted">No settings changes yet.</p>
        ) : (
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left text-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">When</th>
                  <th className="px-2 py-2 font-medium">Setting</th>
                  <th className="px-2 py-2 font-medium">Change</th>
                  <th className="px-2 py-2 font-medium">Who</th>
                </tr>
              </thead>
              <tbody>
                {historyQuery.data!.items.map((row) => (
                  <tr key={row.id} className="border-b border-border">
                    <td className="px-2 py-2 whitespace-nowrap">
                      {new Date(row.at).toLocaleString("en-PH")}
                    </td>
                    <td className="px-2 py-2">{row.settingKey}</td>
                    <td className="px-2 py-2">
                      <span className="text-muted">
                        {JSON.stringify(row.oldValue)}
                      </span>
                      {" → "}
                      <span>{JSON.stringify(row.newValue)}</span>
                    </td>
                    <td className="px-2 py-2">{row.actorName || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog
        open={restoreSection !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreSection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore defaults?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">
            Restore the{" "}
            <span className={cn("font-medium text-ink")}>{restoreSection}</span>{" "}
            section to factory defaults? This is audited and cannot be undone
            except by saving new values.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRestoreSection(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={restoreMutation.isPending || !restoreSection}
              onClick={() => {
                if (restoreSection) restoreMutation.mutate(restoreSection);
              }}
            >
              Restore
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
