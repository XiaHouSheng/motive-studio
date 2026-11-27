import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import type { AiUsageDayModel, AiUsageView } from "@motive/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** 热力图统计窗口（自然日，约 29 周 ≈ 半年；窗口拉长后格子尺寸与设置页 640px 版心匹配，网格可水平填满） */
const RANGE_DAYS = 203;

type Metric = "requests" | "tokens";

/** 三大分类：识别（图片导入）/ 题解与详解 / 讨论 */
type Category = "all" | "import" | "solution" | "chat";

const CATEGORY_TASK_TYPES: Record<Exclude<Category, "all">, AiUsageDayModel["taskType"][]> = {
  import: ["image_import"],
  solution: ["solution_generation", "explanation_generation"],
  chat: ["chat"],
};

function categoryOfTaskType(taskType: AiUsageDayModel["taskType"]): Exclude<Category, "all"> {
  if (taskType === "image_import") return "import";
  if (taskType === "chat") return "chat";
  return "solution";
}

const CATEGORY_LABEL_KEYS: Record<Exclude<Category, "all">, "settings.usage.categoryImport" | "settings.usage.categorySolution" | "settings.usage.categoryChat"> = {
  import: "settings.usage.categoryImport",
  solution: "settings.usage.categorySolution",
  chat: "settings.usage.categoryChat",
};

/** GitHub 式日历热力图的色阶（0 = 无请求，4 = 最密集） */
const LEVEL_CLASSES = [
  "bg-sidebar/70 border border-line/60",
  "bg-brand/20",
  "bg-brand/35",
  "bg-brand/60",
  "bg-brand",
];

