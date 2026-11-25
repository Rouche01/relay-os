import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHelpThreadArchetype,
  DEFAULT_CREATE_PERSONA,
  DEFAULT_HELP_PERSONA,
  DEFAULT_PRESENCE_PERSONA,
  formatHelpArchetypeOverlay,
  formatPersonaForPrompt,
  getPersonaById,
  hasAuthorizedFacts,
  personaForLane,
  resolvePersona,
  type LanePersona,
} from "../src/policy/persona.js";

function assertPersonaShape(p: LanePersona, lane: LanePersona["lane"]) {
  assert.equal(p.lane, lane);
  assert.ok(p.id.startsWith(`${lane}.`));
  assert.ok(p.stance.trim().length > 0);
  assert.ok(p.judgment.length >= 1);
  assert.ok(p.rhythm.length >= 1);
  assert.ok(p.bans.length >= 1);
  assert.ok(Array.isArray(p.authorizedFacts));
  assert.equal(p.authorizedFacts!.length, 0);
}

describe("default lane personas", () => {
  it("help / presence / create packs have required fields and empty facts", () => {
    assertPersonaShape(DEFAULT_HELP_PERSONA, "help");
    assertPersonaShape(DEFAULT_PRESENCE_PERSONA, "presence");
    assertPersonaShape(DEFAULT_CREATE_PERSONA, "create");
  });

  it("help stance is peer advice, not theatrical character", () => {
    assert.match(DEFAULT_HELP_PERSONA.stance, /peer|wardrobe/i);
    assert.doesNotMatch(DEFAULT_HELP_PERSONA.stance, /influencer|guru/i);
  });

  it("presence bans coaching and product plugs", () => {
    const blob = DEFAULT_PRESENCE_PERSONA.bans.join(" ");
    assert.match(blob, /stylist|coach|wardrobe/i);
    assert.match(blob, /product|URL|intensity/i);
  });
});

describe("personaForLane / getPersonaById / resolvePersona", () => {
  it("maps lane to default pack; unknown kind → help", () => {
    assert.equal(personaForLane("help").id, "help.default");
    assert.equal(personaForLane("presence").id, "presence.default");
    assert.equal(personaForLane("create").id, "create.default");
    assert.equal(personaForLane("nope").id, "help.default");
    assert.equal(personaForLane(undefined).id, "help.default");
  });

  it("looks up by id", () => {
    assert.equal(getPersonaById("help.default")?.lane, "help");
    assert.equal(getPersonaById("missing"), undefined);
    assert.equal(getPersonaById("  "), undefined);
  });

  it("resolvePersona prefers matching id, else lane default", () => {
    assert.equal(
      resolvePersona({ kind: "presence", personaId: "presence.default" }).id,
      "presence.default"
    );
    assert.equal(
      resolvePersona({ kind: "help", personaId: "unknown.pack" }).id,
      "help.default"
    );
    assert.equal(resolvePersona({ kind: "create" }).id, "create.default");
  });
});

describe("formatPersonaForPrompt / hasAuthorizedFacts", () => {
  it("formats stance and empty-facts rule", () => {
    const lines = formatPersonaForPrompt(DEFAULT_HELP_PERSONA);
    const text = lines.join("\n");
    assert.match(text, /Persona \(help\.default\)/);
    assert.match(text, /Stance:/);
    assert.match(text, /Judgment:/);
    assert.match(text, /Authorized personal facts: none/);
    assert.doesNotMatch(text, /—/);
    assert.equal(hasAuthorizedFacts(DEFAULT_HELP_PERSONA), false);
  });

  it("lists authorizedFacts when present", () => {
    const withFacts: LanePersona = {
      ...DEFAULT_HELP_PERSONA,
      authorizedFacts: [
        "Founder of GoStylens; mention only when intensity >= 1.",
      ],
    };
    assert.equal(hasAuthorizedFacts(withFacts), true);
    assert.match(
      formatPersonaForPrompt(withFacts).join("\n"),
      /Founder of GoStylens/
    );
  });
});

describe("classifyHelpThreadArchetype", () => {
  it("labels ICP wardrobe language as systems", () => {
    assert.equal(
      classifyHelpThreadArchetype({
        threadTitle: "Capsule wardrobe for work",
        opText: "Need a cohesive closet plan and pieces that work together.",
      }),
      "systems"
    );
    assert.match(
      formatHelpArchetypeOverlay("systems").join("\n"),
      /planning constraint/
    );
  });

  it("labels short bodies as thin_ask", () => {
    assert.equal(
      classifyHelpThreadArchetype({
        threadTitle: "Any tips for interviews?",
        opText: "Help",
      }),
      "thin_ask"
    );
  });

  it("labels longer non-ICP help as general", () => {
    assert.equal(
      classifyHelpThreadArchetype({
        threadTitle: "What shoes for a wedding?",
        opText:
          "I'm a guest at an outdoor wedding next month and already own black oxfords but wonder if loafers are better in heat.",
      }),
      "general"
    );
  });
});
