import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ConsentForm, type ConsentFormProps } from "./consent-form";

function renderForm(overrides: Partial<ConsentFormProps> = {}) {
  const props: ConsentFormProps = {
    clientName: "Claude",
    redirectHost: "claude.ai",
    userEmail: "someone@example.com",
    scopes: [
      { scope: "health:read", description: "View your health data." },
      { scope: "health:write", description: "Add and update health data." },
    ],
    clientId: "mcp_test_client",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    scopeValue: "health:read health:write",
    state: "state-value",
    codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    resource: "https://example.com/api/mcp",
    consentToken: "consent-token",
    ...overrides,
  };

  const result = render(<ConsentForm {...props} />);
  const form = result.container.querySelector("form");
  if (!form) {
    throw new Error("consent form did not render a form element");
  }

  // Listen on `document`, not on the form: React delegates its own onSubmit to
  // the root container, so a listener on the form itself would run first and
  // count submissions the component goes on to cancel. Anything still
  // un-prevented by the time it reaches here is a submission the browser would
  // actually have sent.
  const submissions: boolean[] = [];
  const onSubmit = vi.fn((event: Event) => {
    submissions.push(!event.defaultPrevented);
    // jsdom cannot navigate, so stop the default action here.
    event.preventDefault();
  });
  document.addEventListener("submit", onSubmit);
  onTestFinished(() => document.removeEventListener("submit", onSubmit));

  const sent = () => submissions.filter(Boolean).length;

  return { form, sent };
}

describe("ConsentForm", () => {
  it("submits the form when Approve is clicked", async () => {
    const user = userEvent.setup();
    const { sent } = renderForm();

    await user.click(screen.getByRole("button", { name: /approve/i }));

    expect(sent()).toBe(1);
  });

  it("submits the form when Deny is clicked", async () => {
    const user = userEvent.setup();
    const { sent } = renderForm();

    await user.click(screen.getByRole("button", { name: /deny/i }));

    expect(sent()).toBe(1);
  });

  // Regression: the buttons used to set `disabled` from their own onClick. React
  // re-rendered them as disabled before the browser ran the form's activation
  // behaviour, so the form was never submitted and the consent screen hung on a
  // spinner forever.
  it("leaves the clicked button enabled so the submission is not cancelled", async () => {
    const user = userEvent.setup();
    renderForm();

    const approve = screen.getByRole("button", { name: /approve/i });
    await user.click(approve);

    expect(approve).not.toBeDisabled();
    expect(approve).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the decision value on the submitting button", async () => {
    const user = userEvent.setup();
    renderForm();

    const approve = screen.getByRole("button", { name: /approve/i });
    await user.click(approve);

    // A disabled control is barred from submission, which would drop `decision`
    // from the payload and turn an approval into a denial.
    expect(approve).toHaveAttribute("name", "decision");
    expect(approve).toHaveAttribute("value", "approve");
    expect(approve).not.toBeDisabled();
  });

  it("ignores a second click once a submission is in flight", async () => {
    const user = userEvent.setup();
    const { sent } = renderForm();

    const approve = screen.getByRole("button", { name: /approve/i });
    await user.click(approve);
    await user.click(approve);
    await user.click(screen.getByRole("button", { name: /deny/i }));

    expect(sent()).toBe(1);
  });

  it("carries the OAuth parameters as hidden fields", () => {
    const { form } = renderForm();
    const value = (name: string) =>
      form.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

    expect(value("client_id")).toBe("mcp_test_client");
    expect(value("redirect_uri")).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(value("scope")).toBe("health:read health:write");
    expect(value("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(value("consent_token")).toBe("consent-token");
    expect(value("state")).toBe("state-value");
    expect(value("resource")).toBe("https://example.com/api/mcp");
  });

  it("omits optional fields that were not supplied", () => {
    const { form } = renderForm({ state: null, resource: null });

    expect(form.querySelector('input[name="state"]')).toBeNull();
    expect(form.querySelector('input[name="resource"]')).toBeNull();
  });
});
