import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Crop,
  FileText,
  ImagePlus,
  Images,
  Loader2,
  ScanLine,
  Trash2,
  Upload,
} from "lucide-react";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImageCropEditor } from "./image-crop-editor";
import { useT } from "@/lib/i18n/use-i18n";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 4;
const MAX_EDGE = 1600;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_EXTRA_PROMPT_LENGTH = 2000;

interface PreparedImage {
  id: string;
  filename: string;
  mediaType: string;
  dataUrl: string;
}

interface QuestionDraft {
  id: string;
  content: string;
  include: boolean;
}

/**
 * 模块级准备函数抛出的错误：消息词条 key 存在实例上，
 * 由调用方（组件内拿到 t 之后）翻译为当前语言的提示。
 */
class ImagePrepareError extends Error {
  constructor(
    readonly messageKey: DictionaryKey,
    readonly params?: Record<string, string | number>,
  ) {
    super(messageKey);
    this.name = "ImagePrepareError";
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImagePrepareError("import.readFailed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ImagePrepareError("import.decodeFailed"));
    image.src = src;
  });
}

/** 超长边缩放到 1600px，降低上传体积（保留原始格式） */
async function prepareFile(file: File): Promise<PreparedImage> {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    throw new ImagePrepareError("import.unsupportedType", { name: file.name });
  }

  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const longest = Math.max(image.width, image.height);
  let dataUrl = original;

  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL(file.type, 0.9);
    }
  }

  const base64 = dataUrl.split(",")[1] ?? "";
  if (Math.ceil((base64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    throw new ImagePrepareError("import.tooLarge", { name: file.name });
  }

  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    filename: file.name,
    mediaType: file.type,
    dataUrl,
  };
}

interface AddQuestionDialogProps {
  workspace: WorkspaceApi;
}

/**
 * 统一的「添加题目」弹窗：文字添加 / 图片导入两个页签切换。
 * 工作区侧栏的「+」与空题组引导都从这里进入，
 * 避免分散在题组 hover、侧栏行内表单等多处入口。
 */
