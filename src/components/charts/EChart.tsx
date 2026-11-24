"use client";
// A tiny Apache ECharts wrapper: init on mount, setOption on change, resize with its box, dispose on unmount.
// Tree-shaken (only the pieces the viewer draws). Client-only: load it with next/dynamic { ssr: false }.
import React, { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, GaugeChart, LineChart } from "echarts/charts";
import { GraphicComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([LineChart, GaugeChart, BarChart, GridComponent, TooltipComponent, GraphicComponent, CanvasRenderer]);

export default function EChart({
  option,
  height,
  onPointClick,
  label,
}: {
  option: EChartsCoreOption;
  height: number;
  onPointClick?: (dataIndex: number) => void;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onPointClick);
  click.current = onPointClick;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: "canvas" });
    chart.current = c;
    c.setOption(optionRef.current, { notMerge: true });
    c.on("click", (p) => {
      if (typeof p.dataIndex === "number") click.current?.(p.dataIndex);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  const optionRef = useRef(option);
  optionRef.current = option;
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={box} role="img" aria-label={label} style={{ width: "100%", height }} />;
}
