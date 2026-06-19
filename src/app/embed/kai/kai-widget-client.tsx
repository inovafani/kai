"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type WidgetConfig = {
  tenant: {
    slug: string;
    name: string;
    defaultLocale: string;
  };
  branding: {
    widgetTitle: string;
    welcomeMessage: string;
    primaryColor: string;
    logoUrl: string | null;
  };
  capabilities: {
    supportedLocales: string[];
    pmsProvider: string;
  };
};

type ChatRole = "TRAVELLER" | "ASSISTANT";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ApiError = {
  error?: {
    message?: string;
  };
};

type KaiWidgetClientProps = {
  widgetKey: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ApiError;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Kai is unavailable right now.");
  }

  return payload;
}

export default function KaiWidgetClient({ widgetKey }: KaiWidgetClientProps) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "sending" | "error">(
    "loading"
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function bootWidget() {
      if (!widgetKey) {
        setStatus("error");
        setError("Missing widget key.");
        return;
      }

      try {
        setStatus("loading");
        setError("");

        const loadedConfig = await readJson<WidgetConfig>(
          await fetch(`/api/widget/config?key=${encodeURIComponent(widgetKey)}`)
        );
        const session = await readJson<{
          conversation: { id: string };
        }>(
          await fetch("/api/widget/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: widgetKey })
          })
        );

        if (!active) {
          return;
        }

        setConfig(loadedConfig);
        setConversationId(session.conversation.id);
        setMessages([
          {
            id: "welcome",
            role: "ASSISTANT",
            content: loadedConfig.branding.welcomeMessage
          }
        ]);
        setStatus("ready");
      } catch (bootError) {
        if (!active) {
          return;
        }

        setStatus("error");
        setError(bootError instanceof Error ? bootError.message : "Kai failed to load.");
      }
    }

    void bootWidget();

    return () => {
      active = false;
    };
  }, [widgetKey]);

  const accentColor = config?.branding.primaryColor ?? "#0f766e";
  const canSend = status !== "loading" && status !== "sending" && message.trim().length > 0;
  const subtitle = useMemo(() => {
    if (!config) {
      return "Connecting to Kai";
    }

    return `${config.tenant.name} · ${config.capabilities.pmsProvider.toUpperCase()}`;
  }, [config]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = message.trim();
    if (!content || !conversationId) {
      return;
    }

    try {
      setStatus("sending");
      setError("");
      setMessage("");

      const response = await readJson<{
        message: ChatMessage;
        assistantMessage: ChatMessage;
      }>(
        await fetch("/api/widget/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: widgetKey,
            conversationId,
            content
          })
        })
      );

      setMessages((currentMessages) => [
        ...currentMessages,
        response.message,
        response.assistantMessage
      ]);
      setStatus("ready");
    } catch (sendError) {
      setStatus("ready");
      setMessage(content);
      setError(sendError instanceof Error ? sendError.message : "Message failed to send.");
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#f7faf9",
        color: "#12201d",
        padding: 16
      }}
    >
      <section
        aria-label="Kai booking assistant"
        style={{
          width: "min(100%, 420px)",
          minHeight: 620,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          overflow: "hidden",
          border: "1px solid #dbe7e2",
          borderRadius: 8,
          background: "#ffffff",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.14)"
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 18,
            borderBottom: "1px solid #e7efec",
            background: "#fbfdfc"
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              borderRadius: 8,
              background: accentColor,
              color: "#ffffff",
              fontWeight: 800
            }}
          >
            K
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
              {config?.branding.widgetTitle ?? "Kai"}
            </h1>
            <p style={{ margin: "4px 0 0", color: "#5c6f68", fontSize: 13 }}>
              {subtitle}
            </p>
          </div>
        </header>

        <div
          aria-live="polite"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 18,
            overflowY: "auto",
            background: "#f9fbfa"
          }}
        >
          {status === "loading" ? (
            <p style={{ margin: 0, color: "#5c6f68" }}>Loading Kai...</p>
          ) : null}

          {messages.map((chatMessage) => {
            const isTraveller = chatMessage.role === "TRAVELLER";

            return (
              <p
                key={chatMessage.id}
                style={{
                  alignSelf: isTraveller ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  margin: 0,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: isTraveller ? accentColor : "#ffffff",
                  border: isTraveller ? "1px solid transparent" : "1px solid #dfe9e5",
                  color: isTraveller ? "#ffffff" : "#17231f",
                  lineHeight: 1.45,
                  fontSize: 14
                }}
              >
                {chatMessage.content}
              </p>
            );
          })}

          {error ? (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "10px 12px",
                border: "1px solid #fecaca",
                borderRadius: 8,
                background: "#fef2f2",
                color: "#991b1b",
                fontSize: 14
              }}
            >
              {error}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={sendMessage}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 10,
            padding: 14,
            borderTop: "1px solid #e7efec",
            background: "#ffffff"
          }}
        >
          <label htmlFor="kai-message" style={{ position: "absolute", left: -9999 }}>
            Message
          </label>
          <input
            id="kai-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about availability"
            disabled={status === "loading" || status === "sending" || status === "error"}
            style={{
              minWidth: 0,
              border: "1px solid #cfded9",
              borderRadius: 8,
              padding: "0 12px",
              font: "inherit",
              outlineColor: accentColor
            }}
          />
          <button
            type="submit"
            disabled={!canSend}
            style={{
              minWidth: 76,
              height: 42,
              border: "none",
              borderRadius: 8,
              background: canSend ? accentColor : "#b8c7c2",
              color: "#ffffff",
              fontWeight: 700,
              cursor: canSend ? "pointer" : "not-allowed"
            }}
          >
            {status === "sending" ? "Sending" : "Send"}
          </button>
        </form>
      </section>
    </main>
  );
}
