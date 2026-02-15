const REALTIME_VSN = "1.0.0";
const SOCKET_CONNECT_TIMEOUT_MS = 8000;
const SOCKET_HEARTBEAT_MS = 25000;
const SOCKET_RECONNECT_MS = 1200;
const CHANNEL_JOIN_TIMEOUT_MS = 10000;

function buildRealtimeWebSocketUrl(supabaseUrl, apikey) {
  const url = new URL(supabaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/realtime/v1/websocket";
  url.search = "";
  url.searchParams.set("apikey", apikey);
  url.searchParams.set("vsn", REALTIME_VSN);
  return url.toString();
}

function clonePresenceState(state) {
  const clone = {};
  for (const [key, metas] of Object.entries(state || {})) {
    clone[key] = Array.isArray(metas) ? metas.map((meta) => ({ ...meta })) : [];
  }
  return clone;
}

function normalizePresenceState(payload) {
  const normalized = {};
  if (!payload || typeof payload !== "object") return normalized;
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      normalized[String(key)] = value.map((meta) => ({ ...meta }));
      continue;
    }
    const metas = Array.isArray(value?.metas) ? value.metas : [];
    normalized[String(key)] = metas.map((meta) => ({ ...meta }));
  }
  return normalized;
}

function mergePresenceMetas(existing, incoming) {
  const byRef = new Map();
  for (const meta of existing || []) {
    if (!meta || typeof meta !== "object") continue;
    byRef.set(String(meta.phx_ref || JSON.stringify(meta)), { ...meta });
  }
  for (const meta of incoming || []) {
    if (!meta || typeof meta !== "object") continue;
    byRef.set(String(meta.phx_ref || JSON.stringify(meta)), { ...meta });
  }
  return Array.from(byRef.values());
}

function applyPresenceDiff(currentState, diff) {
  if (!diff || typeof diff !== "object") return;
  const joins = normalizePresenceState(diff.joins);
  const leaves = normalizePresenceState(diff.leaves);

  for (const [key, metas] of Object.entries(joins)) {
    currentState[key] = mergePresenceMetas(currentState[key] || [], metas);
  }

  for (const [key, metas] of Object.entries(leaves)) {
    const existing = currentState[key] || [];
    const leavingRefs = new Set(metas.map((meta) => String(meta?.phx_ref || "")));
    const next = existing.filter((meta) => !leavingRefs.has(String(meta?.phx_ref || "")));
    if (next.length > 0) {
      currentState[key] = next;
    } else {
      delete currentState[key];
    }
  }
}

class LightweightRealtimeChannel {
  constructor(client, topicName, options = {}) {
    this.client = client;
    this.topic = topicName.startsWith("realtime:") ? topicName : `realtime:${topicName}`;
    this.options = options;
    this.handlers = [];
    this.statusListener = null;
    this.presence = {};
    this.joinRef = "";
    this.joined = false;
    this.closed = false;
    this.shouldBeSubscribed = false;
    this.joinTimer = null;
  }

  on(type, filter, callback) {
    this.handlers.push({
      type: String(type || ""),
      event: String(filter?.event || "*"),
      callback,
    });
    return this;
  }

  subscribe(statusCallback) {
    this.closed = false;
    this.shouldBeSubscribed = true;
    this.statusListener = typeof statusCallback === "function" ? statusCallback : null;
    this.client.registerChannel(this);
    this.client.ensureSocket()
      .then(() => this.join())
      .catch(() => this.notifyStatus("CHANNEL_ERROR"));
    return this;
  }

  async send(message) {
    if (!this.joined || this.closed) return "error";
    if (!message || message.type !== "broadcast") return "error";
    const event = String(message.event || "");
    if (!event) return "error";
    this.client.push(this.topic, "broadcast", {
      type: "broadcast",
      event,
      payload: message.payload || {},
    }, this.joinRef);
    return "ok";
  }

  async track(payload = {}) {
    if (!this.joined || this.closed) {
      throw new Error("Realtime channel is not joined");
    }
    this.client.push(this.topic, "track", payload, this.joinRef);
    return "ok";
  }

  async untrack() {
    if (!this.joined || this.closed) return "ok";
    this.client.push(this.topic, "untrack", {}, this.joinRef);
    return "ok";
  }

  async unsubscribe() {
    this.shouldBeSubscribed = false;
    this.joined = false;
    this.closed = true;
    this.clearJoinTimer();
    if (this.client.isSocketOpen()) {
      this.client.push(this.topic, "phx_leave", {}, this.joinRef || undefined);
    }
    this.client.unregisterChannel(this);
    return "ok";
  }

  presenceState() {
    return clonePresenceState(this.presence);
  }

  join() {
    if (!this.shouldBeSubscribed || this.closed || !this.client.isSocketOpen()) return;
    const selfBroadcast = !!this.options?.config?.broadcast?.self;
    const presenceKey = String(this.options?.config?.presence?.key || "");
    this.joined = false;
    this.clearJoinTimer();
    this.joinRef = this.client.push(this.topic, "phx_join", {
      config: {
        broadcast: { ack: false, self: selfBroadcast },
        presence: { key: presenceKey },
        postgres_changes: [],
        private: false,
      },
    });
    this.joinTimer = setTimeout(() => {
      if (!this.joined) {
        this.notifyStatus("TIMED_OUT");
      }
    }, CHANNEL_JOIN_TIMEOUT_MS);
  }

  onSocketOpen() {
    if (this.shouldBeSubscribed && !this.closed) {
      this.join();
    }
  }

