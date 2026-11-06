import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { HomeCard } from "../src/features/home/HomeCard";

afterEach(cleanup);

test("Home cards remain fully opaque when unavailable", () => {
  const view = render(
    <HomeCard name="Music" subtitle="Coming soon" artwork="/music.svg" disabled tilt={43} gradient={80} />,
  );
  const card = view.getByRole("button", { name: /music/i });
  expect(card.hasAttribute("disabled")).toBe(true);
  expect(card.classList.contains("bg-otto-raised-soft")).toBe(true);
  expect(card.classList.contains("disabled:opacity-60")).toBe(false);
  expect(card.className).not.toContain("mix-blend");
  expect(card.querySelector("img")?.getAttribute("style")).toContain("--art-opacity: 0.8");
});
