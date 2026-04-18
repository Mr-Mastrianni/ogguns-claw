import { logger } from "../utils/logger.js";
import { supabaseMemory, UserFact } from "./supabase.js";

export interface ProfileField {
  key: string;
  label: string;
  question: string;
  priority: number; // lower = asked first
}

// Core profile fields — ordered by priority (most important first)
const PROFILE_FIELDS: ProfileField[] = [
  {
    key: "name",
    label: "name",
    question: "What should I call you?",
    priority: 1,
  },
  {
    key: "location",
    label: "location",
    question: "Where are you based?",
    priority: 2,
  },
  {
    key: "profession",
    label: "profession",
    question: "What do you do for work or study?",
    priority: 3,
  },
  {
    key: "communication_style",
    label: "communication style",
    question: "Do you prefer short, direct answers or detailed explanations?",
    priority: 4,
  },
  {
    key: "goals",
    label: "current goals",
    question: "What are you working on or toward right now?",
    priority: 5,
  },
  {
    key: "interests",
    label: "interests",
    question: "What are you into outside of work?",
    priority: 6,
  },
  {
    key: "schedule",
    label: "schedule",
    question: "Are you more of a morning person or a night owl?",
    priority: 7,
  },
  {
    key: "dietary",
    label: "dietary preferences",
    question: "Any dietary preferences or restrictions I should know about?",
    priority: 8,
  },
  {
    key: "tech_stack",
    label: "tech stack",
    question: "What programming languages or tools do you use most?",
    priority: 9,
  },
  {
    key: "birthday",
    label: "birthday",
    question: "When's your birthday? (So I can remember to celebrate it)",
    priority: 10,
  },
];

const COMPLETENESS_THRESHOLD = 0.6; // Stop asking after 60% filled

export class ProfileManager {
  // Format known facts into a tight, token-efficient paragraph
  formatProfileParagraph(facts: UserFact[]): string {
    if (facts.length === 0) return "";

    const parts: string[] = [];
    for (const field of PROFILE_FIELDS) {
      const fact = facts.find((f) => f.fact_key === field.key);
      if (fact) {
        parts.push(`${field.label}: ${fact.fact_value}`);
      }
    }

    if (parts.length === 0) return "";
    return `User profile — ${parts.join(". ")}.`;
  }

  // Find missing profile fields, sorted by priority
  getMissingFields(facts: UserFact[]): ProfileField[] {
    const knownKeys = new Set(facts.map((f) => f.fact_key));
    return PROFILE_FIELDS.filter((f) => !knownKeys.has(f.key)).sort(
      (a, b) => a.priority - b.priority
    );
  }

  // Calculate profile completeness (0.0 - 1.0)
  getCompleteness(facts: UserFact[]): number {
    const known = PROFILE_FIELDS.filter((f) =>
      facts.some((fact) => fact.fact_key === f.key)
    ).length;
    return known / PROFILE_FIELDS.length;
  }

  // Should we ask a profile question right now?
  shouldAskQuestion(facts: UserFact[]): boolean {
    return this.getCompleteness(facts) < COMPLETENESS_THRESHOLD;
  }

  // Get the next question to ask
  getNextQuestion(facts: UserFact[]): string | null {
    const missing = this.getMissingFields(facts);
    if (missing.length === 0) return null;

    const field = missing[0];
    // Add variety so it doesn't feel robotic
    const prefixes = [
      "Quick question —",
      "By the way,",
      "I realized I don't know —",
      "Curious —",
      "So I can help better,",
    ];
    const prefix = prefixes[field.priority % prefixes.length];
    return `${prefix} ${field.question}`;
  }

  // Load profile facts for a user
  async loadProfile(userId: number): Promise<UserFact[]> {
    if (!supabaseMemory.enabled) return [];
    try {
      const allFacts = await supabaseMemory.getUserFacts(userId);
      // Only keep facts that match our profile keys
      const profileKeys = new Set(PROFILE_FIELDS.map((f) => f.key));
      return allFacts.filter((f) => profileKeys.has(f.fact_key));
    } catch (err) {
      logger.error("Failed to load profile", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export const profileManager = new ProfileManager();
