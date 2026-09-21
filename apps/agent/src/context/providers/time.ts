import type { ContextFragment, ContextInput, ContextProvider } from "../types.js";

const fallbackTimeZone = "UTC";

export function resolveTimeZone(value: string | undefined): string {
  if (!value) return fallbackTimeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return fallbackTimeZone;
  }
}

export function formatEventTime(value: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: resolveTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value)).replace(/\//g, "-");
}

const lunarDay = (day: number) => {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  return `${day < 10 ? "初" : day < 20 ? "十" : "廿"}${digits[day % 10]}`;
};

export function formatLunarDate(value: string | Date, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    timeZone: resolveTimeZone(timeZone), year: "numeric", month: "long", day: "numeric",
  }).formatToParts(new Date(value));
  const yearName = parts.find(part => (part.type as string) === "yearName")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = Number(parts.find(part => part.type === "day")?.value);
  if (!yearName || !month || !Number.isInteger(day) || day < 1 || day > 30) return "农历日期不可用";
  return `农历：${yearName}年${month}${lunarDay(day)}`;
}

function formatDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value).replace(/\//g, "-");
}

export class CurrentTimeProvider implements ContextProvider {
  readonly name = "current_time";

  async build(input: ContextInput): Promise<ContextFragment> {
    const timeZone = resolveTimeZone(input.timeZone);
    const now = new Date();
    return {
      section: "Current Time",
      content: `当前时间：${formatEventTime(now.toISOString(), timeZone)}（${timeZone}）\n今天：${formatDate(now, timeZone)} ${new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "long" }).format(now)}\n${formatLunarDate(now, timeZone)}`,
    };
  }
}
