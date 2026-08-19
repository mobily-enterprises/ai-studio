import { describe, expect, it } from "vitest";

import {
  activeSessionMobileSectionLinks
} from "../../src/composables/useVibe64DashboardPage.js";

describe("useVibe64DashboardPage", () => {
  it("includes selected-session tools in mobile dashboard navigation", () => {
    expect(activeSessionMobileSectionLinks({
      tools: [
        {
          disabled: false,
          icon: "history-icon",
          id: "repository",
          label: "Repository",
          to: "/app/project/test/dashboard/repository"
        },
        {
          disabled: true,
          icon: "file-icon",
          id: "files",
          label: "Files",
          to: "/app/project/test/dashboard/files"
        }
      ],
      visible: true
    })).toEqual([
      {
        disabled: false,
        icon: "history-icon",
        id: "active-session:repository",
        label: "Repository",
        to: "/app/project/test/dashboard/repository"
      },
      {
        disabled: true,
        icon: "file-icon",
        id: "active-session:files",
        label: "Files",
        to: "/app/project/test/dashboard/files"
      }
    ]);
  });

  it("does not expose session tools without a selected session", () => {
    expect(activeSessionMobileSectionLinks({
      tools: [{ id: "repository", label: "Repository", to: "/repository" }],
      visible: false
    })).toEqual([]);
    expect(activeSessionMobileSectionLinks()).toEqual([]);
  });
});
