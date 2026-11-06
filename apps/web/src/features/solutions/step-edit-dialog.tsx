import { useEffect, useState } from "react";
import type { SolutionStep } from "@motive/shared";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/use-i18n";

const inputClass =
  "w-full rounded-md border border-line bg-field px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand/50";
const textareaClass =
  "min-h-[220px] w-full resize-y rounded-md border border-line bg-field px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand/50";

interface StepEditDialogProps {
  step: SolutionStep;
  onClose: () => void;
  /** 保存成功返回 null，失败返回用户可读的错误消息 */
  onSave: (
    stepId: string,
    patch: { title?: string; content?: string },
  ) => Promise<string | null>;
}

/** 步骤编辑对话框：修改标题/内容后保存，后端在同一事务内写入「手动编辑」版本快照 */
export function StepEditDialog({ step, onClose, onSave }: StepEditDialogProps) {
  const t = useT();
  const [title, setTitle] = useState(step.title);
  const [content, setContent] = useState(step.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换编辑目标时重置草稿
  useEffect(() => {
    setTitle(step.title);
    setContent(step.content);
    setError(null);
  }, [step]);

  const changed = title !== step.title || content !== step.content;

  const save = async () => {
    if (saving || !changed) return;
    setSaving(true);
    setError(null);
    const failure = await onSave(step.id, { title: title.trim(), content });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={t("steps.edit")}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error ? (
            <span className="mr-auto min-w-0 flex-1 truncate text-[11.5px] text-danger">
              {t("steps.editFailed", { message: error })}
            </span>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            {t("solution.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || !changed}>
            {saving ? t("steps.saving") : t("steps.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium text-ink-soft" htmlFor="step-edit-title">
            {t("steps.editTitle")}
          </label>
          <input
            id="step-edit-title"
            className={inputClass}
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11.5px] font-medium text-ink-soft" htmlFor="step-edit-content">
            {t("steps.editContent")}
          </label>
          <textarea
            id="step-edit-content"
            className={textareaClass}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
