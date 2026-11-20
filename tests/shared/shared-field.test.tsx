import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { ActiveIndicatorGroup, SelectField, SettingBlock, SettingRow, TextField, Toggle } from "../../src/shared/ui";

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

  test("setting rows put one control beside a label and optional help", () => {
    render(
      <>
        <SettingRow title="Shortcut" help="Works from any app" htmlFor="row-control">
          <input id="row-control" type="text" />
        </SettingRow>
        <SettingBlock title="Provider" action={<span>Ready</span>}>
          <TextField aria-label="stacked" />
        </SettingBlock>
        <Toggle title="Expand on hover" checked onChange={() => {}} />
      </>,
    );

    expect(screen.getByLabelText(/Shortcut/)).toBeTruthy();
    expect(screen.getByText("Works from any app")).toBeTruthy();
    expect(screen.getByText("Provider")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Expand on hover" }) as HTMLInputElement).checked).toBe(true);
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
