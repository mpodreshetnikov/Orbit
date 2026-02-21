import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function TestComponent(): React.ReactElement {
  return <button type="button">Web Harness</button>;
}

describe("web harness", () => {
  it("runs jsdom + testing-library setup", () => {
    render(<TestComponent />);
    expect(screen.getByRole("button", { name: "Web Harness" })).toBeInTheDocument();
  });
});
