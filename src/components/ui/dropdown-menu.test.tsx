import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "./dropdown-menu";

vi.mock("@radix-ui/react-dropdown-menu", () => {
  const React = require("react");

  const makeForwardRef = (slot: string, tag: "div" | "button" = "div") => {
    const Component = React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
        const { children, sideOffset, ...rest } = props;
        const sideOffsetAttr =
          sideOffset === undefined ? {} : { "data-sideoffset": String(sideOffset) };
        const node = children as React.ReactNode;
        if (tag === "button") {
          return (
            <button
              ref={ref as React.Ref<HTMLButtonElement>}
              data-slot={slot}
              {...sideOffsetAttr}
              {...rest}
            >
              {node}
            </button>
          );
        }
        return (
          <div
            ref={ref as React.Ref<HTMLDivElement>}
            data-slot={slot}
            {...sideOffsetAttr}
            {...rest}
          >
            {node}
          </div>
        );
      },
    );
    Component.displayName = slot;
    return Component;
  };

  return {
    Root: ({ children }: { children: React.ReactNode }) => <div data-slot="root">{children}</div>,
    Trigger: makeForwardRef("trigger", "button"),
    Group: ({ children }: { children: React.ReactNode }) => <div data-slot="group">{children}</div>,
    Portal: ({ children }: { children: React.ReactNode }) => (
      <div data-slot="portal">{children}</div>
    ),
    Sub: ({ children }: { children: React.ReactNode }) => <div data-slot="sub">{children}</div>,
    RadioGroup: ({ children }: { children: React.ReactNode }) => (
      <div data-slot="radio-group">{children}</div>
    ),
    SubTrigger: makeForwardRef("sub-trigger"),
    SubContent: makeForwardRef("sub-content"),
    Content: makeForwardRef("content"),
    Item: makeForwardRef("item"),
    CheckboxItem: makeForwardRef("checkbox-item"),
    ItemIndicator: ({ children }: { children: React.ReactNode }) => (
      <span data-slot="item-indicator">{children}</span>
    ),
    RadioItem: makeForwardRef("radio-item"),
    Label: makeForwardRef("label"),
    Separator: makeForwardRef("separator"),
  };
});

describe("DropdownMenu wrappers", () => {
  it("applies inset styling branches and renders shortcut", () => {
    render(
      <div>
        <DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger>
        <DropdownMenuItem inset>Item</DropdownMenuItem>
        <DropdownMenuLabel inset>Label</DropdownMenuLabel>
        <DropdownMenuShortcut data-testid="shortcut">Ctrl+K</DropdownMenuShortcut>
      </div>,
    );

    expect(screen.getByText("More").closest("[data-slot='sub-trigger']")).toHaveClass("pl-8");
    expect(screen.getByText("Item").closest("[data-slot='item']")).toHaveClass("pl-8");
    expect(screen.getByText("Label").closest("[data-slot='label']")).toHaveClass("pl-8");
    expect(screen.getByTestId("shortcut")).toHaveClass("ml-auto");
  });

  it("uses default and custom sideOffset values in content wrappers", () => {
    const { rerender } = render(<DropdownMenuContent>Content</DropdownMenuContent>);
    expect(screen.getByText("Content").closest("[data-slot='content']")).toHaveAttribute(
      "data-sideoffset",
      "4",
    );

    rerender(<DropdownMenuContent sideOffset={12}>Content</DropdownMenuContent>);
    expect(screen.getByText("Content").closest("[data-slot='content']")).toHaveAttribute(
      "data-sideoffset",
      "12",
    );

    rerender(<DropdownMenuSubContent>Sub Content</DropdownMenuSubContent>);
    expect(
      screen.getByText("Sub Content").closest("[data-slot='sub-content']"),
    ).toBeInTheDocument();
  });

  it("renders checkbox/radio items and separator wrappers", () => {
    render(
      <div>
        <DropdownMenuCheckboxItem checked>Checked</DropdownMenuCheckboxItem>
        <DropdownMenuRadioItem value="radio">Radio</DropdownMenuRadioItem>
        <DropdownMenuSeparator />
      </div>,
    );

    expect(screen.getByText("Checked")).toBeInTheDocument();
    expect(screen.getByText("Radio")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='separator']")).toBeInTheDocument();
    expect(document.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});
