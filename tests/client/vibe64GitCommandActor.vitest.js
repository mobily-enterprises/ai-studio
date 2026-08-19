import { describe, expect, it } from "vitest";
import {
  sessionGithubCommandActor,
  sessionUsesGithub
} from "@/lib/vibe64GitCommandActor.js";

describe("session GitHub command actor", () => {
  it("shows the user whose connected GitHub account owns the next Git command", () => {
    expect(sessionGithubCommandActor({
      metadata: {
        session_git_command_actor_scope: "user",
        session_git_command_actor_user_key: "merc",
        source_remote_url: "https://github.com/example/project.git"
      }
    })).toMatchObject({
      active: true,
      available: true,
      displayLabel: "merc",
      label: "GitHub: merc"
    });
  });

  it("shows an unselected state until a session actor is recorded", () => {
    expect(sessionGithubCommandActor({
      metadata: {
        source_remote_url: "https://github.com/example/project.git"
      }
    })).toMatchObject({
      active: false,
      available: true,
      displayLabel: "not selected",
      label: "GitHub: not selected"
    });
    expect(sessionGithubCommandActor({ metadata: {} }).displayLabel).toBe("not selected");
  });

  it("does not offer a GitHub actor for managed Git or local source sessions", () => {
    const managedSession = {
      metadata: {
        source_remote_url: "/state/project/canonical-repository/repository.git"
      }
    };

    expect(sessionUsesGithub(managedSession)).toBe(false);
    expect(sessionGithubCommandActor(managedSession)).toMatchObject({
      active: false,
      available: false
    });
  });
});
