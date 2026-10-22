import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect } from "react-native-svg";
import { Text } from "@/components/ui";
import { space, usePalette, type Palette } from "@/theme";

/** Where each value sits in a `width` × `height` box, inset by `inset`, lowest value at the bottom. */
export function plot(
  values: number[],
  width: number,
  height: number,
  inset = 0,
  domain: [number, number] = [Math.min(...values), Math.max(...values)],
): { x: number; y: number }[] {
  const [low, high] = domain;
  const span = high - low || 1;
  const step = values.length > 1 ? (width - inset * 2) / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: inset + (values.length > 1 ? index * step : (width - inset * 2) / 2),
    y: inset + (height - inset * 2) * (1 - (value - low) / span),
  }));
}

/**
 * The detail chart's y range: the web app's, 10% beyond the values each way, never below zero.
 * A single repeated value gets a range of one either side so the line sits mid-chart.
 */
export function chartDomain(values: number[]): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low) * 0.1 || 1;
  return [Math.max(0, low - padding), high + padding];
}

const points = (at: { x: number; y: number }[]) => at.map(({ x, y }) => `${x},${y}`).join(" ");

/** The list card's sparkline: the history as one line, nothing under two points. */
export function Sparkline({
  values,
  tone = "primary",
}: {
  values: number[];
  tone?: keyof Palette;
}) {
  const palette = usePalette();
  const width = 64;
  const height = 32;
  return (
    <View style={{ width, height }}>
      {values.length < 2 ? null : (
        <Svg width={width} height={height}>
          <Polyline
            points={points(plot(values, width, height, 2))}
            fill="none"
            stroke={palette[tone]}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </View>
  );
}

/**
 * The detail page's chart: the line with its points, the y range written at the top and bottom
 * edges, and the first and last dates under it, laid out to whatever width it is given. A `band`,
 * a reference range, is shaded behind the line and kept inside the range.
 */
export function LineChart({
  values,
  labels,
  format,
  band,
}: {
  values: number[];
  labels: [string, string];
  format: (value: number) => string;
  band?: [number, number];
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const height = 200;
  const domain = chartDomain([...values, ...(band ?? [])]);
  const at = width ? plot(values, width, height, 8, domain) : [];
  const shade = band && width ? plot(band, width, height, 8, domain) : null;
  return (
    <View style={{ gap: space.xs }}>
      <View
        style={{ height }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        testID="chart"
      >
        {width ? (
          <Svg width={width} height={height}>
            {shade ? (
              <Rect
                x={0}
                width={width}
                y={shade[1].y}
                height={shade[0].y - shade[1].y}
                fill={palette.success}
                opacity={0.12}
              />
            ) : null}
            {[8, height / 2, height - 8].map((y) => (
              <Line
                key={y}
                x1={0}
                x2={width}
                y1={y}
                y2={y}
                stroke={palette.border}
                strokeDasharray="3 3"
              />
            ))}
            <Polyline
              points={points(at)}
              fill="none"
              stroke={palette.primary}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {at.map(({ x, y }, index) => (
              <Circle key={index} cx={x} cy={y} r={4} fill={palette.primary} />
            ))}
          </Svg>
        ) : null}
        <Text size="xs" tone="mutedForeground" style={{ position: "absolute", top: 10, left: 0 }}>
          {format(domain[1])}
        </Text>
        <Text
          size="xs"
          tone="mutedForeground"
          style={{ position: "absolute", bottom: 10, left: 0 }}
        >
          {format(domain[0])}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text size="xs" tone="mutedForeground">
          {labels[0]}
        </Text>
        <Text size="xs" tone="mutedForeground">
          {labels[1]}
        </Text>
      </View>
    </View>
  );
}
