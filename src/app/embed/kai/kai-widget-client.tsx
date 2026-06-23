"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type PaymentRequest = {
  conversationId: string;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  status: "PAYMENT_PENDING";
};

type PaymentIntent = {
  provider: "REZDYPAY_STRIPE";
  publishableKey: string;
  conversationId: string;
};

type StripeCardElement = {
  mount(selector: string): void;
  unmount?: () => void;
};

type StripeInstance = {
  elements(): {
    create(type: "card", options?: unknown): StripeCardElement;
  };
  createToken(
    cardElement: StripeCardElement,
    details?: { name?: string }
  ): Promise<{ token?: { id: string }; error?: { message?: string } }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeInstance | null;
  }
}

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

function loadStripeScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Secure payment can only start in a browser."));
  }

  if (window.Stripe) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Secure payment could not load.")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Secure payment could not load."));
    document.head.appendChild(script);
  });
}

function createLocalMessageId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function KaiWidgetClient({ widgetKey }: KaiWidgetClientProps) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "starting" | "ready" | "confirming" | "confirmed">(
    "idle"
  );
  const [paymentError, setPaymentError] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "sending" | "error">(
    "loading"
  );
  const [error, setError] = useState("");
  const stripeRef = useRef<StripeInstance | null>(null);
  const cardElementRef = useRef<StripeCardElement | null>(null);

  useEffect(() => {
    let active = true;

    async function mountPaymentElement() {
      if (!paymentIntent) return;

      try {
        setPaymentError("");
        await loadStripeScript();
        if (!active) return;

        const stripe = window.Stripe?.(paymentIntent.publishableKey) ?? null;
        if (!stripe) {
          throw new Error("Secure payment could not initialize.");
        }

        const elements = stripe.elements();
        const cardElement = elements.create("card", {
          hidePostalCode: true
        });
        stripeRef.current = stripe;
        cardElementRef.current = cardElement;
        cardElement.mount("#kai-payment-card-element");
        setPaymentStatus("ready");
      } catch (mountError) {
        if (!active) return;
        setPaymentStatus("idle");
        setPaymentError(mountError instanceof Error ? mountError.message : "Secure payment could not load.");
      }
    }

    void mountPaymentElement();

    return () => {
      active = false;
      cardElementRef.current?.unmount?.();
      cardElementRef.current = null;
      stripeRef.current = null;
    };
  }, [paymentIntent]);

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
  const canSend = status !== "loading" && status !== "sending" && status !== "error" && message.trim().length > 0;
  const isSending = status === "sending";
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

    const localTravellerMessage: ChatMessage = {
      id: createLocalMessageId(),
      role: "TRAVELLER",
      content
    };

    try {
      setStatus("sending");
      setError("");
      setMessage("");
      setMessages((currentMessages) => [...currentMessages, localTravellerMessage]);

      const response = await readJson<{
        message: ChatMessage;
        assistantMessage: ChatMessage;
        paymentRequest?: PaymentRequest | null;
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
        ...currentMessages.map((chatMessage) =>
          chatMessage.id === localTravellerMessage.id ? response.message : chatMessage
        ),
        response.assistantMessage
      ]);
      setPaymentRequest(response.paymentRequest ?? null);
      setPaymentIntent(null);
      setPaymentError("");
      setCardholderName("");
      setStatus("ready");
    } catch (sendError) {
      setStatus("ready");
      setMessage(content);
      setMessages((currentMessages) =>
        currentMessages.filter((chatMessage) => chatMessage.id !== localTravellerMessage.id)
      );
      setError(sendError instanceof Error ? sendError.message : "Message failed to send.");
    }
  }

  async function startPayment() {
    if (!paymentRequest) return;

    try {
      setPaymentStatus("starting");
      setPaymentError("");

      const intent = await readJson<PaymentIntent>(
        await fetch("/api/widget/payments/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: widgetKey,
            conversationId: paymentRequest.conversationId
          })
        })
      );
      setPaymentIntent(intent);
    } catch (paymentStartError) {
      setPaymentError(
        paymentStartError instanceof Error ? paymentStartError.message : "Secure payment is not available yet."
      );
      setPaymentStatus("idle");
    }
  }

  async function confirmPayment() {
    if (!paymentRequest || !paymentIntent || !stripeRef.current || !cardElementRef.current) return;

    try {
      setPaymentStatus("confirming");
      setPaymentError("");

      const tokenResult = await stripeRef.current.createToken(cardElementRef.current, {
        name: cardholderName.trim() || undefined
      });

      if (tokenResult.error || !tokenResult.token?.id) {
        throw new Error(tokenResult.error?.message ?? "Card details could not be verified.");
      }

      const response = await readJson<{
        booking: { externalBookingId: string; status: "CONFIRMED" | "PENDING" | "FAILED" };
        assistantMessage?: ChatMessage;
      }>(
        await fetch("/api/widget/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: widgetKey,
            conversationId: paymentIntent.conversationId,
            cardToken: tokenResult.token.id
          })
        })
      );

      if (response.assistantMessage) {
        setMessages((currentMessages) => [...currentMessages, response.assistantMessage as ChatMessage]);
      }
      setPaymentStatus("confirmed");
      setPaymentRequest(null);
      setPaymentIntent(null);
    } catch (confirmError) {
      setPaymentStatus("ready");
      setPaymentError(confirmError instanceof Error ? confirmError.message : "Payment could not be completed.");
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
                  fontSize: 14,
                  whiteSpace: "pre-wrap"
                }}
              >
                {chatMessage.content}
              </p>
            );
          })}

          {isSending ? (
            <div
              aria-label="Kai is typing"
              style={{
                alignSelf: "flex-start",
                display: "flex",
                alignItems: "center",
                gap: 8,
                maxWidth: "82%",
                margin: 0,
                padding: "10px 12px",
                border: "1px solid #dfe9e5",
                borderRadius: 8,
                background: "#ffffff",
                color: "#5c6f68",
                fontSize: 14
              }}
            >
              <span>Kai is typing</span>
              <span aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: 999, background: accentColor, animation: "kaiTyping 1s infinite ease-in-out" }} />
                <span style={{ width: 5, height: 5, borderRadius: 999, background: accentColor, animation: "kaiTyping 1s infinite ease-in-out 0.15s" }} />
                <span style={{ width: 5, height: 5, borderRadius: 999, background: accentColor, animation: "kaiTyping 1s infinite ease-in-out 0.3s" }} />
              </span>
            </div>
          ) : null}

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

          {paymentRequest ? (
            <section
              aria-label="Secure payment"
              style={{
                alignSelf: "stretch",
                padding: 14,
                border: "1px solid #cfded9",
                borderRadius: 8,
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)"
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, lineHeight: 1.25 }}>Secure payment</h2>
              <p style={{ margin: "8px 0 0", color: "#4f625b", fontSize: 13, lineHeight: 1.45 }}>
                {paymentRequest.productTitle ?? "Selected booking"}
                {paymentRequest.dateText ? ` · ${paymentRequest.dateText}` : ""}
                {paymentRequest.guests ? ` · ${paymentRequest.guests} guest${paymentRequest.guests === 1 ? "" : "s"}` : ""}
              </p>
              <p style={{ margin: "10px 0 0", color: "#4f625b", fontSize: 13, lineHeight: 1.45 }}>
                Card details must be entered only in the secure payment form.
              </p>
              {paymentError ? (
                <p
                  role="alert"
                  style={{
                    margin: "10px 0 0",
                    padding: "8px 10px",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    background: "#fef2f2",
                    color: "#991b1b",
                    fontSize: 13,
                    lineHeight: 1.4
                  }}
                >
                  {paymentError}
                </p>
              ) : null}
              {paymentIntent ? (
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  <label htmlFor="kai-cardholder-name" style={{ fontSize: 13, fontWeight: 800 }}>
                    Name on card
                  </label>
                  <input
                    id="kai-cardholder-name"
                    value={cardholderName}
                    onChange={(event) => setCardholderName(event.target.value)}
                    autoComplete="cc-name"
                    style={{
                      height: 40,
                      border: "1px solid #cfded9",
                      borderRadius: 8,
                      padding: "0 10px",
                      font: "inherit",
                      outlineColor: accentColor
                    }}
                  />
                  <div
                    id="kai-payment-card-element"
                    aria-label="Card details"
                    style={{
                      minHeight: 42,
                      display: "grid",
                      alignItems: "center",
                      border: "1px solid #cfded9",
                      borderRadius: 8,
                      padding: "10px",
                      background: "#fbfdfc",
                      color: "#4f625b",
                      fontSize: 13
                    }}
                  />
                  <button
                    type="button"
                    onClick={confirmPayment}
                    disabled={paymentStatus !== "ready"}
                    style={{
                      width: "100%",
                      height: 42,
                      border: "none",
                      borderRadius: 8,
                      background: accentColor,
                      color: "#ffffff",
                      fontWeight: 800,
                      cursor: paymentStatus === "confirming" ? "wait" : paymentStatus === "ready" ? "pointer" : "not-allowed",
                      opacity: paymentStatus === "ready" ? 1 : 0.75
                    }}
                  >
                    {paymentStatus === "confirming" ? "Confirming..." : "Pay securely"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startPayment}
                  disabled={paymentStatus === "starting"}
                  style={{
                    width: "100%",
                    height: 42,
                    marginTop: 12,
                    border: "none",
                    borderRadius: 8,
                    background: accentColor,
                    color: "#ffffff",
                    fontWeight: 800,
                    cursor: paymentStatus === "starting" ? "wait" : "pointer"
                  }}
                >
                  {paymentStatus === "starting" ? "Preparing..." : "Continue to payment"}
                </button>
              )}
            </section>
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
            disabled={status === "loading" || status === "error"}
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
            Send
          </button>
        </form>
      </section>
      <style jsx global>{`
        @keyframes kaiTyping {
          0%,
          80%,
          100% {
            opacity: 0.35;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-2px);
          }
        }
      `}</style>
    </main>
  );
}
