import { useState, useMemo, memo } from "react";
import {
  ChevronDown,
  ChevronRight,
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
    exportGroupMarkdown,
    openImageImport,
  } = workspace;
  const selectedGroupId = useUiStore((state) => state.selectedGroupId);
  const selectedQuestionId = useUiStore((state) => state.selectedQuestionId);
  const selectGroup = useUiStore((state) => state.selectGroup);
  const selectPaperGroup = useUiStore((state) => state.selectPaperGroup);
  const selectQuestion = useUiStore((state) => state.selectQuestion);
  const t = useT();

  const [groupDraft, setGroupDraft] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  /** 每个题组的试卷分组列表展开状态（默认展开） */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
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

  /** 跨全部题组/试卷分组的题目搜索；返回 null 表示未启用搜索 */
  const searchResults = useMemo(() => {
    const keyword = searchDraft.trim().toLowerCase();
    if (!keyword) return null;
    const groupTitleById = new Map(groups.map((group) => [group.id, group.title] as const));
    const paperTitleById = new Map(paperGroups.map((paper) => [paper.id, paper.title] as const));
    return questions
      .filter((question) => question.content.toLowerCase().includes(keyword))
      .map((question) => ({
        question,
        groupTitle: groupTitleById.get(question.groupId) ?? "",
        paperTitle: paperTitleById.get(question.paperGroupId ?? "") ?? "",
      }));
  }, [searchDraft, questions, groups, paperGroups]);

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
    <div className="flex h-full min-h-0 flex-col">
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
              const collapsed = collapsedGroups[group.id] ?? false;
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
                            onNavigate?.();
                          }}
                          title={group.title}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-md py-1.5 pr-20 pl-1 text-left transition-colors",
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
                              setCollapsedGroups((current) => ({
                                ...current,
                                [group.id]: !collapsed,
                              }));
                            }}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
                          >
                            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
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
                              aria-label={t("groups.addPaperAria", { title: group.title })}
                              title={t("groups.addPaperGroup")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setRenaming(null);
                                setAddingPaperFor(group.id);
                                setPaperDraft("");
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-brand"
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              type="button"
                              aria-label={t("groups.exportAria", { title: group.title })}
                              title={t("groups.exportTitle")}
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
                          <span className="w-6 shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint">
                            {group.questionIds.length}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 试卷分组行（题组之下的二级分组） */}
                  {!collapsed ? (
                    <div className="ml-4 border-l border-line/70 pl-1.5">
                      {papers.map((paper) => {
                        const paperActive =
                          active && paper.id === selectedPaperGroup?.id;
                        const isPaperRenaming =
                          renaming?.kind === "paper" && renaming.id === paper.id;
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
                                  className="h-7 w-full rounded-md border border-brand/50 bg-field px-2 text-[12px] text-ink outline-none"
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
                                    "flex w-full items-center gap-1.5 rounded-md py-1 pr-14 pl-1.5 text-left transition-colors",
                                    paperActive
                                      ? "bg-selection text-ink"
                                      : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                                  )}
                                >
                                  <FileText
                                    size={13}
                                    strokeWidth={1.8}
                                    className={cn(
                                      "shrink-0",
                                      paperActive ? "text-brand" : "text-ink-faint",
                                    )}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-[12px]">
                                    {paper.title}
                                  </span>
                                </button>
                                <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
                                  <div className="flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover/paper:opacity-100">
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
                                    {papers.length > 1 ? (
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
                                            }),
                                          );
                                          if (ok) deletePaperGroup(paper.id);
                                        }}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}

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
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-3 border-t border-line" />

      {/* 「题目」行：唯一的添加入口（弹窗支持文字 / 图片两种方式），不再显示题目总数 */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
          {t("groups.questionsTitle")}
        </span>
        <button
          type="button"
          onClick={() =>
            selectedGroup && openImageImport(selectedGroup.id, selectedPaperGroup?.id ?? null)
          }
          disabled={!selectedGroup}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("groups.addQuestionTitle")}
          title={t("groups.addQuestionTitle")}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 题目搜索：非空时跨全部题组/试卷分组搜索 */}
      <div className="px-2 pb-2">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchDraft("");
            }}
            placeholder={t("groups.searchPlaceholder")}
            aria-label={t("groups.searchAria")}
            className="h-7 w-full rounded-md border border-line bg-field pl-7.5 pr-7 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
          />
          {searchDraft ? (
            <button
              type="button"
              onClick={() => setSearchDraft("")}
              aria-label={t("groups.searchAria")}
              className="absolute top-1/2 right-1.5 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint hover:text-ink"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-2 py-3 text-[12px] text-ink-faint">{t("groups.noSearchResults")}</p>
          ) : (
            <div className="space-y-0.5">
              {searchResults.map(({ question, groupTitle, paperTitle }) => (
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
                    <FolderOpen size={10} className="shrink-0" />
                    <span className="truncate">{groupTitle}</span>
                    <span className="shrink-0 text-ink-faint">/</span>
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
