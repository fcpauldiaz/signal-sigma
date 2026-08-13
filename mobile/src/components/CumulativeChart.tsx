import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { G, Line, Polygon, Polyline, Text as SvgText } from "react-native-svg";
import type { PerformanceResponse } from "../api";
import { money } from "../format";
import { colors } from "../theme";

const W = 640;
const H = 220;
const PAD = { t: 16, r: 16, b: 28, l: 52 };

export function CumulativeChart({
  series,
}: {
  series: PerformanceResponse["cumulativeSeries"];
}) {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const points = useMemo(() => {
    if (!series.length) return null;
    const ys = series.map((p) => p.cumulative);
    const minY = Math.min(0, ...ys);
    const maxY = Math.max(0, ...ys);
    const span = maxY - minY || 1;
    const coords = series.map((p, i) => {
      const x = PAD.l + (i / Math.max(series.length - 1, 1)) * innerW;
      const y = PAD.t + ((maxY - p.cumulative) / span) * innerH;
      return { x, y };
    });
    const zeroY = PAD.t + ((maxY - 0) / span) * innerH;
    const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
    const area = `${PAD.l},${zeroY} ${line} ${coords[coords.length - 1].x},${zeroY}`;
    return { coords, line, area, zeroY, minY, maxY };
  }, [series, innerH, innerW]);

  if (!points) return null;

  const ticks = [points.minY, 0, points.maxY].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  return (
    <View style={styles.wrap}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={180}>
        {ticks.map((t) => {
          const span = points.maxY - points.minY || 1;
          const y = PAD.t + ((points.maxY - t) / span) * innerH;
          return (
            <G key={String(t)}>
              <Line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y}
                y2={y}
                stroke={colors.rule}
                strokeWidth={1}
              />
              <SvgText
                x={PAD.l - 8}
                y={y + 3}
                fill={colors.faint}
                fontSize={10}
                textAnchor="end"
              >
                {money(t)}
              </SvgText>
            </G>
          );
        })}
        <Polygon points={points.area} fill={colors.accentMuted} />
        <Polyline
          points={points.line}
          fill="none"
          stroke={colors.accent}
          strokeWidth={2}
        />
        <SvgText x={PAD.l} y={H - 6} fill={colors.faint} fontSize={10}>
          {series[0]?.date}
        </SvgText>
        <SvgText
          x={W - PAD.r}
          y={H - 6}
          fill={colors.faint}
          fontSize={10}
          textAnchor="end"
        >
          {series[series.length - 1]?.date}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    minWidth: 0,
  },
});