export function AddQuestionDialog({ workspace }: AddQuestionDialogProps) {
  const {
    groups,
    paperGroups,
    imageImportGroupId,
    imageImportPaperGroupId,
    imageImportTab,
    imageImportAnalyzing,
    imageImportCreating,
    imageImportError,
    imageImportQuestions,
    closeImageImport,
    createQuestionIn,
    analyzeImages,
    createQuestionsFromImages,
  } = workspace;

  const t = useT();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"text" | "image" | "pdf">("text");
  const [textDraft, setTextDraft] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [attachImages, setAttachImages] = useState(true);
  const [extraPrompt, setExtraPrompt] = useState("");
  // PDF 导入页签状态
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfDragging, setPdfDragging] = useState(false);
  /** 转图片识别：页码范围（如 1-4）与渲染中状态 */
  const [pdfRange, setPdfRange] = useState("1-4");
  const [pdfRendering, setPdfRendering] = useState(false);

  const open = imageImportGroupId !== null;
  const groupTitle =
    groups.find((group) => group.id === imageImportGroupId)?.title ?? t("groups.title");
  // 目标试卷分组：显式指定优先，否则回落到题组首个试卷分组（与后端兜底一致）
  const paperTitle = (() => {
    const list = paperGroups.filter((paper) => paper.groupId === imageImportGroupId);
    const target = list.find((paper) => paper.id === imageImportPaperGroupId) ?? list[0];
    return target?.title ?? t("groups.paperDefaultFallback");
  })();

  // 打开时按入口指定的页签复位全部状态
  useEffect(() => {
    if (!open) return;
    setTab(imageImportTab);
    setTextDraft("");
    setImages([]);
    setDrafts([]);
    setLocalError(null);
    setDragging(false);
    setCroppingId(null);
    setAttachImages(true);
    setExtraPrompt("");
    setPdfFile(null);
    setPdfParsing(false);
    setPdfDragging(false);
    setPdfRange("1-4");
    setPdfRendering(false);
  }, [open, imageImportTab]);

  useEffect(() => {
    setDrafts(
      imageImportQuestions.map((content, index) => ({
        id: `draft-${index}-${content.slice(0, 8)}`,
        content,
        include: true,
      })),
    );
  }, [imageImportQuestions]);

  const error = localError ?? imageImportError;
  const busy = imageImportAnalyzing || imageImportCreating;
  const croppingImage = images.find((image) => image.id === croppingId) ?? null;

  const handleCropApplied = (dataUrl: string) => {
    const base64 = dataUrl.split(",")[1] ?? "";
    if (Math.ceil((base64.length * 3) / 4) > MAX_IMAGE_BYTES) {
      setLocalError(t("import.cropStillTooLarge"));
      return;
    }
    setImages((current) =>
      current.map((item) =>
        item.id === croppingId
          ? {
              ...item,
              mediaType: /^data:([^;]+)/.exec(dataUrl)?.[1] ?? item.mediaType,
              dataUrl,
            }
          : item,
      ),
    );
    setCroppingId(null);
  };

  const addFiles = async (files: FileList | File[]) => {
    setLocalError(null);
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (list.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setLocalError(t("import.maxImages", { count: MAX_IMAGES }));
      return;
    }

    try {
      const prepared = await Promise.all(list.slice(0, remaining).map(prepareFile));
      setImages((current) => [...current, ...prepared]);
      if (list.length > remaining) {
        setLocalError(t("import.maxImagesIgnored", { count: MAX_IMAGES }));
      }
    } catch (prepareError) {
      if (prepareError instanceof ImagePrepareError) {
        setLocalError(t(prepareError.messageKey, prepareError.params));
      } else {
        setLocalError(
          prepareError instanceof Error
            ? prepareError.message
            : t("import.processFailed"),
        );
      }
    }
  };

  // 图片页签挂载期间监听全局粘贴（裁剪中不响应）
  useEffect(() => {
    if (!open || tab !== "image") return;
    const onPaste = (event: ClipboardEvent) => {
      if (croppingId) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const selectedCount = drafts.filter((draft) => draft.include && draft.content.trim()).length;
  const trimmedExtraPrompt = extraPrompt.trim();
  const extraPromptTooLong = trimmedExtraPrompt.length > MAX_EXTRA_PROMPT_LENGTH;

  const handleAddText = () => {
    if (!textDraft.trim() || !imageImportGroupId) return;
    // 成功后由 createQuestionIn 关闭弹窗；失败时错误走工作区顶部横幅
    createQuestionIn(imageImportGroupId, textDraft);
  };

  const handleAnalyze = async () => {
    if (images.length === 0) {
      setLocalError(t("import.selectFirst"));
      return;
    }
    if (extraPromptTooLong) {
      setLocalError(t("import.extraPromptTooLong"));
      return;
    }
    setLocalError(null);
    const message = await analyzeImages(
      images.map((image) => ({
        mediaType: image.mediaType,
        data: image.dataUrl.split(",")[1] ?? "",
      })),
      trimmedExtraPrompt || undefined,
    );
    if (message) setLocalError(message);
  };

  const handleCreate = async () => {
    const contents = drafts
      .filter((draft) => draft.include)
      .map((draft) => draft.content.trim())
      .filter(Boolean);
    if (contents.length === 0) {
      setLocalError(t("import.selectAtLeastOne"));
      return;
    }
    setLocalError(null);
    const message = await createQuestionsFromImages(
      contents,
      attachImages && tab === "image"
        ? images.map((image) => ({
            mediaType: image.mediaType,
            data: image.dataUrl.split(",")[1] ?? "",
          }))
        : [],
    );
    if (message) setLocalError(message);
  };

  // ---------- PDF 导入 ----------

  const isPdfFile = (file: File) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  const acceptPdfFile = (file: File) => {
    setLocalError(null);
    if (!isPdfFile(file)) {
      setLocalError(t("import.pdfUnsupported", { name: file.name }));
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setLocalError(t("import.pdfTooLarge"));
      return;
    }
    setPdfFile(file);
    setDrafts([]);
  };

  const handleParsePdf = async () => {
    if (!pdfFile || !imageImportGroupId) return;
    setPdfParsing(true);
    setLocalError(null);
    try {
      const dataUrl = await readAsDataUrl(pdfFile);
      const result = await api.importQuestionsFromPdf(
        imageImportGroupId,
        imageImportPaperGroupId,
        dataUrl.split(",")[1] ?? "",
        pdfFile.name,
      );
      if (result.blocks.length === 0) {
        setLocalError(t("import.pdfEmpty"));
        setDrafts([]);
        return;
      }
      setDrafts(
        result.blocks.map((content, index) => ({
          id: `pdf-${index}-${content.slice(0, 8)}`,
          content,
          include: true,
        })),
      );
    } catch (parseError) {
      setLocalError(
        parseError instanceof Error ? parseError.message : t("import.pdfParseFailed"),
      );
    } finally {
      setPdfParsing(false);
    }
  };

  /**
   * 把所选页渲染为图片并切到图片导入页签（扫描版 / 公式版 PDF 走视觉模型）。
   * pdfjs-dist 懒加载，长边缩放到 1400px；单批最多 MAX_IMAGES 页。
   */
  const renderPdfPagesToImages = async () => {
    if (!pdfFile) return;

    const rangeMatch = /^(\d+)(?:\s*[-–—~～至到]\s*(\d+))?$/.exec(pdfRange.trim());
    const startInput = rangeMatch ? Number(rangeMatch[1]) : Number.NaN;
    const endInput = rangeMatch ? Number(rangeMatch[2] ?? rangeMatch[1]) : Number.NaN;
    if (!Number.isInteger(startInput) || !Number.isInteger(endInput) || startInput < 1) {
      setLocalError(t("import.pdfRangeInvalid"));
      return;
    }

    setPdfRendering(true);
    setLocalError(null);
    let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
    try {
      const [pdfjs, workerModule] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

      const loaded = await pdfjs.getDocument({ data: await pdfFile.arrayBuffer() }).promise;
      doc = loaded;
      const start = Math.min(Math.max(1, startInput), loaded.numPages);
      const end = Math.min(Math.max(start, endInput), loaded.numPages);
      if (end - start + 1 > MAX_IMAGES) {
        setLocalError(t("import.pdfRangeTooMany", { count: MAX_IMAGES }));
        return;
      }

      const rendered: PreparedImage[] = [];
      for (let pageNumber = start; pageNumber <= end; pageNumber++) {
        const page = await loaded.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1, 1400 / Math.max(base.width, base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        rendered.push({
          id: `pdf-page-${pageNumber}-${Date.now()}`,
          filename: `${pdfFile.name} · 第 ${pageNumber} 页`,
          mediaType: "image/jpeg",
          dataUrl: canvas.toDataURL("image/jpeg", 0.92),
        });
      }
      setImages(rendered);
      setDrafts([]);
      setTab("image");
    } catch (renderError) {
      setLocalError(
        renderError instanceof Error ? renderError.message : t("import.pdfRenderFailed"),
      );
    } finally {
      try {
        await doc?.destroy();
      } catch {
        // 已销毁时忽略
      }
      setPdfRendering(false);
    }
  };

  const tabButtonClass = (active: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] transition-colors",
      active
        ? "bg-panel font-medium text-ink shadow-soft"
        : "text-ink-faint hover:text-ink-soft",
    );

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) closeImageImport();
        }}
        title={t("groups.addQuestionTitle")}
        description={t("groups.addQuestionHint", { group: `${groupTitle} / ${paperTitle}` })}
        className="max-w-[640px]"
      >
        {/* 内容区定高：两个页签高度一致，切换不引起弹窗尺寸变化 */}
        <div className="flex h-[420px] flex-col">
        <div className="inline-flex shrink-0 self-start gap-0.5 rounded-lg bg-sidebar/70 p-1" role="tablist" aria-label={t("groups.addQuestionTitle")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "text"}
            onClick={() => setTab("text")}
            className={tabButtonClass(tab === "text")}
          >
            <FileText size={13} />
            {t("groups.tabText")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "image"}
            onClick={() => setTab("image")}
            className={tabButtonClass(tab === "image")}
          >
            <Images size={13} />
            {t("groups.tabImage")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pdf"}
            onClick={() => setTab("pdf")}
            className={tabButtonClass(tab === "pdf")}
          >
            <FileText size={13} />
            {t("groups.tabPdf")}
          </button>
        </div>

        {tab === "text" ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            <textarea
              autoFocus
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleAddText();
                if (event.key === "Escape") closeImageImport();
              }}
              placeholder={t("groups.questionPlaceholder")}
              className="min-h-0 w-full flex-1 resize-none rounded-md border border-line bg-field px-3 py-2.5 text-[12.8px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
            />
            {error ? (
              <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={closeImageImport} disabled={busy}>
                {t("import.cancel")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddText}
                disabled={busy || !textDraft.trim()}
              >
                {t("groups.add")}
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "image" ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void addFiles(event.dataTransfer.files);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-elevated/40 px-4 py-6 text-center transition-colors",
                dragging && "border-brand/60 bg-brand/5",
              )}
            >
              <ImagePlus size={22} strokeWidth={1.6} className="text-ink-faint" />
              <p className="text-[12.5px] text-ink-soft">{t("import.dropHint")}</p>
              <p className="text-[11px] text-ink-faint">
                {t("import.supportHint", { count: MAX_IMAGES })}
              </p>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept={SUPPORTED_TYPES.join(",")}
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || images.length >= MAX_IMAGES}
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={13} />
                {t("import.chooseImages")}
              </Button>
            </div>

            {images.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="group/img relative overflow-hidden rounded-md border border-line bg-field"
                  >
                    <img
                      src={image.dataUrl}
                      alt={image.filename}
                      className={cn("h-24 w-full object-cover", !busy && "cursor-pointer")}
                      onClick={() => {
                        if (!busy) setCroppingId(image.id);
                      }}
                    />
                    <button
                      type="button"
                      aria-label={t("import.cropAria", { name: image.filename })}
                      disabled={busy}
                      onClick={() => setCroppingId(image.id)}
                      className="absolute top-1 left-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white transition-colors hover:bg-brand/80"
                    >
                      <Crop size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("import.removeAria", { name: image.filename })}
                      disabled={busy}
                      onClick={() =>
                        setImages((current) =>
                          current.filter((item) => item.id !== image.id),
                        )
                      }
                      className="absolute top-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white transition-colors hover:bg-danger/80"
                    >
                      <Trash2 size={12} />
                    </button>
                    <p className="truncate px-1.5 py-1 text-[10.5px] text-ink-faint">
                      {image.filename}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {images.length > 0 ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-line bg-elevated/40 px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
                <input
                  type="checkbox"
                  checked={attachImages}
                  disabled={busy}
                  onChange={(event) => setAttachImages(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-brand)]"
                />
                <span>
                  {t("import.attachLabel")}
                  <span className="ml-1 text-ink-faint">{t("import.attachHint")}</span>
                </span>
              </label>
            ) : null}

            {images.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium text-ink-soft">
                    {t("import.extraPromptToggle")}
                  </span>
                  <span
                    className={cn(
                      "text-[10.5px] text-ink-faint",
                      extraPromptTooLong && "text-danger",
                    )}
                  >
                    {trimmedExtraPrompt.length} / {MAX_EXTRA_PROMPT_LENGTH}
                  </span>
                </div>
                <textarea
                  value={extraPrompt}
                  rows={2}
                  disabled={busy}
                  onChange={(event) => setExtraPrompt(event.target.value)}
                  placeholder={t("import.extraPromptPlaceholder")}
                  aria-label={t("import.extraPromptAria")}
                  className="w-full resize-y rounded-md border border-line bg-field px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
                />
                {extraPromptTooLong ? (
                  <p className="text-[11px] text-danger">{t("import.extraPromptTooLong")}</p>
                ) : null}
              </div>
            ) : null}


            {drafts.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-ink-soft">
                    {t("import.resultCount", { count: drafts.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDrafts([]);
                      setLocalError(null);
                    }}
                    className="text-[11.5px] text-ink-faint transition-colors hover:text-ink"
                  >
                    {t("import.reanalyze")}
                  </button>
                </div>
                <DraftsList drafts={drafts} onChange={setDrafts} disabled={busy} />
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="flex shrink-0 items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          </div>
        ) : null}

        {tab === "pdf" ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setPdfDragging(true);
                }}
                onDragLeave={() => setPdfDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setPdfDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) acceptPdfFile(file);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-elevated/40 px-4 py-6 text-center transition-colors",
                  pdfDragging && "border-brand/60 bg-brand/5",
                )}
              >
                <FileText size={22} strokeWidth={1.6} className="text-ink-faint" />
                <p className="text-[12.5px] text-ink-soft">{t("import.pdfDropHint")}</p>
                <p className="text-[11px] text-ink-faint">{t("import.pdfSupportHint")}</p>
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) acceptPdfFile(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pdfParsing}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <Upload size={13} />
                  {t("import.pdfChoose")}
                </Button>
                {pdfFile ? (
                  <>
                    <p
                      className="max-w-full truncate text-[11px] text-ink-soft"
                      title={pdfFile.name}
                    >
                      {pdfFile.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        value={pdfRange}
                        onChange={(event) => setPdfRange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void renderPdfPagesToImages();
                        }}
                        placeholder={t("import.pdfRangePlaceholder")}
                        aria-label={t("import.pdfPageRange")}
                        disabled={pdfRendering}
                        className="h-7 w-24 rounded-md border border-line bg-field px-2 text-center text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void renderPdfPagesToImages()}
                        disabled={pdfRendering}
                      >
                        {pdfRendering ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Images size={13} />
                        )}
                        {pdfRendering ? t("import.pdfRendering") : t("import.pdfToImages")}
                      </Button>
                    </div>
                    <p className="text-[11px] text-ink-faint">{t("import.pdfToImagesHint")}</p>
                  </>
                ) : null}
              </div>

              {drafts.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-ink-soft">
                      {t("import.resultCount", { count: drafts.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDrafts([]);
                        setLocalError(null);
                      }}
                      className="text-[11.5px] text-ink-faint transition-colors hover:text-ink"
                    >
                      {t("import.reanalyze")}
                    </button>
                  </div>
                  <DraftsList drafts={drafts} onChange={setDrafts} disabled={pdfParsing} />
                </div>
              ) : null}
            </div>
            {error ? (
              <div className="flex shrink-0 items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="ghost" size="sm" onClick={closeImageImport} disabled={pdfParsing}>
                {t("import.cancel")}
              </Button>
              {drafts.length > 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={pdfParsing || selectedCount === 0}
                >
                  {imageImportCreating ? <Loader2 size={13} className="animate-spin" /> : null}
                  {imageImportCreating
                    ? t("import.creating")
                    : t("import.createCount", { count: selectedCount })}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleParsePdf()}
                  disabled={pdfParsing || !pdfFile}
                >
                  {pdfParsing ? <Loader2 size={13} className="animate-spin" /> : null}
                  {pdfParsing ? t("import.pdfParsing") : t("import.pdfParse")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
        {tab === "image" ? (
          <>
            <p className="shrink-0 pb-1 text-[11px] text-ink-faint">{t("import.modelHint")}</p>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="ghost" size="sm" onClick={closeImageImport} disabled={busy}>
                {t("import.cancel")}
              </Button>
              {drafts.length > 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={busy || selectedCount === 0}
                >
                  {imageImportCreating ? <Loader2 size={13} className="animate-spin" /> : null}
                  {imageImportCreating
                    ? t("import.creating")
                    : t("import.createCount", { count: selectedCount })}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAnalyze}
                  disabled={busy || images.length === 0 || extraPromptTooLong}
                >
                  {imageImportAnalyzing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <ScanLine size={13} />
                  )}
                  {imageImportAnalyzing ? t("import.analyzing") : t("import.analyze")}
                </Button>
              )}
            </div>
          </>
        ) : null}
        </div>
      </Dialog>

      {croppingImage ? (
        <ImageCropEditor
          key={croppingImage.id}
          dataUrl={croppingImage.dataUrl}
          filename={croppingImage.filename}
          onCancel={() => setCroppingId(null)}
          onApply={handleCropApplied}
        />
      ) : null}
    </>
  );
}

