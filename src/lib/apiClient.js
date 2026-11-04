async function post(action, data = {}) {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action, ...data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The server could not complete the request.");
  return payload;
}

class DatabaseQuery {
  constructor(table) {
    this.query = {
      table,
      operation: "select",
      columns: "*",
      filters: [],
      orders: [],
      returning: false,
      single: false,
    };
    this.promise = null;
  }

  select(columns = "*") {
    if (this.query.operation === "select") {
      this.query.columns = columns;
    } else {
      this.query.returning = true;
      this.query.columns = columns;
    }
    return this;
  }

  insert(values) {
    this.query.operation = "insert";
    this.query.values = values;
    return this;
  }

  update(values) {
    this.query.operation = "update";
    this.query.values = values;
    return this;
  }

  delete() {
    this.query.operation = "delete";
    return this;
  }

  eq(column, value) {
    this.query.filters.push({ column, operator: "eq", value });
    return this;
  }

  neq(column, value) {
    this.query.filters.push({ column, operator: "neq", value });
    return this;
  }

  ilike(column, value) {
    this.query.filters.push({ column, operator: "ilike", value });
    return this;
  }

  order(column, options = {}) {
    this.query.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(count) {
    this.query.limit = count;
    return this;
  }

  single() {
    this.query.single = "single";
    return this;
  }

  maybeSingle() {
    this.query.single = "maybe";
    return this;
  }

  then(resolve, reject) {
    if (!this.promise) {
      this.promise = post("query", { query: this.query })
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error: { message: error.message } }));
    }
    return this.promise.then(resolve, reject);
  }
}

export const supabase = {
  from(table) {
    return new DatabaseQuery(table);
  },

  async rpc(functionName, args = {}) {
    try {
      return { data: await post("rpc", { functionName, args }), error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }
  },
};

export async function authRequest(action, data = {}) {
  return post(action, data);
}
