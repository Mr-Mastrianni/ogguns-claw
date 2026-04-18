import { ToolDefinition, ToolHandler } from "./types.js";

export const getCurrentTimeDefinition: ToolDefinition = {
  name: "get_current_time",
  description:
    "Get the current date and time in ISO 8601 format, plus a human-readable string in the user's local timezone.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          "Optional IANA timezone string (e.g., 'America/New_York', 'Europe/Vienna'). Defaults to system local time.",
      },
    },
    required: [],
  },
};

export const getCurrentTimeHandler: ToolHandler = (
  args: Record<string, unknown>
) => {
  const timezone =
    typeof args.timezone === "string" && args.timezone.length > 0
      ? args.timezone
      : undefined;

  const now = new Date();

  let humanReadable: string;
  if (timezone) {
    try {
      humanReadable = now.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return {
        content: `Error: Invalid timezone "${timezone}". Please provide a valid IANA timezone identifier.`,
        isError: true,
      };
    }
  } else {
    humanReadable = now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  }

  return {
    content: `ISO: ${now.toISOString()}\nHuman-readable: ${humanReadable}\nUnix: ${Math.floor(now.getTime() / 1000)}`,
  };
};
