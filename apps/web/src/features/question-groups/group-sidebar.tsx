import { useState } from "react";
import { Download, FolderOpen, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { excerpt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Skeleton } from "@/components/ui/skeleton";

interface GroupSidebarProps {
  workspace: WorkspaceApi;
  onNavigate?: () => void;
}

export function GroupSidebar({ workspace, onNavigate }: GroupSidebarProps) {
  const {
    loading,
    groups,
    questionsInGroup,
    selectedGroup,
    createGroup,
    createQuestion,
    deleteGroup,
    deleteQuestion,
    exportGroupMarkdown,
    openImageImport,
  } = workspace;
  const selectedGroupId = useUiStore((state) => state.selectedGroupId);
  const selectedQuestionId = useUiStore((state) => state.selectedQuestionId);
  const selectGroup = useUiStore((state) => state.selectGroup);
  const selectQuestion = useUiStore((state) => state.selectQuestion);

  const [groupDraft, setGroupDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [questionDraft, setQuestionDraft] = useState("");
  const [addingQuestion, setAddingQuestion] = useState(false);

  const submitGroup = () => {
    if (!groupDraft.trim()) return;
    createGroup(groupDraft);
    setGroupDraft("");
    setAddingGroup(false);
  };

  const submitQuestion = () => {
    if (!questionDraft.trim()) return;
    createQuestion(questionDraft);
    setQuestionDraft("");
    setAddingQuestion(false);
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 px-3 py-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-5/6" />
        <Skeleton className="mt-4 h-3 w-12" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
          题组
        </span>
        <button
          type="button"
          onClick={() => setAddingGroup((value) => !value)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink"
          aria-label={addingGroup ? "取消新建题组" : "新建题组"}
        >
          {addingGroup ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {addingGroup ? (
        <div className="px-2 pb-2">
          <input
            autoFocus
            value={groupDraft}
            onChange={(event) => setGroupDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitGroup();
              if (event.key === "Escape") {
                setAddingGroup(false);
                setGroupDraft("");
              }
            }}
            placeholder="题组名称，回车创建"
            className="h-8 w-full rounded-md border border-line bg-field px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
          />
        </div>
      ) : null}

      <div className="max-h-[38%] min-h-0 shrink-0 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-faint">
            尚无题组，先创建一个。
          </p>
        ) : (
          <div className="space-y-0.5">
            {groups.map((group) => {
              const active = group.id === selectedGroupId;
              return (
                <div key={group.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => {
                      selectGroup(group.id);
                      onNavigate?.();
                    }}
                    title={group.title}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1.5 pr-20 pl-2 text-left transition-colors",
                      active
                        ? "bg-selection text-ink"
                        : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                    )}
                  >
                    <FolderOpen
                      size={14}
                      strokeWidth={1.8}
                      className={cn("shrink-0", active ? "text-brand" : "text-ink-faint")}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                      {group.title}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-faint group-hover/row:opacity-0">
                      {group.questionIds.length}
                    </span>
                  </button>
                  <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/row:opacity-100">
                    <button
                      type="button"
                      aria-label={`按图片导入题目到 ${group.title}`}
                      title="按图片导入题目"
                      onClick={(event) => {
                        event.stopPropagation();
                        openImageImport(group.id);
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                    >
                      <ImagePlus size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`导出题组 ${group.title}`}
                      title="导出题组详解（Markdown）"
                      onClick={(event) => {
                        event.stopPropagation();
                        exportGroupMarkdown(group.id);
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除题组 ${group.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        const ok = window.confirm(
                          `删除题组「${group.title}」及其 ${group.questionIds.length} 道题目？该操作不可恢复。`,
                        );
                        if (ok) deleteGroup(group.id);
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-3 border-t border-line" />

      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
          题目
        </span>
        <span className="text-[10.5px] text-ink-faint">{questionsInGroup.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!selectedGroup ? (
          <p className="px-2 py-3 text-[12px] text-ink-faint">先选择一个题组。</p>
        ) : questionsInGroup.length === 0 ? (
          <div className="space-y-2 px-2 py-3">
            <p className="text-[12px] leading-relaxed text-ink-faint">该题组暂无题目。</p>
            <button
              type="button"
              onClick={() => openImageImport(selectedGroup.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-selection/50 hover:text-ink"
            >
              <ImagePlus size={13} />
              从图片导入
            </button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {questionsInGroup.map((question, index) => {
              const active = question.id === selectedQuestionId;
              return (
                <div key={question.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => {
                      selectQuestion(question.id);
                      onNavigate?.();
                    }}
                    title={question.content}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md py-1.5 pr-7 pl-2 text-left transition-colors",
                      active
                        ? "bg-selection text-ink"
                        : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 font-mono text-[10.5px] tabular-nums",
                        active ? "text-brand" : "text-ink-faint",
                      )}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-[1.55]">
                      {excerpt(question.content, 46)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="删除题目"
                    onClick={(event) => {
                      event.stopPropagation();
                      const ok = window.confirm(
                        `删除题目「${excerpt(question.content, 24)}」及其步骤、讨论与详解？该操作不可恢复。`,
                      );
                      if (ok) deleteQuestion(question.id);
                    }}
                    className="absolute top-1.5 right-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint opacity-100 transition-opacity hover:bg-danger/10 hover:text-danger md:opacity-0 md:group-hover/row:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line p-2.5">
        {addingQuestion ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={questionDraft}
              onChange={(event) => setQuestionDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submitQuestion();
                if (event.key === "Escape") {
                  setAddingQuestion(false);
                  setQuestionDraft("");
                }
              }}
              rows={3}
              placeholder="粘贴题目内容，Cmd/Ctrl+Enter 添加"
              className="w-full resize-none rounded-md border border-line bg-field px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAddingQuestion(false);
                  setQuestionDraft("");
                }}
                className="h-7 rounded-md px-2 text-[12px] text-ink-soft transition-colors hover:bg-selection hover:text-ink"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitQuestion}
                disabled={!questionDraft.trim()}
                className="h-7 rounded-md bg-brand px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                添加
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingQuestion(true)}
            disabled={!selectedGroup}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-2 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:bg-selection/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} />
            新建题目
          </button>
        )}
      </div>
    </div>
  );
}
