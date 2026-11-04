import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ActiveIndicatorGroup, SelectField, SettingsSection, TextField } from "../src/shared/ui";

afterEach(cleanup);

describe("shared field primitives", () => {
  test("keeps surface controls on the standard geometry contract", () => {
    render(
      <>
        <TextField aria-label="text" />
        <SelectField aria-label="select">
          <option>One</option>
        </SelectField>
      </>,
    );

    expect(screen.getByLabelText("text").className).toContain("h-[35px]");
    expect(screen.getByLabelText("text").className).toContain("rounded-otto-control");
    expect(screen.getByLabelText("select").className).toContain("h-[35px]");
    expect(screen.getByLabelText("select").className).toContain("rounded-otto-control");
  });

  test("supports compact and embedded variants without duplicating feature CSS", () => {
    render(
      <>
        <TextField aria-label="compact" density="compact" />
        <TextField aria-label="embedded" appearance="embedded" />
      </>,
    );

    expect(screen.getByLabelText("compact").className).toContain("h-[29px]");
    expect(screen.getByLabelText("embedded").className).not.toContain("rounded-otto-control");
  });

  test("renders settings sections with a shared heading boundary", () => {
    render(
      <SettingsSection title="Appearance">
        <TextField aria-label="setting" />
      </SettingsSection>,
    );

    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByLabelText("setting")).toBeTruthy();
  });

  test("renders one shared indicator for the active choice group", () => {
    const { container } = render(
      <ActiveIndicatorGroup activeKey="capture" indicatorClassName="indicator">
        <button type="button" data-active-key="assistant">Assistant</button>
        <button type="button" data-active-key="capture">Capture</button>
      </ActiveIndicatorGroup>,
    );

    expect(container.querySelector("[aria-hidden=\"true\"]")).toBeTruthy();
  });
});
