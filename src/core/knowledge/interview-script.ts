import type { KnowledgeCategory } from "./types";

/**
 * The fixed question bank Kai walks an operator through to build their
 * knowledge pack. Each question maps 1:1 to a pack entry (or, for the last
 * one, to the escalation handoff line). Order matters: policies first
 * (highest guest-safety value), then logistics, itinerary, seasonal, FAQ,
 * escalation last.
 *
 * Keywords seed guest-question matching so an entry answers before the
 * operator ever edits it; they can refine keywords later in admin.
 */

export interface KnowledgeInterviewQuestion {
  /** Entry id this answer becomes (or the escalation slot). */
  id: string;
  /** What Kai asks the operator. */
  prompt: string;
  /** Canonical guest-facing question stored on the resulting entry. */
  question: string;
  category: KnowledgeCategory;
  isPolicy: boolean;
  /** Guest-question trigger seeds for the resulting entry. */
  keywords: string[];
  /** "escalation" writes the answer to pack.escalation.handoffMessage. */
  target: "entry" | "escalation";
}

export const KNOWLEDGE_INTERVIEW_QUESTIONS: KnowledgeInterviewQuestion[] = [
  {
    id: "cancellation-policy",
    prompt: "What is your cancellation and refund policy?",
    question: "What is your cancellation and refund policy?",
    category: "policies",
    isPolicy: true,
    keywords: ["cancel", "cancellation", "refund", "reschedule", "change my booking", "money back"],
    target: "entry",
  },
  {
    id: "weather-policy",
    prompt: "What happens if a trip is cancelled for weather?",
    question: "What happens if the trip is cancelled because of weather?",
    category: "policies",
    isPolicy: true,
    keywords: ["weather", "rain", "storm", "wind", "rough", "cancelled for weather", "bad conditions"],
    target: "entry",
  },
  {
    id: "deposit-payment",
    prompt: "What deposit or payment do you take, and when is the balance due?",
    question: "What deposit do you take and when is the balance due?",
    category: "policies",
    isPolicy: true,
    keywords: ["deposit", "pay", "payment", "balance", "how much upfront", "when do i pay"],
    target: "entry",
  },
  {
    id: "min-age-safety",
    prompt: "Any minimum age, health, or safety restrictions guests should know?",
    question: "Are there minimum age, health, or safety restrictions?",
    category: "policies",
    isPolicy: true,
    keywords: [
      "age", "minimum age", "how old", "year old", "years old", "kids", "children",
      "child", "toddler", "baby", "infant", "pregnant", "medical", "health", "swim", "safety",
    ],
    target: "entry",
  },
  {
    id: "meeting-point",
    prompt: "Where and what time do guests meet you?",
    question: "Where and what time do we meet?",
    category: "logistics",
    isPolicy: false,
    keywords: ["where", "meet", "meeting point", "location", "address", "what time", "start time", "check in"],
    target: "entry",
  },
  {
    id: "what-to-bring",
    prompt: "What should guests bring or wear?",
    question: "What should I bring or wear?",
    category: "logistics",
    isPolicy: false,
    keywords: ["bring", "wear", "pack", "what should i", "towel", "sunscreen", "shoes", "gear"],
    target: "entry",
  },
  {
    id: "transfers-parking",
    prompt: "Do you offer hotel transfers or parking?",
    question: "Do you offer hotel transfers or parking?",
    category: "logistics",
    isPolicy: false,
    keywords: ["transfer", "pickup", "pick up", "hotel", "parking", "park", "how do i get there", "shuttle"],
    target: "entry",
  },
  {
    id: "vessel-specs",
    prompt: "Tell me about your main vessel(s): capacity, length, amenities.",
    question: "What is the boat like — capacity, size, amenities?",
    category: "itinerary",
    isPolicy: false,
    keywords: ["boat", "vessel", "yacht", "capacity", "how many people", "length", "cabins", "amenities", "toilet"],
    target: "entry",
  },
  {
    id: "inclusions",
    prompt: "What's included in the price — meals, gear, guide?",
    question: "What's included in the price?",
    category: "itinerary",
    isPolicy: false,
    keywords: ["included", "include", "inclusions", "meals", "food", "lunch", "gear", "equipment", "guide", "drinks"],
    target: "entry",
  },
  {
    id: "duration-route",
    prompt: "How long is the trip and what's the rough route?",
    question: "How long is the trip and where does it go?",
    category: "itinerary",
    isPolicy: false,
    keywords: ["how long", "duration", "hours", "days", "route", "itinerary", "where do we go", "stops"],
    target: "entry",
  },
  {
    id: "best-season",
    prompt: "What's the best season, and any months you don't operate?",
    question: "When is the best time to go, and are you ever closed?",
    category: "seasonal",
    isPolicy: false,
    keywords: ["best time", "best season", "when to go", "which month", "closed", "off season", "peak"],
    target: "entry",
  },
  {
    id: "signature-highlight",
    prompt: "What's the one thing guests love most about your trip?",
    question: "What's the highlight of the trip?",
    category: "faq",
    isPolicy: false,
    keywords: ["highlight", "best part", "what makes", "special", "why should", "love most"],
    target: "entry",
  },
  {
    id: "handoff-line",
    prompt: "Last one — if Kai can't answer something, what should it tell guests before handing to your team?",
    question: "",
    category: "faq",
    isPolicy: false,
    keywords: [],
    target: "escalation",
  },
];
