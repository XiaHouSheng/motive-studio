import { useState, useMemo, memo } from "react";
import {
  ChevronDown,
  Download,
  FileText,
  FolderOpen,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { excerpt } from "@/lib/format";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Skeleton } from "@/components/ui/skeleton";

interface GroupSidebarProps {
  workspace: WorkspaceApi;
  onNavigate?: () => void;
}

/** 行内改名编辑目标：题组或试卷分组 */
interface RenameTarget {
  kind: "group" | "paper";
  id: string;
  draft: string;
}

export function GroupSidebar({ workspace, onNavigate }: GroupSidebarProps) {
  const {
    loading,
    groups,
    paperGroups,
    questions,
    questionsInGroup,
    selectedGroup,
    selectedPaperGroup,
    createGroup,
    createPaperGroup,
    renameGroup,
    renamePaperGroup,
    deleteGroup,
    deletePaperGroup,
    deleteQuestion,
    exportPaperMarkdown,
    openImageImport,
  } = workspace;  const selectedGroupId = useUiStore((state) => state.selectedGroupId);
  const selectedQuestionId = useUiStore((state) => state.selectedQuestionId);
  const selectGroup = useUiStore((state) => state.selectGroup);
  const selectPaperGroup = useUiStore((state) => state.selectPaperGroup);
  const selectQuestion = useUiStore((state) => state.selectQuestion);
  const t = useT();

  const [groupDraft, setGroupDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  /** 手风琴展开：同一时间只展开一个题组（默认展开当前选中的题组） */
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(selectedGroupId);
  /** 正在行内改名的题组 / 试卷分组 */
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  /** 正在添加试卷分组的题组 id */
  const [addingPaperFor, setAddingPaperFor] = useState<string | null>(null);
  const [paperDraft, setPaperDraft] = useState("");
  /** 题目搜索词：非空时跨全部题组/试卷分组搜索 */
  const [searchDraft, setSearchDraft] = useState("");

  const submitGroup = () => {
    if (!groupDraft.trim()) return;
    createGroup(groupDraft);
    setGroupDraft("");
    setAddingGroup(false);
  };

  const submitPaper = (groupId: string) => {
    if (!paperDraft.trim()) return;
    createPaperGroup(groupId, paperDraft);
    setPaperDraft("");
    setAddingPaperFor(null);
  };

  const commitRename = () => {
    if (!renaming) return;
    const title = renaming.draft.trim();
    if (title) {
      if (renaming.kind === "group") renameGroup(renaming.id, title);
      else renamePaperGroup(renaming.id, title);
    }
    setRenaming(null);
  };

  const startRename = (kind: "group" | "paper", id: string, currentTitle: string) => {
    setAddingPaperFor(null);
    setRenaming({ kind, id, draft: currentTitle });
  };

  const paperGroupsOf = (groupId: string) =>
    paperGroups.filter((paper) => paper.groupId === groupId);

  /**
   * 题目搜索：仅在当前题组内搜索（覆盖该题组全部试卷分组）；
   * 返回 null 表示未启用搜索（无关键词或未选择题组）。
   */
  const searchResults = useMemo(() => {
    const keyword = searchDraft.trim().toLowerCase();
    if (!keyword || !selectedGroupId) return null;
    const paperTitleById = new Map(paperGroups.map((paper) => [paper.id, paper.title] as const));
    return questions
      .filter(
        (question) =>
          question.groupId === selectedGroupId &&
          question.content.toLowerCase().includes(keyword),
      )
      .map((question) => ({
        question,
        paperTitle: paperTitleById.get(question.paperGroupId ?? "") ?? "",
      }));
  }, [searchDraft, questions, selectedGroupId, paperGroups]);

  const openQuestionInSearch = (question: (typeof questions)[number]) => {
    if (question.paperGroupId) {
      selectPaperGroup(question.groupId, question.paperGroupId);
    } else {
      selectGroup(question.groupId);
    }
    selectQuestion(question.id);
    onNavigate?.();
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
    <div className="flex h-full min-h-0 flex-col [container-type:size]">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
          {t("groups.title")}
        </span>
        <button
          type="button"
          onClick={() => setAddingGroup((value) => !value)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink"
          aria-label={addingGroup ? t("groups.newGroupCancel") : t("groups.newGroup")}
        >
          {addingGroup ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>

      {addingGroup ? (
        <div className="animate-fade-in px-2 pb-2">
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
            placeholder={t("groups.namePlaceholder")}
            className="h-8 w-full rounded-md border border-line bg-field px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
          />
        </div>
      ) : null}

      <div className="max-h-[42%] min-h-0 shrink-0 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-ink-faint">
            {t("groups.empty")}
          </p>
        ) : (
          <div className="space-y-0.5">
            {groups.map((group) => {
              const active = group.id === selectedGroupId;
              const collapsed = expandedGroupId !== group.id;
              const papers = paperGroupsOf(group.id);
              const isRenaming = renaming?.kind === "group" && renaming.id === group.id;
              return (
                <div key={group.id}>
                  {/* 题组行 */}
                  <div className="group/row relative">
                    {isRenaming ? (
                      <div className="px-1 py-0.5">
                        <input
                          autoFocus
                          value={renaming.draft}
                          onChange={(event) =>
                            setRenaming({ ...renaming, draft: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename();
                            if (event.key === "Escape") setRenaming(null);
                          }}
                          onBlur={commitRename}
                          aria-label={t("groups.renameGroupAria", { title: group.title })}
                          className="h-7 w-full rounded-md border border-brand/50 bg-field px-2 text-[12.5px] text-ink outline-none"
                        />
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            selectGroup(group.id);
                            setExpandedGroupId(group.id);
                            onNavigate?.();
                          }}
                          title={group.title}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-[56px] pl-1 text-left transition-colors",
                            active
                              ? "bg-selection text-ink"
                              : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                          )}
                        >
                          <span
                            role="button"
                            tabIndex={-1}
                            aria-label={t("groups.toggleExpandAria")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedGroupId((current) =>
                                current === group.id ? null : group.id,
                              );
                            }}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
                          >
                            <ChevronDown
                              size={12}
                              className={cn(
                                "transition-transform duration-200",
                                collapsed && "-rotate-90",
                              )}
                            />
                          </span>
                          <FolderOpen
                            size={14}
                            strokeWidth={1.8}
                            className={cn("shrink-0", active ? "text-brand" : "text-ink-faint")}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                            {group.title}
                          </span>
                        </button>
                        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                          <div className="flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/row:opacity-100">
                            <button
                              type="button"
                              aria-label={t("groups.renameGroupAria", { title: group.title })}
                              title={t("groups.renameTitle")}
                              onClick={(event) => {
                                event.stopPropagation();
                                startRename("group", group.id, group.title);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={t("groups.deleteAria", { title: group.title })}
                              onClick={(event) => {
                                event.stopPropagation();
                                const ok = window.confirm(
                                  t("groups.deleteConfirm", {
                                    title: group.title,
                                    count: group.questionIds.length,
                                  }),
                                );
                                if (ok) deleteGroup(group.id);
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 试卷分组行（题组之下的二级分组）：与题组行留出垂直间隔；展开/收起带高度过渡动效，超高时内部滚动 */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      {/* 高度阈值 = 题组列表容器(≤侧栏42%)高度的30%，即 42% × 30% ≈ 12.6cqh，超出内部滚动 */}
                      <div className="mt-1 mb-0.5 ml-4 max-h-[12.6cqh] space-y-0.5 overflow-y-auto border-l border-line/70 pl-1.5">
                      {papers.map((paper) => {
                        const paperActive =
                          active && paper.id === selectedPaperGroup?.id;
                        const isPaperRenaming =
                          renaming?.kind === "paper" && renaming.id === paper.id;
                        // 试卷题目数：历史数据 paperGroupId 为空时按首个试卷分组兜底
                        const fallbackPaperId = papers[0]?.id ?? null;
                        const paperQuestionCount = questions.filter(
                          (question) => (question.paperGroupId ?? fallbackPaperId) === paper.id,
                        ).length;
                        return (
                          <div key={paper.id} className="group/paper relative">
                            {isPaperRenaming ? (
                              <div className="px-1 py-0.5">
                                <input
                                  autoFocus
                                  value={renaming.draft}
                                  onChange={(event) =>
                                    setRenaming({ ...renaming, draft: event.target.value })
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") commitRename();
                                    if (event.key === "Escape") setRenaming(null);
                                  }}
                                  onBlur={commitRename}
                                  aria-label={t("groups.renamePaperAria", { title: paper.title })}
                                  className="h-7 w-full rounded-md border border-brand/50 bg-field px-2 text-[12.5px] text-ink outline-none"
                                />
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    selectPaperGroup(group.id, paper.id);
                                    onNavigate?.();
                                  }}
                                  title={paper.title}
                                  className={cn(
                                    "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-[100px] pl-1 text-left transition-colors",
                                    paperActive
                                      ? "bg-selection text-ink"
                                      : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                                  )}
                                >
                                  <FileText
                                    size={14}
                                    strokeWidth={1.8}
                                    className={cn(
                                      "shrink-0",
                                      paperActive ? "text-brand" : "text-ink-faint",
                                    )}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                                    {paper.title}
                                  </span>
                                </button>
                                <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                                  <div className="flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/paper:opacity-100">
                                    <button
                                      type="button"
                                      aria-label={t("groups.exportPaperAria", {
                                        title: paper.title,
                                      })}
                                      title={t("groups.exportPaperTitle")}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        exportPaperMarkdown(paper.id);
                                      }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                                    >
                                      <Download size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={t("groups.renamePaperAria", {
                                        title: paper.title,
                                      })}
                                      title={t("groups.renameTitle")}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        startRename("paper", paper.id, paper.title);
                                      }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                                    >
                                      <Pencil size={11} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={t("groups.deletePaperAria", {
                                        title: paper.title,
                                      })}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        const ok = window.confirm(
                                          t("groups.deletePaperConfirm", {
                                            title: paper.title,
                                            count: paperQuestionCount,
                                          }),
                                        );
                                        if (ok) deletePaperGroup(paper.id);
                                      }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                  <span className="w-6 shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint">
                                    {paperQuestionCount}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {/* 行内新建试卷分组入口（替代题组 hover 的 "+"） */}
                      {addingPaperFor === group.id ? (
                        <div className="animate-fade-in px-1 py-0.5">
                          <input
                            autoFocus
                            value={paperDraft}
                            onChange={(event) => setPaperDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") submitPaper(group.id);
                              if (event.key === "Escape") {
                                setAddingPaperFor(null);
                                setPaperDraft("");
                              }
                            }}
                            onBlur={() => {
                              if (paperDraft.trim()) submitPaper(group.id);
                              else setAddingPaperFor(null);
                            }}
                            placeholder={t("groups.paperNamePlaceholder")}
                            className="h-7 w-full rounded-md border border-line bg-field px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRenaming(null);
                            setAddingPaperFor(group.id);
                            setPaperDraft("");
                          }}
                          className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-ink-faint transition-colors hover:bg-selection/60 hover:text-ink-soft"
                        >
                          <Plus size={12} className="shrink-0" />
                          <span className="min-w-0 truncate">{t("groups.addPaperGroup")}</span>
                        </button>
                      )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-3 border-t border-line" />

      {/* 「题目」行：搜索内嵌标题行，"+" 为唯一添加入口（弹窗支持文字 / 图片 / PDF） */}
      <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
        <span className="shrink-0 text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
          {t("groups.questionsTitle")}
        </span>
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchDraft("");
            }}
            placeholder={t("groups.searchPlaceholder")}
            aria-label={t("groups.searchAria")}
            className="h-6.5 w-full rounded-md border border-line bg-field pr-5 pl-6 text-[11.5px] text-ink transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-ink-faint focus:border-brand/50 focus:ring-2 focus:ring-brand/15"
          />
          {searchDraft ? (
            <button
              type="button"
              onClick={() => setSearchDraft("")}
              aria-label={t("groups.searchAria")}
              className="absolute top-1/2 right-1 inline-flex h-4.5 w-4.5 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() =>
            selectedGroup && openImageImport(selectedGroup.id, selectedPaperGroup?.id ?? null)
          }
          disabled={!selectedGroup}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("groups.addQuestionTitle")}
          title={t("groups.addQuestionTitle")}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-faint">{t("groups.noSearchResults")}</p>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map(({ question, paperTitle }) => (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => openQuestionInSearch(question)}
                  title={question.content}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    question.id === selectedQuestionId
                      ? "bg-selection text-ink"
                      : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                  )}
                >
                  <span className="line-clamp-2 min-w-0 text-[12.5px] leading-[1.55]">
                    {excerpt(question.content, 46)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 text-[10.5px] text-ink-faint">
                    <FileText size={10} className="shrink-0" />
                    <span className="truncate">{paperTitle}</span>
                  </span>
                </button>
              ))}
            </div>
          )
        ) : !selectedGroup ? (
          <p className="px-2 py-3 text-[12px] text-ink-faint">{t("groups.selectFirst")}</p>
        ) : questionsInGroup.length === 0 ? (
          <div className="space-y-2 px-2 py-3">
            <p className="text-[12px] leading-relaxed text-ink-faint">{t("groups.noQuestions")}</p>
            <button
              type="button"
              onClick={() =>
                openImageImport(selectedGroup.id, selectedPaperGroup?.id ?? null, "image")
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-selection/50 hover:text-ink"
            >
              <ImagePlus size={13} />
              {t("groups.importButton")}
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
                    aria-label={t("groups.deleteQuestionAria")}
                    onClick={(event) => {
                      event.stopPropagation();
                      const ok = window.confirm(
                        t("groups.deleteQuestionConfirm", {
                          title: excerpt(question.content, 24),
                        }),
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

    </div>
  );
}

/** 面板拖宽等场景下 props 引用稳定时可整体跳过重渲染（宽度状态只影响布局层） */
export const GroupSidebarMemo = memo(GroupSidebar);
