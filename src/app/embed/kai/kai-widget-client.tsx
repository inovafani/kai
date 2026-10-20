"use client";

import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./kai-widget.css";
import type { BluePassQuestionInput } from "@/core/bluepass/question-input";
import QuestionControl from "./question-control";

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
    enabledFeatures: string[];
  };
};

const BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE = "bluepass_stripe_pms_checkout";
const REZDY_CHECKOUT_HANDOFF_FEATURE = "rezdy_checkout_handoff";

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
  checkoutUrl: string | null;
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

type ContactRequest = {
  conversationId: string;
  fields: ["name", "email", "phone"];
  status: "CONTACT_DETAILS_REQUIRED";
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
      existingScript.addEventListener("error", () => reject(new Error("Secure payment couldn't load. Please try again.")), {
        once: true
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Secure payment couldn't load. Please try again."));
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
  const [questionInput, setQuestionInput] = useState<BluePassQuestionInput | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null);
  const [contactRequest, setContactRequest] = useState<ContactRequest | null>(null);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "" });
  const [contactFormError, setContactFormError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "starting" | "ready" | "confirming">("idle");
  const [paymentError, setPaymentError] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "sending" | "error">(
    "loading"
  );
  const [error, setError] = useState("");
  const stripeRef = useRef<StripeInstance | null>(null);
  const cardElementRef = useRef<StripeCardElement | null>(null);
  // The operator's own Rezdy page, opened in a new tab: the widget sits inside the operator's website,
  // and taking the whole page away to a payment page would lose the conversation behind it.
  const rezdyHandoffEnabled = Boolean(config?.capabilities.enabledFeatures.includes(REZDY_CHECKOUT_HANDOFF_FEATURE));
  const hostedCheckoutRedirectEnabled =
    rezdyHandoffEnabled || Boolean(config?.capabilities.enabledFeatures.includes(BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE));

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
          throw new Error("Secure payment couldn't start. Please try again.");
        }

        const cardElement = stripe.elements().create("card", {
          hidePostalCode: true
        });
        stripeRef.current = stripe;
        cardElementRef.current = cardElement;
        cardElement.mount("#kai-payment-card-element");
        setPaymentStatus("ready");
      } catch (mountError) {
        if (!active) return;
        setPaymentStatus("idle");
        setPaymentError(mountError instanceof Error ? mountError.message : "Secure payment couldn't load. Please try again.");
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
        setError(bootError instanceof Error ? bootError.message : "Kai couldn't load just now. Please try again.");
      }
    }

    void bootWidget();

    return () => {
      active = false;
    };
  }, [widgetKey]);

  useEffect(() => {
    setPaymentStatus("idle");
    setPaymentError("");
    setPaymentIntent(null);
    setCardholderName("");
  }, [paymentRequest, widgetKey]);

  const accentColor = config?.branding.primaryColor ?? "#0f766e";
  const canSend = status !== "loading" && status !== "sending" && status !== "error" && message.trim().length > 0;

  /* Inside the customer's page the loader draws the frame, so the close button asks it to close; opened
     on its own (no parent page) there is nothing to close, so no button. */
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(window.parent !== window);
  }, []);
  function closeFromParent() {
    window.parent.postMessage({ source: "kai-widget", type: "close" }, "*");
  }
  const isSending = status === "sending";
  const subtitle = useMemo(() => {
    if (!config) {
      return "Connecting to Kai";
    }

    // Travellers see who they're talking to, never the booking system behind it ("NATIVE", "REZDY")
    // or an admin's note in the tenant name ("BluePass Australia (Rezdy pilot)").
    return `${config.tenant.name.replace(/\s*\([^)]*\)/g, "").trim()} concierge`;
  }, [config]);

  async function submitContent(content: string) {
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
      setContactFormError("");
      setMessage("");
      setMessages((currentMessages) => [...currentMessages, localTravellerMessage]);
      setQuestionInput(null);

      const response = await readJson<{
        message: ChatMessage;
        assistantMessage: ChatMessage;
        paymentRequest?: PaymentRequest | null;
        contactRequest?: ContactRequest | null;
        questionInput?: BluePassQuestionInput | null;
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
      setContactRequest(response.contactRequest ?? null);
      // Only while Kai is waiting on that answer: a contact form or a payment takes the place of it.
      setQuestionInput(response.contactRequest || response.paymentRequest ? null : (response.questionInput ?? null));
      if (!response.contactRequest) {
        setContactForm({ name: "", email: "", phone: "" });
      }
      setPaymentIntent(null);
      setPaymentError("");
      setStatus("ready");
    } catch (sendError) {
      setStatus("ready");
      setMessage(content);
      setMessages((currentMessages) =>
        currentMessages.filter((chatMessage) => chatMessage.id !== localTravellerMessage.id)
      );
      setError(sendError instanceof Error ? sendError.message : "That didn't send. Mind trying again?");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitContent(message.trim());
  }

  async function submitContactDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = contactForm.name.trim();
    const email = contactForm.email.trim();
    const phone = contactForm.phone.trim();

    if (name.length < 2) {
      setContactFormError("Please add your full name.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactFormError("That email doesn't look quite right.");
      return;
    }

    if (phone.replace(/\D/g, "").length < 6) {
      setContactFormError("That phone number doesn't look quite right.");
      return;
    }

    await submitContent(`My name is ${name}, email is ${email}, phone number is ${phone}`);
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
      setPaymentStatus("idle");
      setPaymentError(
        paymentStartError instanceof Error ? paymentStartError.message : "Secure payment isn't available just yet."
      );
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

      const confirmation = await readJson<{
        status: "CONFIRMED";
        externalBookingId: string;
        provider: string;
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

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createLocalMessageId(),
          role: "ASSISTANT",
          content: `Payment received and your booking is confirmed. Confirmation reference: ${confirmation.externalBookingId}.`
        }
      ]);
      setPaymentRequest(null);
      setPaymentIntent(null);
      setPaymentStatus("idle");
    } catch (confirmError) {
      setPaymentStatus("ready");
      setPaymentError(confirmError instanceof Error ? confirmError.message : "That payment didn't go through. Please try again.");
    }
  }

  return (
    <main className="kw" style={{ "--kw-accent": accentColor } as CSSProperties}>
      <section className="kpanel__shell" aria-label="Kai booking assistant">
        <header className="kpanel__head">
          <div className="kpanel__id">
            <span className="kpanel__avatar" aria-hidden="true">
              K
              <span className="kpanel__dot" />
            </span>
            <div className="kpanel__id-text">
              <h1 className="kpanel__name ds-body-sm">{config?.branding.widgetTitle ?? "Kai"}</h1>
              <p className="kpanel__status ds-micro">{subtitle}</p>
            </div>
          </div>
          {embedded ? (
            <button type="button" className="kpanel__icon" aria-label="Close Kai" onClick={closeFromParent}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          ) : null}
        </header>

        <div className="kpanel__log" aria-live="polite">
          {status === "loading" ? (
            <div className="kmsg kmsg--assistant">
              <span className="kmsg__mark" aria-hidden="true">K</span>
              <span className="kmsg__bubble kmsg__bubble--typing" role="status" aria-label="Loading Kai">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : null}

          {messages.map((chatMessage) => {
            const isTraveller = chatMessage.role === "TRAVELLER";

            return (
              <div key={chatMessage.id} className={`kmsg ${isTraveller ? "kmsg--user" : "kmsg--assistant"}`}>
                {isTraveller ? null : (
                  <span className="kmsg__mark" aria-hidden="true">K</span>
                )}
                <p className="kmsg__bubble ds-body-sm">{chatMessage.content}</p>
              </div>
            );
          })}

          {isSending ? (
            <div className="kmsg kmsg--assistant">
              <span className="kmsg__mark" aria-hidden="true">K</span>
              <span className="kmsg__bubble kmsg__bubble--typing" role="status" aria-label="Kai is typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="kmsg kmsg--system" role="alert">
              <p className="kmsg__bubble ds-body-sm">{error}</p>
            </div>
          ) : null}

          {questionInput && !isSending ? (
            <QuestionControl
              key={`${messages.length}-${questionInput.kind}`}
              input={questionInput}
              disabled={status !== "ready"}
              onAnswer={(text) => void submitContent(text)}
            />
          ) : null}

          {contactRequest ? (
            <form className="kform" aria-label="Contact details" onSubmit={submitContactDetails}>
              <h2 className="kform__title ds-body-sm">Your details</h2>
              <p className="kform__lede ds-micro">
                This keeps names, email, and phone number in the right format for the booking.
              </p>
              <label className="kform__field">
                <span className="kform__label ds-micro">Full name</span>
                <input
                  className="kform__input ds-body-sm"
                  aria-label="Full name"
                  value={contactForm.name}
                  onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))}
                  disabled={isSending}
                  autoComplete="name"
                />
              </label>
              <label className="kform__field">
                <span className="kform__label ds-micro">Email</span>
                <input
                  className="kform__input ds-body-sm"
                  aria-label="Email"
                  value={contactForm.email}
                  onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))}
                  disabled={isSending}
                  autoComplete="email"
                  inputMode="email"
                />
              </label>
              <label className="kform__field">
                <span className="kform__label ds-micro">Phone</span>
                <input
                  className="kform__input ds-body-sm"
                  aria-label="Phone"
                  value={contactForm.phone}
                  onChange={(event) => setContactForm((current) => ({ ...current, phone: event.target.value }))}
                  disabled={isSending}
                  autoComplete="tel"
                  inputMode="tel"
                />
              </label>
              {contactFormError ? (
                <p className="kform__err ds-micro" role="alert">
                  {contactFormError}
                </p>
              ) : null}
              <button type="submit" className="kform__go ds-body-sm" disabled={isSending}>
                Send details
              </button>
            </form>
          ) : null}

          {paymentRequest && hostedCheckoutRedirectEnabled ? (
            <section className="kpay" aria-label="Secure payment">
              <h2 className="kpay__title ds-body-sm">
                {rezdyHandoffEnabled ? "Finish your booking" : "Redirecting you to secure payment"}
              </h2>
              <p className="kpay__meta ds-micro">
                {paymentRequest.productTitle ?? "Selected booking"}
                {paymentRequest.dateText ? ` - ${paymentRequest.dateText}` : ""}
                {paymentRequest.guests ? ` - ${paymentRequest.guests} guest${paymentRequest.guests === 1 ? "" : "s"}` : ""}
              </p>
              <p className="kpay__note ds-micro">
                {rezdyHandoffEnabled
                  ? "The booking page opens in a new tab, where you pay the operator securely. Kai never sees or stores your card details."
                  : "You'll be taken to a secure BluePass payment page; Kai never sees or stores your card details."}
              </p>
              {paymentRequest.checkoutUrl ? (
                <button
                  type="button"
                  className="kpay__go ds-body-sm"
                  onClick={() => {
                    if (rezdyHandoffEnabled) {
                      window.open(paymentRequest.checkoutUrl as string, "_blank", "noopener,noreferrer");
                      return;
                    }
                    const target = window.top ?? window;
                    target.location.href = paymentRequest.checkoutUrl as string;
                  }}
                >
                  {rezdyHandoffEnabled ? "Open the booking page" : "Continue to secure payment"}
                </button>
              ) : (
                <p className="kpay__note ds-micro">
                  I could not prepare the secure payment link just now - the operator will follow up to complete payment.
                </p>
              )}
            </section>
          ) : null}

          {paymentRequest && !hostedCheckoutRedirectEnabled ? (
            <section className="kpay" aria-label="Secure payment">
              <h2 className="kpay__title ds-body-sm">Secure RezdyPay payment</h2>
              <p className="kpay__meta ds-micro">
                {paymentRequest.productTitle ?? "Selected booking"}
                {paymentRequest.dateText ? ` - ${paymentRequest.dateText}` : ""}
                {paymentRequest.guests ? ` - ${paymentRequest.guests} guest${paymentRequest.guests === 1 ? "" : "s"}` : ""}
              </p>
              <p className="kpay__note ds-micro">
                Card details are handled by RezdyPay&apos;s secure Stripe form; Kai will not store card numbers.
              </p>
              {paymentError ? (
                <p className="kform__err ds-micro" role="alert">
                  {paymentError}
                </p>
              ) : null}
              {!paymentIntent ? (
                <button type="button" className="kpay__go ds-body-sm" onClick={startPayment} disabled={paymentStatus === "starting"}>
                  {paymentStatus === "starting" ? "Preparing..." : "Continue to secure payment"}
                </button>
              ) : (
                <>
                  <label className="kform__field">
                    <span className="kform__label ds-micro">Name on card</span>
                    <input
                      className="kform__input ds-body-sm"
                      aria-label="Name on card"
                      value={cardholderName}
                      onChange={(event) => setCardholderName(event.target.value)}
                      disabled={paymentStatus === "confirming"}
                      autoComplete="cc-name"
                    />
                  </label>
                  <div aria-label="Card details" id="kai-payment-card-element" className="kpay__card" />
                  <button type="button" className="kpay__go ds-body-sm" onClick={confirmPayment} disabled={paymentStatus === "confirming"}>
                    {paymentStatus === "confirming" ? "Confirming..." : "Pay securely"}
                  </button>
                </>
              )}
            </section>
          ) : null}
        </div>

        <form className="kpanel__compose" onSubmit={sendMessage}>
          <label htmlFor="kai-message" className="kw-sr">
            Message
          </label>
          <input
            id="kai-message"
            className="kpanel__input ds-body-sm"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask me anything"
            disabled={status === "loading" || status === "error"}
          />
          <button type="submit" className="kpanel__send" aria-label="Send" disabled={!canSend}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      </section>
    </main>
  );
}
