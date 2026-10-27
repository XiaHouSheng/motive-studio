export interface SseParser {
  push(chunk: string): string[];
  flush(): string[];
}

/**
 * 增量解析 SSE 文本流。返回每个完整事件里的 data 载荷。
 * 支持跨 chunk 的 CRLF、多行 data、注释行以及结尾未带空行的最后一个事件。
 */
export function createSseParser(): SseParser {
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = (out: string[]) => {
    if (dataLines.length === 0) return;
    out.push(dataLines.join("\n"));
    dataLines = [];
  };

  const handleLine = (line: string, out: string[]) => {
    if (line === "") {
      dispatch(out);
      return;
    }
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
  };

  const drain = (final: boolean, out: string[]) => {
    let index = 0;

    while (index < buffer.length) {
      const lf = buffer.indexOf("\n", index);
      const cr = buffer.indexOf("\r", index);

      if (lf === -1 && cr === -1) break;

      if (cr !== -1 && (lf === -1 || cr < lf)) {
        // 单独的 \r 可能只是 \r\n 的前半，等待下一个 chunk
        if (cr === buffer.length - 1 && !final) break;
        handleLine(buffer.slice(index, cr), out);
        index = buffer[cr + 1] === "\n" ? cr + 2 : cr + 1;
        continue;
      }

      handleLine(buffer.slice(index, lf), out);
      index = lf + 1;
    }

    buffer = buffer.slice(index);

    if (final) {
      if (buffer.length > 0) handleLine(buffer, out);
      buffer = "";
      dispatch(out);
    }
  };

  return {
    push(chunk) {
      const out: string[] = [];
      buffer += chunk;
      drain(false, out);
      return out;
    },
    flush() {
      const out: string[] = [];
      drain(true, out);
      return out;
    },
  };
}

export function encodeSseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
