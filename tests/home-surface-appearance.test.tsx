import { afterEach, expect, test } from "bun:test";
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HomeSurface } from "../src/features/home/HomeSurface";

afterEach(cleanup);

test("Music remains available from Home when system media is unavailable", () => {
  let opened = false;
  const view = render(
    <HomeSurface
      homeGear={createRef()}
      agentSubtitle="Ask your CLI"
      musicSubtitle="No media session"
      artProps={{ tilt: 43, gradient: 80 }}
      onOpenSettings={() => {}}
      onOpenAgent={() => {}}
      onOpenMusic={() => {
        opened = true;
      }}
    />,
  );
  const card = view.getByRole("button", { name: /music/i });
  expect(card.hasAttribute("disabled")).toBe(false);
  expect(card.classList.contains("bg-otto-raised-soft")).toBe(true);
  expect(card.classList.contains("disabled:opacity-60")).toBe(false);
  expect(card.className).not.toContain("mix-blend");
  expect(card.getAttribute("style")).toContain("--art-opacity: 0.8");
  fireEvent.click(card);
  expect(opened).toBe(true);
});
