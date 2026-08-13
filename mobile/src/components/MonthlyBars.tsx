import { StyleSheet, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";
import type { PerformanceResponse } from "../api";
import { money } from "../format";
import { colors } from "../theme";

const W = 640;
const H = 200;
const PAD = { t: 12, r: 12, b: 36, l: 52 };

export function MonthlyBars({
  monthly,
}: {
  monthly: PerformanceResponse["monthly"];
}) {
  if (!monthly.length) return null;

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const values = monthly.map((m) => m.gainLoss);
  const minY = Math.min(0, ...values);
  const maxY = Math.max(0, ...values);
  const span = maxY - minY || 1;
  const yAt = (v: number) => PAD.t + ((maxY - v) / span) * innerH;
  const zeroY = yAt(0);
  const barW = Math.max(6, (innerW / monthly.length) * 0.7);
  const gap = innerW / monthly.length;

  return (
    <View style={styles.wrap}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={168}>
        <Line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={zeroY}
          y2={zeroY}
          stroke={colors.rule}
          strokeWidth={1}
        />
        <SvgText
          x={PAD.l - 8}
          y={yAt(maxY) + 3}
          fill={colors.faint}
          fontSize={10}
          textAnchor="end"
        >
          {money(maxY)}
        </SvgText>
        <SvgText
          x={PAD.l - 8}
          y={yAt(minY) + 3}
          fill={colors.faint}
          fontSize={10}
          textAnchor="end"
        >
          {money(minY)}
        </SvgText>
        {monthly.map((m, i) => {
          const cx = PAD.l + gap * i + gap / 2;
          const yVal = yAt(m.gainLoss);
          const y = Math.min(yVal, zeroY);
          const hBar = Math.max(Math.abs(yVal - zeroY), 1);
          const label =
            i === 0 || i === monthly.length - 1 || monthly.length <= 8
              ? m.month.slice(2)
              : i % Math.ceil(monthly.length / 6) === 0
                ? m.month.slice(5)
                : "";
          return (
            <G key={m.month}>
              <Rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={hBar}
                fill={m.gainLoss >= 0 ? colors.positive : colors.negative}
              />
              {label ? (
                <SvgText
                  x={cx}
                  y={H - 8}
                  fill={colors.faint}
                  fontSize={10}
                  textAnchor="middle"
                >
                  {label}
                </SvgText>
              ) : null}
            </G>
          );
        })}
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
