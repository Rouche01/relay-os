import { AgenticAppManifest } from "@relay/protocol";

export const NewsletterMigratorManifest: AgenticAppManifest = {
  name: "NewsletterMigrator",
  version: "1.0.0",
  description: "Migrates subscribers between newsletter platforms (Substack to Mailchimp)",
  author: "Relay OS Built-in",

  // In the case of full-blown relay-OS implementation. 
  // The trigger will be generated from intents (user request).
  // For now, we'll use these triggers to start the agent.
  triggers: [
    {
      pattern: "migrate substack",
      description: "Trigger the substack to mailchimp migration flow",
      examples: ["migrate my substack list", "export substack subscribers"]
    }
  ],

  capabilities: ["newsletter.export", "newsletter.import"],
  engines_required: ["browser"],
  permissions: ["user.credentials.substack"],

  stages: [
    {
      name: "LOGIN",
      description: "Navigate to Substack sign in at https://substack.com/sign-in and prompt user for credentials",
      engine: "browser",
      feedback_points: [
        {
          type: "credential",
          description: "Substack email and password",
          required: true
        }
      ]
    },
    {
      name: "VERIFY_OTP",
      description: "Enter the OTP sent to your email to finalize logging in",
      engine: "browser",
      feedback_points: [
        {
          type: "credential",
          description: "Enter the 6-digit verification code sent to your email",
          required: true
        }
      ]
    },
    {
      name: "SELECT_LIST",
      description: "Navigate to settings and extract the list of audiences, prompt user to select one",
      engine: "browser",
      feedback_points: [
        {
          type: "choice",
          description: "Which audience list do you want to migrate?",
          required: true
        }
      ]
    },
    {
      name: "EXTRACT_DATA",
      description: "Export the CSV data of the selected list",
      engine: "browser",
      feedback_points: [
        {
          type: "progress",
          description: "Downloading subscriber CSV...",
          required: false
        }
      ]
    }
  ],

  feedback_patterns: ["credential", "approval", "choice", "progress"]
};