/** 可编辑的候选题目块列表：图片导入与 PDF 导入共用 */
function DraftsList({
  drafts,
  onChange,
  disabled,
}: {
  drafts: QuestionDraft[];
  onChange: (updater: (current: QuestionDraft[]) => QuestionDraft[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      {drafts.map((draft, index) => (
        <div
          key={draft.id}
          className={cn(
            "rounded-md border border-line bg-field px-3 py-2",
            !draft.include && "opacity-55",
          )}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.include}
              disabled={disabled}
              aria-label={t("import.draftIncludeAria", { index: index + 1 })}
              onChange={(event) =>
                onChange((current) =>
                  current.map((item) =>
                    item.id === draft.id ? { ...item, include: event.target.checked } : item,
                  ),
                )
              }
              className="h-3.5 w-3.5 accent-[var(--color-brand)]"
            />
            <span className="text-[11px] text-ink-faint">
              {t("import.draftIndex", { index: index + 1 })}
            </span>
          </div>
          <textarea
            value={draft.content}
            rows={3}
            disabled={disabled}
            onChange={(event) =>
              onChange((current) =>
                current.map((item) =>
                  item.id === draft.id ? { ...item, content: event.target.value } : item,
                ),
              )
            }
            aria-label={t("import.draftContentAria", { index: index + 1 })}
            className="w-full resize-y rounded border border-line bg-panel px-2 py-1.5 text-[12.5px] leading-relaxed text-ink outline-none focus:border-brand/50"
          />
        </div>
      ))}
    </div>
  );
}
