import { expect, test } from "vitest";
import { spreadPages, turnPage } from "../../src/reader/spread-layout";
import { formatReadingTime } from "../../src/reading-time";
test("双页保留封面、最后单页和任意定位的源页码", () => {
  expect(spreadPages(0, 170, true)).toEqual([0]);
  expect(spreadPages(1, 170, true)).toEqual([1, 2]);
  expect(spreadPages(50, 170, true)).toEqual([50, 51]);
  expect(spreadPages(169, 170, true)).toEqual([169]);
  expect(turnPage(0, 170, true, 1)).toBe(1);
  expect(turnPage(1, 170, true, -1)).toBe(0);
  expect(turnPage(1, 170, true, 1)).toBe(3);
  expect(turnPage(169, 170, true, -1)).toBe(167);
  expect(turnPage(169, 170, true, 1)).toBe(169);
  expect(turnPage(50, 170, false, 1)).toBe(51);
});
test("阅读时间累计秒、分钟和小时，不虚构历史时间", () => {
  expect(formatReadingTime()).toBe("0 秒");
  expect(formatReadingTime(59_999)).toBe("59 秒");
  expect(formatReadingTime(60_000)).toBe("1 分钟");
  expect(formatReadingTime(3_720_000)).toBe("1 小时 2 分钟");
});
