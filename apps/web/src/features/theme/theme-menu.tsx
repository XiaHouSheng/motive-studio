import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/theme";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const options: Array<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: "light", label: "浅色", icon: Sun },
  { mode: "dark", label: "深色", icon: Moon },
  { mode: "system", label: "跟随系统", icon: Monitor },
];

export function ThemeMenu() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);
  const TriggerIcon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="切换主题"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink data-[state=open]:bg-selection data-[state=open]:text-ink"
        >
          <TriggerIcon size={16} strokeWidth={1.8} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[168px] rounded-xl border border-line bg-elevated p-1 shadow-soft"
        >
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
            外观
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as ThemeMode)}
          >
            {options.map(({ mode: value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none select-none",
                  "data-[highlighted]:bg-selection data-[highlighted]:text-ink",
                  value === mode && "text-ink",
                )}
              >
                <Icon size={14} strokeWidth={1.8} className="text-ink-faint" />
                <span className="flex-1">{label}</span>
                <DropdownMenu.ItemIndicator>
                  <Check size={13} strokeWidth={2.2} className="text-brand" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
