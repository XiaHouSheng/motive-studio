import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, ScanLine, Trash2, Upload } from "lucide-react";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MAX_IMAGES = 4;
const MAX_EDGE = 1600;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解析失败"));
    image.src = src;
  });
}

/** 超长边缩放到 1600px，降低上传体积（保留原始格式） */
async function prepareFile(file: File): Promise<PreparedImage> {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    throw new Error(`「${file.name}」格式不支持，仅支持 PNG、JPEG、WebP`);
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
    throw new Error(`「${file.name}」压缩后仍超过 6MB，请裁剪后重试`);
  }

  return {
    id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    filename: file.name,
    mediaType: file.type,
    dataUrl,
  };
}

interface ImageImportDialogProps {
  workspace: WorkspaceApi;
}

export function ImageImportDialog({ workspace }: ImageImportDialogProps) {
  const {
    groups,
    imageImportGroupId,
    imageImportAnalyzing,
    imageImportCreating,
    imageImportError,
    imageImportQuestions,
    closeImageImport,
    analyzeImages,
    createQuestionsFromImages,
  } = workspace;

  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [drafts, setDrafts] = useState<QuestionDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const open = imageImportGroupId !== null;
  const groupTitle =
    groups.find((group) => group.id === imageImportGroupId)?.title ?? "题组";

  useEffect(() => {
    if (!open) {
      setImages([]);
      setDrafts([]);
      setLocalError(null);
      setDragging(false);
    }
  }, [open]);

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

  const addFiles = async (files: FileList | File[]) => {
    setLocalError(null);
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (list.length === 0) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setLocalError(`单次最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }

    try {
      const prepared = await Promise.all(list.slice(0, remaining).map(prepareFile));
      setImages((current) => [...current, ...prepared]);
      if (list.length > remaining) {
        setLocalError(`单次最多上传 ${MAX_IMAGES} 张图片，已忽略多余图片`);
      }
    } catch (prepareError) {
      setLocalError(
        prepareError instanceof Error ? prepareError.message : "图片处理失败",
      );
    }
  };

  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const selectedCount = drafts.filter((draft) => draft.include && draft.content.trim()).length;

  const handleAnalyze = async () => {
    if (images.length === 0) {
      setLocalError("请先选择题目截图");
      return;
    }
    setLocalError(null);
    const message = await analyzeImages(
      images.map((image) => ({
        mediaType: image.mediaType,
        data: image.dataUrl.split(",")[1] ?? "",
      })),
    );
    if (message) setLocalError(message);
  };

  const handleCreate = async () => {
    const contents = drafts
      .filter((draft) => draft.include)
      .map((draft) => draft.content.trim())
      .filter(Boolean);
    if (contents.length === 0) {
      setLocalError("请至少勾选一道题目");
      return;
    }
    setLocalError(null);
    const message = await createQuestionsFromImages(contents);
    if (message) setLocalError(message);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) closeImageImport();
      }}
      title="按图片导入题目"
      description={`识别截图中的题目并创建到「${groupTitle}」，识别结果可先修改再确认。`}
      className="max-w-[640px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">
            需要模型支持图片输入；公式会以 LaTeX 保留。
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={closeImageImport}
              disabled={busy}
            >
              取消
            </Button>
            {drafts.length > 0 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreate}
                disabled={busy || selectedCount === 0}
              >
                {imageImportCreating ? <Loader2 size={13} className="animate-spin" /> : null}
                {imageImportCreating ? "创建中…" : `创建 ${selectedCount} 道题目`}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={handleAnalyze}
                disabled={busy || images.length === 0}
              >
                {imageImportAnalyzing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <ScanLine size={13} />
                )}
                {imageImportAnalyzing ? "识别中…" : "识别题目"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
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
          <p className="text-[12.5px] text-ink-soft">
            拖入、粘贴（Ctrl/Cmd+V）或选择题目截图
          </p>
          <p className="text-[11px] text-ink-faint">
            支持 PNG / JPEG / WebP，单次最多 {MAX_IMAGES} 张
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
            选择图片
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
                  className="h-24 w-full object-cover"
                />
                <button
                  type="button"
                  aria-label={`移除 ${image.filename}`}
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

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {drafts.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-ink-soft">
                识别结果 · {drafts.length} 道
              </span>
              <button
                type="button"
                onClick={() => {
                  setDrafts([]);
                  setLocalError(null);
                }}
                className="text-[11.5px] text-ink-faint transition-colors hover:text-ink"
              >
                重新识别
              </button>
            </div>
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
                      aria-label={`导入第 ${index + 1} 道题目`}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id
                              ? { ...item, include: event.target.checked }
                              : item,
                          ),
                        )
                      }
                      className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                    />
                    <span className="text-[11px] text-ink-faint">
                      第 {index + 1} 道
                    </span>
                  </div>
                  <textarea
                    value={draft.content}
                    rows={3}
                    onChange={(event) =>
                      setDrafts((current) =>
                        current.map((item) =>
                          item.id === draft.id
                            ? { ...item, content: event.target.value }
                            : item,
                        ),
                      )
                    }
                    aria-label={`第 ${index + 1} 道题目内容`}
                    className="w-full resize-y rounded border border-line bg-panel px-2 py-1.5 text-[12.5px] leading-relaxed text-ink outline-none focus:border-brand/50"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
