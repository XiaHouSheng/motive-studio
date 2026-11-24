/**
 * 步骤引用格式化与清洗。
 *
 * 上下文注入与模型输出约定统一使用「步骤 N（标题）」的可读形式指代步骤，
 * 严禁在提示词或回复正文里出现步骤 ID（UUID）——否则模型会模仿输出，
 * 用户在讨论/详解里就会看到哈希串。此工具用于：
 * 1. 服务端：清洗注入上下文的历史讨论/轮次原文（存量消息可能含 UUID）；
 * 2. 前端：渲染 assistant 消息前兜底替换（存量数据不迁移库，显示层修正）。
 */

/** 供替换用的最小步骤信息（SolutionStep 的子集） */
export interface StepRefInfo {
  id: string;
  order: number;
  title: string;
}

/** 形如 `[uuid]`、裸 uuid 的引用（大小写不敏感，方括号可选） */
const STEP_ID_PATTERN = /\[?\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b\]?/gi;

/**
 * 把文本中的步骤 UUID（已知步骤）替换为「步骤 N（标题）」。
 * 未知的 UUID（不在 steps 里）保持原样，避免误伤用户自己写的文本。
 */
export function replaceStepReferences(content: string, steps: StepRefInfo[]): string {
  if (!content) return content;
  const refById = new Map<string, string>();
  for (const step of steps) {
    refById.set(step.id.toLowerCase(), `步骤 ${step.order}（${step.title}）`);
  }
  if (refById.size === 0) return content;
  return content.replace(STEP_ID_PATTERN, (match, id: string) => {
    const ref = refById.get(id.toLowerCase());
    // 未知 id：原样返回（保留用户可能使用的任何写法）
    return ref ?? match;
  });
}
