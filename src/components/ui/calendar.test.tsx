import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Calendar, CalendarDayButton } from "./calendar";

const dayPickerMocks = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("react-day-picker", () => {
  const React = require("react");

  const DayButton = React.forwardRef(
    (props: Record<string, unknown>, ref: React.Ref<HTMLButtonElement>) => (
      <button ref={ref} {...props} />
    ),
  );
  DayButton.displayName = "DayButton";

  const DayPicker = (props: Record<string, unknown>) => {
    dayPickerMocks.props = props;
    const components = props.components as
      | {
          Chevron?: (props: {
            orientation: "left" | "right" | "down";
            className?: string;
          }) => React.ReactNode;
        }
      | undefined;

    return (
      <div data-testid="mock-day-picker">
        <div data-testid="chevron-left">
          {components?.Chevron?.({ orientation: "left", className: "left-chevron" })}
        </div>
        <div data-testid="chevron-right">
          {components?.Chevron?.({ orientation: "right", className: "right-chevron" })}
        </div>
        <div data-testid="chevron-down">
          {components?.Chevron?.({ orientation: "down", className: "down-chevron" })}
        </div>
      </div>
    );
  };
  DayPicker.displayName = "DayPicker";

  return {
    DayButton,
    DayPicker,
    getDefaultClassNames: () => ({
      root: "root",
      months: "months",
      month: "month",
      nav: "nav",
      button_previous: "button_previous",
      button_next: "button_next",
      month_caption: "month_caption",
      dropdowns: "dropdowns",
      dropdown_root: "dropdown_root",
      dropdown: "dropdown",
      caption_label: "caption_label",
      weekdays: "weekdays",
      weekday: "weekday",
      week: "week",
      week_number_header: "week_number_header",
      week_number: "week_number",
      day: "day",
      range_start: "range_start",
      range_middle: "range_middle",
      range_end: "range_end",
      today: "today",
      outside: "outside",
      disabled: "disabled",
      hidden: "hidden",
    }),
  };
});

describe("Calendar", () => {
  it("passes default props and chevron branches", () => {
    render(<Calendar />);

    expect(screen.getByTestId("mock-day-picker")).toBeInTheDocument();
    expect(screen.getByTestId("chevron-left").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("chevron-right").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("chevron-down").querySelector("svg")).toBeInTheDocument();

    const props = dayPickerMocks.props as Record<string, unknown>;
    expect(props.showOutsideDays).toBe(true);
    expect(props.captionLayout).toBe("label");

    const classNames = props.classNames as Record<string, string>;
    expect(classNames.caption_label).toContain("text-sm");

    const formatters = props.formatters as {
      formatMonthDropdown: (date: Date) => string;
    };
    const sampleDate = new Date(2026, 0, 1);
    expect(formatters.formatMonthDropdown(sampleDate)).toBe(
      sampleDate.toLocaleString("default", { month: "short" }),
    );
  });

  it("supports custom class names, caption layout, and formatter override", () => {
    render(
      <Calendar
        className="custom-calendar"
        captionLayout="dropdown"
        classNames={{ day: "custom-day" }}
        formatters={{ formatMonthDropdown: () => "CUSTOM-MONTH" }}
      />,
    );

    const props = dayPickerMocks.props as Record<string, unknown>;
    expect(String(props.className)).toContain("custom-calendar");

    const classNames = props.classNames as Record<string, string>;
    expect(classNames.day).toContain("custom-day");
    expect(classNames.caption_label).toContain("flex h-8");

    const formatters = props.formatters as {
      formatMonthDropdown: (date: Date) => string;
    };
    expect(formatters.formatMonthDropdown(new Date())).toBe("CUSTOM-MONTH");
  });
});

describe("CalendarDayButton", () => {
  it("focuses button when focused modifier is true and marks selected-single state", () => {
    const focusSpy = vi
      .spyOn(HTMLButtonElement.prototype, "focus")
      .mockImplementation(() => undefined);

    render(
      <CalendarDayButton
        day={{ date: new Date("2026-01-01T00:00:00.000Z") } as never}
        modifiers={
          {
            selected: true,
            focused: true,
            range_start: false,
            range_end: false,
            range_middle: false,
          } as never
        }
      />,
    );

    const button = screen.getByRole("button");
    expect(focusSpy).toHaveBeenCalled();
    expect(button).toHaveAttribute("data-selected-single", "true");
    focusSpy.mockRestore();
  });

  it("does not mark selected-single for range selections", () => {
    render(
      <CalendarDayButton
        day={{ date: new Date("2026-01-02T00:00:00.000Z") } as never}
        modifiers={
          {
            selected: true,
            focused: false,
            range_start: true,
            range_end: false,
            range_middle: false,
          } as never
        }
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-selected-single", "false");
    expect(button).toHaveAttribute("data-range-start", "true");
  });
});
