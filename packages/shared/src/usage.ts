import type { TokenUsage } from "./types";

/** AI 请求类型：覆盖全部消耗模型调用的环节（连接测试不计入） */
export const AI_REQUEST_TASK_TYPES = [
  "solution_generation",
  "explanation_generation",
  "chat",
  "image_import",
] as const;

export type AiRequestTaskType = (typeof AI_REQUEST_TASK_TYPES)[number];

/** 按天 × 模型聚合的一行用量 */
export interface AiUsageDayModel {
  /** 本地时区日期（YYYY-MM-DD） */
  date: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
}

/** 用量统计视图：热力图与汇总的数据源 */
export interface AiUsageView {
  /** 统计窗口天数（自然日，含今天） */
  rangeDays: number;
  days: AiUsageDayModel[];
}

/** 供仓储层写入用的一行请求记录 */
export interface AiRequestRecordInput {
  taskType: AiRequestTaskType;
  model: string;
  /** 发起请求的配置 profile（讨论模型跟随主模型时用于区分） */
  profileId?: string;
  usage?: TokenUsage;
  /** 失败请求也计入请求数（usage 可缺失） */
  ok?: boolean;
}
