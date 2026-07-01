/**
 * Thin PocketBase REST client. Transport only — no token caching, no retries.
 *
 * CRITICAL: PocketBase expects the raw token in the Authorization header with
 * NO "Bearer " prefix. Getting this wrong makes every authenticated call 401.
 */

export class PbError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = "PbError";
    this.status = status;
    this.data = data;
  }
}

export interface PbRecord {
  id: string;
  [key: string]: unknown;
}

export interface PbListResult<T extends PbRecord = PbRecord> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

export interface ListOptions {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  fields?: string;
}

/** Build the records path for a collection (pure, testable). */
export function recordsPath(collection: string, id?: string): string {
  const base = `/api/collections/${encodeURIComponent(collection)}/records`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

/** Build request headers. Token is sent raw (no Bearer). Pure, testable. */
export function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  return headers;
}

async function request<T>(
  server: string,
  path: string,
  init: { method: string; token?: string; body?: unknown; query?: URLSearchParams }
): Promise<T> {
  const url = new URL(path, server);
  if (init.query) url.search = init.query.toString();

  const res = await fetch(url, {
    method: init.method,
    headers: buildHeaders(init.token),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const message =
      (data as { message?: string } | null)?.message ?? `${res.status} ${res.statusText}`;
    throw new PbError(res.status, message, data);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface AuthResult {
  token: string;
  record: PbRecord;
}

/** Exchange identity + password for an auth token. */
export async function authWithPassword(
  server: string,
  collection: string,
  identity: string,
  password: string
): Promise<AuthResult> {
  return await request<AuthResult>(server, `${recordsPath(collection).replace("/records", "")}/auth-with-password`, {
    method: "POST",
    body: { identity, password },
  });
}

/** Authenticated record operations against one server with one token. */
export class PbClient {
  constructor(
    private readonly server: string,
    private readonly token: string
  ) {}

  async create<T extends PbRecord = PbRecord>(collection: string, data: unknown): Promise<T> {
    return await request<T>(this.server, recordsPath(collection), {
      method: "POST",
      token: this.token,
      body: data,
    });
  }

  async update<T extends PbRecord = PbRecord>(
    collection: string,
    id: string,
    data: unknown
  ): Promise<T> {
    return await request<T>(this.server, recordsPath(collection, id), {
      method: "PATCH",
      token: this.token,
      body: data,
    });
  }

  async delete(collection: string, id: string): Promise<void> {
    await request<null>(this.server, recordsPath(collection, id), {
      method: "DELETE",
      token: this.token,
    });
  }

  async list<T extends PbRecord = PbRecord>(
    collection: string,
    options: ListOptions = {}
  ): Promise<PbListResult<T>> {
    const query = new URLSearchParams();
    if (options.filter) query.set("filter", options.filter);
    if (options.sort) query.set("sort", options.sort);
    if (options.fields) query.set("fields", options.fields);
    query.set("page", String(options.page ?? 1));
    query.set("perPage", String(options.perPage ?? 30));
    return await request<PbListResult<T>>(this.server, recordsPath(collection), {
      method: "GET",
      token: this.token,
      query,
    });
  }

  /** First record matching a filter, or null if none. */
  async getFirst<T extends PbRecord = PbRecord>(
    collection: string,
    filter: string
  ): Promise<T | null> {
    const result = await this.list<T>(collection, { filter, perPage: 1 });
    return result.items[0] ?? null;
  }
}
