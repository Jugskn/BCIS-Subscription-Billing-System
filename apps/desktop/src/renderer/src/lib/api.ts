import type {
  AllocationPreviewResponse,
  AreaOption,
  ArAgingSummaryDto,
  BackupListItem,
  BillingCycleSummary,
  BillingPreview,
  CollectionAreaListItem,
  CollectorOption,
  DashboardDto,
  InvoiceDetail,
  InvoiceListItem,
  LedgerEntryItem,
  LoginResponse,
  PaymentDetail,
  PaymentListItem,
  PlanOption,
  PostPaymentResponse,
  ReceiptDetail,
  RouteSheetDto,
  ServiceAccountListItem,
  ServiceEventItem,
  ServicePlanListItem,
  SessionUser,
  StatementOfAccount,
  SubscriberDetail,
  SubscriberListItem,
  SubscriberOption,
  UserListItem,
} from "@bcis/shared";

/** Single API host for the renderer — always 127.0.0.1 (not localhost). */
export const DEFAULT_API_BASE_URL = "http://127.0.0.1:3001";

export type ApiValidationIssue = { field: string; message: string };

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];

  constructor(
    status: number,
    code: string,
    message: string,
    issues: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/** Map API validation issues onto react-hook-form field errors. */
export function applyApiFieldErrors(
  // RHF setError is path-typed per form; callers pass FieldValues-compatible setters.
  setError: (name: never, error: { type: string; message: string }) => void,
  err: unknown,
): string {
  if (!(err instanceof ApiClientError)) {
    console.error("API request failed:", err);
    return "Cannot reach the server";
  }
  for (const issue of err.issues) {
    if (issue.field && issue.field !== "_root") {
      setError(issue.field as never, {
        type: "server",
        message: issue.message,
      });
    }
  }
  return err.message;
}

type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type OutstandingReceivableItem = {
  serviceAccountId: string;
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  serviceTypeCode: string;
  collectionAreaName: string | null;
  collectorName: string | null;
  currentBalanceCentavos: string;
  oldestDueDate: string;
  status: string;
};

export type OverdueReceivableItem = {
  serviceAccountId: string;
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  serviceTypeCode: string;
  collectionAreaName: string | null;
  collectorName: string | null;
  monthsUnpaid: number;
  oldestUnpaidInvoice: string;
  oldestDueDate: string;
  lastPaymentDate: string | null;
  totalArrearsCentavos: string;
  daysPastDue: number;
  delinquencyAgeBucket: string;
  status: string;
};

export type SuspensionCandidateItem = {
  serviceAccountId: string;
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  collectionAreaName: string | null;
  collectorName: string | null;
  daysPastDue: number;
  totalArrearsCentavos: string;
  status: string;
  oldestDueDate: string;
};

export type SuspendedAccountItem = {
  serviceAccountId: string;
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  collectionAreaName: string | null;
  status: string;
  latestSuspensionId: string | null;
  suspensionReason: string | null;
  suspensionEffectiveDate: string | null;
  pendingReconnectionId: string | null;
  pendingReconnectionFeeCentavos: string | null;
};

export type SuspensionHistoryItem = {
  id: string;
  kind: "SUSPENSION" | "RECONNECTION";
  serviceAccountId: string;
  accountNumber: string;
  subscriberName: string;
  reason: string | null;
  effectiveDate: string | null;
  status: string;
  feeCentavos: string | null;
  technicianUserId: string | null;
  requestedAt: string;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
};

export type CollectionBatchStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REMITTED"
  | "RECONCILED"
  | "CLOSED";

export type CollectionBatchItem = {
  id: string;
  batchNumber: string;
  collectorUserId: string;
  collectorName: string | null;
  collectionAreaId: string | null;
  collectionAreaName: string | null;
  status: CollectionBatchStatus;
  expectedCashCentavos: string;
  collectedCashCentavos: string;
  collectedNonCashCentavos: string;
  remittedCashCentavos: string | null;
  differenceCentavos: string | null;
  shortageReason: string | null;
  notes: string | null;
  accountCount: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollectionBatchAccount = {
  id: string;
  subscriberId: string;
  subscriberAccountNumber: string;
  subscriberName: string;
  subscriberAddress: string;
  serviceAccountId: string | null;
  expectedCentavos: string;
  collectedCentavos: string;
  paymentId: string | null;
  notes: string | null;
};

export type CollectionBatchDetail = CollectionBatchItem & {
  accounts: CollectionBatchAccount[];
};

export type CollectorSummary = {
  collectorUserId: string;
  username: string;
  collectorName: string;
  assignedAreas: { id: string; code: string; name: string }[];
  subscriberCount: number;
  openBatchCount: number;
  currentMonthCollectedCentavos: string;
  remittanceDifferenceCentavos: string;
};

export type SubscriberCollectionHistory = {
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  assignedCollector: { id: string; name: string } | null;
  assignedArea: { id: string; code: string; name: string } | null;
  items: Array<{
    batchAccountId: string;
    batchId: string;
    batchNumber: string;
    batchStatus: CollectionBatchStatus;
    collectorUserId: string;
    collectorName: string | null;
    collectionAreaId: string | null;
    collectionAreaName: string | null;
    collectedCentavos: string;
    expectedCentavos: string;
    paymentId: string | null;
    notes: string | null;
    recordedAt: string;
  }>;
  page: number;
  pageSize: number;
  total: number;
};

export class ApiClient {
  constructor(
    private readonly getBaseUrl: () => string,
    private readonly getToken: () => string | null,
  ) {}

  private async request<T>(
    path: string,
    init?: RequestInit & { json?: unknown },
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (init?.json !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}${path}`, {
        ...init,
        headers,
        body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      });
    } catch (err) {
      console.error("API request failed (no response):", err);
      throw new ApiClientError(0, "NETWORK_ERROR", "Cannot reach the server");
    }

    if (!res.ok) {
      let code = "REQUEST_FAILED";
      let message = "Request failed.";
      let issues: ApiValidationIssue[] = [];
      try {
        const body = (await res.json()) as {
          error?: {
            code?: string;
            message?: string;
            issues?: ApiValidationIssue[];
          };
        };
        code = body.error?.code ?? code;
        if (body.error?.message) message = body.error.message;
        issues = body.error?.issues ?? [];
      } catch {
        // ignore parse errors
      }
      throw new ApiClientError(res.status, code, message, issues);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health() {
    return this.request<{ status: string }>("/health");
  }

  login(username: string, password: string) {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      json: { username, password },
    });
  }

  logout() {
    return this.request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  }

  me() {
    return this.request<{ user: SessionUser; sessionTimeoutMinutes?: number }>(
      "/auth/me",
    );
  }

  getCompanyProfile() {
    return this.request<{
      companyName: string;
      address: string;
      contactNumber: string;
      email: string;
      tin: string;
    }>("/settings/company");
  }

  getSettings() {
    return this.request<{
      settings: Record<string, unknown>;
      meta: {
        receiptCounter: number;
        invoiceCounter: number;
        gcashDuplicatePolicy: string;
        canManage: boolean;
      };
      system: {
        appVersion: string;
        apiVersion: string;
        databaseName: string;
        apiBaseUrl: string;
        attachmentsPath: string;
        backupsPath: string;
      };
    }>("/settings");
  }

  updateSettings(patch: Record<string, unknown>) {
    return this.request<{
      settings: Record<string, unknown>;
      meta: {
        receiptCounter: number;
        invoiceCounter: number;
        gcashDuplicatePolicy: string;
        canManage: boolean;
      };
      system: {
        appVersion: string;
        apiVersion: string;
        databaseName: string;
        apiBaseUrl: string;
        attachmentsPath: string;
        backupsPath: string;
      };
      changed: string[];
    }>("/settings", { method: "PUT", json: patch });
  }

  restoreSettingsDefaults(section: string) {
    return this.request<{
      settings: Record<string, unknown>;
      restored: string[];
    }>("/settings/restore-defaults", {
      method: "POST",
      json: { section },
    });
  }

  getSettingsHistory(params: { page?: number; pageSize?: number }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.request<
      Paginated<{
        id: string;
        settingKey: string;
        oldValue: unknown;
        newValue: unknown;
        actorName: string;
        actorUserId: string | null;
        at: string;
        action: string;
      }>
    >(`/settings/history${qs ? `?${qs}` : ""}`);
  }

  getSubscriberDocuments(
    id: string,
    params: { page?: number; pageSize?: number },
  ) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.request<
      Paginated<{
        kind: "receipt" | "gcash_proof";
        id: string;
        label: string;
        status: string;
        amountCentavos: string | null;
        at: string;
        paymentId: string;
        voided: boolean;
        mimeType: string | null;
        verifierName: string | null;
        referenceNumber?: string | null;
        verifiedAt?: string | null;
      }>
    >(`/subscribers/${id}/documents${qs ? `?${qs}` : ""}`);
  }

  getSubscriberAudit(
    id: string,
    params: { page?: number; pageSize?: number },
  ) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.request<
      Paginated<{
        id: string;
        actorName: string;
        actorUserId: string | null;
        action: string;
        entityType: string;
        entityId: string | null;
        reason: string | null;
        at: string;
        oldSummary: string;
        newSummary: string;
      }>
    >(`/subscribers/${id}/audit${qs ? `?${qs}` : ""}`);
  }

  listUsers(params: { page?: number; pageSize?: number; search?: string }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return this.request<Paginated<UserListItem>>(
      `/users${qs ? `?${qs}` : ""}`,
    );
  }

  createUser(input: {
    username: string;
    password: string;
    fullName: string;
    roleNames: string[];
  }) {
    return this.request<UserListItem>("/users", {
      method: "POST",
      json: input,
    });
  }

  deactivateUser(id: string) {
    return this.request<{ ok: boolean }>(`/users/${id}/deactivate`, {
      method: "POST",
    });
  }

  assignRoles(id: string, roleNames: string[]) {
    return this.request<{ ok: boolean }>(`/users/${id}/roles`, {
      method: "PUT",
      json: { roleNames },
    });
  }

  listSubscribers(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    collectionAreaId?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    if (params.status) q.set("status", params.status);
    if (params.collectionAreaId) q.set("collectionAreaId", params.collectionAreaId);
    const qs = q.toString();
    return this.request<Paginated<SubscriberListItem>>(
      `/subscribers${qs ? `?${qs}` : ""}`,
    );
  }

  searchSubscribers(params: { q: string; page?: number; pageSize?: number }) {
    const q = new URLSearchParams({ q: params.q });
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    return this.request<Paginated<SubscriberListItem>>(
      `/subscribers/search?${q.toString()}`,
    );
  }

  subscriberOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<SubscriberOption[]>(
      `/subscribers/options${qs ? `?${qs}` : ""}`,
    );
  }

  planOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<PlanOption[]>(`/plans/options${qs ? `?${qs}` : ""}`);
  }

  areaOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<AreaOption[]>(`/areas/options${qs ? `?${qs}` : ""}`);
  }

  collectorOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<CollectorOption[]>(
      `/collectors/options${qs ? `?${qs}` : ""}`,
    );
  }

  getSubscriber(id: string) {
    return this.request<SubscriberDetail>(`/subscribers/${id}`);
  }

  createSubscriber(input: {
    fullName: string;
    contactPhone?: string;
    contactEmail?: string;
    address: string;
    collectionAreaId?: string | null;
    collectorUserId?: string | null;
    dueDay: number;
    notes?: string;
    servicePlanIds?: string[];
  }) {
    return this.request<SubscriberDetail>("/subscribers", {
      method: "POST",
      json: input,
    });
  }

  updateSubscriber(
    id: string,
    input: {
      fullName?: string;
      contactPhone?: string;
      contactEmail?: string;
      address?: string;
      collectionAreaId?: string | null;
      collectorUserId?: string | null;
      dueDay?: number;
      notes?: string;
      status?: string;
      statusReason?: string;
    },
  ) {
    return this.request<SubscriberDetail>(`/subscribers/${id}`, {
      method: "PUT",
      json: input,
    });
  }

  listServicePlans(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    serviceTypeCode?: string;
    isActive?: boolean;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    if (params.serviceTypeCode) q.set("serviceTypeCode", params.serviceTypeCode);
    if (params.isActive !== undefined) q.set("isActive", String(params.isActive));
    const qs = q.toString();
    return this.request<Paginated<ServicePlanListItem>>(
      `/service-plans${qs ? `?${qs}` : ""}`,
    );
  }

  createServicePlan(input: {
    serviceTypeCode: string;
    code: string;
    name: string;
    description?: string;
    price: string;
    installationFee?: string;
    speedMbps?: number;
    channelCount?: number;
  }) {
    return this.request<ServicePlanListItem>("/service-plans", {
      method: "POST",
      json: input,
    });
  }

  updateServicePlan(
    id: string,
    input: {
      name?: string;
      description?: string;
      price?: string;
      isActive?: boolean;
    },
  ) {
    return this.request<ServicePlanListItem>(`/service-plans/${id}`, {
      method: "PUT",
      json: input,
    });
  }

  listCollectionAreas(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    isActive?: boolean;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    if (params.isActive !== undefined) q.set("isActive", String(params.isActive));
    const qs = q.toString();
    return this.request<Paginated<CollectionAreaListItem>>(
      `/collection-areas${qs ? `?${qs}` : ""}`,
    );
  }

  createCollectionArea(input: {
    code: string;
    name: string;
    description?: string | null;
  }) {
    return this.request<CollectionAreaListItem>("/collection-areas", {
      method: "POST",
      json: input,
    });
  }

  updateCollectionArea(
    id: string,
    input: {
      code?: string;
      name?: string;
      description?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.request<CollectionAreaListItem>(`/collection-areas/${id}`, {
      method: "PUT",
      json: input,
    });
  }

  deleteCollectionArea(id: string) {
    return this.request<void>(`/collection-areas/${id}`, {
      method: "DELETE",
    });
  }

  listCollectionBatches(params: {
    page?: number;
    pageSize?: number;
    status?: CollectionBatchStatus;
    collectorUserId?: string;
    collectionAreaId?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.status) q.set("status", params.status);
    if (params.collectorUserId) q.set("collectorUserId", params.collectorUserId);
    if (params.collectionAreaId) q.set("collectionAreaId", params.collectionAreaId);
    const qs = q.toString();
    return this.request<Paginated<CollectionBatchItem>>(
      `/collection-batches${qs ? `?${qs}` : ""}`,
    );
  }

  getCollectionBatch(id: string) {
    return this.request<CollectionBatchDetail>(`/collection-batches/${id}`);
  }

  createCollectionBatch(input: {
    collectorUserId: string;
    collectionAreaId: string;
    notes?: string;
    accounts: Array<{
      subscriberId: string;
      serviceAccountId?: string | null;
      expectedCentavos: string;
    }>;
  }) {
    return this.request<CollectionBatchDetail>("/collection-batches", {
      method: "POST",
      json: input,
    });
  }

  startCollectionBatch(id: string) {
    return this.request<CollectionBatchDetail>(`/collection-batches/${id}/start`, {
      method: "POST",
    });
  }

  submitCollectionBatch(id: string) {
    return this.request<CollectionBatchDetail>(`/collection-batches/${id}/submit`, {
      method: "POST",
    });
  }

  recordBatchCollection(
    id: string,
    input: {
      subscriberId: string;
      serviceAccountId?: string | null;
      collectedCentavos: string;
      paymentId: string;
      isCash: boolean;
      notes?: string;
    },
  ) {
    return this.request<CollectionBatchDetail>(
      `/collection-batches/${id}/collections`,
      { method: "POST", json: input },
    );
  }

  remitCollectionBatch(
    id: string,
    input: { remittedCashCentavos: string; shortageReason?: string },
  ) {
    return this.request<CollectionBatchDetail>(`/collection-batches/${id}/remit`, {
      method: "POST",
      json: input,
    });
  }

  reconcileCollectionBatch(id: string) {
    return this.request<CollectionBatchDetail>(
      `/collection-batches/${id}/reconcile`,
      { method: "POST" },
    );
  }

  closeCollectionBatch(id: string) {
    return this.request<CollectionBatchDetail>(`/collection-batches/${id}/close`, {
      method: "POST",
    });
  }

  listCollectorSummaries(params: { page?: number; pageSize?: number } = {}) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.request<Paginated<CollectorSummary>>(
      `/collectors${qs ? `?${qs}` : ""}`,
    );
  }

  assignCollectorArea(collectorId: string, collectionAreaId: string) {
    return this.request<{ ok: boolean }>(`/collectors/${collectorId}/areas`, {
      method: "POST",
      json: { collectionAreaId },
    });
  }

  unassignCollectorArea(collectorId: string, collectionAreaId: string) {
    return this.request<{ ok: boolean }>(
      `/collectors/${collectorId}/areas/${collectionAreaId}`,
      { method: "DELETE" },
    );
  }

  getSubscriberCollectionHistory(subscriberId: string) {
    return this.request<SubscriberCollectionHistory>(
      `/subscribers/${subscriberId}/collection-history?page=1&pageSize=100`,
    );
  }

  listServiceAccounts(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    subscriberId?: string;
    status?: string;
    servicePlanId?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.search) q.set("search", params.search);
    if (params.subscriberId) q.set("subscriberId", params.subscriberId);
    if (params.status) q.set("status", params.status);
    if (params.servicePlanId) q.set("servicePlanId", params.servicePlanId);
    const qs = q.toString();
    return this.request<Paginated<ServiceAccountListItem>>(
      `/service-accounts${qs ? `?${qs}` : ""}`,
    );
  }

  createServiceAccount(input: {
    subscriberId: string;
    servicePlanId: string;
    installationAddress: string;
    activationDate: string;
    billingStartDate: string;
    dueDay: number;
    collectorUserId?: string | null;
  }) {
    return this.request<ServiceAccountListItem>("/service-accounts", {
      method: "POST",
      json: input,
    });
  }

  listServiceEvents(serviceAccountId: string) {
    return this.request<ServiceEventItem[]>(
      `/service-accounts/${serviceAccountId}/events`,
    );
  }

  getCurrentBilling() {
    return this.request<BillingCycleSummary>("/billing/current");
  }

  previewBilling(billingPeriod: string) {
    return this.request<BillingPreview>("/billing/preview", {
      method: "POST",
      json: { billingPeriod },
    });
  }

  generateBilling(billingPeriod: string) {
    return this.request<{
      billingPeriod: string;
      createdCount: number;
      skippedCount: number;
    }>("/billing/generate", {
      method: "POST",
      json: { billingPeriod },
    });
  }

  listInvoices(params: {
    page?: number;
    pageSize?: number;
    billingPeriod?: string;
    status?: string;
    subscriberId?: string;
    search?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.billingPeriod) q.set("billingPeriod", params.billingPeriod);
    if (params.status) q.set("status", params.status);
    if (params.subscriberId) q.set("subscriberId", params.subscriberId);
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return this.request<Paginated<InvoiceListItem>>(
      `/invoices${qs ? `?${qs}` : ""}`,
    );
  }

  getInvoice(id: string) {
    return this.request<InvoiceDetail>(`/invoices/${id}`);
  }

  voidInvoice(id: string, reason: string) {
    return this.request<InvoiceDetail>(`/invoices/${id}/void`, {
      method: "POST",
      json: { reason },
    });
  }

  adjustInvoice(id: string, amount: string, reason: string) {
    return this.request<InvoiceDetail>(`/invoices/${id}/adjust`, {
      method: "POST",
      json: { amount, reason },
    });
  }

  listSubscriberLedger(
    subscriberId: string,
    params: { page?: number; pageSize?: number; fromDate?: string; toDate?: string },
  ) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.fromDate) q.set("fromDate", params.fromDate);
    if (params.toDate) q.set("toDate", params.toDate);
    const qs = q.toString();
    return this.request<Paginated<LedgerEntryItem>>(
      `/subscribers/${subscriberId}/ledger${qs ? `?${qs}` : ""}`,
    );
  }

  getStatementOfAccount(
    subscriberId: string,
    fromDate: string,
    toDate: string,
  ) {
    const q = new URLSearchParams({ fromDate, toDate });
    return this.request<StatementOfAccount>(
      `/subscribers/${subscriberId}/statement?${q.toString()}`,
    );
  }

  getOpenBalance(subscriberId: string) {
    return this.request<{ subscriberId: string; openBalanceCentavos: string }>(
      `/subscribers/${subscriberId}/open-balance`,
    );
  }

  previewPaymentAllocation(input: {
    subscriberId: string;
    amount: string;
    allocations?: { invoiceId: string; amount: string }[];
  }) {
    return this.request<AllocationPreviewResponse>("/payments/preview", {
      method: "POST",
      json: input,
    });
  }

  postPayment(input: {
    subscriberId: string;
    amount: string;
    method: string;
    receivedAt?: string;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
    allocations?: { invoiceId: string; amount: string }[];
  }) {
    return this.request<PostPaymentResponse>("/payments", {
      method: "POST",
      json: input,
    });
  }

  listPayments(params: {
    page?: number;
    pageSize?: number;
    subscriberId?: string;
    method?: string;
    status?: string;
    search?: string;
  }) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.subscriberId) q.set("subscriberId", params.subscriberId);
    if (params.method) q.set("method", params.method);
    if (params.status) q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    const qs = q.toString();
    return this.request<Paginated<PaymentListItem>>(
      `/payments${qs ? `?${qs}` : ""}`,
    );
  }

  getPayment(id: string) {
    return this.request<PaymentDetail>(`/payments/${id}`);
  }

  listPendingGCash(params: { page?: number; pageSize?: number } = {}) {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return this.request<Paginated<PaymentListItem>>(
      `/payments/gcash/pending${qs ? `?${qs}` : ""}`,
    );
  }

  recordGCash(input: {
    subscriberId: string;
    amount: string;
    referenceNumber: string;
    senderName: string;
    notes?: string;
    idempotencyKey: string;
    proof: File;
  }) {
    const form = new FormData();
    form.set("subscriberId", input.subscriberId);
    form.set("amount", input.amount);
    form.set("referenceNumber", input.referenceNumber);
    form.set("senderName", input.senderName);
    form.set("idempotencyKey", input.idempotencyKey);
    if (input.notes) form.set("notes", input.notes);
    form.set("proof", input.proof);
    return this.requestForm<PaymentDetail>("/payments/gcash", form);
  }

  verifyGCash(id: string) {
    return this.request<PostPaymentResponse>(`/payments/${id}/verify`, {
      method: "POST",
    });
  }

  rejectGCash(id: string, reason: string) {
    return this.request<PaymentDetail>(`/payments/${id}/reject`, {
      method: "POST",
      json: { reason },
    });
  }

  reversePayment(id: string, reason: string) {
    return this.request<PaymentDetail>(`/payments/${id}/reverse`, {
      method: "POST",
      json: { reason },
    });
  }

  getReceipt(id: string) {
    return this.request<ReceiptDetail>(`/receipts/${id}`);
  }

  getDashboard() {
    return this.request<DashboardDto>("/dashboard");
  }

  getReceivablesAging(params: {
    asOfDate?: string;
    collectionAreaId?: string;
    collectorUserId?: string;
  } = {}) {
    const q = new URLSearchParams();
    if (params.asOfDate) q.set("asOfDate", params.asOfDate);
    if (params.collectionAreaId) q.set("collectionAreaId", params.collectionAreaId);
    if (params.collectorUserId) q.set("collectorUserId", params.collectorUserId);
    const qs = q.toString();
    return this.request<ArAgingSummaryDto>(
      `/receivables/aging${qs ? `?${qs}` : ""}`,
    );
  }

  getReceivablesSummary() {
    return this.request<{
      currentReceivableCentavos: string;
      overdueReceivableCentavos: string;
      subscribersOverdueCount: number;
      totalOpenCentavos: string;
    }>("/receivables/summary");
  }

  listOutstandingReceivables(params: {
    page?: number;
    pageSize?: number;
    collectionAreaId?: string;
    collectorUserId?: string;
    servicePlanId?: string;
    serviceTypeCode?: string;
  } = {}) {
    const qs = this.reportQuery(params);
    return this.request<
      Paginated<OutstandingReceivableItem> & {
        totals: { balanceCentavos: string; count: number };
      }
    >(`/receivables/outstanding${qs ? `?${qs}` : ""}`);
  }

  listOverdueReceivables(params: {
    page?: number;
    pageSize?: number;
    collectionAreaId?: string;
    collectorUserId?: string;
    servicePlanId?: string;
    serviceTypeCode?: string;
    delinquencyAgeBucket?: string;
  } = {}) {
    const qs = this.reportQuery(params);
    return this.request<
      Paginated<OverdueReceivableItem> & {
        totals: { arrearsCentavos: string; count: number };
      }
    >(`/receivables/overdue${qs ? `?${qs}` : ""}`);
  }

  listSuspensionCandidates(params: {
    page?: number;
    pageSize?: number;
    collectionAreaId?: string;
    collectorUserId?: string;
    servicePlanId?: string;
    serviceTypeCode?: string;
  } = {}) {
    const qs = this.reportQuery(params);
    return this.request<
      Paginated<SuspensionCandidateItem> & {
        thresholdCentavos: string;
        totals: { count: number; arrearsCentavos: string };
      }
    >(`/receivables/suspension-candidates${qs ? `?${qs}` : ""}`);
  }

  listSuspendedAccounts(params: { page?: number; pageSize?: number } = {}) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<SuspendedAccountItem>>(
      `/receivables/suspended${qs ? `?${qs}` : ""}`,
    );
  }

  listSuspensionHistory(params: { page?: number; pageSize?: number } = {}) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<SuspensionHistoryItem>>(
      `/receivables/suspension-history${qs ? `?${qs}` : ""}`,
    );
  }

  technicianOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<CollectorOption[]>(
      `/technicians/options${qs ? `?${qs}` : ""}`,
    );
  }

  approverOptions(search?: string) {
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const qs = q.toString();
    return this.request<CollectorOption[]>(
      `/approvers/options${qs ? `?${qs}` : ""}`,
    );
  }

  createSuspension(input: {
    serviceAccountId: string;
    reason: string;
    effectiveDate: string;
    approvedBy?: string | null;
    notes?: string | null;
  }) {
    return this.request<{
      id: string;
      serviceAccountId: string;
      reason: string;
      effectiveDate: string;
      approvedBy: string | null;
      notes: string | null;
      createdAt: string;
    }>("/suspensions", { method: "POST", json: input });
  }

  createReconnection(input: {
    serviceAccountId: string;
    suspensionId?: string | null;
    feeCentavos?: string;
    technicianUserId?: string | null;
    requestDate?: string | null;
    notes?: string | null;
  }) {
    return this.request<{
      id: string;
      serviceAccountId: string;
      status: string;
      requestedAt: string;
    }>("/reconnections", { method: "POST", json: input });
  }

  completeReconnection(id: string, notes?: string | null) {
    return this.request<{
      id: string;
      serviceAccountId: string;
      status: string;
      completedAt: string;
    }>(`/reconnections/${id}/complete`, {
      method: "POST",
      json: { notes: notes ?? null },
    });
  }

  private reportQuery(params: Record<string, string | number | undefined>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    return q.toString();
  }

  getCollectionsReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      fromDate: string;
      toDate: string;
      totals: { amountCentavos: string; count: number };
    }>(`/reports/collections${qs ? `?${qs}` : ""}`);
  }

  getPaymentMethodsReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      fromDate: string;
      toDate: string;
      totals: { amountCentavos: string; count: number };
    }>(`/reports/payment-methods${qs ? `?${qs}` : ""}`);
  }

  getBillingVsCollectionReport(months = 12) {
    return this.request<Paginated<Record<string, unknown>> & {
      totals: { billedCentavos: string; collectedCentavos: string };
    }>(`/reports/billing-vs-collection?months=${months}`);
  }

  getRevenueReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      fromDate: string;
      toDate: string;
      groupBy: string;
      totals: { amountCentavos: string };
    }>(`/reports/revenue${qs ? `?${qs}` : ""}`);
  }

  getArAgingReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      summary: ArAgingSummaryDto;
      totals: { balanceCentavos: string; count: number };
    }>(`/reports/ar-aging${qs ? `?${qs}` : ""}`);
  }

  getSubscriberMasterReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>>>(
      `/reports/subscribers${qs ? `?${qs}` : ""}`,
    );
  }

  getLedgerReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      statement: StatementOfAccount;
      totals: {
        openingBalanceCentavos: string;
        closingBalanceCentavos: string;
      };
    }>(`/reports/ledger${qs ? `?${qs}` : ""}`);
  }

  getCollectorReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      fromDate: string;
      toDate: string;
      totals: {
        collectedCentavos: string;
        remittedCentavos: string;
        shortageOverageCentavos: string;
      };
    }>(`/reports/collectors${qs ? `?${qs}` : ""}`);
  }

  getReversalsReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>> & {
      fromDate: string;
      toDate: string;
      totals: { amountCentavos: string; count: number };
    }>(`/reports/reversals${qs ? `?${qs}` : ""}`);
  }

  getAuditReport(params: Record<string, string | number | undefined>) {
    const qs = this.reportQuery(params);
    return this.request<Paginated<Record<string, unknown>>>(
      `/reports/audit${qs ? `?${qs}` : ""}`,
    );
  }

  getRouteSheet(params: {
    collectionAreaId: string;
    collectorUserId?: string;
  }) {
    const qs = this.reportQuery(params);
    return this.request<RouteSheetDto>(`/reports/route-sheet?${qs}`);
  }

  /** Download a report export file (PDF/XLSX/CSV). Requires report.export. */
  async downloadReportExport(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<void> {
    const qs = this.reportQuery(params);
    const headers = new Headers({ Accept: "*/*" });
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(
        `${this.getBaseUrl()}${path}${qs ? `?${qs}` : ""}`,
        { headers },
      );
    } catch (err) {
      console.error("API request failed (no response):", err);
      throw new ApiClientError(0, "NETWORK_ERROR", "Cannot reach the server");
    }
    if (!res.ok) {
      let message = "Export failed.";
      let code = "REQUEST_FAILED";
      let issues: ApiValidationIssue[] = [];
      try {
        const body = (await res.json()) as {
          error?: {
            code?: string;
            message?: string;
            issues?: ApiValidationIssue[];
          };
        };
        code = body.error?.code ?? code;
        if (body.error?.message) message = body.error.message;
        issues = body.error?.issues ?? [];
      } catch {
        // ignore
      }
      throw new ApiClientError(res.status, code, message, issues);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match?.[1] ?? "report.bin";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  listBackups() {
    return this.request<{ items: BackupListItem[] }>("/backups");
  }

  getBackupsRoot() {
    return this.request<{ path: string }>("/backups/root");
  }

  createBackup() {
    return this.request<BackupListItem>("/backups", { method: "POST" });
  }

  verifyBackup(id: string) {
    return this.request<{
      id: string;
      verified: boolean;
      checksumOk: boolean;
      listOk: boolean;
      message: string;
    }>(`/backups/${id}/verify`, { method: "POST" });
  }

  restoreBackup(id: string, confirmation: "RESTORE") {
    return this.request<{
      ok: boolean;
      backupId: string;
      safetyBackup: string | null;
      message: string;
    }>(`/backups/${id}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirmation }),
    });
  }

  async fetchProofBlob(proofId: string): Promise<Blob> {
    const headers = new Headers({ Accept: "*/*" });
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}/payment-proofs/${proofId}`, {
        headers,
      });
    } catch (err) {
      console.error("API request failed (no response):", err);
      throw new ApiClientError(0, "NETWORK_ERROR", "Cannot reach the server");
    }
    if (!res.ok) {
      throw new ApiClientError(res.status, "REQUEST_FAILED", "Could not load proof.");
    }
    return res.blob();
  }

  private async requestForm<T>(path: string, form: FormData): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    const token = this.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(`${this.getBaseUrl()}${path}`, {
        method: "POST",
        headers,
        body: form,
      });
    } catch (err) {
      console.error("API request failed (no response):", err);
      throw new ApiClientError(0, "NETWORK_ERROR", "Cannot reach the server");
    }
    if (!res.ok) {
      let code = "REQUEST_FAILED";
      let message = "Request failed.";
      let issues: ApiValidationIssue[] = [];
      try {
        const body = (await res.json()) as {
          error?: {
            code?: string;
            message?: string;
            issues?: ApiValidationIssue[];
          };
        };
        code = body.error?.code ?? code;
        if (body.error?.message) message = body.error.message;
        issues = body.error?.issues ?? [];
      } catch {
        // ignore
      }
      throw new ApiClientError(res.status, code, message, issues);
    }
    return (await res.json()) as T;
  }
}
