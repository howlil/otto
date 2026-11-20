import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { BackControl } from "../../src/features/agent/conversation/AgentHeaderControls";

afterEach(cleanup);

test("the chat header shows the Otto logo as identity, not as a second settings entry", () => {
  const view = render(<BackControl view="chat" buttonRef={createRef()} onBack={() => {}} />);
  expect(view.container.querySelector("[data-otto-logo]")).not.toBeNull();
  expect(view.queryAllByRole("button")).toHaveLength(0);
});

test("nested views replace the logo with a back control", () => {
  let back = 0;
  const view = render(
    <BackControl view="history" buttonRef={createRef()} onBack={() => back++} />,
  );
  view.getByRole("button", { name: "Back to conversation" }).click();
  expect(back).toBe(1);
});