function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function UsageSection() {
  const t = useT();
  const [view, setView] = useState<AiUsageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("requests");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<Category>("all");

  useEffect(() => {
    let cancelled = false;
    void api
      .getAiUsage(RANGE_DAYS)
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) setError(toMessage(fetchError));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 过滤后的模型列表（数据中出现过的），供筛选与汇总
  const models = useMemo(() => {
    if (!view) return [];
    return [...new Set(view.days.map((day) => day.model))].sort();
  }, [view]);

  const filteredRows = useMemo(() => {
    if (!view) return [];
    return view.days.filter((day) => {
      if (
        categoryFilter !== "all" &&
        !CATEGORY_TASK_TYPES[categoryFilter].includes(day.taskType)
      ) {
        return false;
      }
      if (modelFilter !== "all" && day.model !== modelFilter) return false;
      return true;
    });
  }, [view, categoryFilter, modelFilter]);

  /** 分类汇总：只按模型筛选（不受分类筛选影响），始终展示三大分类 */
  const categorySummary = useMemo(() => {
    if (!view) return [];
    const modelRows =
      modelFilter === "all"
        ? view.days
        : view.days.filter((day) => day.model === modelFilter);
    const byCategory = new Map<
      Exclude<Category, "all">,
      { category: Exclude<Category, "all">; requests: number; inputTokens: number; outputTokens: number; failures: number }
    >();
    for (const row of modelRows) {
      const category = categoryOfTaskType(row.taskType);
      const current = byCategory.get(category) ?? {
        category,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        failures: 0,
      };
      current.requests += row.requests;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      current.failures += row.failures;
      byCategory.set(category, current);
    }
    const order: Array<Exclude<Category, "all">> = ["solution", "chat", "import"];
    return order.map(
      (category) =>
        byCategory.get(category) ?? {
          category,
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          failures: 0,
        },
    );
  }, [view, modelFilter]);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        inputTokens: acc.inputTokens + row.inputTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        failures: acc.failures + row.failures,
      }),
      { requests: 0, inputTokens: 0, outputTokens: 0, failures: 0 },
    );
  }, [filteredRows]);

  /** 日历网格：列 = 周（周一起），行 = 星期；value 按当前指标与筛选聚合 */
  const weeks = useMemo(() => {
    if (!view) return [];
    const valueOf = new Map<string, number>();
    for (const row of filteredRows) {
      const value =
        metric === "requests" ? row.requests : row.inputTokens + row.outputTokens;
      valueOf.set(row.date, (valueOf.get(row.date) ?? 0) + value);
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const end = today;
    const start = addDays(end, -(RANGE_DAYS - 1));
    // 对齐到本周周一（getDay: 周日=0）
    const cursor = addDays(start, -((start.getDay() + 6) % 7));

    const columns: Array<Array<{ date: string; value: number | null }>> = [];
    let week = cursor;
    while (week <= end) {
      const column = [];
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const day = addDays(week, dayIndex);
        const key = toDateKey(day);
        column.push({ date: key, value: day <= end ? (valueOf.get(key) ?? 0) : null });
      }
      columns.push(column);
      week = addDays(week, 7);
    }
    return columns;
  }, [view, filteredRows, metric]);

  const maxLevelValue = useMemo(() => {
    return weeks.reduce(
      (max, column) =>
        column.reduce((cellMax, cell) => Math.max(cellMax, cell.value ?? 0), max),
      0,
    );
  }, [weeks]);

  const levelOf = (value: number | null): number => {
    if (value === null || value <= 0 || maxLevelValue <= 0) return 0;
    return Math.min(4, Math.ceil((value / maxLevelValue) * 4));
  };

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
        <BarChart3 size={13} className="mt-0.5 shrink-0" />
        <span>
          {t("settings.usage.loadError")}
          {error ? `：${error}` : ""}
        </span>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 汇总卡片：筛选范围内的四个总量 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label={t("settings.usage.totalRequests")} value={totals.requests} />
        <StatCard label={t("settings.usage.inputTokens")} value={totals.inputTokens} />
        <StatCard label={t("settings.usage.outputTokens")} value={totals.outputTokens} />
        <StatCard
          label={t("settings.usage.failures")}
          value={totals.failures}
          tone={totals.failures > 0 ? "warning" : undefined}
        />
      </div>

      {/* 指标切换 + 分类筛选 + 模型筛选 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          className="inline-flex gap-0.5 rounded-lg bg-sidebar/70 p-1"
          role="tablist"
          aria-label={t("settings.usage.metricAria")}
        >
          {(["requests", "tokens"] as Metric[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={metric === value}
              onClick={() => setMetric(value)}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-3 text-[12px] transition-colors",
                metric === value
                  ? "bg-panel font-medium text-ink shadow-soft"
                  : "text-ink-faint hover:text-ink-soft",
              )}
            >
              {t(value === "requests" ? "settings.usage.requestsMetric" : "settings.usage.tokensMetric")}
            </button>
          ))}
        </div>
        <div
          className="inline-flex gap-0.5 rounded-lg bg-sidebar/70 p-1"
          role="radiogroup"
          aria-label={t("settings.usage.categoryAria")}
        >
          {(["all", "import", "solution", "chat"] as Category[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={categoryFilter === value}
              onClick={() => setCategoryFilter(value)}
              className={cn(
                "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] transition-colors",
                categoryFilter === value
                  ? "bg-panel font-medium text-ink shadow-soft"
                  : "text-ink-faint hover:text-ink-soft",
              )}
            >
              {t(
                value === "all"
                  ? "settings.usage.categoryAll"
                  : CATEGORY_LABEL_KEYS[value],
              )}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          {t("settings.usage.modelFilterLabel")}
          <select
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            className="h-7 rounded-md border border-line bg-field px-1.5 text-[11.5px] text-ink-soft outline-none focus:border-brand/50"
          >
            <option value="all">{t("settings.usage.allModels")}</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 日历热力图 */}
      {filteredRows.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line px-4 py-3.5">
          <BarChart3 size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ink-faint" />
          <p className="text-[12.5px] leading-relaxed text-ink-faint">
            {t("settings.usage.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-panel p-4">
          <div className="overflow-x-auto pb-1">
            <div className="flex w-full min-w-[520px] flex-col gap-1.5">
              {/* 月份标签行：按列首格月份变化标注 */}
              <div className="flex gap-[3px] pl-7">
                {weeks.map((column, weekIndex) => {
                  const firstDay = column.find((cell) => cell.value !== null);
                  const month = firstDay ? Number(firstDay.date.slice(5, 7)) : null;
                  const previous = weekIndex > 0 ? weeks[weekIndex - 1] : null;
                  const previousFirst = previous?.find((cell) => cell.value !== null);
                  const previousMonth = previousFirst
                    ? Number(previousFirst.date.slice(5, 7))
                    : null;
                  return (
                    <div key={`month-${weekIndex}`} className="min-w-0 flex-1 whitespace-nowrap text-[9.5px] leading-none text-ink-faint">
                      {month !== null && month !== previousMonth ? `${month}月` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-[3px]">
                {/* 星期标签列：一 / 三 / 五 */}
                <div className="flex w-7 shrink-0 flex-col gap-[3px]">
                  {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                    <div
                      key={row}
                      className="flex min-h-[15px] flex-1 items-center text-[9.5px] leading-none text-ink-faint"
                    >
                      {row === 0
                        ? t("settings.usage.weekdayMon")
                        : row === 2
                          ? t("settings.usage.weekdayWed")
                          : row === 4
                            ? t("settings.usage.weekdayFri")
                            : ""}
                    </div>
                  ))}
                </div>
                {weeks.map((column, weekIndex) => (
                  <div key={`week-${weekIndex}`} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    {column.map((cell) => (
                      <div
                        key={cell.date}
                        title={
                          cell.value !== null
                            ? t("settings.usage.cellTitle", {
                                date: cell.date,
                                requests: cellRequests(view, cell.date, modelFilter),
                                tokens: cellTokens(view, cell.date, modelFilter),
                              })
                            : undefined
                        }
                        className={cn(
                          "aspect-square w-full rounded-[3px] transition-colors",
                          cell.value === null ? "invisible" : LEVEL_CLASSES[levelOf(cell.value)],
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
              {/* 图例 */}
              <div className="flex items-center gap-1 pl-7 pt-1 text-[9.5px] text-ink-faint">
                <span>{t("settings.usage.legendLess")}</span>
                {LEVEL_CLASSES.map((levelClass, index) => (
                  <span
                    key={index}
                    className={cn("h-[10px] w-[10px] rounded-[2px]", levelClass)}
                  />
                ))}
                <span>{t("settings.usage.legendMore")}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 按分类汇总：识别 / 题解与详解 / 讨论（跟随模型筛选，不受分类筛选影响） */}
      {categorySummary.some((row) => row.requests > 0) ? (
        <div className="space-y-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("settings.usage.byCategoryTitle")}
          </p>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line bg-sidebar/50 text-left text-[10.5px] uppercase tracking-wide text-ink-faint">
                  <th className="px-3 py-2 font-medium">{t("settings.usage.categoryColumn")}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("settings.usage.requestsColumn")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("settings.usage.inputTokens")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("settings.usage.outputTokens")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("settings.usage.failures")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {categorySummary.map((row) => (
                  <tr
                    key={row.category}
                    className="border-b border-line/60 last:border-b-0"
                  >
                    <td className="px-3 py-2 text-ink">
                      {t(CATEGORY_LABEL_KEYS[row.category])}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {row.requests}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {row.inputTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {row.outputTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {row.failures}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 按模型汇总 */}
      {filteredRows.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("settings.usage.byModelTitle")}
          </p>
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line bg-sidebar/50 text-left text-[10.5px] uppercase tracking-wide text-ink-faint">
                <th className="px-3 py-2 font-medium">{t("settings.usage.modelColumn")}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("settings.usage.requestsColumn")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("settings.usage.inputTokens")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("settings.usage.outputTokens")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("settings.usage.failures")}
                </th>
              </tr>
            </thead>
            <tbody>
              {modelsWithData(filteredRows).map((row) => (
                <tr key={row.model} className="border-b border-line/60 last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[11.5px] text-ink">{row.model}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                    {row.requests}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                    {row.inputTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                    {row.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                    {row.failures}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      <p className={cn("text-[11px] leading-relaxed text-ink-faint")}>
        {t("settings.usage.hint")}
      </p>
    </div>
  );
}

/** 单个模型 × 当天日期在筛选范围内的请求数 / token 合计（用于格子 tooltip） */
function cellRequests(view: AiUsageView, date: string, modelFilter: string): number {
  return view.days
    .filter((day) => day.date === date && (modelFilter === "all" || day.model === modelFilter))
    .reduce((sum, day) => sum + day.requests, 0);
}

function cellTokens(view: AiUsageView, date: string, modelFilter: string): number {
  return view.days
    .filter((day) => day.date === date && (modelFilter === "all" || day.model === modelFilter))
    .reduce((sum, day) => sum + day.inputTokens + day.outputTokens, 0);
}

/** 按模型聚合筛选后的行（排序：请求数降序） */
function modelsWithData(rows: AiUsageView["days"]) {
  const byModel = new Map<
    string,
    { model: string; requests: number; inputTokens: number; outputTokens: number; failures: number }
  >();
  for (const row of rows) {
    const current = byModel.get(row.model) ?? {
      model: row.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      failures: 0,
    };
    current.requests += row.requests;
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.failures += row.failures;
    byModel.set(row.model, current);
  }
  return [...byModel.values()].sort((a, b) => b.requests - a.requests);
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
      <p className="text-[10.5px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-1 text-[18px] font-semibold tabular-nums",
          tone === "warning" ? "text-warning" : "text-ink",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
