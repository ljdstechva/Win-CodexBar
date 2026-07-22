import { describe, expect, it } from "vitest";

import { measureFloatBarContent } from "./useFloatBarWindow";

function measuredElement({
  rectWidth,
  rectHeight,
  scrollWidth,
  scrollHeight,
}: {
  rectWidth: number;
  rectHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ width: rectWidth, height: rectHeight }) as DOMRect;
  Object.defineProperties(element, {
    scrollWidth: { value: scrollWidth },
    scrollHeight: { value: scrollHeight },
  });
  return element;
}

describe("measureFloatBarContent", () => {
  it("uses intrinsic overflow when a horizontal account pill exceeds the viewport", () => {
    const element = measuredElement({
      rectWidth: 495,
      rectHeight: 52,
      scrollWidth: 612,
      scrollHeight: 52,
    });

    expect(measureFloatBarContent(element)).toEqual({ w: 620, h: 60 });
  });

  it("sums unshrunk horizontal pill widths when the body is viewport-constrained", () => {
    const element = measuredElement({
      rectWidth: 495,
      rectHeight: 52,
      scrollWidth: 495,
      scrollHeight: 52,
    });
    const body = document.createElement("div");
    body.className = "floatbar__body floatbar__body--horizontal";
    body.style.gap = "4px";
    for (const width of [220, 160, 190]) {
      const child = measuredElement({
        rectWidth: Math.min(width, 150),
        rectHeight: 44,
        scrollWidth: width,
        scrollHeight: 44,
      });
      body.appendChild(child);
    }
    element.appendChild(body);

    expect(measureFloatBarContent(element)).toEqual({ w: 606, h: 60 });
  });

  it("sums vertical capacity and account pills without a removed Pace row", () => {
    const element = measuredElement({
      rectWidth: 190,
      rectHeight: 180,
      scrollWidth: 190,
      scrollHeight: 180,
    });
    const body = document.createElement("div");
    body.className = "floatbar__body floatbar__body--vertical";
    body.style.gap = "4px";
    for (const { width, height } of [
      { width: 182, height: 74 },
      { width: 236, height: 42 },
      { width: 188, height: 58 },
      { width: 224, height: 42 },
    ]) {
      body.appendChild(
        measuredElement({
          rectWidth: Math.min(width, 190),
          rectHeight: height,
          scrollWidth: width,
          scrollHeight: height,
        }),
      );
    }
    element.appendChild(body);

    expect(measureFloatBarContent(element)).toEqual({ w: 244, h: 236 });
  });

  it("keeps the rendered bounds when there is no overflow", () => {
    const element = measuredElement({
      rectWidth: 124.2,
      rectHeight: 210.1,
      scrollWidth: 124,
      scrollHeight: 210,
    });

    expect(measureFloatBarContent(element)).toEqual({ w: 133, h: 219 });
  });
});
