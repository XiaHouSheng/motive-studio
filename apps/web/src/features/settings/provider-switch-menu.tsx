import { useCallback, useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Check, ChevronDown, Cpu } from "lucide-react";
import type { ProviderProfilesView } from "@motive/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

const itemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none select-none data-[highlighted]:bg-selection data-[highlighted]:text-ink";

/**
 * 顶栏模型快捷切换：触发器直接显示当前使用的模型（名称 + 模型标识），
 * 下拉列出已保存配置，选中即切换激活配置（各配置 Key 独立保存）。
 * 完整管理（新增/删除/讨论模型分开配置）在设置页「模型服务」。
 */
export function ProviderQuickSwitch() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ProviderProfilesView | null>(null);
  const [switching, setSwitching] = useState(false);

  const loadProfiles = useCallback(() => {
    api
      .getProviderProfiles()
      .then((next) => setView(next))
      .catch(() => setView(null));
  }, []);

  // 触发器要常显当前模型，挂载即拉取一次；打开菜单时再刷新
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) loadProfiles();
    },
    [loadProfiles],
  );

  const handleSwitch = useCallback(
    async (profileId: string) => {
      if (switching || view?.activeId === profileId) return;
      setSwitching(true);
      try {
        const next = await api.switchProviderProfile(profileId);
        setView((prev) =>
          prev
            ? {
                activeId: next.provider.id,
                profiles: prev.profiles.map((profile) => ({
                  ...profile,
                  isActive: profile.config.id === next.provider.id,
                })),
              }
            : prev,
        );
        setOpen(false);
      } catch {
        // 切换失败保持菜单关闭前的列表不变，可重新打开重试
        loadProfiles();
      } finally {
        setSwitching(false);
      }
    },
    [loadProfiles, switching, view],
  );

  const activeProfile = view?.profiles.find((profile) => profile.isActive);

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("topbar.modelSwitchAria")}
          title={t("topbar.modelSwitchAria")}
          className="hidden h-8 max-w-[220px] items-center gap-1.5 rounded-lg border border-line bg-field px-2 text-[11.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink data-[state=open]:bg-selection data-[state=open]:text-ink sm:inline-flex"
        >
          <Cpu size={13} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 truncate">
            {activeProfile ? (
              <>
                <span className="font-medium text-ink">{activeProfile.config.name}</span>
                <span className="ml-1 text-ink-faint">{activeProfile.config.model}</span>
              </>
            ) : (
              t("topbar.modelSwitchEmpty")
            )}
          </span>
          <ChevronDown size={12} className="shrink-0 text-ink-faint" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[232px] rounded-xl border border-line bg-elevated p-1 shadow-soft"
        >
          <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
            {t("settings.profileMenuLabel")}
          </DropdownMenu.Label>
          {view ? (
            <DropdownMenu.RadioGroup
              value={view.activeId}
              onValueChange={(value) => void handleSwitch(value)}
            >
              {view.profiles.map((profile) => (
                <DropdownMenu.RadioItem
                  key={profile.config.id}
                  value={profile.config.id}
                  disabled={switching}
                  className={cn(
                    itemClass,
                    "items-center gap-2 py-1.5 pr-2",
                  )}
                >
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate">{profile.config.name}</span>
                    <span className="block truncate text-[10.5px] text-ink-faint">
                      {profile.config.model}
                    </span>
                  </span>
                  {!profile.hasApiKey ? (
                    <AlertTriangle
                      size={12}
                      className="shrink-0 text-warning"
                      aria-label={t("settings.profileKeyMissing")}
                    />
                  ) : null}
                  <DropdownMenu.ItemIndicator>
                    <Check size={13} strokeWidth={2.2} className="shrink-0 text-brand" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          ) : (
            <div className="px-2.5 py-2 text-[11.5px] text-ink-faint">
              {t("settings.loading")}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