  onSocketClose() {
    this.joined = false;
    this.joinRef = "";
    this.clearJoinTimer();
    if (this.shouldBeSubscribed && !this.closed) {
      this.notifyStatus("CHANNEL_ERROR");
    }
  }

  handleSocketMessage(message) {
    const event = String(message?.event || "");
    if (event === "phx_reply") {
      if (String(message?.ref || "") === this.joinRef) {
        const status = String(message?.payload?.status || "");
        if (status === "ok") {
          this.joined = true;
          this.clearJoinTimer();
          this.notifyStatus("SUBSCRIBED");
        } else {
          this.joined = false;
          this.clearJoinTimer();
          this.notifyStatus("CHANNEL_ERROR");
        }
      }
      return;
    }

    if (event === "presence_state") {
      this.presence = normalizePresenceState(message?.payload);
      this.notifyPresenceSync();
      return;
    }

    if (event === "presence_diff") {
      applyPresenceDiff(this.presence, message?.payload);
      this.notifyPresenceSync();
      return;
    }

    if (event === "broadcast") {
      const payload = message?.payload && typeof message.payload === "object" ? message.payload : {};
      const broadcastEvent = String(payload.event || "");
      const broadcastPayload = payload && typeof payload === "object" && "payload" in payload
        ? payload.payload
        : payload;
      this.notifyBroadcast(broadcastEvent, broadcastPayload);
      return;
    }

    if (event === "phx_error") {
      this.joined = false;
      this.notifyStatus("CHANNEL_ERROR");
    }
  }

  notifyStatus(status) {
    if (this.statusListener) {
      this.statusListener(String(status || "CHANNEL_ERROR"));
    }
  }

  notifyPresenceSync() {
    for (const handler of this.handlers) {
      if (handler.type !== "presence") continue;
      if (handler.event !== "*" && handler.event !== "sync") continue;
      handler.callback?.();
    }
  }

  notifyBroadcast(eventName, payload) {
    for (const handler of this.handlers) {
      if (handler.type !== "broadcast") continue;
      if (handler.event !== "*" && handler.event !== eventName) continue;
      handler.callback?.({ payload });
    }
  }

  clearJoinTimer() {
    if (!this.joinTimer) return;
    clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }
}

class LightweightRealtimeClient {
  constructor(supabaseUrl, apikey) {
    this.wsUrl = buildRealtimeWebSocketUrl(supabaseUrl, apikey);
    this.channels = new Map();
    this.socket = null;
    this.connectPromise = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.nextRef = 1;
  }

  channel(topicName, options = {}) {
    return new LightweightRealtimeChannel(this, topicName, options);
  }

  registerChannel(channel) {
    this.channels.set(channel.topic, channel);
  }

  unregisterChannel(channel) {
    if (this.channels.get(channel.topic) === channel) {
      this.channels.delete(channel.topic);
    }
    if (this.channels.size === 0) {
      this.stopReconnect();
      this.stopHeartbeat();
      if (this.socket) {
        try {
          this.socket.close();
        } catch {
          // Ignore socket close errors.
        }
      }
      this.socket = null;
      this.connectPromise = null;
    }
  }

  isSocketOpen() {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  ensureSocket() {
    if (this.isSocketOpen()) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.wsUrl);
      let settled = false;

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        fn(value);
      };

      const connectTimeout = setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Ignore close errors.
        }
        settle(reject, new Error("Realtime socket connect timeout"));
      }, SOCKET_CONNECT_TIMEOUT_MS);

      socket.addEventListener("open", () => {
        this.socket = socket;
        this.connectPromise = null;
        this.attachSocketListeners(socket);
        this.startHeartbeat();
        this.stopReconnect();
        for (const channel of this.channels.values()) {
          channel.onSocketOpen();
        }
        settle(resolve);
      }, { once: true });

      socket.addEventListener("error", () => {
        this.connectPromise = null;
        settle(reject, new Error("Realtime socket connection error"));
      }, { once: true });

      socket.addEventListener("close", () => {
        this.connectPromise = null;
        settle(reject, new Error("Realtime socket closed before open"));
      }, { once: true });
    });

    return this.connectPromise;
  }

  push(topic, event, payload = {}, joinRef = undefined) {
    if (!this.isSocketOpen()) {
      throw new Error("Realtime socket is not connected");
    }
    const ref = String(this.nextRef++);
    const message = {
      topic,
      event,
      payload,
      ref,
    };
    if (joinRef) {
      message.join_ref = String(joinRef);
    }
    this.socket.send(JSON.stringify(message));
    return ref;
  }

  attachSocketListeners(socket) {
    socket.addEventListener("message", (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const topic = String(message?.topic || "");
      if (!topic || topic === "phoenix") return;
      const channel = this.channels.get(topic);
      if (!channel) return;
      channel.handleSocketMessage(message);
    });

    socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.socket = null;
      for (const channel of this.channels.values()) {
        channel.onSocketClose();
      }
      if (this.channels.size > 0) {
        this.scheduleReconnect();
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isSocketOpen()) return;
      try {
        this.push("phoenix", "heartbeat", {});
      } catch {
        // Ignore heartbeat failures; reconnect handles recovery.
      }
    }, SOCKET_HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket().catch(() => {
        this.scheduleReconnect();
      });
    }, SOCKET_RECONNECT_MS);
  }

  stopReconnect() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export function createSupabaseRealtimeClient(supabaseUrl, apikey) {
  return new LightweightRealtimeClient(supabaseUrl, apikey);
}
